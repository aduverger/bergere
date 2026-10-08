import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { localHarness, waitFor } from "../../scripts/local-harness.js";
import { getSnapshot } from "../../src/server/herdr.js";

test("create Pi sessions and workspaces in real Herdr without Emidev", async ({ page }, info) => {
	const h = await localHarness(8840 + info.workerIndex, true);
	const open = async () => {
		if (info.project.name !== "chromium")
			await page.getByRole("button", { name: "Open sessions", exact: true }).click();
		await page.getByRole("button", { name: "New", exact: true }).click();
	};
	try {
		await page.goto(h.config.origin);
		await expect(page.getByRole("main")).toHaveAttribute("aria-busy", "false");
		const original = await getSnapshot(h.herdrSocket);
		const workspace = original.panes.find((p) => p.pane_id === h.paneId)?.workspace_id;
		if (!workspace) throw new Error("Missing initial workspace");
		await open();
		await expect(page.getByRole("heading", { name: "New", exact: true })).toBeFocused();
		await expect(page.getByRole("combobox", { name: "Workspace", exact: true })).toBeVisible();
		await expect(page.getByLabel("Root directory")).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Start Pi", exact: true })).toBeDisabled();
		const before = await page.getByRole("dialog").boundingBox();
		await page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption(workspace);
		expect((await page.getByRole("dialog").boundingBox())?.height).toBe(before?.height);
		await expect(page.getByLabel("Root directory")).toHaveValue(await realpath(h.root));
		await expect(page.getByText("Confirm the workspace root", { exact: false })).toBeVisible();
		await expect(page.getByLabel("Repositories", { exact: true })).toHaveCount(0);
		await page.getByRole("button", { name: "Start Pi", exact: true }).click();
		await expect(page.getByRole("dialog")).toBeHidden({ timeout: 20000 });
		await expect(page.getByRole("main")).toHaveAttribute("aria-busy", "false");
		const after = await getSnapshot(h.herdrSocket);
		expect(after.workspaces.length).toBe(original.workspaces.length);
		expect(after.panes.length).toBe(original.panes.length + 1);
		const newPane = after.panes.find(
			(p) => !original.panes.some((old) => old.pane_id === p.pane_id),
		);
		expect(newPane?.workspace_id).toBe(workspace);
		await page.getByRole("textbox", { name: "Message", exact: true }).fill("New tab works");
		await page.getByRole("button", { name: "Send message", exact: true }).click();
		await expect(page.getByText("Local reply: New tab works", { exact: true })).toBeVisible();
		await h.restart();
		await expect(page.getByRole("main")).toHaveAttribute("aria-busy", "false");
		expect((await getSnapshot(h.herdrSocket)).panes.length).toBe(after.panes.length);
		await open();
		await page.getByRole("button", { name: "Workspace", exact: true }).click();
		await page.getByLabel("Workspace name").fill("Created from Bergère");
		await page.getByLabel("Root directory").fill("/bergere-nonexistent-directory");
		await page.getByRole("button", { name: "Create workspace", exact: true }).click();
		await expect(page.getByRole("alert")).toContainText("Root directory does not exist");
		await page.getByRole("button", { name: "Workspace", exact: true }).click();
		await page.getByLabel("Workspace name").fill("Created from Bergère");
		await page.getByLabel("Root directory").fill(h.root);
		await page.screenshot({ path: `test-results/${info.project.name}-creation.png` });
		await page.getByRole("button", { name: "Create workspace", exact: true }).click();
		await expect(page.getByRole("dialog")).toBeHidden({ timeout: 20000 });
		await waitFor(async () => {
			const s = await getSnapshot(h.herdrSocket);
			return s.workspaces.length === after.workspaces.length + 1 ? true : undefined;
		});
		await expect(page.getByRole("main")).toHaveAttribute("aria-busy", "false");
		await page.getByRole("textbox", { name: "Message", exact: true }).fill("New workspace works");
		await page.getByRole("button", { name: "Send message", exact: true }).click();
		await expect(page.getByText("Local reply: New workspace works", { exact: true })).toBeVisible();
		const unchanged = (await getSnapshot(h.herdrSocket)).panes.find((p) => p.pane_id === h.paneId);
		expect(unchanged?.terminal_id).toBe(
			original.panes.find((p) => p.pane_id === h.paneId)?.terminal_id,
		);
	} finally {
		await h.close();
	}
});

