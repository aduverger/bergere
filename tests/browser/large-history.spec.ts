import {
  browserMessage,
  browserTool,
} from "../../src/server/browser-transcript";
import { transcriptTools } from "../../src/shared/transcript";
import { test, expect } from "@playwright/test";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { WebSocketServer } from "ws";
import {
  diffSnapshot,
  type Message,
  type Snapshot,
} from "../../src/shared/protocol";

test("large history keeps collapsed output unmounted and typing responsive", async ({
  page,
}, info) => {
  const messages: Message[] = [];
  const output =
    "## Output\n\n" +
    "- Synthetic tool output with **Markdown** and `code`.\n".repeat(360);
  for (let i = 0; i < 290; i++) {
    messages.push({
      id: `a${i}`,
      role: "assistant",
      content: [
        { type: "text", text: `Step ${i}: checking the workspace.` },
        {
          type: "thinking",
          thinking: "Inspect the workspace before making changes.",
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
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, "http://localhost");
      if (url.pathname === "/api/tool") {
        detailRequests++;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify(
            transcriptTools(state.messages, state.tools).get(
              url.searchParams.get("id")!,
            ),
          ),
        );
        return;
      }
      const file = path.resolve(
        "dist/web",
        "." + (req.url === "/" ? "/index.html" : req.url),
      );
      res.setHeader(
        "Content-Type",
        file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : "text/html",
      );
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end();
    }
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
    await expect(page.getByText("Ready", { exact: true })).toBeVisible();
    await expect(page.locator("article.message")).toHaveCount(290);
    await expect(page.locator(".tool-body")).toHaveCount(0);
    await expect(page.locator(".thinking p")).toHaveCount(0);
    await expect(page.locator("article.message .thinking")).toHaveCount(290);
    await expect(page.locator("details.activity > summary")).toHaveText(
      "6 tool calls · completed",
    );
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
    await page.locator("header").click();
    await expect(page.getByLabel("Model", { exact: true })).toBeHidden();
    const compactHeight = (await composer.boundingBox())!.height;
    await composer.screenshot({
      path: `test-results/${info.project.name}-composer-compact.png`,
    });
    await input.click();
    await expect(
      page.getByRole("button", { name: "Message settings" }),
    ).toBeVisible();
    await expect(page.getByLabel("Model", { exact: true })).toBeHidden();
    expect((await composer.boundingBox())!.height).toBeGreaterThan(
      compactHeight,
    );
    await composer.screenshot({
      path: `test-results/${info.project.name}-composer-expanded.png`,
    });
    await page.getByRole("button", { name: "Message settings" }).click();
    await page.getByLabel("Model", { exact: true }).focus();
    await expect(
      page.getByLabel("Thinking level", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await input.click();
    await expect(input).toBeFocused();
    const typing = Date.now();
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .pressSequentially("A responsive composer with a large conversation");
    const typed = Date.now() - typing;
    await expect(
      page.getByRole("textbox", { name: "Message", exact: true }),
    ).toHaveValue("A responsive composer with a large conversation");
    await page.evaluate(() => {
      Object.defineProperties(window.visualViewport!, {
        height: { configurable: true, value: 420 },
        offsetTop: { configurable: true, value: 120 },
      });
      window.visualViewport!.dispatchEvent(new Event("resize"));
      window.visualViewport!.dispatchEvent(new Event("scroll"));
    });
    await expect
      .poll(async () => (await page.locator(".app").boundingBox())!.y)
      .toBe(120);
    const viewportComposer = (await composer.boundingBox())!;
    expect(viewportComposer.y).toBeGreaterThan(120);
    expect(viewportComposer.y + viewportComposer.height).toBeLessThanOrEqual(
      540,
    );
    await expect(input).toBeFocused();
    await expect(page.locator(".composer select")).toHaveCount(0);
    await page.evaluate(() => {
      Reflect.deleteProperty(window.visualViewport!, "height");
      Reflect.deleteProperty(window.visualViewport!, "offsetTop");
      window.visualViewport!.dispatchEvent(new Event("resize"));
    });
    await page.locator("header").click();
    await expect(page.getByLabel("Model", { exact: true })).toBeHidden();
    await expect(input).toHaveValue(
      "A responsive composer with a large conversation",
    );
    expect((await composer.boundingBox())!.height).toBe(compactHeight);
    const next = {
      ...state,
      revision: 2,
      messages: [
        ...messages,
        {
          id: "last",
          role: "assistant",
          content: [{ type: "text" as const, text: "Incremental response" }],
        },
      ],
    };
    const patch = diffSnapshot(browserState, {
      ...next,
      messages: next.messages.map(browserMessage),
      tools: next.tools.map(browserTool),
    });
    expect(JSON.stringify(patch).length).toBeLessThan(300);
    for (const ws of wss.clients)
      ws.send(
        JSON.stringify({ type: "patch", version: 2, paneId: "p", patch }),
      );
    await expect(
      page.getByText("Incremental response", { exact: true }),
    ).toBeVisible();
    expect(detailRequests).toBe(0);
    await page.locator("details.activity > summary").last().click();
    await expect(page.locator(".activity .thinking")).toHaveCount(0);
    await expect(page.locator(".activity .tool")).toHaveCount(6);
    await page
      .locator("details.tool summary")
      .filter({ hasText: "nested.ts" })
      .click();
    await expect(page.locator(".tool-body")).toHaveCount(1);
    await expect(
      page.getByText("Deferred nested output", { exact: true }),
    ).toBeVisible();
    expect(detailRequests).toBe(1);
    const order = await page.locator(".transcript").innerText();
    expect(order.indexOf("nested.ts")).toBeLessThan(
      order.indexOf("Incremental response"),
    );
    await page
      .locator("details.tool summary")
      .filter({ hasText: "nested.ts" })
      .click();
    await expect(page.locator(".tool-body")).toHaveCount(0);
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
