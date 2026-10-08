import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HerdrSnapshot } from "../src/server/herdr.js";
import { emidevChoices, prepareEmidev } from "../src/server/integrations/emidev.js";

vi.mock("node:child_process", async (original) => ({
	...(await original<typeof import("node:child_process")>()),
	execFile: vi.fn(),
}));
let root: string;
beforeEach(async () => {
	root = await realpath(await mkdtemp(path.join(os.tmpdir(), "bergere-emidev-")));
	await mkdir(path.join(root, "one/api"), { recursive: true });
	await mkdir(path.join(root, "two"));
	vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
		const callback = args.at(-1) as (error: null, result: { stdout: string }) => void;
		callback(null, {
			stdout: JSON.stringify({
				ok: true,
				data: ["one", "two"].map((name) => ({
					name,
					path: path.join(root, name),
					repositories: ["api"],
				})),
			}),
		});
		return {} as ReturnType<typeof execFile>;
	});
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});
function snapshot(directories: string[]): HerdrSnapshot {
	return {
		protocol: 22,
		version: "test",
		workspaces: [{ workspace_id: "w1", label: "Unrelated label" }],
		panes: directories.map((cwd, i) => ({
			workspace_id: "w1",
			terminal_id: `t${i}`,
			pane_id: `p${i}`,
			cwd,
		})),
	};
}
it("matches repository subdirectories despite different Herdr labels", async () => {
	const choices = await emidevChoices(snapshot([path.join(root, "one/api")]), {});
	expect(choices[0]).toMatchObject({ name: "one", workspaceId: "w1", candidates: ["w1"] });
	expect(choices[1]?.workspaceId).toBe("");
});
it("does not auto-associate a mixed space or use partial path prefixes", async () => {
	const choices = await emidevChoices(
		snapshot([path.join(root, "one/api"), path.join(root, "two")]),
		{},
	);
	expect(choices.every((w) => w.workspaceId === "")).toBe(true);
	await mkdir(path.join(root, "one-more"));
	expect((await emidevChoices(snapshot([path.join(root, "one-more")]), {}))[0]?.candidates).toEqual(
		[],
	);
});
it("preserves an explicit association after its panes change directory", async () => {
	const choices = await emidevChoices(snapshot([root]), { [path.join(root, "one")]: "w1" });
	expect(choices[0]?.workspaceId).toBe("w1");
});
it("rejects unsafe repository names and creation of existing workspaces", async () => {
	const integration = {
		enabled: true,
		error: "",
		workspaces: await emidevChoices(snapshot([]), {}),
	};
	await expect(
		prepareEmidev({ kind: "emidev-workspace", name: "new", repositories: ["--evil"] }, integration),
	).rejects.toThrow("valid repository");
	await expect(
		prepareEmidev({ kind: "emidev-workspace", name: "one", repositories: ["api"] }, integration),
	).rejects.toThrow("already exists");
});
