import { memo, useState } from "react";
import { transcriptTools } from "../shared/transcript";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Block, Tool, Message } from "../shared/protocol";
export const Content = memo(function Content({
  blocks,
}: {
  blocks: readonly Block[];
}) {
  return (
    <>
      {blocks.map((p, i) =>
        p.type === "text" ? (
          <Markdown key={i} remarkPlugins={[remarkGfm]}>
            {p.text}
          </Markdown>
        ) : p.type === "thinking" ? (
          <Reasoning key={i} text={p.thinking} />
        ) : p.type === "image" ? (
          <a
            key={i}
            href={`data:${p.mimeType};base64,${p.data}`}
            target="_blank"
            rel="noreferrer"
          >
            <img
              alt="Message attachment"
              src={`data:${p.mimeType};base64,${p.data}`}
            />
          </a>
        ) : null,
      )}
    </>
  );
});
function Reasoning({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="thinking"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>Reasoning</summary>
      {open && <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>}
    </details>
  );
}
export function ToolRow({ tool }: { tool: Tool }) {
  const [open, setOpen] = useState(false);
  const args = tool.args as Record<string, unknown> | undefined;
  const label =
    typeof args?.path === "string"
      ? args.path
      : typeof args?.command === "string"
        ? args.command
        : "";
  return (
    <details
      className={`tool ${tool.status}`}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        <span className="tool-icon">
          {tool.status === "running"
            ? "◌"
            : tool.status === "error"
              ? "!"
              : "✓"}
        </span>
        <strong>{tool.name}</strong>
        <span className="tool-label">{label}</span>
        <span>›</span>
      </summary>
      {open && (
        <div className="tool-body">
          <pre>{JSON.stringify(tool.args, null, 2)}</pre>
          <Content blocks={tool.content} />
        </div>
      )}
    </details>
  );
}

const MemoToolRow = memo(
  ToolRow,
  (a, b) =>
    a.tool.id === b.tool.id &&
    a.tool.name === b.tool.name &&
    a.tool.status === b.tool.status &&
    a.tool.args === b.tool.args &&
    a.tool.content === b.tool.content,
);
export const Transcript = memo(function Transcript({
  messages,
  live,
}: {
  messages: readonly Message[];
  live: readonly Tool[];
}) {
  const tools = transcriptTools(messages, live);
  const rendered = new Set<string>();
  const results = new Set(
    messages.flatMap((m) => (m.toolCallId ? [m.toolCallId] : [])),
  );
  return (
    <>
      {messages.map((m) => {
        if (
          m.role === "toolResult" &&
          m.toolCallId &&
          rendered.has(m.toolCallId)
        )
          return null;
        return (
          <article key={m.id} className={`message ${m.role}`}>
            <Content blocks={m.content} />
            {m.content.map((p) => {
              if (p.type !== "toolCall") return null;
              rendered.add(p.id);
              const tool = tools.get(p.id);
              return tool ? <MemoToolRow key={p.id} tool={tool} /> : null;
            })}
          </article>
        );
      })}
      {[...tools.values()]
        .filter((t) => !rendered.has(t.id) && !results.has(t.id))
        .map((t) => (
          <MemoToolRow key={t.id} tool={t} />
        ))}
    </>
  );
});
