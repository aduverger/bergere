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
			const html = render("edit", args, "Replacement failed", "error");
			expect(html).toContain("hljs-deletion");
			expect(html).toContain("-old");
			expect(html).toContain("+new");
			expect(html).toContain("Requested changes · tool failed");
			expect(html).toContain("Replacement failed");
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
		expect(render("codemode", {}, "output")).toBe("Generic fallback");
		expect(render("write", {}, "output")).toBe("Generic fallback");
		expect(render("edit", { edits: [{ unexpected: "value" }] }, "error")).toContain("unexpected");
	});
});
