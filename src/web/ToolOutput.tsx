import { ChevronRight } from "lucide-react";
import { memo, type ReactNode, useState } from "react";
import type { Tool } from "../shared/protocol";
import { record } from "../shared/transcript";
import { codemodeOutputs, isCodemodeCompletionHeader } from "./codemode";
import { EditDiff } from "./EditDiff";
import { fileLanguage, highlightSource } from "./syntax";

const Source = memo(function Source({
	text,
	language = "plaintext",
	label,
	wrap = false,
}: {
	text: string;
	language?: string;
	label: string;
	wrap?: boolean;
}) {
	const highlighted = highlightSource(text, language);
	return (
		<section aria-label={label}>
			{/* biome-ignore lint/a11y/noNoninteractiveTabindex: Scrollable source must support keyboard scrolling. */}
			<pre className={`tool-source${wrap ? " tool-source-wrap" : ""}`} tabIndex={0}>
				<code>{highlighted}</code>
			</pre>
		</section>
	);
});
function EditPreview({ args, language }: { args: Record<string, unknown>; language: string }) {
	const edits = Array.isArray(args.edits) ? args.edits : [args];
	if (
		!edits.every(
			(edit) =>
				typeof record(edit).oldText === "string" && typeof record(edit).newText === "string",
		)
	)
		return <Source text={JSON.stringify(args, null, 2)} language="json" label="Edit arguments" />;
	return (
		<>
			{edits.map((edit, index) => {
				const { oldText, newText } = record(edit) as { oldText: string; newText: string };

				return (
					// biome-ignore lint/suspicious/noArrayIndexKey: Replacement blocks are ordered immutable tool arguments.
					<section key={index} aria-label={`Change ${index + 1}`}>
						{edits.length > 1 && <div className="tool-section-label">Change {index + 1}</div>}
						<EditDiff before={oldText} after={newText} language={language} />
					</section>
				);
			})}
		</>
	);
}
function MappedTool({ tool }: { tool: Tool }) {
	const [open, setOpen] = useState(false);
	const args = record(tool.args);
	return (
		<details
			className={`tool ${tool.status}`}
			onToggle={(event) => {
				if (event.target === event.currentTarget) setOpen(event.currentTarget.open);
			}}
		>
			<summary>
				<span className="tool-icon">{tool.status === "error" ? "!" : "✓"}</span>
				<strong>{tool.name}</strong>
				<span className="tool-label">{String(args.path ?? args.command ?? "")}</span>
				<span>›</span>
			</summary>
			{open && (
				<div className="tool-body">
					<ToolOutput tool={tool}>
						<Source
							text={tool.content
								.filter((b) => b.type === "text")
								.map((b) => b.text)
								.join("\n")}
							label="Tool output"
						/>
					</ToolOutput>
				</div>
			)}
		</details>
	);
}

function CodemodeOutput({ tool, hasNestedCalls }: { tool: Tool; hasNestedCalls: boolean }) {
	const args = record(tool.args);
	const mapped = hasNestedCalls ? undefined : codemodeOutputs(tool);
	const output = mapped
		? []
		: tool.status === "success" && isCodemodeCompletionHeader(tool.content[0])
			? tool.content.slice(1)
			: tool.content;
	return (
		<>
			{mapped && (
				<div className="codemode-outputs">
					{mapped.map((output) => (
						<MappedTool key={output.id} tool={output} />
					))}
				</div>
			)}
			<details className="codemode-script">
				<summary>
					<ChevronRight size={16} aria-hidden="true" />
					Script
				</summary>
				<Source
					text={
						typeof args.code === "string"
							? args.code
							: typeof tool.args === "string"
								? tool.args
								: JSON.stringify(tool.args ?? {}, null, 2)
					}
					language="javascript"
					label="Script"
					wrap
				/>
			</details>
			{output.length > 0 && <div className="tool-section-label">Output</div>}
			{output.map((block, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: Script output blocks retain their order.
				<div key={index}>
					{block.type === "text" ? (
						<Source text={block.text} label="Output" />
					) : block.type === "image" ? (
						<img src={`data:${block.mimeType};base64,${block.data}`} alt="Output" />
					) : null}
				</div>
			))}
		</>
	);
}
export default function ToolOutput({
	tool,
	children,
	hasNestedCalls = false,
}: {
	tool: Tool;
	children?: ReactNode;
	hasNestedCalls?: boolean;
}) {
	const args = record(tool.args);
	const language = fileLanguage(typeof args.path === "string" ? args.path : "");
	if (
		!["read", "write", "edit", "bash", "codemode"].includes(tool.name) ||
		(tool.name === "write" && typeof args.content !== "string") ||
		(tool.name === "bash" && typeof args.command !== "string") ||
		tool.content.some((block) => block.type !== "text" && block.type !== "image")
	)
		return children;
	if (tool.name === "codemode")
		return <CodemodeOutput tool={tool} hasNestedCalls={hasNestedCalls} />;
	const output =
		(tool.name === "write" || tool.name === "edit") && tool.status === "success"
			? []
			: tool.content;
	return (
		<>
			{tool.name === "read" && typeof args.offset === "number" && (
				<div className="tool-section-label">
					From line {args.offset}
					{typeof args.limit === "number" ? ` · up to ${args.limit} lines` : ""}
				</div>
			)}
			{tool.name === "write" && typeof args.content === "string" && (
				<Source text={args.content} language={language} label="File content" />
			)}
			{tool.name === "bash" && typeof args.command === "string" && (
				<Source text={args.command} language="bash" label="Shell command" wrap />
			)}
			{tool.name === "edit" && (
				<>
					{tool.status === "error" && <div className="tool-section-label">Tool failed</div>}
					<EditPreview args={args} language={language} />
				</>
			)}
			{output.length > 0 && tool.name !== "read" && (
				<div className="tool-section-label">Output</div>
			)}
			{output.map((block, index) => (
				<div
					// biome-ignore lint/suspicious/noArrayIndexKey: Output block positions stay fixed while streaming.
					key={index}
				>
					{block.type === "text" && (
						<Source
							text={block.text}
							language={tool.name === "read" && tool.status !== "error" ? language : "plaintext"}
							label={tool.name === "read" ? "File content" : "Tool output"}
						/>
					)}
					{block.type === "image" && (
						<a
							href={`data:${block.mimeType};base64,${block.data}`}
							target="_blank"
							rel="noreferrer"
						>
							<img src={`data:${block.mimeType};base64,${block.data}`} alt="Tool output" />
						</a>
					)}
				</div>
			))}
		</>
	);
}
