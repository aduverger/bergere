import { Schema } from "effect";
import { CreationClientSchema, CreationServerSchema } from "./creation.js";

const VERSION = 2;
const text = Schema.String;
const strings = Schema.Array(text);
const ImageSchema = Schema.Struct({
	type: Schema.Literal("image"),
	mimeType: text,
	data: text,
});
const BlockSchema = Schema.Union([
	Schema.Struct({ type: Schema.Literal("text"), text }),
	Schema.Struct({ type: Schema.Literal("thinking"), thinking: text }),
	Schema.Struct({
		type: Schema.Literal("toolCall"),
		id: text,
		name: text,
		arguments: Schema.Unknown,
	}),
	ImageSchema,
]);
export const ToolSchema = Schema.Struct({
	parentToolCallId: Schema.optional(text),
	detailsDeferred: Schema.optional(Schema.Boolean),
	outputUnavailable: Schema.optional(Schema.Boolean),
	id: text,
	name: text,
	args: Schema.Unknown,
	content: Schema.Array(BlockSchema),
	status: Schema.Literals(["running", "success", "error", "unknown"]),
});
const MessageSchema = Schema.Struct({
	nestedTools: Schema.optional(Schema.Array(ToolSchema)),
	nestedCallsComplete: Schema.optional(Schema.Boolean),
	id: text,
	role: text,
	content: Schema.Array(BlockSchema),
	detailsDeferred: Schema.optional(Schema.Boolean),
	toolCallId: Schema.optional(text),
	toolName: Schema.optional(text),
	isError: Schema.optional(Schema.Boolean),
});
const DialogSchema = Schema.Struct({
	id: text,
	kind: Schema.Literals(["confirm", "select", "input", "editor"]),
	title: text,
	message: text,
	options: strings,
	prefill: text,
});
const ModelSchema = Schema.Struct({
	provider: text,
	id: text,
	name: text,
});
const SnapshotSchema = Schema.Struct({
	generation: text,
	revision: Schema.Number,
	sessionId: text,
	sessionPath: text,
	messages: Schema.Array(MessageSchema),
	tools: Schema.Array(ToolSchema),
	dialogs: Schema.Array(DialogSchema),
	models: Schema.Array(ModelSchema),
	model: text,
	thinking: text,
	busy: Schema.Boolean,
	terminalOnly: Schema.Boolean,
	error: text,
});
const PatchSchema = Schema.Struct({
	generation: text,
	baseRevision: Schema.Number,
	revision: Schema.Number,
	messages: Schema.optional(
		Schema.Struct({ from: Schema.Number, items: Schema.Array(MessageSchema) }),
	),
	tools: Schema.optional(Schema.Struct({ from: Schema.Number, items: Schema.Array(ToolSchema) })),
	dialogs: Schema.optional(Schema.Array(DialogSchema)),
	models: Schema.optional(Schema.Array(ModelSchema)),
	model: Schema.optional(text),
	thinking: Schema.optional(text),
	busy: Schema.optional(Schema.Boolean),
	terminalOnly: Schema.optional(Schema.Boolean),
	error: Schema.optional(text),
});
const ActionSchema = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal("prompt"),
		text,
		delivery: Schema.Literals(["send", "steer", "followUp"]),
		images: Schema.Array(ImageSchema),
	}),
	Schema.Struct({ kind: Schema.Literal("abort") }),
	Schema.Struct({
		kind: Schema.Literal("model"),
		provider: text,
		modelId: text,
	}),
	Schema.Struct({
		kind: Schema.Literal("thinking"),
		level: Schema.Literals(["off", "minimal", "low", "medium", "high", "xhigh"]),
	}),
	Schema.Struct({
		kind: Schema.Literal("answer"),
		dialogId: text,
		value: Schema.Union([text, Schema.Boolean]),
		cancelled: Schema.Boolean,
	}),
]);
const CommandSchema = Schema.Struct({
	type: Schema.Literal("command"),
	version: Schema.Literal(VERSION),
	id: text,
	paneId: text,
	generation: text,
	action: ActionSchema,
});
const ClientSchema = Schema.Union([
	CreationClientSchema,
	CommandSchema,
	Schema.Struct({
		type: Schema.Literal("subscribe"),
		version: Schema.Literal(VERSION),
		paneId: text,
	}),
]);
const AckSchema = Schema.Struct({
	type: Schema.Literal("ack"),
	version: Schema.Literal(VERSION),
	id: text,
	paneId: text,
	generation: text,
	ok: Schema.Boolean,
	error: text,
});
const RegistrationSchema = Schema.Struct({
	type: Schema.Literal("register"),
	version: Schema.Literal(VERSION),
	herdrSocket: text,
	paneId: text,
	pid: Schema.Number,
	snapshot: SnapshotSchema,
});
const CompanionSchema = Schema.Union([
	RegistrationSchema,
	AckSchema,
	Schema.Struct({
		type: Schema.Literal("snapshot"),
		version: Schema.Literal(VERSION),
		paneId: text,
		snapshot: SnapshotSchema,
	}),
	Schema.Struct({
		type: Schema.Literal("patch"),
		version: Schema.Literal(VERSION),
		paneId: text,
		patch: PatchSchema,
	}),
]);
const SessionSchema = Schema.Struct({
	paneId: text,
	workspaceId: text,
	workspace: text,
	title: text,
	cwd: text,
	status: text,
	connected: Schema.Boolean,
	generation: text,
	reason: text,
});
const ServerSchema = Schema.Union([
	CreationServerSchema,
	AckSchema,
	Schema.Struct({
		type: Schema.Literal("sessions"),
		version: Schema.Literal(VERSION),
		sessions: Schema.Array(SessionSchema),
		error: text,
	}),
	Schema.Struct({
		type: Schema.Literal("snapshot"),
		version: Schema.Literal(VERSION),
		paneId: text,
		snapshot: SnapshotSchema,
	}),
	Schema.Struct({
		type: Schema.Literal("patch"),
		version: Schema.Literal(VERSION),
		paneId: text,
		patch: PatchSchema,
	}),
	Schema.Struct({
		type: Schema.Literal("unavailable"),
		version: Schema.Literal(VERSION),
		paneId: text,
		error: text,
	}),
]);
export type Snapshot = typeof SnapshotSchema.Type;
export type Patch = typeof PatchSchema.Type;
export type Message = typeof MessageSchema.Type;
export type Block = typeof BlockSchema.Type;
export type Dialog = typeof DialogSchema.Type;
export type Tool = typeof ToolSchema.Type;
export type Command = typeof CommandSchema.Type;
export type Ack = typeof AckSchema.Type;
export type Session = typeof SessionSchema.Type;
export type ServerMessage = typeof ServerSchema.Type;
export type Registration = typeof RegistrationSchema.Type;
export const decodeClient = Schema.decodeUnknownSync(ClientSchema);
export const decodeCompanion = Schema.decodeUnknownSync(CompanionSchema);
export const decodeServer = Schema.decodeUnknownSync(ServerSchema);
export const decodeCommand = Schema.decodeUnknownSync(CommandSchema);

