import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { getSnapshot } from "../src/server/herdr.js";
import { startGateway } from "../src/server/gateway.js";
export async function waitFor<T>(
  read: () => Promise<T | undefined> | T | undefined,
  timeout = 15000,
): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const value = await read();
      if (value !== undefined) return value;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Timed out waiting for local test state");
}
export async function localHarness(port = 8788) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pmh-"));
  await mkdir(path.join(root, "herdr"), { recursive: true });
  await writeFile(path.join(root, "herdr/config.toml"), "");
  await mkdir(path.join(root, "pi/extensions"), { recursive: true });
  await mkdir(path.join(root, "bridge"), { mode: 0o700 });
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (key.startsWith("HERDR_")) delete env[key];
  Object.assign(env, {
    XDG_CONFIG_HOME: root,
    XDG_STATE_HOME: root,
    PI_CODING_AGENT_DIR: path.join(root, "pi"),
    PMH_BRIDGE_SOCKET: path.join(root, "bridge/bridge.sock"),
    PMH_TEST_PID_FILE: path.join(root, "pi.pid"),
  });
  const herdrSocket = path.join(root, "herdr/herdr.sock");
  let log = "";
  const server = spawn("herdr", ["server"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr?.on("data", (b) => {
    log += String(b);
  });
  server.stdout?.on("data", (b) => {
    log += String(b);
  });
  let stopGateway: (() => Promise<void>) | undefined;
  const cli = (args: string[]) =>
    execFileSync("herdr", args, {
      env: { ...env, HERDR_SOCKET_PATH: herdrSocket },
      encoding: "utf8",
    });
  async function close() {
    await stopGateway?.();
    try {
      cli(["server", "stop"]);
    } catch {
      server.kill("SIGTERM");
    }
    await waitFor(
      () => (server.exitCode !== null ? true : undefined),
      5000,
    ).catch(() => server.kill("SIGTERM"));
    await rm(root, { recursive: true, force: true });
  }
  try {
    await waitFor(() => getSnapshot(herdrSocket), 15000);
    const created = JSON.parse(
      cli(["workspace", "create", "--cwd", root, "--label", "Pi mobile test"]),
    );
    const paneId = created.result.root_pane.pane_id;
    cli(["integration", "install", "pi"]);
    const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
    const args = [
      process.execPath,
      path.resolve("node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--provider",
      "pmh-test",
      "--model",
      "test",
      "--extension",
      path.resolve("tests/fixtures/pi-provider.ts"),
      "--extension",
      path.join(root, "pi/extensions/herdr-agent-state.ts"),
      "--extension",
      path.resolve("dist/extension/index.js"),
    ];
    cli(["pane", "run", paneId, args.map(quote).join(" ")]);
    const config = {
      port,
      origin: `http://127.0.0.1:${port}`,
      login: "",
      local: true,
      herdrSocket,
      bridgeSocket: env.PMH_BRIDGE_SOCKET!,
      webRoot: path.resolve("dist/web"),
    };
    stopGateway = await startGateway(config);
    await waitFor(() => readFile(path.join(root, "pi.pid"), "utf8"));
    const pid = await readFile(path.join(root, "pi.pid"), "utf8");
    return {
      root,
      paneId,
      pid,
      herdrSocket,
      config,
      cli,
      close,
      restart: async () => {
        await stopGateway?.();
        stopGateway = await startGateway(config);
      },
      terminal: (text: string) => cli(["agent", "prompt", paneId, text]),
      readTerminal: () =>
        cli([
          "pane",
          "read",
          paneId,
          "--source",
          "recent-unwrapped",
          "--lines",
          "100",
        ]),
      readPid: () => readFile(path.join(root, "pi.pid"), "utf8"),
    };
  } catch (e) {
    console.error(log.slice(-3000));
    await close();
    throw e;
  }
}
if (process.argv[1]?.endsWith("local-harness.ts")) {
  const harness = await localHarness(Number(process.env.PMH_TEST_PORT ?? 8788));
  console.info(`LOCAL_HARNESS_READY http://127.0.0.1:${harness.config.port}`);
  const close = async () => {
    await harness.close();
    process.exit(0);
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}
