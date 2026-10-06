import {
  createAssistantMessageEventStream,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { writeFileSync } from "node:fs";
export default function fixture(pi: ExtensionAPI) {
  pi.registerProvider("bergere-test", {
    baseUrl: "http://127.0.0.1",
    apiKey: "local-test-only",
    api: "bergere-test-api",
    models: ["test", "alternate"].map((id) => ({
      id,
      name: id === "test" ? "Local test model" : "Alternate test model",
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 100000,
      maxTokens: 4000,
    })),
    streamSimple: (model, context, options) => {
      const stream = createAssistantMessageEventStream();
      const last = context.messages.filter((m) => m.role === "user").at(-1);
      const text =
        last && "content" in last
          ? typeof last.content === "string"
            ? last.content
            : last.content
                .filter((p) => p.type === "text")
                .map((p) => p.text)
                .join(" ")
          : "";
      const output: AssistantMessage = {
        role: "assistant",
        content: [{ type: "text", text: "" }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        stopReason: "pending",
        timestamp: Date.now(),
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      };
      void (async () => {
        if (
          text.includes("tool test") &&
          context.messages.at(-1)?.role === "user"
        ) {
          output.content = [
            {
              type: "toolCall",
              id: "local-tool-" + Date.now(),
              name: "bash",
              arguments: { command: "printf 'Local tool output'" },
            },
          ];
          output.stopReason = "toolUse";
          stream.push({ type: "done", reason: "toolUse", message: output });
          stream.end();
          return;
        }
        stream.push({ type: "start", partial: output });
        stream.push({ type: "text_start", contentIndex: 0, partial: output });
        for (const word of `Local reply: ${text}`.split(" ")) {
          await new Promise((r) =>
            setTimeout(r, text.includes("slow") ? 300 : 35),
          );
          if (options?.signal?.aborted) {
            output.stopReason = "aborted";
            stream.push({ type: "error", reason: "aborted", error: output });
            stream.end();
            return;
          }
          const block = output.content[0];
          if (block.type === "text") block.text += word + " ";
          stream.push({
            type: "text_delta",
            contentIndex: 0,
            delta: word + " ",
            partial: output,
          });
        }
        output.stopReason = "stop";
        stream.push({
          type: "text_end",
          contentIndex: 0,
          content: (output.content[0] as { text: string }).text,
          partial: output,
        });
        stream.push({ type: "done", reason: "stop", message: output });
        stream.end();
      })();
      return stream;
    },
  });
  pi.on("session_start", () => {
    if (process.env.BERGERE_TEST_PID_FILE)
      writeFileSync(process.env.BERGERE_TEST_PID_FILE, String(process.pid));
  });
  pi.registerCommand("bergere-custom", {
    description: "Local custom widget",
    handler: async (_args, ctx) => {
      await ctx.ui.custom((_tui, _theme, _keys, done) => ({
        render: () => ["Terminal-only test widget"],
        invalidate() {},
        handleInput() {
          done(undefined);
        },
      }));
      pi.sendMessage({
        customType: "bergere-test",
        content: "Custom widget finished",
        display: true,
      });
    },
  });
  for (const kind of ["confirm", "select", "input", "editor"] as const)
    pi.registerCommand(`bergere-${kind}`, {
      description: "Local integration test dialog",
      handler: async (_args, ctx) => {
        const value =
          kind === "confirm"
            ? await ctx.ui.confirm(
                "Test confirmation",
                "Allow this local test?",
              )
            : kind === "select"
              ? await ctx.ui.select("Test selection", ["One", "Two"])
              : kind === "input"
                ? await ctx.ui.input("Test input", "")
                : await ctx.ui.editor("Test editor", "Initial text");
        pi.sendMessage({
          customType: "bergere-test",
          content: `Dialog ${kind}: ${String(value)}`,
          display: true,
        });
      },
    });
}