export function applyPatch(state: Snapshot, patch: Patch): Snapshot | undefined {
	if (
		state.generation !== patch.generation ||
		state.revision !== patch.baseRevision ||
		patch.revision <= patch.baseRevision
	)
		return;
	const { baseRevision: _, messages, tools, ...changes } = patch;
	for (const [splice, length] of [
		[messages, state.messages.length],
		[tools, state.tools.length],
	] as const)
		if (splice && (!Number.isInteger(splice.from) || splice.from < 0 || splice.from > length))
			return;
	return {
		...state,
		...changes,
		messages: messages
			? [...state.messages.slice(0, messages.from), ...messages.items]
			: state.messages,
		tools: tools ? [...state.tools.slice(0, tools.from), ...tools.items] : state.tools,
	};
}
export function diffSnapshot(previous: Snapshot, next: Snapshot): Patch {
	const patch: Record<string, unknown> = {
		generation: next.generation,
		baseRevision: previous.revision,
		revision: next.revision,
	};
	for (const key of ["messages", "tools"] as const) {
		let from = 0;
		while (
			from < previous[key].length &&
			from < next[key].length &&
			(previous[key][from] === next[key][from] ||
				JSON.stringify(previous[key][from]) === JSON.stringify(next[key][from]))
		)
			from++;
		if (from !== previous[key].length || from !== next[key].length)
			patch[key] = { from, items: next[key].slice(from) };
	}
	for (const key of [
		"dialogs",
		"models",
		"model",
		"thinking",
		"busy",
		"terminalOnly",
		"error",
	] as const) {
		if (JSON.stringify(previous[key]) !== JSON.stringify(next[key])) patch[key] = next[key];
	}
	return Schema.decodeUnknownSync(PatchSchema)(patch);
}
