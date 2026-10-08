import { execFile, spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Schema } from "effect";
import type { CreationCatalog, CreationRequest } from "../../shared/creation.js";
import type { HerdrSnapshot } from "../herdr.js";

const WorkspaceSchema = Schema.Struct({
	name: Schema.String,
	path: Schema.String,
	repositories: Schema.Array(Schema.String),
});
const ListSchema = Schema.Struct({ ok: Schema.Literal(true), data: Schema.Array(WorkspaceSchema) });
const ResultSchema = Schema.Struct({
	ok: Schema.Literal(true),
	data: Schema.Struct({ workspace: WorkspaceSchema }),
});
async function listEmidev() {
	const { stdout } = await promisify(execFile)("emidev", ["workspace", "list", "--json"], {
		timeout: 15000,
		maxBuffer: 4 * 1024 * 1024,
	});
	const result = Schema.decodeUnknownSync(ListSchema)(JSON.parse(stdout));
	return Promise.all(result.data.map(async (w) => ({ ...w, path: await realpath(w.path) })));
}
function contains(root: string, directory: string) {
	const relative = path.relative(root, directory);
	return (
		relative === "" ||
		(!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
	);
}
export async function emidevChoices(
	snapshot: HerdrSnapshot,
	links: Record<string, string>,
): Promise<CreationCatalog["emidev"]["workspaces"]> {
	const workspaces = await listEmidev();
	const paneRoots = await Promise.all(
		snapshot.panes.map(async (pane) => {
			const directory = pane.cwd ? await realpath(pane.cwd).catch(() => "") : "";
			const owner = workspaces
				.filter((w) => directory && contains(w.path, directory))
				.sort((a, b) => b.path.length - a.path.length)[0];
			return { space: pane.workspace_id, root: owner?.path };
		}),
	);
	return workspaces.map((w) => {
		const saved = snapshot.workspaces.some((s) => s.workspace_id === links[w.path])
			? links[w.path]
			: undefined;
		const candidates = [...new Set(paneRoots.filter((p) => p.root === w.path).map((p) => p.space))];
		const candidate = candidates[0];
		const mixed =
			candidate &&
			paneRoots.some((p) => p.space === candidate && p.root !== undefined && p.root !== w.path);
		return {
			name: w.name,
			root: w.path,
			repositories: w.repositories,
			workspaceId: saved ?? (candidates.length === 1 && !mixed ? (candidate ?? "") : ""),
			candidates,
		};
	});
}
function validateEmidevName(name: string) {
	if (!/^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/.test(name) || name.length > 100)
		throw new Error(
			"Use a lowercase workspace name with letters, numbers, hyphens or underscores.",
		);
}
function validateRepositories(repositories: readonly string[]) {
	if (
		!repositories.length ||
		repositories.length > 30 ||
		repositories.some(
			(r) =>
				r.length > 100 ||
				!/^[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?$/.test(r) ||
				r.includes(".."),
		)
	)
		throw new Error("Enter valid repository names, without paths or command options.");
}
export async function provisionEmidev(
	name: string,
	repositories: readonly string[],
): Promise<string> {
	validateEmidevName(name);
	validateRepositories(repositories);
	const stdout = await new Promise<string>((resolve, reject) => {
		const child = spawn(
			"emidev",
			["workspace", "create", "--json", "-n", name, ...repositories.flatMap((r) => ["-r", r])],
			{ stdio: ["ignore", "pipe", "inherit"] },
		);
		let output = "";
		child.stdout.on("data", (chunk) => {
			output += String(chunk);
			if (output.length > 4 * 1024 * 1024) {
				child.kill();
				reject(new Error("Emidev output exceeded the limit."));
			}
		});
		child.on("error", () => reject(new Error("Cannot start emidev. Check the terminal PATH.")));
		child.on("close", (code) => {
			if (code === 0) resolve(output);
			else {
				console.error("Emidev workspace creation failed.");
				try {
					const failure = Schema.decodeUnknownSync(
						Schema.Struct({
							error: Schema.Struct({
								message: Schema.String,
								hint: Schema.optional(Schema.String),
							}),
						}),
					)(JSON.parse(output));
					console.error(failure.error.message.slice(0, 2000));
					if (failure.error.hint) console.error(failure.error.hint.slice(0, 2000));
				} catch {}
				reject(
					new Error(
						"Emidev provisioning failed. Inspect this workspace in the terminal before retrying.",
					),
				);
			}
		});
	});
	let result: typeof ResultSchema.Type;
	try {
		result = Schema.decodeUnknownSync(ResultSchema)(JSON.parse(stdout));
	} catch {
		throw new Error("Emidev returned an invalid creation result. Pi was not started.");
	}
	if (!path.isAbsolute(result.data.workspace.path))
		throw new Error("Emidev returned an invalid workspace path.");
	return realpath(result.data.workspace.path);
}

export async function prepareEmidev(
	request: Extract<CreationRequest, { kind: "emidev-session" | "emidev-workspace" }>,
	integration: CreationCatalog["emidev"],
) {
	if (integration.error) throw new Error(integration.error);
	if (request.kind === "emidev-workspace") {
		validateEmidevName(request.name);
		validateRepositories(request.repositories);
		if (integration.workspaces.some((w) => w.name === request.name))
			throw new Error("Workspace already exists. Create a Pi session instead.");
		return { root: os.homedir(), workspaceId: "", name: request.name };
	}
	const workspace = integration.workspaces.find((w) => w.root === request.root);
	if (!workspace) throw new Error("Emidev workspace no longer exists. Refresh the list.");
	const workspaceId =
		request.workspaceId === "new" ? "" : request.workspaceId || workspace.workspaceId;
	if (!request.workspaceId && !workspaceId && workspace.candidates.length)
		throw new Error("Select a Herdr space for this workspace.");
	if (
		workspaceId &&
		workspaceId !== workspace.workspaceId &&
		!workspace.candidates.includes(workspaceId)
	)
		throw new Error("Invalid workspace association.");
	return { root: workspace.root, name: workspace.name, workspaceId };
}
