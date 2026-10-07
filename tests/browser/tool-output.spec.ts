import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { browserTool } from "../../src/server/browser-transcript";
import type { Snapshot, Tool } from "../../src/shared/protocol";

for (const nested of [false, true])
	test(`tools ${nested ? "inside codemode" : "standalone"} preserve source formatting and stay within the mobile viewport`, async ({
		page,
	}, info) => {
		const command =
			'set -e\npwd; ls -a /home/ubuntu/.pi/agent; git -C emidat-api status --short && find /tmp /home/ubuntu/.pi -maxdepth 3 -iname "*ship*"; printf "%s\\n" "quoted ; and && remain intact"';
		const tools: Tool[] = [
			{
				id: "read",
				name: "read",
				args: { path: "tests/example.py", offset: 8, limit: 60 },
				status: "success",
				content: [
					{
						type: "text",
						text: 'import json\n\ndef test_delivery():\n    assert result.status == "delivered"\n',
					},
				],
			},
			{
				id: "write",
				name: "write",
				args: {
					path: "config.json",
					content: '{\n  "message": "<script>not executable</script>"\n}\n',
				},
				status: "success",
				content: [{ type: "text", text: "Successfully wrote config.json" }],
			},
			{
				id: "edit",
				name: "edit",
				args: {
					path: "tests/example.py",
					edits: [
						{ oldText: 'status = "pending"\n', newText: 'status = "delivered"\n' },
						{ oldText: "attempts = 0\n", newText: "attempts = 1\n" },
						{
							oldText: "",
							newText:
								'def handle_cancel():\n    if is_new:\n        navigate("/elementaries")\n    else:\n        reset()\n',
						},
						{
							oldText:
								"Add an additive migration, operator documentation, safe structured events, and the callback OpenAPI schema.",
							newText:
								"Add an additive migration, operator documentation, redacted structured events, and the callback OpenAPI schema.",
						},
					],
				},
				status: "success",
				content: [{ type: "text", text: "Successfully replaced 2 blocks." }],
			},
			{
				id: "bash",
				name: "bash",
				args: { command, timeout: 120 },
				status: "success",
				content: [{ type: "text", text: "All checks passed!\n43 passed, 389 warnings in 9.39s\n" }],
			},
		];
		if (nested) {
			tools.push(
				{ ...(tools[0] as Tool), id: "read-extra-1" },
				{ ...(tools[0] as Tool), id: "read-extra-2" },
			);
			for (const tool of tools) Object.assign(tool, { parentToolCallId: "script" });
			tools.unshift({
				id: "script",
				name: "codemode",
				args: { code: 'text(await tools.read({path:"tests/example.py"}));' },
				status: "success",
				content: [{ type: "text", text: "# Literal output\n  indented" }],
			});
		}
		const snapshot: Snapshot = {
			generation: "fixture",
			revision: 1,
			sessionId: "s",
			sessionPath: "/s",
			messages: [],
			tools: tools.map(browserTool),
			dialogs: [],
			models: [],
			model: "",
			thinking: "off",
			busy: false,
			terminalOnly: false,
			error: "",
		};
		let requests = 0;
		await page.route("http://bergere.test/**", async (route) => {
			const url = new URL(route.request().url());
			if (url.pathname === "/api/tool") {
				requests++;
				await route.fulfill({ json: tools.find((tool) => tool.id === url.searchParams.get("id")) });
				return;
			}
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
							workspace: "Tool preview",
							title: "Examples",
							cwd: "/fixture",
							status: "idle",
							connected: true,
							generation: "fixture",
							reason: "",
						},
					],
				}),
			);
			ws.onMessage(() =>
				ws.send(JSON.stringify({ version: 2, type: "snapshot", paneId: "p", snapshot })),
			);
		});
		await page.goto("http://bergere.test/");
		await expect(page.locator("details.tool")).toHaveCount(nested ? 1 : 4);
		expect(requests).toBe(0);
		for (const [index, tool] of tools.entries()) {
			const row = page.locator("details.tool").nth(index);
			await row.locator(":scope > summary").click();
			if (tool.name === "codemode") {
				await expect(row.locator(".codemode-script")).toBeVisible();
				await expect(row.locator("details.tool")).toHaveCount(6);
				await expect(row.locator(".activity")).toHaveCount(0);
				await expect(row.locator("details.tool .tool-body")).toHaveCount(0);
				expect(requests).toBe(1);
				await expect(row.locator(".codemode-script")).not.toHaveAttribute("open");
				await row.locator(".codemode-script summary").click();
				await expect(row.getByRole("region", { name: "Script", exact: true })).toContainText(
					"text(await",
				);
				await row.locator(".codemode-script summary").click();
				await expect(row.getByRole("region", { name: "Output", exact: true })).toHaveText(
					"# Literal output\n  indented",
				);
				continue;
			}
			await expect(row.locator(".tool-source, .edit-diff").first()).toBeVisible();
			await expect(row.locator(".tool-body")).not.toContainText('"path":');
		}
		expect(requests).toBe(nested ? 7 : 4);
		const shell = page.getByRole("region", { name: "Shell command" }).locator("pre");
		expect(await shell.textContent()).toBe(command);
		await expect(shell).toHaveCSS("white-space", "pre-wrap");
		expect(await shell.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false);
		await expect(page.getByRole("region", { name: "Tool output" }).locator("pre")).toHaveCSS(
			"white-space",
			"pre",
		);
		await expect(page.getByRole("region", { name: "Change 2", exact: true })).toContainText(
			"~attempts = 1",
		);
		const change = page.getByRole("region", { name: "Change 1", exact: true });
		const expand = change.getByRole("button", { name: "Expand modified line" });
		await expect(change).not.toContainText("pending");
		await expand.click();
		await expect(change.locator(".diff-row")).toHaveCount(2);
		await expect(change.locator(".diff-removed")).toContainText('−status = "pending"');
		const collapseRemoved = change.getByRole("button", { name: "Collapse removed line" });
		await expect(collapseRemoved).toBeFocused();
		await collapseRemoved.press("Enter");
		await expect(expand).toBeFocused();
		await expect(change.locator(".diff-row")).toHaveCount(1);
		await expand.press("Enter");
		await change.getByRole("button", { name: "Collapse added line" }).click();
		await expect(expand).toBeFocused();
		await expect(change).not.toContainText("pending");
		await expect(page.getByRole("region", { name: "File content" }).first()).toContainText(
			"    assert result.status",
		);
		await expect(page.locator(".diff-word").filter({ hasText: "redacted" })).toBeVisible();
		await expect(
			page
				.locator(".tool-body")
				.filter({ has: page.locator(".edit-diff") })
				.first(),
		).not.toContainText("No newline");
		const addedBlock = page.getByRole("region", { name: "Change 3", exact: true });
		await expect(addedBlock.locator(".diff-word")).toHaveCount(0);
		await expect(addedBlock.locator(".hljs-keyword").first()).toBeVisible();
		await expect(addedBlock.locator(".diff-row").first()).toHaveCSS(
			"background-color",
			"rgb(27, 26, 24)",
		);
		const diffOverflow = await page
			.locator(".edit-diff")
			.evaluateAll((elements) => elements.some((el) => el.scrollWidth > el.clientWidth));
		expect(diffOverflow).toBe(false);
		const overflow = await page
			.locator(".history")
			.evaluate((el) => el.scrollWidth > el.clientWidth);
		expect(overflow).toBe(false);
		await page
			.locator(".tool")
			.filter({
				has: page.locator(":scope > summary > strong", { hasText: "edit" }),
			})
			.scrollIntoViewIfNeeded();
		await page.screenshot({
			path: `test-results/${info.project.name}-${nested ? "codemode" : "neutral-diff"}.png`,
		});
	});
