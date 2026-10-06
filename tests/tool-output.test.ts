import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Tool } from "../src/shared/protocol";
import ToolOutput from "../src/web/ToolOutput";

function render(name: string, args: unknown, text: string, status: Tool["status"] = "success") {
	return renderToStaticMarkup(
		createElement(
			ToolOutput,
			{
				tool: { id: "t", name, args, content: [{ type: "text", text }], status },
			},
			"Generic fallback",
		),
	);
}
describe("tool presentation", () => {
	it("shows read source with its language and range, without interpreting HTML or Markdown", () => {
		const html = render(
			"read",
			{ path: "test.py", offset: 8, limit: 60 },
			"import json\n# <script>alert(1)</script>\n",
		);
		expect(html).toContain("hljs-keyword");
		expect(html).toContain("From line 8");
		expect(html).toContain("up to 60 lines");
		expect(html).not.toContain("<script>");
		expect(html).not.toContain("&quot;path&quot;");
		expect(render("read", { path: "README.md" }, "# Heading\n")).not.toContain("<h1>");
	});
	it("preserves unknown file types and logs as plain text", () => {
		expect(render("read", { path: "output.log" }, "a\n  b\n")).toContain("<code>a\n  b\n</code>");
		expect(render("read", { path: "file.unrecognized" }, "a\n")).not.toContain("hljs-");
	});
	it("shows only content for successful writes and retains failure output", () => {
		const html = render(
			"write",
			{ path: "file.py", content: "import json\n" },
			"Successfully wrote file",
		);
		expect(html).toContain("hljs-keyword");
		expect(html).not.toContain("Successfully wrote file");
		expect(html).not.toContain('aria-label="Tool output"');
		const failed = render(
			"write",
			{ path: "file.py", content: "import json\n" },
			"Permission denied",
			"error",
		);
		expect(failed).toContain("Permission denied");
		expect(failed).toContain('aria-label="Tool output"');
		expect(html).not.toContain("&quot;content&quot;");
	});
	it("renders single and multiple replacements and retains failures", () => {
		const edit = { oldText: "old\n", newText: "new\n" };
		for (const args of [
			{ path: "file.py", ...edit },
			{ path: "file.py", edits: [edit, edit] },
		]) {
			const success = render("edit", args, "Successfully replaced 1 block(s) in file.py.");
			expect(success).toContain("Expand modified line");
			expect(success).toContain("new");
			expect(success).not.toContain("Successfully replaced");
			expect(success).not.toContain('aria-label="Tool output"');
			const html = render("edit", args, "Replacement failed", "error");
			expect(html).toContain("diff-modified");
			expect(html).toContain("new");
			expect(html).toContain("Tool failed");
			expect(html).toContain("Replacement failed");
		}
	});
	it("highlights changed words without patch headers or snippet EOF warnings", () => {
		const html = render(
			"edit",
			{ oldText: "Add safe logs and tests.", newText: "Add structured logs and tests." },
			"",
		);
		expect(html).not.toContain('<span class="diff-word">safe</span>');
		expect(html).toContain('<span class="diff-word">structured</span>');
		expect(html).not.toContain("@@");
		expect(html).not.toContain("No newline");
		expect(html).not.toContain("--- before");
		expect(html).not.toContain('class="tool-section-label">Change 1');
	});
	it("keeps ambiguous multiline replacements fully visible", () => {
		const html = render("edit", { oldText: "one\ntwo\n", newText: "three\nfour\n" }, "");
		expect(html).not.toContain("Expand modified line");
		expect(html).toContain("diff-removed");
		expect(html).toContain("diff-added");
	});
	it("keeps a compact toggle for a removed word even without a new highlighted word", () => {
		const html = render(
			"edit",
			{ oldText: "if (!valid) submit();", newText: "if (valid) submit();" },
			"",
		);
		expect(html).toContain("Expand modified line");
		expect(html).toContain("if (valid) submit();");
	});
	it("preserves blank lines, indentation, additions and deletions", () => {
		for (const [oldText, newText] of [
			["", "  added\n\n"],
			["  deleted\n\n", ""],
		]) {
			const html = render("edit", { oldText, newText }, "");
			expect(html).not.toContain("diff-word");
			expect(html.match(/class="diff-row /g)).toHaveLength(2);
			expect(html).toContain(oldText ? "  deleted" : "  added");
		}
	});
	it("keeps shell commands separate from literal output", () => {
		const html = render("bash", { command: "echo hello\nprintf done", timeout: 120 }, "a\n  b\n");
		expect(html).toContain('aria-label="Shell command"');
		expect(html).toContain('aria-label="Tool output"');
		expect(html).toContain("<code>a\n  b\n</code>");
		expect(html).not.toContain("timeout");
	});
	it("preserves generic rendering for codemode and unexpected argument shapes", () => {
		expect(render("unknown-tool", {}, "output")).toBe("Generic fallback");
		expect(render("write", {}, "output")).toBe("Generic fallback");
		expect(render("edit", { edits: [{ unexpected: "value" }] }, "error")).toContain("unexpected");
	});
});

it("renders codemode script without JSON escaping and preserves literal output", () => {
	const html = render(
		"codemode",
		{ code: 'text(await tools.read({path:"test.py"}));\n' },
		"# not a heading\n    indented\n<script>unsafe</script>",
	);
	expect(html).toContain("hljs-keyword");
	expect(html).not.toContain("&quot;code&quot;");
	expect(html).not.toContain("<h1>");
	expect(html).not.toContain("<script>");
	expect(html).toContain("# not a heading\n    indented");
	expect(html).toContain('class="codemode-script"');
});

it("hides codemode completion metadata without dropping output or failure details", () => {
	const header = "Script completed\nWall time 0.1 seconds\nOutput:\n";
	const empty = render("codemode", { code: "" }, header);
	expect(empty).not.toContain("Script completed");
	expect(empty).not.toContain('aria-label="Output"');
	for (const code of ['text(await tools.read({path:"test.py"}));', "text(result);"]) {
		const html = renderToStaticMarkup(
			createElement(ToolOutput, {
				tool: {
					id: "t",
					name: "codemode",
					args: { code },
					status: "success",
					content: [
						{ type: "text", text: header },
						{ type: "text", text: "actual output" },
					],
				},
			}),
		);
		expect(html).not.toContain("Script completed");
		expect(html).toContain(code.includes("tools.read") ? "test.py" : "actual output");
	}
	expect(render("codemode", {}, "Script failed\nTimeout", "error")).toContain("Timeout");
	expect(render("codemode", {}, `${header}actual output`)).toContain("actual output");
});
