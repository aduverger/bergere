import type { Block, Message, Tool } from "./protocol.js";
export function record(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
export function blocks(value: unknown): Block[] {
	if (typeof value === "string") return [{ type: "text", text: value }];
	if (!Array.isArray(value)) return [];
	return value.flatMap((item): Block[] => {
		const p = record(item);
		if (p.type === "text" && typeof p.text === "string") return [{ type: "text", text: p.text }];
		if (p.type === "thinking" && typeof p.thinking === "string")
			return [{ type: "thinking", thinking: p.thinking }];
		if (
			p.type === "image" &&
			typeof p.data === "string" &&
			typeof p.mimeType === "string" &&
			/^image\/(png|jpeg|gif|webp)$/.test(p.mimeType)
		)
			return [{ type: "image", data: p.data, mimeType: p.mimeType }];
		if (p.type === "toolCall" && typeof p.id === "string" && typeof p.name === "string")
			return [{ type: "toolCall", id: p.id, name: p.name, arguments: p.arguments }];
		return [];
	});
}
function nestedTools(value: unknown): Tool[] {
	const calls = record(value).calls;
	if (!Array.isArray(calls)) return [];
	return calls.flatMap((value): Tool[] => {
		const call = record(value);
		if (typeof call.id !== "string" || typeof call.name !== "string") return [];
		return [
			{
				id: call.id,
				parentToolCallId: call.id.slice(0, call.id.lastIndexOf("/")),
				name: call.name,
				args: call.arguments,
				content: typeof call.error === "string" ? [{ type: "text", text: call.error }] : [],
				status: call.status === "ok" ? "success" : call.status === "error" ? "error" : "unknown",
				outputUnavailable: true,
			},
		];
	});
}
export function message(value: unknown, id: string): Message {
	const m = record(value);
	const content = blocks(m.content);
	if (typeof m.errorMessage === "string") content.push({ type: "text", text: m.errorMessage });
	return {
		id,
		role: String(m.role ?? "system"),
		...(m.nestedCalls
			? {
					nestedTools: nestedTools(m.nestedCalls),
					nestedCallsComplete: record(m.nestedCalls).complete === true,
				}
			: {}),
		content,
		...(typeof m.toolCallId === "string" ? { toolCallId: m.toolCallId } : {}),
		...(typeof m.toolName === "string" ? { toolName: m.toolName } : {}),
		...(typeof m.isError === "boolean" ? { isError: m.isError } : {}),
	};
}
export function branchMessages(entries: readonly unknown[]): Message[] {
	return entries.flatMap((value): Message[] => {
		const e = record(value);
		const id = String(e.id);
		if (e.type === "message") return [message(e.message, id)];
		if (e.type === "custom_message" && e.display === true)
			return [message({ role: "system", content: e.content }, id)];
		if (e.type === "compaction" || e.type === "branch_summary")
			return [message({ role: "system", content: e.summary }, id)];
		return [];
	});
}
export function transcriptTools(
	messages: readonly Message[],
	live: readonly Tool[],
): Map<string, Tool> {
	const tools = new Map<string, Tool>();
	for (const m of messages) {
		for (const tool of m.nestedTools ?? []) tools.set(tool.id, tool);
		for (const p of m.content)
			if (p.type === "toolCall")
				tools.set(p.id, {
					id: p.id,
					name: p.name,
					args: p.arguments,
					content: [],
					status: "running",
					detailsDeferred: m.detailsDeferred,
				});
		if (m.role === "toolResult" && m.toolCallId) {
			const previous = tools.get(m.toolCallId);
			tools.set(m.toolCallId, {
				id: m.toolCallId,
				name: m.toolName ?? previous?.name ?? "tool",
				args: previous?.args,
				content: m.content,
				status: m.isError ? "error" : "success",
				detailsDeferred: m.detailsDeferred,
			});
		}
	}
	for (const t of live)
		if (
			!tools.has(t.id) ||
			tools.get(t.id)?.status === "running" ||
			tools.get(t.id)?.outputUnavailable
		)
			tools.set(t.id, t);
	return tools;
}

export function hasVisibleContent(block: Block): boolean {
	if (block.type === "thinking") return block.thinking.trim().length > 0;
	if (block.type === "text") return block.text.trim().length > 0;
	return true;
}

export type TranscriptTool = Tool & { children: TranscriptTool[]; traceIncomplete?: boolean };

export type TranscriptEntry =
	| { kind: "message"; id: string; role: string; content: readonly Block[] }
	| { kind: "activity"; id: string; tools: TranscriptTool[] };

export function transcriptEntries(
	messages: readonly Message[],
	live: readonly Tool[],
): TranscriptEntry[] {
	const tools = transcriptTools(messages, live);
	const incompleteTraces = new Set(
		messages.filter((m) => m.nestedCallsComplete === false).map((m) => m.toolCallId),
	);
	const children = new Map<string, Tool[]>();
	for (const tool of tools.values()) {
		const parent =
			tool.parentToolCallId ??
			(/\/\d+$/.test(tool.id) ? tool.id.slice(0, tool.id.lastIndexOf("/")) : "");
		if (tools.has(parent)) children.set(parent, [...(children.get(parent) ?? []), tool]);
	}
	const entries: TranscriptEntry[] = [];
	const seen = new Set<string>();
	function activity(id: string) {
		const last = entries.at(-1);
		if (last?.kind === "activity") return last;
		const entry: Extract<TranscriptEntry, { kind: "activity" }> = {
			kind: "activity",
			id,
			tools: [],
		};
		entries.push(entry);
		return entry;
	}
	function buildTool(id: string): TranscriptTool | undefined {
		const tool = tools.get(id);
		if (!tool || seen.has(id)) return;
		seen.add(id);
		return {
			...tool,
			traceIncomplete: incompleteTraces.has(id),
			children: (children.get(id) ?? []).flatMap((child) => {
				const nested = buildTool(child.id);
				return nested ? [nested] : [];
			}),
		};
	}
	function addTool(id: string) {
		const tool = buildTool(id);
		if (tool) activity(id).tools.push(tool);
	}
	for (const m of messages) {
		if (m.role === "toolResult" && m.toolCallId) {
			addTool(m.toolCallId);
			continue;
		}
		let segment: Extract<TranscriptEntry, { kind: "message" }> | undefined;
		m.content.forEach((block, index) => {
			if (block.type === "toolCall") {
				addTool(block.id);
				segment = undefined;
			} else if (hasVisibleContent(block)) {
				if (segment) segment.content = [...segment.content, block];
				else {
					segment = {
						kind: "message",
						id: `${m.id}:${index}`,
						role: m.role,
						content: [block],
					};
					entries.push(segment);
				}
			}
		});
	}
	// Execution events without a persisted call belong before the current turn's final response.
	const orphaned = [...tools.values()].filter((t) => !seen.has(t.id));
	const firstOrphan = orphaned[0];
	if (firstOrphan) {
		let index = entries.length;
		while (
			index > 0 &&
			entries[index - 1]?.kind === "message" &&
			(entries[index - 1] as { role?: string }).role === "assistant"
		)
			index--;
		entries.splice(index, 0, {
			kind: "activity",
			id: firstOrphan.id,
			tools: orphaned.flatMap((tool) => {
				const entry = buildTool(tool.id);
				return entry ? [entry] : [];
			}),
		});
	}
	return entries;
}
