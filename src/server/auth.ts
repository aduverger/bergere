import type { IncomingMessage } from "node:http";
import type { Config } from "./config.js";
export function authorized(
	req: IncomingMessage,
	c: Pick<Config, "origin" | "local" | "login">,
	upgrade = false,
): boolean {
	if (req.headers.host !== new URL(c.origin).host) return false;
	if (req.headers.origin !== undefined && req.headers.origin !== c.origin) return false;
	if (upgrade && req.headers.origin !== c.origin) return false;
	if (req.headers["sec-fetch-site"] === "cross-site") return false;
	if (c.local)
		return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "");
	return req.headers["tailscale-user-login"] === c.login;
}