test("optional Emidev provisioning survives gateway restart and selects the returned root", async ({
	page,
}, info) => {
	const h = await localHarness(8850 + info.workerIndex, true);
	const previousPath = process.env.PATH;
	const root = await realpath(h.root);
	const workspace = path.join(root, "provisioned-root");
	const registry = path.join(root, "emidev-list.json");
	const cwdFile = path.join(root, "launched-pi-cwd");
	const piWrapper = path.join(root, "bin/pi");
	const wrapper = await readFile(piWrapper, "utf8");
	const quoted = `'${cwdFile.replaceAll("'", "'\\''")}'`;
	await writeFile(piWrapper, wrapper.replace("#!/bin/sh\n", `#!/bin/sh\npwd > ${quoted}\n`));
	await mkdir(workspace);
	await writeFile(registry, "[]");
	await writeFile(
		path.join(root, "bin/emidev"),
		`#!${process.execPath}\nimport fs from 'node:fs';\nconst file=${JSON.stringify(registry)};\nif(process.argv.includes('list')) console.log(JSON.stringify({ok:true,data:JSON.parse(fs.readFileSync(file,'utf8'))}));\nelse {setTimeout(() => {const workspace={name:'emidev-test',path:${JSON.stringify(workspace)},repositories:['emidat-api']};fs.writeFileSync(file,JSON.stringify([workspace]));console.log(JSON.stringify({ok:true,data:{workspace}}));},2500);}\n`,
		{ mode: 0o700 },
	);
	process.env.PATH = `${path.join(root, "bin")}:${previousPath}`;
	h.config.emidev = true;
	try {
		await h.restart();
		await page.goto(h.config.origin);
		await expect(page.getByRole("main")).toHaveAttribute("aria-busy", "false");
		if (info.project.name !== "chromium")
			await page.getByRole("button", { name: "Open sessions", exact: true }).click();
		await page.getByRole("button", { name: "New", exact: true }).click();
		await page.getByRole("button", { name: "Workspace", exact: true }).click();
		await expect(page.getByRole("combobox", { name: "Workspace type" })).toHaveValue("emidev");
		await expect(page.getByLabel("Workspace name")).toHaveAttribute("autocapitalize", "none");
		await expect(page.getByLabel("Repositories", { exact: true })).toHaveAttribute(
			"autocapitalize",
			"none",
		);
		await page.getByLabel("Workspace name").fill("emidev-test");
		await page.getByLabel("Repositories", { exact: true }).fill("emidat-api");
		await page.getByRole("button", { name: "Add repository" }).click();
		await expect(page.getByRole("button", { name: "Remove emidat-api" })).toBeVisible();
		await page.getByRole("button", { name: "Create workspace", exact: true }).click();
		await expect(page.getByText("Provisioning workspace…", { exact: true })).toBeVisible({
			timeout: 15000,
		});
		await h.restart();
		await expect(page.getByRole("dialog")).toBeHidden({ timeout: 20000 });
		await expect(page.getByRole("main")).toHaveAttribute("aria-busy", "false");
		expect(JSON.parse(await readFile(registry, "utf8"))).toHaveLength(1);
		await page
			.getByRole("textbox", { name: "Message", exact: true })
			.fill("Provisioned session works");
		await page.getByRole("button", { name: "Send message", exact: true }).click();
		await expect(
			page.getByText("Local reply: Provisioned session works", { exact: true }),
		).toBeVisible();
		const snapshot = await getSnapshot(h.herdrSocket);
		expect((await readFile(cwdFile, "utf8")).trim()).toBe(workspace);
		expect(snapshot.workspaces.filter((w) => w.label === "emidev-test")).toHaveLength(1);
	} finally {
		process.env.PATH = previousPath;
		await h.close();
	}
});
