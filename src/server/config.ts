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
  const port = Number(env.PMH_PORT ?? 8787);
  const local = env.PMH_LOCAL === "1";
  const origin = env.PMH_ORIGIN ?? (local ? `http://127.0.0.1:${port}` : "");
  const login = env.PMH_TAILSCALE_LOGIN ?? "";
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid PMH_PORT");
  if (!origin || (!local && !login))
    throw new Error(
      "Set PMH_ORIGIN and PMH_TAILSCALE_LOGIN, or explicitly enable PMH_LOCAL=1.",
    );
  const url = new URL(origin);
  if (url.origin !== origin || url.username || url.password)
    throw new Error("PMH_ORIGIN must be a plain origin.");
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
      env.PMH_BRIDGE_SOCKET ??
      path.join(os.homedir(), ".local/state/pi-mobile-herdr/bridge.sock"),
    webRoot: path.resolve("dist/web"),
  };
}
