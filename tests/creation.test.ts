import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CreationService } from "../src/server/creation.js";
import { atomicJSON, readOperation } from "../src/server/creation-store.js";
import { getSnapshot, type HerdrSnapshot, herdrRequest } from "../src/server/herdr.js";
import { emidevChoices } from "../src/server/integrations/emidev.js";

vi.mock("../src/server/herdr.js", () => ({ getSnapshot: vi.fn(), herdrRequest: vi.fn() }));
vi.mock("../src/server/integrations/emidev.js", async (original) => ({
	...(await original<typeof import("../src/server/integrations/emidev.js")>()),
	emidevChoices: vi.fn(),
}));
vi.mock("node:fs/promises", async (original) => ({
	...(await original<typeof import("node:fs/promises")>()),
	access: vi.fn().mockResolvedValue(undefined),
}));
let root: string;
let service: CreationService;
let snapshot: HerdrSnapshot;
let config: ConstructorParameters<typeof CreationService>[0];
beforeEach(async () => {
	vi.clearAllMocks();
	root = await realpath(await mkdtemp(path.join(os.tmpdir(), "bergere-creation-")));
	config = {
		port: 8787,
		origin: "http://127.0.0.1:8787",
		login: "",
		local: true,
		herdrSocket: path.join(root, "herdr.sock"),
		bridgeSocket: path.join(root, "bridge.sock"),
		webRoot: root,
	};
	service = new CreationService(config);
	snapshot = {
		protocol: 22,
		version: "test",
		workspaces: [{ workspace_id: "w1", label: "Different display label" }],
		panes: [{ workspace_id: "w1", pane_id: "w1:p1", terminal_id: "t1", cwd: root, focused: true }],
	};
	vi.mocked(getSnapshot).mockImplementation(async () => snapshot);
	vi.mocked(herdrRequest).mockImplementation(async (_socket, method) => {
		if (method.endsWith("create")) {
			const pane = {
				workspace_id: method === "tab.create" ? "w1" : "w2",
				pane_id: "w2:p2",
				terminal_id: "t2",
				cwd: root,
			};
			snapshot.panes.push(pane);
			if (method === "workspace.create")
				snapshot.workspaces.push({ workspace_id: "w2", label: "new" });
			return { root_pane: pane };
		}
		return { type: "ok" };
	});
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});
it("discovers all Herdr spaces without invoking disabled Emidev", async () => {
	const catalog = await service.discover();
	expect(catalog.emidev.enabled).toBe(false);
	expect(emidevChoices).not.toHaveBeenCalled();
	expect(catalog.workspaces[0]).toMatchObject({ id: "w1", root, savedRoot: false });
	await expect(
		service.start(randomUUID(), { kind: "emidev-workspace", name: "test", repositories: ["api"] }),
	).rejects.toThrow("disabled");
	expect(herdrRequest).not.toHaveBeenCalled();
});
it("creates a new tab, persists roots, and deduplicates across gateway restarts", async () => {
	const id = randomUUID();
	const request = { kind: "session" as const, workspaceId: "w1", root };
	const [a, b] = await Promise.all([service.start(id, request), service.start(id, request)]);
	expect(a.paneId).toBe(b.paneId);
	expect(herdrRequest).toHaveBeenCalledTimes(3);
	expect(herdrRequest).toHaveBeenNthCalledWith(
		1,
		config.herdrSocket,
		"tab.create",
		expect.objectContaining({ workspace_id: "w1", cwd: root, focus: false }),
	);
	expect((await service.discover()).workspaces[0]?.savedRoot).toBe(true);
	service = new CreationService(config);
	await service.start(id, request);
	expect(herdrRequest).toHaveBeenCalledTimes(3);
	await expect(service.start(id, { ...request, root: "/different" })).rejects.toThrow(
		"already used",
	);
});
it("creates a workspace and uses only its returned initial pane", async () => {
	await service.start(randomUUID(), { kind: "workspace", name: "new", root });
	expect(herdrRequest).toHaveBeenNthCalledWith(
		1,
		config.herdrSocket,
		"workspace.create",
		expect.objectContaining({ cwd: root, label: "new", focus: false }),
	);
	expect(herdrRequest).toHaveBeenNthCalledWith(
		2,
		config.herdrSocket,
		"pane.send_text",
		expect.objectContaining({ pane_id: "w2:p2" }),
	);
});
it("does not run commands in vanished spaces or invalid directories", async () => {
	await expect(
		service.start(randomUUID(), { kind: "session", workspaceId: "gone", root }),
	).rejects.toThrow("no longer exists");
	await expect(
		service.start(randomUUID(), { kind: "workspace", name: "x", root: "relative" }),
	).rejects.toThrow("absolute");
	expect(herdrRequest).not.toHaveBeenCalled();
});
it("keeps uncertain delivery durable and never resends", async () => {
	vi.mocked(herdrRequest).mockRejectedValueOnce(new Error("lost response"));
	const id = randomUUID();
	const request = { kind: "workspace" as const, name: "new", root };
	expect((await service.start(id, request)).stage).toBe("uncertain");
	expect((await new CreationService(config).start(id, request)).stage).toBe("uncertain");
	expect(herdrRequest).toHaveBeenCalledTimes(1);
});
it("keeps Herdr creation available when enabled Emidev discovery fails", async () => {
	service = new CreationService({ ...config, emidev: true });
	vi.mocked(emidevChoices).mockRejectedValue(new Error("not installed"));
	expect((await service.discover()).emidev.error).toContain("unavailable");
	expect(
		(await service.start(randomUUID(), { kind: "workspace", name: "ordinary", root })).stage,
	).toBe("launching");
});
it("requires explicit choice for ambiguous Emidev associations", async () => {
	service = new CreationService({ ...config, emidev: true });
	vi.mocked(emidevChoices).mockResolvedValue([
		{ name: "emidev-name", root, repositories: ["api"], workspaceId: "", candidates: ["w1", "w3"] },
	]);
	await expect(
		service.start(randomUUID(), { kind: "emidev-session", root, workspaceId: "" }),
	).rejects.toThrow("Select a Herdr");
	await service.start(randomUUID(), { kind: "emidev-session", root, workspaceId: "w1" });
	expect(herdrRequest).toHaveBeenNthCalledWith(
		1,
		config.herdrSocket,
		"tab.create",
		expect.objectContaining({ workspace_id: "w1", cwd: root }),
	);
});
it("reads runner state after restart and rejects reused terminal identity", async () => {
	const id = randomUUID();
	await service.start(id, { kind: "workspace", name: "new", root });
	const server = (await readdir(path.join(root, "creation")))[0];
	const file = path.join(root, "creation", String(server), `${id}.json`);
	const stored = await readOperation(file);
	await atomicJSON(`${file}.status`, {
		...stored,
		operation: { ...stored.operation, stage: "starting" },
	});
	service = new CreationService(config);
	expect((await service.status(id)).stage).toBe("starting");
	snapshot.panes = snapshot.panes.map((p) => ({ ...p, terminal_id: "replacement" }));
	expect((await service.status(id)).stage).toBe("failed");
	expect((await service.discover()).workspaces.every((w) => !w.savedRoot)).toBe(true);
});

it("does not inject a launch into a replaced pane", async () => {
	const original = vi.mocked(herdrRequest).getMockImplementation();
	vi.mocked(herdrRequest).mockImplementation(async (...args) => {
		const result = (await original?.(...args)) ?? {};
		if (args[1] === "workspace.create")
			snapshot.panes = snapshot.panes.map((p) => ({ ...p, terminal_id: "replaced" }));
		return result;
	});
	const operation = await service.start(randomUUID(), { kind: "workspace", name: "test", root });
	expect(operation.stage).toBe("uncertain");
	expect(herdrRequest).toHaveBeenCalledTimes(1);
});
