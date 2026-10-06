import { test, expect } from "@playwright/test";
import { localHarness, waitFor } from "../../scripts/local-harness.js";
import { WebSocket } from "ws";
import {
  applyPatch,
  decodeServer,
  type Snapshot,
  type Command,
  type Ack,
} from "../../src/shared/protocol.js";

test("same live Pi: terminal, browser, deduplication, dialogs and recovery", async ({
  page,
}, info) => {
  const h = await localHarness(8790 + info.workerIndex);
  let ws: WebSocket | undefined;
  try {
    await page.goto(h.config.origin);
    await expect(page.getByText("Ready", { exact: true })).toBeVisible();
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Browser first");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.getByText("Local reply: Browser first", { exact: true }),
    ).toBeVisible();
    await waitFor(() =>
      h.readTerminal().includes("Browser first") ? true : undefined,
    );
    h.terminal("Terminal second");
    await expect(
      page.getByText("Local reply: Terminal second", { exact: true }),
    ).toBeVisible();
    expect(await h.readPid()).toBe(h.pid);
    let state: Snapshot | undefined;
    const acks: Ack[] = [];
    async function connectWire() {
      state = undefined;
      ws = new WebSocket(h.config.origin.replace("http:", "ws:") + "/ws", {
        origin: h.config.origin,
      });
      ws.on("message", (raw) => {
        const msg = decodeServer(JSON.parse(raw.toString()));
        if (msg.type === "snapshot") state = msg.snapshot;
        if (msg.type === "patch" && state) state = applyPatch(state, msg.patch);
        if (msg.type === "ack") acks.push(msg);
      });
      await new Promise<void>((resolve) => ws!.once("open", resolve));
      ws!.send(
        JSON.stringify({ type: "subscribe", version: 2, paneId: h.paneId }),
      );
      await waitFor(() => state);
    }
    await connectWire();
    const duplicate: Command = {
      type: "command",
      version: 2,
      paneId: h.paneId,
      generation: state!.generation,
      id: "dedup-test",
      action: {
        kind: "prompt",
        text: "Exactly once",
        delivery: "send",
        images: [],
      },
    };
    ws!.send(JSON.stringify(duplicate));
    ws!.send(JSON.stringify(duplicate));
    await expect(
      page.getByText("Local reply: Exactly once", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Exactly once", { exact: true })).toHaveCount(
      1,
    );
    await waitFor(() =>
      acks.some((a) => a.id === "dedup-test" && a.ok) ? true : undefined,
    );
    for (const kind of ["confirm", "select", "input", "editor"]) {
      h.terminal("/pmh-" + kind);
      if (kind === "confirm")
        await page.getByRole("button", { name: "Allow", exact: true }).click();
      else if (kind === "select")
        await page.getByRole("button", { name: "Two", exact: true }).click();
      else {
        await page
          .getByRole("textbox", {
            name: kind === "input" ? "Test input" : "Test editor",
            exact: true,
          })
          .fill("From browser");
        await page.getByRole("button", { name: "Submit", exact: true }).click();
      }
      await expect(
        page.getByText(
          `Dialog ${kind}: ${kind === "confirm" ? "true" : kind === "select" ? "Two" : "From browser"}`,
          { exact: true },
        ),
      ).toBeVisible();
    }
    h.terminal("/pmh-input");
    await expect(
      page.getByRole("textbox", { name: "Test input", exact: true }),
    ).toBeVisible();
    h.cli(["pane", "send-text", h.paneId, "Terminal answer"]);
    h.cli(["pane", "send-keys", h.paneId, "Enter"]);
    await expect(
      page.getByText("Dialog input: Terminal answer", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Test input", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("tool test");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.getByText("Local reply: tool test", { exact: true }),
    ).toBeVisible();
    await expect(page.locator("details.tool")).toHaveCount(1);
    await page.locator("details.tool summary").click();
    await expect(
      page.getByText("Local tool output", { exact: true }),
    ).toBeVisible();
    await page.locator("details.tool summary").click();
    h.terminal("/pmh-custom");
    await expect(
      page.getByText("This custom interaction requires the terminal.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Send message", exact: true }),
    ).toBeDisabled();
    h.cli(["pane", "send-keys", h.paneId, "Enter"]);
    await expect(
      page.getByText("Custom widget finished", { exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Model", { exact: true })
      .selectOption("pmh-test/alternate");
    await waitFor(() =>
      state?.model === "pmh-test/alternate" ? true : undefined,
    );
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Image input");
    await page.locator("input[type=file]").setInputFiles({
      name: "test.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGO4uqweK2IYWhIAgyd+gfBHvaAAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await expect(
      page.getByRole("img", { name: "Attachment 1", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.getByText("Local reply: Image input", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: "Message attachment", exact: true }),
    ).toHaveCount(1);
    await page
      .getByLabel("Thinking level", { exact: true })
      .selectOption("high");
    await expect(
      page.getByLabel("Thinking level", { exact: true }),
    ).toHaveValue("high");
    for (const delivery of ["steer", "followUp"]) {
      await expect(page.getByText("Ready", { exact: true })).toBeVisible();
      await page
        .getByRole("textbox", { name: "Message", exact: true })
        .fill("slow run to exercise queued delivery now");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await page.getByLabel("Delivery", { exact: true }).selectOption(delivery);
      await page
        .getByRole("textbox", { name: "Message", exact: true })
        .fill("Queued " + delivery);
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect(
        page.getByText("Local reply: Queued " + delivery, { exact: true }),
      ).toBeVisible({ timeout: 15000 });
    }
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Draft survives reconnect");
    const reconnected = page.waitForEvent("websocket");
    await h.restart();
    await reconnected;
    await expect(page.getByText("Ready", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Message", exact: true }),
    ).toHaveValue("Draft survives reconnect");
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("slow restart while this response is still streaming");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Stop", exact: true }),
    ).toBeVisible();
    ws!.close();
    await h.restart();
    await expect(
      page.getByText(
        "Local reply: slow restart while this response is still streaming",
        { exact: true },
      ),
    ).toBeVisible({ timeout: 20000 });
    expect(await h.readPid()).toBe(h.pid);
    await page.reload();
    await expect(page.getByText("Exactly once", { exact: true })).toHaveCount(
      1,
    );
    await expect(page.getByText("Ready", { exact: true })).toBeVisible();
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("slow abort this response with several more words");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.getByText("Ready", { exact: true })).toBeVisible();
    await connectWire();
    const oldGeneration = state!.generation;
    h.terminal("/reload");
    await waitFor(() =>
      state?.generation !== oldGeneration ? true : undefined,
    );
    ws!.send(JSON.stringify({ ...duplicate, id: "stale-reload" }));
    await waitFor(() =>
      acks.some((a) => a.id === "stale-reload" && !a.ok) ? true : undefined,
    );
    await expect(page.getByText("Ready", { exact: true })).toBeVisible();
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("After extension reload");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.getByText("Local reply: After extension reload", { exact: true }),
    ).toBeVisible();
    expect(await h.readPid()).toBe(h.pid);
    const beforeNew = state!.generation;
    h.terminal("/new");
    await waitFor(() => (state?.generation !== beforeNew ? true : undefined));
    await expect(
      page.getByText("After extension reload", { exact: true }),
    ).toHaveCount(0);
    ws!.send(JSON.stringify({ ...duplicate, id: "stale-session" }));
    await waitFor(() =>
      acks.some((a) => a.id === "stale-session" && !a.ok) ? true : undefined,
    );
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("New session, same process");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.getByText("Local reply: New session, same process", { exact: true }),
    ).toBeVisible();
    expect(await h.readPid()).toBe(h.pid);
    await page.screenshot({
      path: `test-results/${info.project.name}-conversation.png`,
    });
    h.cli(["pane", "close", h.paneId]);
    await expect(
      page.getByRole("button", { name: "Send message", exact: true }),
    ).toBeDisabled();
    await expect(page.getByText("Ready", { exact: true })).toHaveCount(0);
  } finally {
    ws?.terminate();
    await h.close();
  }
});
