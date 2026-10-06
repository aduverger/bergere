import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { WebSocketServer } from "ws";
import { browserMessage, browserTool } from "../../src/server/browser-transcript";
import { diffSnapshot, type Message, type Snapshot } from "../../src/shared/protocol";
import { transcriptTools } from "../../src/shared/transcript";

test("large history keeps collapsed output unmounted and typing responsive", async ({
	page,
}, info) => {
	const messages: Message[] = [];
	const output = `## Output\n\n${"- Synthetic tool output with **Markdown** and `code`.\n".repeat(360)}`;
	for (let i = 0; i < 290; i++) {
		messages.push({
			id: `a${i}`,
			role: "assistant",
			content: [
				{ type: "text", text: `Step ${i}: checking the workspace.` },
				{
					type: "thinking",
					thinking:
						i === 0 ? "" : i === 1 ? " \n\t " : "Inspect the workspace before making changes.",
				},
				{
					type: "toolCall",
					id: `t${i}`,
					name: "bash",
					arguments: { command: `check ${i}` },
				},
			],
		});
		messages.push({
			id: `r${i}`,
			role: "toolResult",
			toolCallId: `t${i}`,
			content: [{ type: "text", text: output }],
		});
	}
	const state: Snapshot = {
		generation: "fixture",
		revision: 1,
		sessionId: "s",
		sessionPath: "/s",
		messages,
		tools: [
			...Array.from({ length: 8 }, (_, i) => ({
				id: `child${i}`,
				parentToolCallId: i < 4 ? "t288" : "t289",
				name: "read",
				args: { path: `child${i}.ts` },
				content: [],
				status: "success" as const,
			})),
			{
				id: "nested",
				parentToolCallId: "t289",
				name: "read",
				args: { path: "nested.ts" },
				content: [{ type: "text", text: "Deferred nested output" }],
				status: "success",
			},
		],
		dialogs: [],
		models: [],
		model: "",
		thinking: "off",
		busy: false,
		terminalOnly: false,
		error: "",
	};
	let detailRequests = 0;
	const browserState = {
		...state,
		messages: state.messages.map(browserMessage),
		tools: state.tools.map(browserTool),
	};
	expect(Buffer.byteLength(JSON.stringify(browserState))).toBeLessThan(250000);
	async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
		try {
			const url = new URL(req.url ?? "/", "http://localhost");
			if (url.pathname === "/api/tool") {
				detailRequests++;
				res.setHeader("Content-Type", "application/json");
				res.end(
					JSON.stringify(
						transcriptTools(state.messages, state.tools).get(url.searchParams.get("id") ?? ""),
					),
				);
				return;
			}
			const file = path.resolve("dist/web", `.${req.url === "/" ? "/index.html" : req.url}`);
			res.setHeader(
				"Content-Type",
				file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html",
			);
			res.end(await readFile(file));
		} catch {
			res.writeHead(404).end();
		}
	}
	const server = http.createServer((req, res) => {
		void handleRequest(req, res).catch(() => res.destroy());
	});
	const wss = new WebSocketServer({ server });
	wss.on("connection", (ws) => {
		ws.send(
			JSON.stringify({
				type: "sessions",
				version: 2,
				error: "",
				sessions: [
					{
						paneId: "p",
						workspaceId: "w",
						workspace: "Large history",
						title: "Fixture",
						cwd: "/fixture",
						status: "idle",
						connected: true,
						generation: "fixture",
						reason: "",
					},
				],
			}),
		);
		ws.on("message", () =>
			ws.send(
				JSON.stringify({
					type: "snapshot",
					version: 2,
					paneId: "p",
					snapshot: browserState,
				}),
			),
		);
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	try {
		const address = server.address() as { port: number };
		const started = Date.now();
		await page.goto(`http://127.0.0.1:${address.port}`);
		await expect(page.getByRole("main")).toHaveAttribute("aria-busy", "false");
		await expect(page.locator("article.message")).toHaveCount(290);
		await expect(page.getByRole("textbox", { name: "Search sessions" })).toHaveCount(0);
		await expect(page.getByText("Existing Herdr sessions", { exact: true })).toHaveCount(0);
		await expect(page.locator("header")).toHaveCount(0);
		const menu = page.getByRole("button", { name: "Open sessions", exact: true });
		const sidebar = page.getByRole("complementary", { name: "Sessions" });
		if (info.project.name !== "chromium") {
			await expect(sidebar).toBeHidden();
			await menu.click();
			await expect(sidebar).toBeVisible();
			await expect(menu).toHaveAttribute("aria-expanded", "true");
			await sidebar.getByRole("button", { name: "Close sessions", exact: true }).click();
			await expect(sidebar).toBeHidden();
			await menu.click();
			await sidebar.getByRole("button", { name: "Fixture idle" }).click();
			await expect(sidebar).toBeHidden();
			await expect(page.getByRole("main")).toHaveAttribute("aria-busy", "false");
		} else {
			await expect(sidebar).toBeVisible();
			await expect(menu).toBeHidden();
		}

		await expect(page.locator(".tool-body")).toHaveCount(0);
		await expect(page.locator(".thinking p")).toHaveCount(0);
		await expect(page.locator("article.message .thinking")).toHaveCount(288);
		await expect(page.locator("details.activity > summary")).toHaveText("6 tool calls · completed");
		await expect(page.locator(".transcript > details.tool")).toHaveCount(293);
		const lastStep = page.locator("article.message").last();
		await expect(lastStep).toContainText("Step 289");
		await lastStep.locator(".thinking > summary").click();
		await expect(lastStep.locator(".thinking p")).toHaveText(
			"Inspect the workspace before making changes.",
		);
		await lastStep.locator(".thinking > summary").click();
		const loaded = Date.now() - started;
		const count = await page.locator("*").count();
		expect(count).toBeLessThan(5000);
		const composer = page.locator(".composer");
		const input = page.getByRole("textbox", { name: "Message", exact: true });
		await page.locator(".history").click({ position: { x: 4, y: 90 } });
		await expect(page.getByLabel("Model", { exact: true })).toBeHidden();
		const compactBox = await composer.boundingBox();
		assert(compactBox);
		const compactHeight = compactBox.height;
		await composer.screenshot({
			path: `test-results/${info.project.name}-composer-compact.png`,
		});
		await input.click();
		await expect(page.getByRole("button", { name: "Message settings" })).toBeVisible();
		await expect(page.getByLabel("Model", { exact: true })).toBeHidden();
		const expandedBox = await composer.boundingBox();
		assert(expandedBox);
		expect(expandedBox.height).toBeGreaterThan(compactHeight);
		await composer.screenshot({
			path: `test-results/${info.project.name}-composer-expanded.png`,
		});
		await page.getByRole("button", { name: "Message settings" }).click();
		await expect(page.getByRole("heading", { name: "Message settings" })).toBeFocused();
		await expect(page.getByLabel("Model", { exact: true })).not.toBeFocused();
		await page.keyboard.press("Tab");
		await expect(page.getByLabel("Model", { exact: true })).toBeFocused();
		await expect(page.getByLabel("Thinking level", { exact: true })).toBeVisible();
		await page.getByRole("button", { name: "Done", exact: true }).click();
		await expect(page.getByRole("dialog")).toBeHidden();
		await input.click();
		await expect(input).toBeFocused();
		const typing = Date.now();
		await page
			.getByRole("textbox", { name: "Message", exact: true })
			.pressSequentially("A responsive composer with a large conversation");
		const typed = Date.now() - typing;
		await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(
			"A responsive composer with a large conversation",
		);
		await page.evaluate(() => {
			const viewport = window.visualViewport;
			if (!viewport) throw new Error("Visual viewport unavailable");
			Object.defineProperties(viewport, {
				height: { configurable: true, value: 420 },
				offsetTop: { configurable: true, value: 120 },
			});
			viewport.dispatchEvent(new Event("resize"));
			viewport.dispatchEvent(new Event("scroll"));
		});
		await expect.poll(async () => (await page.locator(".app").boundingBox())?.y).toBe(120);
		const viewportComposer = await composer.boundingBox();
		assert(viewportComposer);
		expect(viewportComposer.y).toBeGreaterThan(120);
		expect(viewportComposer.y + viewportComposer.height).toBeLessThanOrEqual(540);
		await expect(input).toBeFocused();
		await expect(page.locator(".composer select")).toHaveCount(0);
		await page.evaluate(() => {
			const viewport = window.visualViewport;
			if (!viewport) throw new Error("Visual viewport unavailable");
			Reflect.deleteProperty(viewport, "height");
			Reflect.deleteProperty(viewport, "offsetTop");
			viewport.dispatchEvent(new Event("resize"));
		});
		await page.locator(".history").click({ position: { x: 4, y: 90 } });
		await expect(page.getByLabel("Model", { exact: true })).toBeHidden();
		await expect(input).toHaveValue("A responsive composer with a large conversation");
		expect((await composer.boundingBox())?.height).toBe(compactHeight);
		const next = {
			...state,
			revision: 2,
			messages: [
				...messages,
				{
					id: "last",
					role: "assistant",
					content: [
						{ type: "thinking" as const, thinking: "" },
						{ type: "text" as const, text: "Incremental response" },
					],
				},
			],
		};
		const patch = diffSnapshot(browserState, {
			...next,
			messages: next.messages.map(browserMessage),
			tools: next.tools.map(browserTool),
		});
		expect(JSON.stringify(patch).length).toBeLessThan(400);
		for (const ws of wss.clients)
			ws.send(JSON.stringify({ type: "patch", version: 2, paneId: "p", patch }));
		await expect(page.getByText("Incremental response", { exact: true })).toBeVisible();
		expect(detailRequests).toBe(0);
		await page.locator("details.activity > summary").last().click();
		await expect(page.locator(".activity .thinking")).toHaveCount(0);
		await expect(page.locator(".activity .tool")).toHaveCount(6);
		await page.locator("details.tool summary").filter({ hasText: "nested.ts" }).click();
		await expect(page.locator(".tool-body")).toHaveCount(1);
		await expect(page.getByText("Deferred nested output", { exact: true })).toBeVisible();
		expect(detailRequests).toBe(1);
		const order = await page.locator(".transcript").innerText();
		expect(order.indexOf("nested.ts")).toBeLessThan(order.indexOf("Incremental response"));
		await page.locator("details.tool summary").filter({ hasText: "nested.ts" }).click();
		await expect(page.locator(".tool-body")).toHaveCount(0);
		const finalMessage = page.locator("article.message").last();
		await expect(finalMessage.locator(".thinking")).toHaveCount(0);
		const withReasoning = {
			...next,
			revision: 3,
			messages: [
				...messages,
				{
					id: "last",
					role: "assistant",
					content: [
						{ type: "thinking" as const, thinking: "Reasoning arrived after the placeholder." },
						{ type: "text" as const, text: "Incremental response" },
					],
				},
			],
		};
		const reasoningPatch = diffSnapshot(next, withReasoning);
		for (const ws of wss.clients)
			ws.send(JSON.stringify({ type: "patch", version: 2, paneId: "p", patch: reasoningPatch }));
		await expect(finalMessage.locator(".thinking")).toHaveCount(1);
		await finalMessage.locator(".thinking > summary").click();
		await expect(finalMessage.locator(".thinking p")).toHaveText(
			"Reasoning arrived after the placeholder.",
		);
		console.log(
			JSON.stringify({
				browserSnapshotBytes: Buffer.byteLength(JSON.stringify(browserState)),
				snapshotBytes: Buffer.byteLength(JSON.stringify(state)),
				patchBytes: Buffer.byteLength(JSON.stringify(patch)),
				elements: count,
				loadMs: loaded,
				typingMs: typed,
			}),
		);
	} finally {
		for (const ws of wss.clients) ws.terminate();
		wss.close();
		await new Promise<void>((r) => server.close(() => r()));
	}
});
