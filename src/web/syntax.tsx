import { common, createLowlight } from "lowlight";
import type { ReactNode } from "react";

const highlighter = createLowlight(common);
const extensions: Record<string, string> = {
	py: "python",
	ts: "typescript",
	tsx: "typescript",
	js: "javascript",
	jsx: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	md: "markdown",
	yml: "yaml",
	sh: "bash",
	zsh: "bash",
	html: "xml",
	svg: "xml",
	h: "c",
	rs: "rust",
	rb: "ruby",
	cs: "csharp",
	diff: "diff",
	patch: "diff",
	txt: "plaintext",
	log: "plaintext",
};
export function fileLanguage(path: string) {
	const name = path.split("/").at(-1)?.toLowerCase() ?? "";
	if (name === "dockerfile") return "dockerfile";
	if (name === "makefile") return "makefile";
	const extension = name.split(".").at(-1) ?? "";
	const language = extensions[extension] ?? extension;
	return highlighter.registered(language) ? language : "plaintext";
}
type HighlightNode = ReturnType<typeof highlighter.highlight>["children"][number];
function tokens(
	nodes: HighlightNode[],
	ranges: readonly [number, number][],
	position = { offset: 0 },
): ReactNode {
	return nodes.map((node, index) => {
		if (node.type === "text") {
			const start = position.offset;
			position.offset += node.value.length;
			const cuts = [
				start,
				...ranges.flat().filter((point) => point > start && point < position.offset),
				position.offset,
			];
			return cuts.slice(0, -1).map((from, index) => {
				const value = node.value.slice(from - start, (cuts[index + 1] ?? position.offset) - start);
				return ranges.some(([left, right]) => from >= left && from < right) ? (
					<span className="diff-word" key={from}>
						{value}
					</span>
				) : (
					value
				);
			});
		}
		if (node.type !== "element") return null;
		return (
			// biome-ignore lint/suspicious/noArrayIndexKey: Highlight tokens are stateless positions in the source.
			<span key={index} className={String(node.properties.className ?? "").replaceAll(",", " ")}>
				{tokens(node.children, ranges, position)}
			</span>
		);
	});
}

export function highlightSource(
	text: string,
	language: string,
	ranges: readonly [number, number][] = [],
): ReactNode {
	const nodes: HighlightNode[] =
		text.length <= 100_000 && language !== "plaintext"
			? highlighter.highlight(language, text).children
			: [{ type: "text", value: text }];
	return tokens(nodes, ranges);
}
