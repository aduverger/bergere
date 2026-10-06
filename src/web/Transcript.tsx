import { Schema } from "effect";
import { createContext, lazy, memo, Suspense, useContext, useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { type Block, type Message, type Tool, ToolSchema } from "../shared/protocol";
import { hasVisibleContent, type TranscriptTool, transcriptEntries } from "../shared/transcript";

const ToolOutput = lazy(() => import("./ToolOutput"));
const ToolContext = createContext({ paneId: "", generation: "" });
const decodeTool = Schema.decodeUnknownSync(ToolSchema);
const Content = memo(function Content({ blocks }: { blocks: readonly Block[] }) {
	return (
		<>
			{blocks.map((p, i) =>
				!hasVisibleContent(p) ? null : p.type === "text" ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: Block positions stay fixed while their text streams.
					<Markdown key={i} remarkPlugins={[remarkGfm]}>
						{p.text}
					</Markdown>
				) : p.type === "thinking" ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: Block positions stay fixed while their text streams.
					<Reasoning key={i} text={p.thinking} />
				) : p.type === "image" ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: Block positions stay fixed while their text streams.
					<a key={i} href={`data:${p.mimeType};base64,${p.data}`} target="_blank" rel="noreferrer">
						<img alt="Message attachment" src={`data:${p.mimeType};base64,${p.data}`} />
					</a>
				) : null,
			)}
		</>
	);
});
function Reasoning({ text }: { text: string }) {
	const [open, setOpen] = useState(false);
	return (
		<details className="thinking" onToggle={(e) => setOpen(e.currentTarget.open)}>
			<summary>Reasoning</summary>
			{open && <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>}
		</details>
	);
}
function ToolRow({ tool }: { tool: TranscriptTool }) {
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
			onToggle={(e) => {
				if (e.target === e.currentTarget) setOpen(e.currentTarget.open);
			}}
		>
			<summary>
				<span className="tool-icon">
					{tool.status === "running"
						? "◌"
						: tool.status === "error"
							? "!"
							: tool.status === "unknown"
								? "?"
								: "✓"}
				</span>
				<strong>{tool.name}</strong>
				<span className="tool-label">
					{tool.children.length ? `${tool.children.length} calls` : label}
				</span>
				<span>›</span>
			</summary>
			{open && (
				<div className="tool-body">
					{tool.traceIncomplete && (
						<p className="tool-section-label">Pi saved an incomplete child-call trace.</p>
					)}
					{tool.children.length > 0 && <Activity tools={tool.children} />}
					<ToolDetails tool={tool} hasNestedCalls={tool.children.length > 0} />
				</div>
			)}
		</details>
	);
}

function ToolDetails({ tool, hasNestedCalls }: { tool: Tool; hasNestedCalls: boolean }) {
	const { paneId, generation } = useContext(ToolContext);
	const [loaded, setLoaded] = useState<Tool>();
	const [error, setError] = useState("");
	const completedContent = tool.status === "running" ? undefined : tool.content;
	// biome-ignore lint/correctness/useExhaustiveDependencies: Completed output changes must refresh open deferred details, while streaming output is polled.
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
	}, [paneId, generation, tool.id, tool.detailsDeferred, tool.status, completedContent]);
	const detail = tool.detailsDeferred ? loaded : tool;
	if (error) return <p role="status">{error}</p>;
	if (!detail) return <p role="status">Loading tool details…</p>;
	return (
		<Suspense fallback={<p role="status">Formatting tool details…</p>}>
			{detail.outputUnavailable && (
				<p className="tool-section-label">
					Pi did not save this child call’s output.{" "}
					{detail.args === undefined ? "Arguments are also unavailable." : ""}
				</p>
			)}
			<ToolOutput tool={detail} hasNestedCalls={hasNestedCalls}>
				<pre>{JSON.stringify(detail.args, null, 2)}</pre>
				<Content blocks={detail.content} />
			</ToolOutput>
		</Suspense>
	);
}
function sameTool(a: TranscriptTool, b: TranscriptTool): boolean {
	return (
		a.id === b.id &&
		a.name === b.name &&
		a.status === b.status &&
		a.args === b.args &&
		a.content === b.content &&
		a.detailsDeferred === b.detailsDeferred &&
		a.outputUnavailable === b.outputUnavailable &&
		a.traceIncomplete === b.traceIncomplete &&
		a.children.length === b.children.length &&
		a.children.every((child, index) => {
			const other = b.children[index];
			return other !== undefined && sameTool(child, other);
		})
	);
}
const MemoToolRow = memo(ToolRow, (a, b) => sameTool(a.tool, b.tool));

function Activity({ tools }: { tools: TranscriptTool[] }) {
	const [open, setOpen] = useState(false);
	const running = tools.filter((t) => t.status === "running");
	const latestRunning = running.at(-1);
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
				{tools.length} tool calls · {latestRunning ? `running ${latestRunning.name}` : "completed"}
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
const MessageContent = memo(function MessageContent({ block }: { block: Block }) {
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
							// biome-ignore lint/suspicious/noArrayIndexKey: Block positions stay fixed while their text streams.
							<MessageContent key={i} block={block} />
						))}
					</article>
				),
			)}
		</ToolContext.Provider>
	);
});
