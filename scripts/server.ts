import { spawn, execFileSync } from "node:child_process";
import { mkdir, open, readFile, unlink, access } from "node:fs/promises";
import path from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "../src/server/config.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const runtime = path.join(root, ".run");
const pidFile = path.join(runtime, "server.json");
const logFile = path.join(runtime, "server.log");
type Running = {
  pid: number;
  identity: string;
  origin: string;
  serve: boolean;
  port: number;
};
const serveFlags = ["--bg", "--yes", "--https=3504"];
function serve(port: number, off = false) {
  try {
    execFileSync(
      "tailscale",
      [
        "serve",
        ...serveFlags,
        `http://127.0.0.1:${port}`,
        ...(off ? ["off"] : []),
      ],
      { stdio: ["ignore", "pipe", "pipe"], timeout: 15000 },
    );
  } catch {
    throw new Error(
      `Cannot ${off ? "disable" : "enable"} Tailscale Serve on port 3504. Check Tailscale permissions and HTTPS setup. Run tailscale serve status for details.`,
    );
  }
}

export function tailscaleEnvironment(
  value: unknown,
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const identity = value as {
    Node?: { Name?: unknown };
    UserProfile?: { LoginName?: unknown };
  } | null;
  const name = identity?.Node?.Name;
  const login = identity?.UserProfile?.LoginName;
  const origin =
    env.BERGERE_ORIGIN ||
    (typeof name === "string" && /^[a-z0-9.-]+\.?$/i.test(name)
      ? `https://${name.replace(/\.$/, "")}:3504`
      : "");
  const allowedLogin =
    env.BERGERE_TAILSCALE_LOGIN ||
    (typeof login === "string" ? login.trim() : "");
  if (!origin || !allowedLogin)
    throw new Error(
      "tailscale whoami did not supply a DNS name and user login. Set BERGERE_ORIGIN and BERGERE_TAILSCALE_LOGIN explicitly for a tagged/server-owned node.",
    );
  const result = {
    ...env,
    BERGERE_LOCAL: "0",
    BERGERE_ORIGIN: origin,
    BERGERE_TAILSCALE_LOGIN: allowedLogin,
  };
  config(result);
  if (new URL(origin).port !== "3504")
    throw new Error("BERGERE_ORIGIN must use HTTPS port 3504 for make start.");
  return result;
}
function processIdentity(pid: number): string | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 1) return;
  try {
    return (
      execFileSync("ps", ["-p", String(pid), "-o", "lstart=", "-o", "args="], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
      }).trim() || undefined
    );
  } catch {
    return;
  }
}
async function recorded(): Promise<Running | undefined> {
  try {
    const saved = JSON.parse(await readFile(pidFile, "utf8")) as Running;
    return saved;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
async function running(): Promise<Running | undefined> {
  const saved = await recorded();
  return saved?.identity && processIdentity(saved.pid) === saved.identity
    ? saved
    : undefined;
}
async function start() {
  await mkdir(runtime, { recursive: true, mode: 0o700 });
  const current = await running();
  if (current) {
    if (current.serve) serve(current.port);
    console.info(`Already running: ${current.origin} (PID ${current.pid})`);
    return;
  }
  await unlink(pidFile).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  const record = await open(pidFile, "wx", 0o600);
  let child: ReturnType<typeof spawn> | undefined;
  try {
    await access(path.join(root, "dist/server/main.js"));
    let env = { ...process.env };
    if (env.BERGERE_LOCAL !== "1") {
      let identity: unknown = null;
      if (!env.BERGERE_ORIGIN || !env.BERGERE_TAILSCALE_LOGIN) {
        try {
          identity = JSON.parse(
            execFileSync("tailscale", ["whoami", "--json"], {
              encoding: "utf8",
              stdio: ["ignore", "pipe", "ignore"],
              timeout: 10000,
            }),
          );
        } catch {
          throw new Error(
            "Cannot run tailscale whoami --json. Check Tailscale is installed and connected, or set BERGERE_ORIGIN and BERGERE_TAILSCALE_LOGIN explicitly.",
          );
        }
      }
      env = tailscaleEnvironment(identity, env);
    }
    const settings = config(env);
    const log = await open(logFile, "a", 0o600);
    try {
      child = spawn(
        process.execPath,
        [path.join(root, "dist/server/main.js")],
        {
          cwd: root,
          env,
          detached: true,
          stdio: ["ignore", log.fd, log.fd, "ipc"],
        },
      );
    } finally {
      await log.close();
    }
    const server = child;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => done(new Error("Gateway startup timed out.")),
        15000,
      );
      const exited = () => done(new Error("Gateway failed to start."));
      const failed = (error: Error) => done(error);
      const message = (value: unknown) => {
        if ((value as { type?: string })?.type === "ready") done();
      };
      function done(error?: Error) {
        clearTimeout(timeout);
        server.off("exit", exited);
        server.off("error", failed);
        server.off("message", message);
        error ? reject(error) : resolve();
      }
      server.once("exit", exited);
      server.once("error", failed);
      server.on("message", message);
    });
    const identity = processIdentity(server.pid!);
    if (!identity) throw new Error("Cannot verify gateway process identity.");
    await record.writeFile(
      JSON.stringify({
        pid: server.pid,
        identity,
        origin: settings.origin,
        serve: !settings.local,
        port: settings.port,
      }),
    );
    if (!settings.local) serve(settings.port);
    server.disconnect();
    server.unref();
    console.info(
      `Started: ${settings.origin} (PID ${server.pid})\nLog: ${logFile}`,
    );
  } catch (error) {
    child?.kill("SIGTERM");
    child?.unref();
    await unlink(pidFile);
    throw new Error(
      `${error instanceof Error ? error.message : "Start failed"} Build with pnpm build if needed. Check ${logFile}.`,
    );
  } finally {
    await record.close();
  }
}
async function stop() {
  const saved = await recorded();
  const current = await running();
  let serveError: unknown;
  if (saved?.serve) {
    try {
      serve(saved.port, true);
    } catch (error) {
      serveError = error;
    }
  }
  if (!current) {
    if (serveError) throw serveError;
    await unlink(pidFile).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    console.info("Not running.");
    return;
  }
  if (processIdentity(current.pid) === current.identity)
    process.kill(current.pid, "SIGTERM");
  for (let i = 0; i < 100; i++) {
    if (processIdentity(current.pid) !== current.identity) {
      if (serveError) throw serveError;
      await unlink(pidFile);
      console.info("Stopped.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    "Gateway has not exited yet. Inspect the log; no forced kill was sent.",
  );
}
async function main(action: string) {
  if (action === "start") await start();
  else if (action === "stop") await stop();
  else if (action === "status") {
    const current = await running();
    console.info(
      current
        ? `Running: ${current.origin} (PID ${current.pid})`
        : "Not running.",
    );
  } else throw new Error("Usage: make start|stop|status|logs");
}
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
