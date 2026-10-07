import { promises as fs } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { MAX_FRAME_BYTES, readLines, sendLine } from "../shared/lines.js";
import {
	applyPatch,
	decodeClient,
	decodeCompanion,
	type Registration,
	type ServerMessage,
	type Session,
	type Snapshot,
} from "../shared/protocol.js";
import { transcriptTools } from "../shared/transcript.js";
import { authorized } from "./auth.js";
import { browserMessage, browserTool } from "./browser-transcript.js";
import type { Config } from "./config.js";
import { getSnapshot, type HerdrSnapshot, watchHerdr } from "./herdr.js";

interface Attachment {
	socket: net.Socket;
	registration: Registration;
	state: Snapshot;
	terminalId: string;
}
export async function startGateway(c: Config): Promise<() => Promise<void>> {
	await fs.mkdir(path.dirname(c.bridgeSocket), {
		recursive: true,
		mode: 0o700,
	});
	const dir = await fs.stat(path.dirname(c.bridgeSocket));
	if (dir.uid !== process.getuid?.() || (dir.mode & 0o077) !== 0)
		throw new Error("Bridge directory must be owned by this user and mode 0700.");
	try {
		const existing = await fs.lstat(c.bridgeSocket);
		if (!existing.isSocket() || existing.uid !== dir.uid)
			throw new Error("Bridge path is not a socket owned by this user.");
		await new Promise<void>((resolve, reject) => {
			const probe = net.createConnection(c.bridgeSocket);
			probe.setTimeout(1000, () => probe.destroy(new Error("Bridge probe timed out")));
			probe.once("connect", () => {
				probe.destroy();
				reject(new Error("Another gateway is already running."));
			});
			probe.once("error", (error: NodeJS.ErrnoException) => {
				if (error.code === "ECONNREFUSED") resolve();
				else reject(error);
			});
		});
		const current = await fs.lstat(c.bridgeSocket);
		if (current.ino !== existing.ino) throw new Error("Bridge socket changed during startup.");
		await fs.unlink(c.bridgeSocket);
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
	}
	let herdr: HerdrSnapshot | undefined;
	let discoveryError = "Connecting to Herdr…";
	const attachments = new Map<string, Attachment>();
	const browsers = new Map<WebSocket, string>();
	const connections = new Set<net.Socket>();
	const pending = new Map<
		string,
		{ clients: Set<WebSocket>; timer: ReturnType<typeof setTimeout> }
	>();
	function clearPending(id: string) {
		clearTimeout(pending.get(id)?.timer);
		pending.delete(id);
	}
	const key = (generation: string, id: string) => `${generation}:${id}`;
	function send(ws: WebSocket, msg: ServerMessage) {
		if (ws.readyState !== WebSocket.OPEN) return;
		if (ws.bufferedAmount > 1024 * 1024) {
			ws.close(1013, "Reconnect for fresh state");
			return;
		}
		if (msg.type === "snapshot")
			msg = {
				...msg,
				snapshot: {
					...msg.snapshot,
					messages: msg.snapshot.messages.map(browserMessage),
					tools: msg.snapshot.tools.map(browserTool),
				},
			};
		if (msg.type === "patch")
			msg = {
				...msg,
				patch: {
					...msg.patch,
					...(msg.patch.messages
						? {
								messages: {
									...msg.patch.messages,
									items: msg.patch.messages.items.map(browserMessage),
								},
							}
						: {}),
					...(msg.patch.tools
						? {
								tools: {
									...msg.patch.tools,
									items: msg.patch.tools.items.map(browserTool),
								},
							}
						: {}),
				},
			};
		ws.send(JSON.stringify(msg));
	}
	function valid(a: Attachment, s = herdr) {
		const p = s?.panes.find((p) => p.pane_id === a.registration.paneId);
		const ref = p?.agent_session;
		return (
			!!p &&
			p.agent === "pi" &&
			p.terminal_id === a.terminalId &&
			!!ref &&
			(ref.kind === "path" ? ref.value === a.state.sessionPath : ref.value === a.state.sessionId)
		);
	}
	function sessions(): Session[] {
		return (herdr?.panes ?? [])
			.filter((p) => p.agent === "pi")
			.map((p) => {
				const a = attachments.get(p.pane_id);
				const connected = !!a && valid(a) && !a.state.error;
				return {
					paneId: p.pane_id,
					workspaceId: p.workspace_id,
					workspace:
						herdr?.workspaces.find((w) => w.workspace_id === p.workspace_id)?.label ??
						p.workspace_id,
					title: p.terminal_title_stripped ?? "Pi session",
					cwd: p.cwd ?? "",
					status: a?.state.busy ? "working" : (p.agent_status ?? "unknown"),
					connected,
					generation: connected ? a.state.generation : "",
					reason: connected
						? ""
						: (a?.state.error ?? "Load the Bergère companion in this Pi session."),
				};
			});
	}
	let publishedSessions = "";
	function publishSessions(newClient?: WebSocket) {
		const msg = {
			type: "sessions" as const,
			version: 2 as const,
			sessions: sessions(),
			error: discoveryError,
		};
		const serialized = JSON.stringify(msg);
		if (serialized !== publishedSessions) {
			publishedSessions = serialized;
			for (const ws of browsers.keys()) send(ws, msg);
		} else if (newClient) send(newClient, msg);
	}
	function publishPane(paneId: string, message: ServerMessage) {
		for (const [ws, selected] of browsers) if (selected === paneId) send(ws, message);
	}
	function unavailable(paneId: string, error: string) {
		for (const [ws, selected] of browsers)
			if (selected === paneId) send(ws, { type: "unavailable", version: 2, paneId, error });
	}
	function drop(a: Attachment) {
		if (attachments.get(a.registration.paneId) !== a) return;
		attachments.delete(a.registration.paneId);
		console.info("Companion detached");
		unavailable(
			a.registration.paneId,
			"Companion disconnected. Delivery of unacknowledged commands is uncertain.",
		);
		for (const [id, { clients }] of pending)
			if (id.startsWith(`${a.state.generation}:`)) {
				for (const ws of clients)
					send(ws, {
						type: "unavailable",
						version: 2,
						paneId: a.registration.paneId,
						error: "Command delivery is uncertain. Check the transcript before sending again.",
					});
				clearPending(id);
			}
		publishSessions();
	}
	function acknowledge(
		msg: Extract<ReturnType<typeof decodeCompanion>, { type: "ack" }>,
		attachment: Attachment,
	) {
		if (msg.generation !== attachment.state.generation) return;
		const id = key(msg.generation, msg.id);
		for (const ws of pending.get(id)?.clients ?? []) send(ws, msg);
		clearPending(id);
	}
	function updateTranscript(
		msg: Extract<ReturnType<typeof decodeCompanion>, { type: "snapshot" | "patch" }>,
		attachment: Attachment,
	) {
		if (msg.type === "snapshot") {
			if (msg.snapshot.generation !== attachment.state.generation)
				throw new Error("Register a new generation");
			attachment.state = msg.snapshot;
		} else {
			const next = applyPatch(attachment.state, msg.patch);
			if (!next) {
				sendLine(attachment.socket, { type: "resync" });
				return;
			}
			attachment.state = next;
		}
		publishPane(msg.paneId, msg);
		publishSessions();
	}
	const bridge = net.createServer((socket) => {
		connections.add(socket);
		let attachment: Attachment | undefined;
		let chain = Promise.resolve();
		socket.on("error", () => {});
		socket.on("close", () => {
			connections.delete(socket);
			if (attachment) drop(attachment);
		});
		async function register(msg: Registration) {
			if (path.resolve(msg.herdrSocket) !== path.resolve(c.herdrSocket))
				throw new Error("Wrong Herdr server");
			const snapshot = await getSnapshot(c.herdrSocket);
			if (socket.destroyed) return;
			const pane = snapshot.panes.find((p) => p.pane_id === msg.paneId);
			if (!pane) throw new Error("Missing pane");
			const candidate = {
				socket,
				registration: msg,
				state: msg.snapshot,
				terminalId: pane.terminal_id,
			};
			if (!valid(candidate, snapshot)) throw new Error("Session mismatch");
			const old = attachments.get(msg.paneId);
			if (old) {
				drop(old);
				if (old.socket !== socket) old.socket.destroy();
			}
			if (attachment && attachment !== old) drop(attachment);
			herdr = snapshot;
			discoveryError = "";
			attachment = candidate;
			attachments.set(msg.paneId, candidate);
			console.info("Companion attached");
			publishSessions();
			publishPane(msg.paneId, {
				type: "snapshot",
				version: 2,
				paneId: msg.paneId,
				snapshot: candidate.state,
			});
		}
		readLines(socket, (value) => {
			chain = chain
				.then(async () => {
					if (
						typeof value === "object" &&
						value !== null &&
						"version" in value &&
						value.version !== 2
					)
						throw new Error(
							"Companion protocol version mismatch: expected 2; rebuild and reload the companion",
						);
					const msg = decodeCompanion(value);
					if (msg.type === "register") {
						await register(msg);
						return;
					}
					if (!attachment || attachments.get(msg.paneId) !== attachment)
						throw new Error("Not registered");
					if (msg.type === "ack") {
						acknowledge(msg, attachment);
						return;
					}
					updateTranscript(msg, attachment);
				})
				.catch((error: unknown) => {
					const reasons = [
						"Wrong Herdr server",
						"Missing pane",
						"Session mismatch",
						"Not registered",
						"Register a new generation",
						"Companion protocol version mismatch: expected 2; rebuild and reload the companion",
					];
					const reason =
						error instanceof Error && reasons.includes(error.message)
							? error.message
							: "Invalid companion payload or Herdr snapshot unavailable";
					console.warn(`Companion registration or protocol rejected: ${reason}`);
					socket.destroy();
				});
		});
	});
	const wss = new WebSocketServer({
		noServer: true,
		maxPayload: MAX_FRAME_BYTES,
	});
	function serveTool(url: URL, req: http.IncomingMessage, res: http.ServerResponse) {
		const attachment = attachments.get(url.searchParams.get("paneId") ?? "");
		if (
			!attachment ||
			!valid(attachment) ||
			attachment.state.generation !== url.searchParams.get("generation")
		) {
			res.writeHead(409).end("Session changed. Reopen the tool.");
			return;
		}
		const tool = transcriptTools(attachment.state.messages, attachment.state.tools).get(
			url.searchParams.get("id") ?? "",
		);
		if (!tool) {
			res.writeHead(404).end("Tool no longer available.");
			return;
		}
		res.setHeader("Content-Type", "application/json");
		res.end(req.method === "HEAD" ? undefined : JSON.stringify(tool));
		return;
	}
	async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
		res.setHeader("Cache-Control", "no-store");
		res.setHeader("X-Content-Type-Options", "nosniff");
		res.setHeader("Referrer-Policy", "no-referrer");
		res.setHeader(
			"Content-Security-Policy",
			"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
		);
		if (!authorized(req, c)) {
			res.writeHead(403);
			res.end("Forbidden");
			return;
		}
		if (c.nativeOrigin && req.headers.origin === c.nativeOrigin) {
			res.setHeader("Access-Control-Allow-Origin", c.nativeOrigin);
			res.setHeader("Vary", "Origin");
		}
		if (req.method !== "GET" && req.method !== "HEAD") {
			res.writeHead(405);
			res.end();
			return;
		}
		try {
			const url = new URL(req.url ?? "/", c.origin);
			if (url.pathname === "/api/tool") {
				serveTool(url, req, res);
				return;
			}
			const relative = decodeURIComponent(url.pathname);
			const file = path.resolve(c.webRoot, `.${relative === "/" ? "/index.html" : relative}`);
			if (!file.startsWith(c.webRoot + path.sep)) {
				res.writeHead(403);
				res.end();
				return;
			}
			const data = await fs.readFile(file);
			if (/^\/assets\/[^/]+-[\w-]+\.(js|css)$/.test(relative))
				res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
			const mime: Record<string, string> = {
				".html": "text/html",
				".js": "text/javascript",
				".css": "text/css",
				".svg": "image/svg+xml",
				".webmanifest": "application/manifest+json",
				".png": "image/png",
			};
			res.setHeader("Content-Type", mime[path.extname(file)] ?? "application/octet-stream");
			res.end(req.method === "HEAD" ? undefined : data);
		} catch {
			res.writeHead(404);
			res.end("Not found");
		}
	}
	const server = http.createServer((req, res) => {
		void handleRequest(req, res).catch(() => res.destroy());
	});
	server.on("upgrade", (req, socket, head) => {
		if (req.url !== "/ws" || !authorized(req, c, true)) {
			socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
			return;
		}
		wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
	});
	wss.on("connection", (ws) => {
		browsers.set(ws, "");
		publishSessions(ws);
		let alive = true;
		ws.on("pong", () => {
			alive = true;
		});
		const heartbeat = setInterval(() => {
			if (!alive) {
				ws.terminate();
				return;
			}
			alive = false;
			ws.ping();
		}, 25000);
		ws.on("close", () => {
			clearInterval(heartbeat);
			browsers.delete(ws);
			for (const [id, { clients }] of pending) {
				clients.delete(ws);
				if (!clients.size) clearPending(id);
			}
		});
		ws.on("error", () => {});
		ws.on("message", (raw) => {
			void handleMessage(raw).catch(() => ws.close(1011, "Command failed"));
		});
		async function handleMessage(raw: import("ws").RawData) {
			let msg: ReturnType<typeof decodeClient>;
			try {
				msg = decodeClient(JSON.parse(raw.toString()));
			} catch {
				ws.close(1008, "Invalid protocol");
				return;
			}
			if (msg.type === "subscribe") {
				browsers.set(ws, msg.paneId);
				const a = attachments.get(msg.paneId);
				if (a && valid(a))
					send(ws, {
						type: "snapshot",
						version: 2,
						paneId: msg.paneId,
						snapshot: a.state,
					});
				else
					send(ws, {
						type: "unavailable",
						version: 2,
						paneId: msg.paneId,
						error: "Session companion unavailable.",
					});
				return;
			}
			const fail = (error: string) =>
				send(ws, {
					type: "ack",
					version: 2,
					id: msg.id,
					paneId: msg.paneId,
					generation: msg.generation,
					ok: false,
					error,
				});
			const a = attachments.get(msg.paneId);
			if (!a || browsers.get(ws) !== msg.paneId || a.state.generation !== msg.generation) {
				fail("Session changed. Reopen it.");
				return;
			}
			try {
				const snapshot = await getSnapshot(c.herdrSocket);
				if (
					!valid(a, snapshot) ||
					attachments.get(msg.paneId) !== a ||
					a.state.generation !== msg.generation ||
					browsers.get(ws) !== msg.paneId ||
					ws.readyState !== WebSocket.OPEN
				) {
					fail("Session is no longer attached.");
					return;
				}
				const id = key(msg.generation, msg.id);
				let entry = pending.get(id);
				if (!entry) {
					const clients = new Set<WebSocket>();
					const timer = setTimeout(() => {
						for (const client of clients) client.close(1013, "Command acknowledgement timed out");
						clearPending(id);
					}, 15000);
					entry = { clients, timer };
					pending.set(id, entry);
				}
				entry.clients.add(ws);
				sendLine(a.socket, msg);
			} catch {
				fail("Herdr is unavailable. Command was not sent.");
			}
		}
	});
	const stopWatch = watchHerdr(
		c.herdrSocket,
		(s) => {
			const recovered = !herdr;
			if (recovered) console.info("Herdr discovery connected");
			herdr = s;
			discoveryError = "";
			for (const a of attachments.values())
				if (!valid(a)) {
					drop(a);
					a.socket.destroy();
				}
			publishSessions();
			if (recovered)
				for (const [ws, paneId] of browsers) {
					const a = attachments.get(paneId);
					if (a && valid(a))
						send(ws, {
							type: "snapshot",
							version: 2,
							paneId,
							snapshot: a.state,
						});
				}
		},
		() => {
			if (herdr) console.warn("Herdr discovery disconnected");
			herdr = undefined;
			discoveryError = "Herdr disconnected. Waiting to reconnect.";
			for (const a of attachments.values()) {
				unavailable(a.registration.paneId, discoveryError);
			}
			publishSessions();
		},
	);
	let bridgeOwned = false;
	try {
		await new Promise<void>((resolve, reject) => {
			bridge.once("error", reject);
			bridge.listen(c.bridgeSocket, () => {
				bridgeOwned = true;
				resolve();
			});
		});
		await fs.chmod(c.bridgeSocket, 0o600);
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(c.port, "127.0.0.1", () => resolve());
		});
	} catch (error) {
		stopWatch();
		for (const socket of connections) socket.destroy();
		for (const id of pending.keys()) clearPending(id);
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- The listen callback sets ownership before a later startup failure.
		if (bridgeOwned) await new Promise<void>((resolve) => bridge.close(() => resolve()));
		server.close();
		wss.close();
		throw error;
	}
	console.info(
		`Gateway listening on loopback:${c.port} (${c.local ? "local development" : "identity restricted"})`,
	);
	return async () => {
		stopWatch();
		for (const id of pending.keys()) clearPending(id);
		for (const ws of browsers.keys()) ws.terminate();
		for (const socket of connections) socket.destroy();
		wss.close();
		await Promise.all([
			new Promise<void>((r) => server.close(() => r())),
			new Promise<void>((r) => bridge.close(() => r())),
		]);
	};
}
