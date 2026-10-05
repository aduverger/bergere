import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Block, Tool } from "../shared/protocol";
export function Content({ blocks }: { blocks: readonly Block[] }) {
  return (
    <>
      {blocks.map((p, i) =>
        p.type === "text" ? (
          <Markdown key={i} remarkPlugins={[remarkGfm]}>
            {p.text}
          </Markdown>
        ) : p.type === "thinking" ? (
          <details className="thinking" key={i}>
            <summary>Reasoning</summary>
            <Markdown remarkPlugins={[remarkGfm]}>{p.thinking}</Markdown>
          </details>
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
}
export function ToolRow({ tool }: { tool: Tool }) {
  const args = tool.args as Record<string, unknown> | undefined;
  const label =
    typeof args?.path === "string"
      ? args.path
      : typeof args?.command === "string"
        ? args.command
        : "";
  return (
    <details className={`tool ${tool.status}`}>
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
      <div className="tool-body">
        <pre>{JSON.stringify(tool.args, null, 2)}</pre>
        <Content blocks={tool.content} />
      </div>
    </details>
  );
}
