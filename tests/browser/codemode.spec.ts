import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { browserTool } from "../../src/server/browser-transcript";
import { codemodeFixture } from "../fixtures/codemode";

test("formats sequential script outputs without child-call metadata", async ({ page }, info) => {
	await page.route("http://bergere.test/**", async (route) => {
		const url = new URL(route.request().url());
		if (url.pathname === "/api/tool") return route.fulfill({ json: codemodeFixture });
		const file = path.resolve(
			"dist/web",
			`.${url.pathname === "/" ? "/index.html" : url.pathname}`,
		);
		await route.fulfill({
			body: await readFile(file),
			contentType: file.endsWith(".js")
				? "text/javascript"
				: file.endsWith(".css")
					? "text/css"
					: "text/html",
		});
	});
	await page.routeWebSocket("ws://bergere.test/**", (ws) => {
		ws.send(
			JSON.stringify({
				version: 2,
				type: "sessions",
				error: "",
				sessions: [
					{
						paneId: "p",
						workspaceId: "w",
						workspace: "Codemode",
						title: "Real output structure",
						cwd: "/fixture",
						status: "idle",
						connected: true,
						generation: "g",
						reason: "",
					},
				],
			}),
		);
		ws.onMessage(() =>
			ws.send(
				JSON.stringify({
					version: 2,
					type: "snapshot",
					paneId: "p",
					snapshot: {
						generation: "g",
						revision: 1,
						sessionId: "s",
						sessionPath: "/s",
						messages: [],
						tools: [browserTool(codemodeFixture)],
						dialogs: [],
						models: [],
						model: "",
						thinking: "off",
						busy: false,
						terminalOnly: false,
						error: "",
					},
				}),
			),
		);
	});
	await page.goto("http://bergere.test/");
	await page.locator("details.tool > summary").click();
	const children = page.locator(".codemode-outputs > details");
	await expect(children).toHaveCount(4);
	await expect(children.locator(".tool-body")).toHaveCount(0);
	await children.nth(0).locator("summary").click();
	await expect(children.nth(0).locator(".hljs-keyword").first()).toHaveText("import");
	await expect(children.nth(0)).toContainText("From line 1");
	await children.nth(2).locator("summary").click();
	await expect(children.nth(2).getByRole("region", { name: "Shell command" })).toContainText(
		"cd emidat-api && rg",
	);
	await expect(children.nth(2).getByRole("region", { name: "Tool output" })).toContainText(
		'monkeypatch.setattr(elementary, "get_all"',
	);
	await expect(children.nth(2)).not.toContainText('"exit_code"');
	await expect(page.locator(".codemode-script")).not.toHaveAttribute("open");
	await children.nth(0).locator("summary").click();
	await expect(children.nth(0).locator(".tool-body")).toHaveCount(0);
	await expect(children).toHaveCount(4);
	expect(await page.locator(".history").evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
		false,
	);
	await page.screenshot({ path: `test-results/${info.project.name}-codemode-mapped.png` });
});
