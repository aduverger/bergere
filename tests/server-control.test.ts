import { it, expect } from "vitest";
import { build } from "esbuild";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  copyFile,
  writeFile,
  readFile,
  symlink,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import { config } from "../src/server/config.js";
import { tailscaleEnvironment } from "../scripts/server.js";

const whoami = {
  Node: { Name: "test.example.ts.net." },
  UserProfile: { LoginName: "owner@example.com" },
};
it("derives only the origin and login, with explicit overrides", () => {
  const env = tailscaleEnvironment(whoami, {});
  expect(env.BERGERE_ORIGIN).toBe("https://test.example.ts.net:3504");
  expect(env.BERGERE_TAILSCALE_LOGIN).toBe("owner@example.com");
  expect(env.BERGERE_LOCAL).toBe("0");
  expect(
    tailscaleEnvironment(null, {
      BERGERE_ORIGIN: "https://custom.example.ts.net:3504",
      BERGERE_TAILSCALE_LOGIN: "personal@example.com",
    }).BERGERE_TAILSCALE_LOGIN,
  ).toBe("personal@example.com");
  expect(() => tailscaleEnvironment({ Node: whoami.Node }, {})).toThrow();
  expect(() =>
    tailscaleEnvironment(
      { Node: { Name: "host/path" }, UserProfile: whoami.UserProfile },
      {},
    ),
  ).toThrow();
});
it("starts detached, handles duplicate start, stops, and rejects a reused PID", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bergere-control-"));
  const exec = promisify(execFile);
  for (const dir of ["scripts", "src/server", "dist/server", "dist/web", "bin"])
    await mkdir(path.join(root, dir), { recursive: true });
  await copyFile("Makefile", path.join(root, "Makefile"));
  await copyFile("scripts/server.ts", path.join(root, "scripts/server.ts"));
  await copyFile(
    "src/server/config.ts",
    path.join(root, "src/server/config.ts"),
  );
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ type: "module" }),
  );
  await symlink(path.resolve("node_modules"), path.join(root, "node_modules"));
  await build({
    entryPoints: ["src/server/main.ts"],
    outfile: path.join(root, "dist/server/main.js"),
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
  });
  await writeFile(path.join(root, "dist/web/index.html"), "gateway test");
  const calls = path.join(root, "tailscale-calls");
  await writeFile(
    path.join(root, "bin/tailscale"),
    `#!/bin/sh
printf '%s\\n' "$*" >> '${calls}'
if [ "$1" = whoami ] && [ "$2" = --json ]; then
printf '%s' '${JSON.stringify(whoami)}'
elif [ "$1" = serve ]; then [ ! -f "${root}/serve-fail" ]
else exit 1; fi
`,
    { mode: 0o700 },
  );
  const probe = net.createServer();
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
  const port = (probe.address() as net.AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));
  const env = {
    ...process.env,
    PATH: path.join(root, "bin") + path.delimiter + process.env.PATH,
    BERGERE_LOCAL: "0",
    BERGERE_ORIGIN: "",
    BERGERE_TAILSCALE_LOGIN: "",
    BERGERE_PORT: String(port),
    HERDR_SOCKET_PATH: path.join(root, "absent-herdr.sock"),
    BERGERE_BRIDGE_SOCKET: path.join(root, "bridge/bridge.sock"),
  };
  const run = (action: string, overrides: NodeJS.ProcessEnv = {}) =>
    exec("make", [action], {
      cwd: root,
      env: { ...env, ...overrides },
      timeout: 20000,
    });
  try {
    expect((await run("start")).stdout).toContain(
      "Started: https://test.example.ts.net:3504",
    );
    const first = JSON.parse(
      await readFile(path.join(root, ".run/server.json"), "utf8"),
    );
    expect((await run("start")).stdout).toContain("Already running");
    expect((await run("status")).stdout).toContain(`PID ${first.pid}`);
    const status = await new Promise<number>((resolve) => {
      http.get(
        `http://127.0.0.1:${port}/`,
        {
          headers: {
            Host: "test.example.ts.net:3504",
            "Tailscale-User-Login": "owner@example.com",
          },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode!);
        },
      );
    });
    expect(status).toBe(200);
    expect((await run("stop")).stdout).toContain("Stopped");
    expect(await readFile(calls, "utf8")).toContain(
      `serve --bg --yes --https=3504 http://127.0.0.1:${port} off`,
    );
    expect((await run("status")).stdout).toContain("Not running");
    await writeFile(
      path.join(root, ".run/server.json"),
      JSON.stringify({
        pid: process.pid,
        identity: "a previous process",
        origin: "https://test.example.ts.net:3504",
      }),
    );
    expect((await run("stop")).stdout).toContain("Not running");
    expect((await run("start")).stdout).toContain("Started");
    expect((await run("stop")).stdout).toContain("Stopped");
    await writeFile(path.join(root, "serve-fail"), "");
    await expect(run("start")).rejects.toThrow("Cannot enable Tailscale Serve");
    expect((await run("status")).stdout).toContain("Not running");
    await rm(path.join(root, "serve-fail"));
    await run("start");
    await writeFile(path.join(root, "serve-fail"), "");
    await expect(run("stop")).rejects.toThrow("Cannot disable Tailscale Serve");
    expect((await run("status")).stdout).toContain("Not running");
    await rm(path.join(root, "serve-fail"));
    await run("stop");
    await writeFile(path.join(root, "bin/tailscale"), "#!/bin/sh\nexit 1\n", {
      mode: 0o700,
    });
    await expect(run("start")).rejects.toThrow();
    expect((await run("status")).stdout).toContain("Not running");
    expect(
      (await run("start", { BERGERE_LOCAL: "1", BERGERE_ORIGIN: undefined }))
        .stdout,
    ).toContain(`Started: http://127.0.0.1:${port}`);
    expect((await run("stop")).stdout).toContain("Stopped");
  } finally {
    await run("stop").catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
}, 30000);

it("uses the Bergère socket by default and accepts an explicit bridge override", () => {
  expect(config({ BERGERE_LOCAL: "1" }).bridgeSocket).toBe(
    path.join(os.homedir(), ".local/state/bergere/bridge.sock"),
  );
  expect(
    config({
      BERGERE_LOCAL: "1",
      BERGERE_BRIDGE_SOCKET: "/tmp/custom-bergere.sock",
    }).bridgeSocket,
  ).toBe("/tmp/custom-bergere.sock");
});
