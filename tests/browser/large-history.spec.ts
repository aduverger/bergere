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
}) => {
  const messages: Message[] = [];
  const output =
    "## Output\n\n" +
    "- Synthetic tool output with **Markdown** and `code`.\n".repeat(180);
  for (let i = 0; i < 290; i++) {
    messages.push({
      id: `a${i}`,
      role: "assistant",
      content: [
        { type: "text", text: `Step ${i}: checking the workspace.` },
        { type: "thinking", thinking: output },
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
    tools: [],
    dialogs: [],
    models: [],
    model: "",
    thinking: "off",
    busy: false,
    terminalOnly: false,
    error: "",
  };
  const server = http.createServer(async (req, res) => {
    try {
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
          snapshot: state,
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
    const loaded = Date.now() - started;
    const count = await page.locator("*").count();
    expect(count).toBeLessThan(5000);
    const typing = Date.now();
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .pressSequentially("A responsive composer with a large conversation");
    const typed = Date.now() - typing;
    await expect(
      page.getByRole("textbox", { name: "Message", exact: true }),
    ).toHaveValue("A responsive composer with a large conversation");
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
    const patch = diffSnapshot(state, next);
    expect(JSON.stringify(patch).length).toBeLessThan(300);
    for (const ws of wss.clients)
      ws.send(
        JSON.stringify({ type: "patch", version: 2, paneId: "p", patch }),
      );
    await expect(
      page.getByText("Incremental response", { exact: true }),
    ).toBeVisible();
    await page.locator("details.tool summary").last().click();
    await expect(page.locator(".tool-body")).toHaveCount(1);
    await page.locator("details.tool summary").last().click();
    await expect(page.locator(".tool-body")).toHaveCount(0);
    console.log(
      JSON.stringify({
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
