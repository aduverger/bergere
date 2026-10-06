import { expect, it } from "vitest";
import { transcriptEntries } from "../src/shared/transcript";
import { browserMessage, browserTool } from "../src/server/browser-transcript";
import type { Message, Tool } from "../src/shared/protocol";

const call = (id: string, name = "read"): Message => ({
  id,
  role: "assistant",
  content: [{ type: "toolCall", id, name, arguments: { path: id } }],
});
const text = (id: string): Message => ({
  id,
  role: "assistant",
  content: [{ type: "text", text: id }],
});
const child: Tool = {
  id: "child",
  parentToolCallId: "parent",
  name: "read",
  args: {},
  content: [],
  status: "success",
};
it("keeps standalone and nested calls before the final answer in invocation order", () => {
  const rows = transcriptEntries(
    [call("first"), call("parent", "codemode"), call("last"), text("final")],
    [child],
  );
  expect(rows.map((r) => r.kind)).toEqual(["activity", "message"]);
  expect(rows[0].kind === "activity" && rows[0].tools.map((t) => t.id)).toEqual(
    ["first", "parent", "child", "last"],
  );
  expect(rows[1].id).toBe("final:0");
});
it("preserves interleaved commentary and does not move calls ahead of earlier text", () => {
  const rows = transcriptEntries(
    [
      text("progress"),
      {
        id: "mixed",
        role: "assistant",
        content: [...call("read").content, ...text("after").content],
      },
    ],
    [],
  );
  expect(rows.map((r) => r.kind)).toEqual(["message", "activity", "message"]);
});
it("does not append orphan execution events after the final answer or duplicate results", () => {
  const result: Message = {
    id: "result",
    role: "toolResult",
    toolCallId: "first",
    content: [{ type: "text", text: "output" }],
  };
  const rows = transcriptEntries(
    [call("first"), result, text("final")],
    [{ ...child, parentToolCallId: undefined }],
  );
  expect(rows.at(-1)?.kind).toBe("message");
  expect(
    rows
      .flatMap((r) => (r.kind === "activity" ? r.tools : []))
      .map((t) => t.id),
  ).toEqual(["first", "child"]);
});
it("omits tool bodies and large arguments from the initial browser projection", () => {
  const message = {
    ...call("write"),
    content: [
      {
        type: "toolCall" as const,
        id: "write",
        name: "write",
        arguments: { path: "file.ts", content: "large".repeat(10000) },
      },
    ],
  };
  expect(JSON.stringify(browserMessage(message))).not.toContain("largelarge");
  expect(
    browserMessage({
      id: "r",
      role: "toolResult",
      content: [{ type: "text", text: "private output" }],
    }).content,
  ).toEqual([]);
  expect(
    browserTool({
      ...child,
      content: [{ type: "text", text: "private output" }],
    }).content,
  ).toEqual([]);
});

it("does not infer nesting from standalone IDs sharing a prefix", () => {
  const rows = transcriptEntries(
    [call("t1"), text("middle"), call("t10"), text("final")],
    [],
  );
  expect(rows.map((r) => r.kind)).toEqual([
    "activity",
    "message",
    "activity",
    "message",
  ]);
  expect(rows[0].kind === "activity" && rows[0].tools.map((t) => t.id)).toEqual(
    ["t1"],
  );
});
