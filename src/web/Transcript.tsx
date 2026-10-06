import { createContext, useContext, useEffect, memo, useState } from "react";
import { transcriptEntries } from "../shared/transcript";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ToolSchema,
  type Block,
  type Tool,
  type Message,
} from "../shared/protocol";
import { Schema } from "effect";
const ToolContext = createContext({ paneId: "", generation: "" });
const decodeTool = Schema.decodeUnknownSync(ToolSchema);
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
          <ToolDetails tool={tool} />
        </div>
      )}
    </details>
  );
}

function ToolDetails({ tool }: { tool: Tool }) {
  const { paneId, generation } = useContext(ToolContext);
  const [loaded, setLoaded] = useState<Tool>();
  const [error, setError] = useState("");
  const completedContent = tool.status === "running" ? undefined : tool.content;
  useEffect(() => {
    if (!tool.detailsDeferred) return;
    const controller = new AbortController();
    setError("");
    const query = new URLSearchParams({ paneId, generation, id: tool.id });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      void fetch(`/api/tool?${query}`, {
        signal: controller.signal,
        cache: "no-store",
      })
        .then(async (response) => {
          if (!response.ok)
            throw new Error(
              response.status === 409
                ? "Session changed. Reopen the tool."
                : "Unable to load tool details. Close and reopen to retry.",
            );
          return decodeTool(await response.json());
        })
        .then((detail) => {
          if (controller.signal.aborted) return;
          setLoaded(detail);
          if (tool.status === "running") timer = setTimeout(load, 1000);
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        });
    };
    load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [
    paneId,
    generation,
    tool.id,
    tool.detailsDeferred,
    tool.status,
    completedContent,
  ]);
  const detail = tool.detailsDeferred ? loaded : tool;
  if (error) return <p role="status">{error}</p>;
  if (!detail) return <p role="status">Loading tool details…</p>;
  return (
    <>
      <pre>{JSON.stringify(detail.args, null, 2)}</pre>
      <Content blocks={detail.content} />
    </>
  );
}
const MemoToolRow = memo(
  ToolRow,
  (a, b) =>
    a.tool.id === b.tool.id &&
    a.tool.name === b.tool.name &&
    a.tool.status === b.tool.status &&
    a.tool.args === b.tool.args &&
    a.tool.content === b.tool.content &&
    a.tool.detailsDeferred === b.tool.detailsDeferred,
);

function Activity({ tools }: { tools: Tool[] }) {
  const [open, setOpen] = useState(false);
  const running = tools.filter((t) => t.status === "running");
  const failed = tools.filter((t) => t.status === "error").length;
  if (tools.length <= 5)
    return (
      <>
        {tools.map((t) => (
          <MemoToolRow key={t.id} tool={t} />
        ))}
      </>
    );
  return (
    <details
      className="activity"
      onToggle={(e) => {
        if (e.target === e.currentTarget) setOpen(e.currentTarget.open);
      }}
    >
      <summary>
        {tools.length} tool calls ·{" "}
        {running.length ? `running ${running.at(-1)!.name}` : "completed"}
        {failed ? ` · ${failed} failed` : ""}
      </summary>
      {open && (
        <div className="activity-body">
          {tools.map((t) => (
            <MemoToolRow key={t.id} tool={t} />
          ))}
        </div>
      )}
    </details>
  );
}
const MessageContent = memo(function MessageContent({
  block,
}: {
  block: Block;
}) {
  return <Content blocks={[block]} />;
});
export const Transcript = memo(function Transcript({
  messages,
  live,
  paneId,
  generation,
}: {
  messages: readonly Message[];
  live: readonly Tool[];
  paneId: string;
  generation: string;
}) {
  const entries = transcriptEntries(messages, live);
  return (
    <ToolContext.Provider value={{ paneId, generation }}>
      {entries.map((entry) =>
        entry.kind === "activity" ? (
          <Activity key={entry.id} tools={entry.tools} />
        ) : (
          <article key={entry.id} className={`message ${entry.role}`}>
            {entry.content.map((block, i) => (
              <MessageContent key={i} block={block} />
            ))}
          </article>
        ),
      )}
    </ToolContext.Provider>
  );
});
