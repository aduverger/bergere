import type { Block, Message, Tool } from "./protocol.js";
export function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}
export function blocks(value: unknown): Block[] {
  if (typeof value === "string") return [{ type: "text", text: value }];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): Block[] => {
    const p = record(item);
    if (p.type === "text" && typeof p.text === "string")
      return [{ type: "text", text: p.text }];
    if (p.type === "thinking" && typeof p.thinking === "string")
      return [{ type: "thinking", thinking: p.thinking }];
    if (
      p.type === "image" &&
      typeof p.data === "string" &&
      typeof p.mimeType === "string" &&
      /^image\/(png|jpeg|gif|webp)$/.test(p.mimeType)
    )
      return [{ type: "image", data: p.data, mimeType: p.mimeType }];
    if (
      p.type === "toolCall" &&
      typeof p.id === "string" &&
      typeof p.name === "string"
    )
      return [
        { type: "toolCall", id: p.id, name: p.name, arguments: p.arguments },
      ];
    return [];
  });
}
export function message(value: unknown, id: string): Message {
  const m = record(value);
  const content = blocks(m.content);
  if (typeof m.errorMessage === "string")
    content.push({ type: "text", text: m.errorMessage });
  return {
    id,
    role: String(m.role ?? "system"),
    content,
    ...(typeof m.toolCallId === "string" ? { toolCallId: m.toolCallId } : {}),
    ...(typeof m.toolName === "string" ? { toolName: m.toolName } : {}),
    ...(typeof m.isError === "boolean" ? { isError: m.isError } : {}),
  };
}
export function branchMessages(entries: readonly unknown[]): Message[] {
  return entries.flatMap((value): Message[] => {
    const e = record(value);
    const id = String(e.id);
    if (e.type === "message") return [message(e.message, id)];
    if (e.type === "custom_message" && e.display === true)
      return [message({ role: "system", content: e.content }, id)];
    if (e.type === "compaction" || e.type === "branch_summary")
      return [message({ role: "system", content: e.summary }, id)];
    return [];
  });
}
export function transcriptTools(
  messages: readonly Message[],
  live: readonly Tool[],
): Map<string, Tool> {
  const tools = new Map<string, Tool>();
  for (const m of messages) {
    for (const p of m.content)
      if (p.type === "toolCall")
        tools.set(p.id, {
          id: p.id,
          name: p.name,
          args: p.arguments,
          content: [],
          status: "running",
        });
    if (m.role === "toolResult" && m.toolCallId) {
      const previous = tools.get(m.toolCallId);
      tools.set(m.toolCallId, {
        id: m.toolCallId,
        name: m.toolName ?? previous?.name ?? "tool",
        args: previous?.args,
        content: m.content,
        status: m.isError ? "error" : "success",
      });
    }
  }
  for (const t of live)
    if (!tools.has(t.id) || tools.get(t.id)?.status === "running")
      tools.set(t.id, t);
  return tools;
}
