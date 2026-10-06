import { describe, it, expect, vi } from "vitest";
import {
  applyPatch,
  decodeCommand,
  diffSnapshot,
  type Snapshot,
  type Command,
} from "../src/shared/protocol";
import { branchMessages, transcriptTools } from "../src/shared/transcript";
import { CommandLedger } from "../src/extension/commands";
import { DialogBroker } from "../src/extension/dialogs";
import { authorized } from "../src/server/auth";
import type { IncomingMessage } from "node:http";
export const state: Snapshot = {
  generation: "g1",
  revision: 1,
  sessionId: "s",
  sessionPath: "/s.jsonl",
  messages: [],
  tools: [],
  dialogs: [],
  models: [],
  model: "",
  thinking: "off",
  busy: false,
  terminalOnly: false,
  error: "",
};
const cmd: Command = {
  type: "command",
  version: 2,
  id: "1",
  paneId: "p1",
  generation: "g1",
  action: { kind: "prompt", text: "hello", delivery: "send", images: [] },
};
describe("protocol recovery", () => {
  it("rejects unsupported versions and malformed commands", () => {
    expect(() => decodeCommand({ ...cmd, version: 3 })).toThrow();
    expect(() =>
      decodeCommand({ ...cmd, action: { kind: "shell", text: "bad" } }),
    ).toThrow();
  });
  it("rejects gaps, stale generations, and duplicate updates", () => {
    const next = { ...state, revision: 2, busy: true };
    const patch = diffSnapshot(state, next);
    expect(applyPatch(state, patch)).toEqual(next);
    expect(applyPatch(next, patch)).toBeUndefined();
    expect(applyPatch({ ...state, generation: "g2" }, patch)).toBeUndefined();
  });
  it("splices changed suffixes while retaining history and rejects invalid offsets", () => {
    const first = {
      id: "first",
      role: "user",
      content: [{ type: "text" as const, text: "hello" }],
    };
    const previous = { ...state, messages: [first] };
    const next = {
      ...previous,
      revision: 2,
      messages: [first, { ...first, id: "second" }],
    };
    const patch = diffSnapshot(previous, next);
    expect(patch.messages?.from).toBe(1);
    expect(applyPatch(previous, patch)).toEqual(next);
    expect(applyPatch(previous, patch)?.messages[0]).toBe(first);
    for (const from of [-1, 0.5, 2])
      expect(
        applyPatch(previous, { ...patch, messages: { from, items: [] } }),
      ).toBeUndefined();
    const truncated = { ...next, revision: 3, messages: [] };
    expect(applyPatch(next, diffSnapshot(next, truncated))).toEqual(truncated);
  });
  it("never includes abandoned branch entries and matches tool results by ID", () => {
    const messages = branchMessages([
      {
        type: "message",
        id: "a",
        message: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "t",
              name: "bash",
              arguments: { command: "pwd" },
            },
          ],
        },
      },
      {
        type: "message",
        id: "b",
        message: {
          role: "toolResult",
          toolCallId: "t",
          toolName: "bash",
          content: [{ type: "text", text: "redacted final" }],
        },
      },
    ]);
    expect(
      transcriptTools(messages, [
        {
          id: "t",
          name: "bash",
          args: {},
          content: [{ type: "text", text: "raw" }],
          status: "success",
        },
      ]).get("t")?.content,
    ).toEqual([{ type: "text", text: "redacted final" }]);
  });
});
describe("command delivery", () => {
  it("deduplicates even while the first delivery is in flight", async () => {
    const ledger = new CommandLedger();
    const run = vi.fn(async () => {});
    const [a, b] = await Promise.all([
      ledger.execute(cmd, "g1", run),
      ledger.execute(cmd, "g1", run),
    ]);
    expect(a.ok).toBe(true);
    expect(b).toEqual(a);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("rejects reused ids and stale attachments", async () => {
    const ledger = new CommandLedger();
    const run = vi.fn(async () => {});
    await ledger.execute(cmd, "g1", run);
    expect(
      (await ledger.execute({ ...cmd, action: { kind: "abort" } }, "g1", run))
        .ok,
    ).toBe(false);
    expect((await ledger.execute(cmd, "g2", run)).ok).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
describe("dialog coordination", () => {
  const dialog = {
    kind: "select" as const,
    title: "Choose",
    message: "",
    options: ["A", "B"],
    prefill: "",
  };
  it("phone response aborts terminal and late terminal answer cannot overwrite it", async () => {
    const broker = new DialogBroker(() => {});
    let signal: AbortSignal | undefined;
    let terminal!: (value: string) => void;
    const result = broker.request(dialog, (s) => {
      signal = s;
      return new Promise((r) => {
        terminal = r;
      });
    });
    await Promise.resolve();
    const id = broker.dialogs[0].id;
    expect(broker.answer(id, "invalid", false)).toBe(false);
    expect(broker.answer(id, "B", false)).toBe(true);
    expect(signal?.aborted).toBe(true);
    terminal("A");
    expect(await result).toBe("B");
    expect(broker.dialogs).toEqual([]);
  });
  it("terminal response dismisses web and caller cancellation resolves pending dialogs", async () => {
    const broker = new DialogBroker(() => {});
    expect(await broker.request(dialog, async () => "A")).toBe("A");
    expect(broker.dialogs).toEqual([]);
    const controller = new AbortController();
    const p = broker.request(dialog, () => new Promise(() => {}), {
      signal: controller.signal,
    });
    controller.abort();
    expect(await p).toBeUndefined();
    expect(broker.dialogs).toEqual([]);
  });
  it("preserves caller timeout", async () => {
    vi.useFakeTimers();
    const broker = new DialogBroker(() => {});
    const p = broker.request(dialog, () => new Promise(() => {}), {
      timeout: 50,
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(await p).toBeUndefined();
    vi.useRealTimers();
  });
});
describe("access", () => {
  const c = {
    origin: "https://dev.example.ts.net",
    login: "alex@example.com",
    local: false,
  };
  const req = (headers: Record<string, string>) =>
    ({
      headers: { host: "dev.example.ts.net", ...headers },
      socket: { remoteAddress: "127.0.0.1" },
    }) as IncomingMessage;
  it("requires exact identity, host and websocket origin", () => {
    expect(authorized(req({}), c)).toBe(false);
    expect(
      authorized(req({ "tailscale-user-login": "other@example.com" }), c),
    ).toBe(false);
    expect(authorized(req({ "tailscale-user-login": c.login }), c)).toBe(true);
    expect(authorized(req({ "tailscale-user-login": c.login }), c, true)).toBe(
      false,
    );
    expect(
      authorized(
        req({ "tailscale-user-login": c.login, origin: c.origin }),
        c,
        true,
      ),
    ).toBe(true);
    expect(
      authorized(
        req({
          "tailscale-user-login": c.login,
          origin: "https://evil.example",
        }),
        c,
        true,
      ),
    ).toBe(false);
  });
});
