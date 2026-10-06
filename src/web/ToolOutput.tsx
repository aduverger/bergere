import { memo, type ReactNode } from "react";
import type { Tool } from "../shared/protocol";
import { record } from "../shared/transcript";
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
export default function ToolOutput({ tool, children }: { tool: Tool; children?: ReactNode }) {
	const args = record(tool.args);
	const language = fileLanguage(typeof args.path === "string" ? args.path : "");
	if (
		!["read", "write", "edit", "bash"].includes(tool.name) ||
		(tool.name === "write" && typeof args.content !== "string") ||
		(tool.name === "bash" && typeof args.command !== "string") ||
		tool.content.some((block) => block.type !== "text" && block.type !== "image")
	)
		return children;
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
					<div className="tool-section-label">
						Requested changes{tool.status === "error" ? " · tool failed" : ""}
					</div>
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
