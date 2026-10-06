import path from "node:path";
import os from "node:os";
export interface Config {
  port: number;
  origin: string;
  login: string;
  local: boolean;
  herdrSocket: string;
  bridgeSocket: string;
  webRoot: string;
}
export function config(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.BERGERE_PORT ?? 8787);
  const local = env.BERGERE_LOCAL === "1";
  const origin =
    env.BERGERE_ORIGIN ?? (local ? `http://127.0.0.1:${port}` : "");
  const login = env.BERGERE_TAILSCALE_LOGIN ?? "";
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid BERGERE_PORT");
  if (!origin || (!local && !login))
    throw new Error(
      "Set BERGERE_ORIGIN and BERGERE_TAILSCALE_LOGIN, or explicitly enable BERGERE_LOCAL=1.",
    );
  const url = new URL(origin);
  if (url.origin !== origin || url.username || url.password)
    throw new Error("BERGERE_ORIGIN must be a plain origin.");
  if (
    local
      ? !["127.0.0.1", "localhost"].includes(url.hostname)
      : url.protocol !== "https:"
  )
    throw new Error("Local mode requires loopback; production requires HTTPS.");
  return {
    port,
    origin,
    login,
    local,
    herdrSocket:
      env.HERDR_SOCKET_PATH ??
      path.join(os.homedir(), ".config/herdr/herdr.sock"),
    bridgeSocket:
      env.BERGERE_BRIDGE_SOCKET ??
      path.join(os.homedir(), ".local/state/bergere/bridge.sock"),
    webRoot: path.resolve("dist/web"),
  };
}
