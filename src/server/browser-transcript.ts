import type { Message, Tool } from "../shared/protocol.js";

function summaryArgs(value: unknown): Record<string, string> {
	const args = value as Record<string, unknown> | null;
	if (!args || typeof args !== "object") return {};
	for (const key of ["path", "command"])
		if (typeof args[key] === "string") return { [key]: args[key].slice(0, 240) };
	return {};
}
export function browserMessage(message: Message): Message {
	return {
		...message,
		detailsDeferred: true,
		content:
			message.role === "toolResult"
				? []
				: message.content.map((block) =>
						block.type === "toolCall"
							? { ...block, arguments: summaryArgs(block.arguments) }
							: block,
					),
	};
}
export function browserTool(tool: Tool): Tool {
	return {
		...tool,
		args: summaryArgs(tool.args),
		content: [],
		detailsDeferred: true,
	};
}
