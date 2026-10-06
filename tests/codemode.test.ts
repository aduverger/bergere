import { expect, it } from "vitest";
import { codemodeOutputs } from "../src/web/codemode";
import { codemodeFixture } from "./fixtures/codemode";

it("maps the browser-observed separate output blocks in script order", () => {
	const tools = codemodeOutputs(codemodeFixture);
	expect(tools?.map((tool) => tool.name)).toEqual(["read", "read", "bash", "read"]);
	expect(tools?.[0]?.args).toMatchObject({ offset: 1, limit: 145 });
	expect(tools?.[1]?.content).toEqual([codemodeFixture.content[2]]);
	expect(tools?.[2]?.content[0]).toMatchObject({
		text: expect.stringContaining('monkeypatch.setattr(elementary, "get_all"'),
	});
	expect(tools?.[3]?.args).toMatchObject({
		path: "emidat-api/docs/elementary-request-delivery.md",
	});
});
it.each([
	'const path = "x"; text(await tools.read({path}));',
	'for (const path of ["x"]) text(await tools.read({path}));',
	'text(await Promise.all([tools.read({path:"x"})]));',
	'text((await tools.read({path:"x"})).slice(0,10));',
	"text(await tools.read({path:getPath()}));",
	"text(await tools.read({...args}));",
	'text(await tools.read({get path(){return "x"}}));',
	// biome-ignore lint/suspicious/noTemplateCurlyInString: This is source code supplied to the parser.
	"text(await tools.read({path:`x${secret}`}));",
	'text(await tools.read({path:"x"})); console.log("extra");',
	'text(await tools.read({path:"x"})); tools = {};',
	'text(await tools.read({path:"x"})); garbage(',
])("keeps dynamic or ambiguous scripts intact: %s", (code) => {
	expect(codemodeOutputs({ ...codemodeFixture, args: { code } })).toBeUndefined();
});
it("rejects running, failed, missing, merged and extra output blocks", () => {
	for (const status of ["running", "error"] as const)
		expect(codemodeOutputs({ ...codemodeFixture, status })).toBeUndefined();
	for (const content of [
		codemodeFixture.content.slice(1),
		codemodeFixture.content.slice(0, -1),
		[...codemodeFixture.content, { type: "text" as const, text: "extra" }],
	])
		expect(codemodeOutputs({ ...codemodeFixture, content })).toBeUndefined();
});
it("preserves bash failure status and falls back for truncated output", () => {
	const tool = {
		...codemodeFixture,
		args: { code: 'text(await tools.bash({command:"false"}));' },
		content: [
			{ type: "text" as const, text: "Script completed\nWall time 0.2 seconds\nOutput:\n" },
			{
				type: "text" as const,
				text: JSON.stringify({ output: "failed", exit_code: 1, truncated: false }),
			},
		],
	};
	expect(codemodeOutputs(tool)?.[0]).toMatchObject({
		status: "error",
		content: [{ type: "text", text: "failed" }],
	});
	tool.content[1] = {
		type: "text",
		text: JSON.stringify({ output: "partial", exit_code: 0, truncated: true }),
	};
	expect(codemodeOutputs(tool)).toBeUndefined();
});
it("extracts literal edit arrays without evaluating JavaScript", () => {
	const tool = {
		...codemodeFixture,
		args: { code: 'text(await tools.edit({path:"x.py",edits:[{oldText:"old",newText:"new"}]}));' },
		content: codemodeFixture.content.slice(0, 2),
	};
	expect(codemodeOutputs(tool)?.[0]?.args).toEqual({
		path: "x.py",
		edits: [{ oldText: "old", newText: "new" }],
	});
});
