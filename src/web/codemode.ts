import { parse } from "acorn";
import type { Tool } from "../shared/protocol";
import { record } from "../shared/transcript";

function literal(value: unknown, depth = 0): unknown {
	if (depth > 20) throw new Error("Nested arguments");
	const node = record(value);
	if (node.type === "Literal" && !node.regex && typeof node.value !== "bigint") return node.value;
	if (node.type === "ArrayExpression" && Array.isArray(node.elements))
		return node.elements.map((item) => literal(item, depth + 1));
	if (node.type === "ObjectExpression" && Array.isArray(node.properties)) {
		return Object.fromEntries(
			node.properties.map((value) => {
				const property = record(value);
				if (
					property.type !== "Property" ||
					property.computed ||
					property.method ||
					property.shorthand ||
					property.kind !== "init"
				)
					throw new Error("Dynamic property");
				const key = record(property.key);
				const name = key.type === "Identifier" ? key.name : key.value;
				if (typeof name !== "string" || ["__proto__", "constructor", "prototype"].includes(name))
					throw new Error("Unsupported key");
				return [name, literal(property.value, depth + 1)];
			}),
		);
	}
	throw new Error("Nonliteral argument");
}

function printedCall(value: unknown): { name: string; args: Record<string, unknown> } {
	const statement = record(value);
	const print = record(statement.expression);
	const awaited =
		Array.isArray(print.arguments) && print.arguments.length === 1
			? record(print.arguments[0])
			: {};
	const call = record(awaited.argument);
	const member = record(call.callee);
	const name = record(member.property).name;
	if (
		statement.type !== "ExpressionStatement" ||
		print.type !== "CallExpression" ||
		print.optional ||
		record(print.callee).type !== "Identifier" ||
		record(print.callee).name !== "text" ||
		awaited.type !== "AwaitExpression" ||
		call.type !== "CallExpression" ||
		call.optional ||
		member.type !== "MemberExpression" ||
		member.computed ||
		member.optional ||
		record(member.object).type !== "Identifier" ||
		record(member.object).name !== "tools" ||
		record(member.property).type !== "Identifier" ||
		typeof name !== "string" ||
		!["read", "write", "edit", "bash"].includes(name) ||
		!Array.isArray(call.arguments) ||
		call.arguments.length !== 1 ||
		record(call.arguments[0]).type !== "ObjectExpression"
	)
		throw new Error("Not a sequential printed tool call");
	return { name, args: record(literal(call.arguments[0])) };
}

export function isCodemodeCompletionHeader(block: Tool["content"][number] | undefined): boolean {
	return (
		block?.type === "text" &&
		/^Script completed\nWall time \d+(?:\.\d+)? seconds\nOutput:\n$/.test(block.text)
	);
}

export function codemodeOutputs(tool: Tool): Tool[] | undefined {
	const code = typeof tool.args === "string" ? tool.args : record(tool.args).code;
	if (
		tool.status !== "success" ||
		typeof code !== "string" ||
		code.length > 100000 ||
		!isCodemodeCompletionHeader(tool.content[0])
	)
		return;
	try {
		const script = parse(code, { ecmaVersion: "latest", sourceType: "module" });
		const calls = script.body.map(printedCall);
		if (!calls.length || tool.content.length !== calls.length + 1) return;
		return calls.map((call, index): Tool => {
			const output = tool.content[index + 1];
			if (output?.type !== "text") throw new Error("Not a text result");
			let text = output.text;
			let status: Tool["status"] = "success";
			if (call.name === "bash") {
				const result = record(JSON.parse(text));
				if (
					typeof result.output !== "string" ||
					typeof result.exit_code !== "number" ||
					result.truncated !== false
				)
					throw new Error("Incomplete shell result");
				text = result.output;
				status = result.exit_code === 0 ? "success" : "error";
			}
			return {
				id: `${tool.id}:output:${index}`,
				name: call.name,
				args: call.args,
				content: [{ type: "text", text }],
				status,
			};
		});
	} catch {
		return;
	}
}
