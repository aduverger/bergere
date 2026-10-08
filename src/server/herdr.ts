import net from "node:net";
import { readLines, sendLine } from "../shared/lines.js";
import { record } from "../shared/transcript.js";

interface Pane {
	pane_id: string;
	workspace_id: string;
	terminal_id: string;
	agent?: string;
	agent_status?: string;
	cwd?: string;
	focused?: boolean;
	terminal_title_stripped?: string;
	agent_session?: { kind: string; value: string };
}
export interface HerdrSnapshot {
	protocol: number;
	version: string;
	panes: Pane[];
	workspaces: { workspace_id: string; label: string }[];
}
export function herdrRequest(
	path: string,
	method: string,
	params: unknown = {},
): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		const socket = net.createConnection(path);
		const timer = setTimeout(() => socket.destroy(new Error("Herdr request timed out")), 5000);
		const finish = () => {
			clearTimeout(timer);
			socket.destroy();
		};
		socket.on("error", reject);
		socket.once("close", () => {
			clearTimeout(timer);
			reject(new Error("Herdr connection closed"));
		});
		socket.once("connect", () => sendLine(socket, { id: "bergere", method, params }));
		readLines(socket, (value) => {
			const r = record(value);
			if (r.error) {
				finish();
				reject(new Error("Herdr rejected request"));
			} else if (r.result) {
				finish();
				resolve(record(r.result));
			}
		});
	});
}
export async function getSnapshot(path: string): Promise<HerdrSnapshot> {
	const result = await herdrRequest(path, "session.snapshot");
	const s = record(result.snapshot);
	if (s.protocol !== 22 || !Array.isArray(s.panes) || !Array.isArray(s.workspaces))
		throw new Error("Herdr protocol 22 is required.");
	return s as unknown as HerdrSnapshot;
}
export function watchHerdr(
	path: string,
	onSnapshot: (s: HerdrSnapshot) => void,
	onError: () => void,
): () => void {
	let stopped = false;
	let socket: net.Socket | undefined;
	let retry: ReturnType<typeof setTimeout> | undefined;
	let dirty = false;
	let refreshing = false;
	let generation = 0;
	async function refresh(epoch: number) {
		dirty = true;
		if (refreshing) return;
		refreshing = true;
		try {
			while (dirty && !stopped && epoch === generation) {
				dirty = false;
				const s = await getSnapshot(path);
				// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Shutdown can run while the snapshot request is awaited.
				if (epoch === generation && !stopped) onSnapshot(s);
			}
		} catch {
			if (epoch === generation) socket?.destroy();
		} finally {
			refreshing = false;
			if (dirty && !stopped && epoch !== generation) void refresh(generation);
		}
	}
	function connect() {
		if (stopped) return;
		const epoch = ++generation;
		const current = net.createConnection(path);
		socket = current;
		current.once("connect", () =>
			sendLine(current, {
				id: "events",
				method: "events.subscribe",
				params: {
					subscriptions: [
						"workspace.created",
						"workspace.updated",
						"workspace.renamed",
						"workspace.closed",
						"pane.created",
						"pane.updated",
						"pane.closed",
						"pane.exited",
						"pane.agent_detected",
					].map((type) => ({ type })),
				},
			}),
		);
		readLines(current, (value) => {
			const r = record(value);
			if (r.error) {
				current.destroy();
				return;
			}
			void refresh(epoch);
		});
		current.on("error", () => {});
		current.once("close", () => {
			if (stopped) return;
			generation++;
			dirty = false;
			onError();
			retry = setTimeout(connect, 1000);
		});
	}
	connect();
	return () => {
		stopped = true;
		generation++;
		clearTimeout(retry);
		socket?.destroy();
	};
}
