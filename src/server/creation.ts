import { createHash } from "node:crypto";
import { access, readdir, readFile, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Schema } from "effect";
import type { CreationCatalog, CreationOperation, CreationRequest } from "../shared/creation.js";
import { record } from "../shared/transcript.js";
import type { Config } from "./config.js";
import { atomicJSON, readOperation, type StoredOperation } from "./creation-store.js";
import { getSnapshot, type HerdrSnapshot, herdrRequest } from "./herdr.js";
import { emidevChoices, prepareEmidev } from "./integrations/emidev.js";

const LinksSchema = Schema.Struct({
	roots: Schema.Record(
		Schema.String,
		Schema.Struct({ root: Schema.String, terminalId: Schema.String }),
	),
	emidev: Schema.Record(Schema.String, Schema.String),
});
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
async function directory(input: string) {
	const expanded =
		input === "~"
			? os.homedir()
			: input.startsWith("~/")
				? path.join(os.homedir(), input.slice(2))
				: input;
	if (!path.isAbsolute(expanded) || expanded.includes("\0"))
		throw new Error("Choose an absolute root directory or ~/path.");
	const root = await realpath(expanded).catch(() => {
		throw new Error("Root directory does not exist.");
	});
	if (!(await stat(root)).isDirectory()) throw new Error("Root must be a directory.");
	return root;
}
export class CreationService {
	private readonly directory: string;
	private chain: Promise<unknown> = Promise.resolve();
	constructor(private readonly config: Config) {
		const server = createHash("sha256")
			.update(path.resolve(config.herdrSocket))
			.digest("hex")
			.slice(0, 16);
		this.directory = path.join(path.dirname(config.bridgeSocket), "creation", server);
	}
	private file(id: string) {
		if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid creation operation ID.");
		return path.join(this.directory, `${id}.json`);
	}
	async hasOperation(id: string) {
		try {
			await stat(this.file(id));
			return true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
			return true;
		}
	}
	private async links() {
		try {
			return Schema.decodeUnknownSync(LinksSchema)(
				JSON.parse(await readFile(path.join(this.directory, "links.json"), "utf8")),
			);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return { roots: {}, emidev: {} };
			throw error;
		}
	}
	private async resolvedLinks(snapshot: HerdrSnapshot) {
		const saved = await this.links();
		const roots = { ...saved.roots };
		const emidev = { ...saved.emidev };
		const files = await readdir(this.directory).catch((error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return [];
			throw error;
		});
		for (const file of files.filter((f) => f.endsWith(".json.status"))) {
			const stored = await readOperation(path.join(this.directory, file));
			const op = stored.operation;
			if (
				stored.request.kind === "emidev-workspace" &&
				op.stage !== "provisioning" &&
				op.root &&
				roots[op.workspaceId]?.terminalId === op.terminalId
			) {
				roots[op.workspaceId] = { root: op.root, terminalId: op.terminalId };
				emidev[op.root] = op.workspaceId;
			}
		}
		for (const [id, savedRoot] of Object.entries(roots)) {
			if (
				!snapshot.panes.some((p) => p.workspace_id === id && p.terminal_id === savedRoot.terminalId)
			)
				delete roots[id];
		}
		for (const [root, id] of Object.entries(emidev)) if (!roots[id]) delete emidev[root];
		return { roots, emidev };
	}
	async discover(): Promise<CreationCatalog> {
		const snapshot = await getSnapshot(this.config.herdrSocket);
		const links = await this.resolvedLinks(snapshot);
		let emidev: CreationCatalog["emidev"] = {
			enabled: !!this.config.emidev,
			error: "",
			workspaces: [],
		};
		if (this.config.emidev) {
			try {
				emidev = { ...emidev, workspaces: await emidevChoices(snapshot, links.emidev) };
			} catch {
				emidev = {
					...emidev,
					error: "Emidev is unavailable. Check installation, configuration and gateway PATH.",
				};
			}
		}
		return {
			home: os.homedir(),
			emidev,
			workspaces: snapshot.workspaces.map((w) => {
				const panes = snapshot.panes.filter((p) => p.workspace_id === w.workspace_id);
				return {
					id: w.workspace_id,
					name: w.label,
					root:
						links.roots[w.workspace_id]?.root ??
						panes.find((p) => p.focused)?.cwd ??
						panes[0]?.cwd ??
						os.homedir(),
					savedRoot: !!links.roots[w.workspace_id],
				};
			}),
		};
	}
	start(id: string, request: CreationRequest): Promise<CreationOperation> {
		const next = this.chain.then(() => this.create(id, request));
		this.chain = next.catch(() => {});
		return next;
	}
	private async prepare(request: CreationRequest) {
		let prepared: { root: string; workspaceId: string; name: string };
		if (request.kind === "emidev-workspace" || request.kind === "emidev-session") {
			if (!this.config.emidev) throw new Error("Emidev integration is disabled.");
			prepared = await prepareEmidev(request, (await this.discover()).emidev);
		} else {
			if (request.kind === "session" && !request.workspaceId)
				throw new Error("Choose a workspace.");
			prepared = {
				root: await directory(request.root),
				workspaceId: request.kind === "session" ? request.workspaceId : "",
				name: request.kind === "workspace" ? request.name.trim() : "Pi",
			};
		}
		if (
			!prepared.name ||
			prepared.name.length > 100 ||
			[...prepared.name].some((c) => c.charCodeAt(0) < 32)
		)
			throw new Error("Enter a workspace name of up to 100 characters.");
		const snapshot = await getSnapshot(this.config.herdrSocket);
		if (
			prepared.workspaceId &&
			!snapshot.workspaces.some((w) => w.workspace_id === prepared.workspaceId)
		)
			throw new Error("Herdr workspace no longer exists.");
		return prepared;
	}
	private async create(id: string, request: CreationRequest): Promise<CreationOperation> {
		const file = this.file(id);
		try {
			const existing = await readOperation(file);
			if (JSON.stringify(existing.request) !== JSON.stringify(request))
				throw new Error("Operation ID already used for another request.");
			return this.status(id);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		const runner = path.resolve("dist/server/session-runner.js");
		await access(runner).catch(() => {
			throw new Error("Build Bergère before creating sessions.");
		});
		const prepared = await this.prepare(request);
		if (request.kind === "emidev-workspace") {
			const files = await readdir(this.directory).catch((error: NodeJS.ErrnoException) => {
				if (error.code === "ENOENT") return [];
				throw error;
			});
			for (const name of files.filter((f) => /^[a-f0-9-]{36}\.json$/.test(f))) {
				const previous = await readOperation(path.join(this.directory, name));
				if (previous.request.kind === "emidev-workspace" && previous.request.name === request.name)
					throw new Error(
						"A creation operation already exists for this name. Inspect its Herdr terminal before recovery.",
					);
			}
		}
		let stored: StoredOperation = {
			request,
			herdrSocket: this.config.herdrSocket,
			bridgeSocket: this.config.bridgeSocket,
			operation: {
				id,
				stage: "creating",
				root: prepared.root,
				workspaceId: prepared.workspaceId,
				paneId: "",
				terminalId: "",
				error: "",
			},
		};
		await atomicJSON(file, stored);
		try {
			const result = await herdrRequest(
				this.config.herdrSocket,
				prepared.workspaceId ? "tab.create" : "workspace.create",
				{
					...(prepared.workspaceId ? { workspace_id: prepared.workspaceId } : {}),
					cwd: prepared.root,
					label: prepared.name,
					focus: false,
				},
			);
			const pane = record(result.root_pane);
			if (
				typeof pane.pane_id !== "string" ||
				typeof pane.terminal_id !== "string" ||
				typeof pane.workspace_id !== "string"
			)
				throw new Error("Invalid Herdr creation result");
			stored = {
				...stored,
				operation: {
					...stored.operation,
					workspaceId: pane.workspace_id,
					paneId: pane.pane_id,
					terminalId: pane.terminal_id,
					stage: "launching",
				},
			};
			await atomicJSON(file, stored);
			const links = await this.links();
			await atomicJSON(path.join(this.directory, "links.json"), {
				roots: {
					...links.roots,
					[pane.workspace_id]: { root: prepared.root, terminalId: pane.terminal_id },
				},
				emidev:
					request.kind === "emidev-session"
						? { ...links.emidev, [prepared.root]: pane.workspace_id }
						: links.emidev,
			});
			await this.verifyLaunchPane(stored.operation);
			await herdrRequest(this.config.herdrSocket, "pane.send_text", {
				pane_id: pane.pane_id,
				text: [process.execPath, runner, file].map(quote).join(" "),
			});
			await this.verifyLaunchPane(stored.operation);
			await herdrRequest(this.config.herdrSocket, "pane.send_keys", {
				pane_id: pane.pane_id,
				keys: ["Enter"],
			});
			return stored.operation;
		} catch {
			const operation: CreationOperation = {
				...stored.operation,
				stage: "uncertain",
				error:
					"Herdr launch was interrupted. Inspect the created space in the terminal; this operation will not be resent.",
			};
			await atomicJSON(file, { ...stored, operation });
			return operation;
		}
	}
	private async verifyLaunchPane(operation: CreationOperation) {
		const snapshot = await getSnapshot(this.config.herdrSocket);
		if (
			!snapshot.panes.some(
				(p) => p.pane_id === operation.paneId && p.terminal_id === operation.terminalId && !p.agent,
			)
		)
			throw new Error("Launch pane changed.");
	}
	async status(id: string): Promise<CreationOperation> {
		const file = this.file(id);
		let stored = await readOperation(file);
		try {
			stored = await readOperation(`${file}.status`);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		if (stored.operation.stage === "starting" || stored.operation.stage === "provisioning") {
			const snapshot = await getSnapshot(this.config.herdrSocket);
			const pane = snapshot.panes.find(
				(p) =>
					p.pane_id === stored.operation.paneId && p.terminal_id === stored.operation.terminalId,
			);
			if (!pane)
				return {
					...stored.operation,
					stage: "failed",
					error: "The launch pane no longer exists. No command was resent.",
				};
		}
		if (
			(stored.operation.stage === "creating" || stored.operation.stage === "launching") &&
			Date.now() - (await stat(file)).mtimeMs > 30000
		)
			return {
				...stored.operation,
				stage: "uncertain",
				error:
					"The runner has not reported startup. Check the Herdr terminal; the command will not be resent.",
			};
		return stored.operation;
	}
}
