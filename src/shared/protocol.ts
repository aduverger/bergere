import { Schema } from "effect";

export const VERSION = 1;
const text = Schema.String;
const strings = Schema.Array(text);
export const ImageSchema = Schema.Struct({
  type: Schema.Literal("image"),
  mimeType: text,
  data: text,
});
export const BlockSchema = Schema.Union([
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
export const MessageSchema = Schema.Struct({
  id: text,
  role: text,
  content: Schema.Array(BlockSchema),
  toolCallId: Schema.optional(text),
  toolName: Schema.optional(text),
  isError: Schema.optional(Schema.Boolean),
});
export const ToolSchema = Schema.Struct({
  id: text,
  name: text,
  args: Schema.Unknown,
  content: Schema.Array(BlockSchema),
  status: Schema.Literals(["running", "success", "error"]),
});
export const DialogSchema = Schema.Struct({
  id: text,
  kind: Schema.Literals(["confirm", "select", "input", "editor"]),
  title: text,
  message: text,
  options: strings,
  prefill: text,
});
export const ModelSchema = Schema.Struct({
  provider: text,
  id: text,
  name: text,
});
export const SnapshotSchema = Schema.Struct({
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
export const PatchSchema = Schema.Struct({
  generation: text,
  baseRevision: Schema.Number,
  revision: Schema.Number,
  messages: Schema.optional(Schema.Array(MessageSchema)),
  tools: Schema.optional(Schema.Array(ToolSchema)),
  dialogs: Schema.optional(Schema.Array(DialogSchema)),
  models: Schema.optional(Schema.Array(ModelSchema)),
  model: Schema.optional(text),
  thinking: Schema.optional(text),
  busy: Schema.optional(Schema.Boolean),
  terminalOnly: Schema.optional(Schema.Boolean),
  error: Schema.optional(text),
});
export const ActionSchema = Schema.Union([
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
    level: Schema.Literals([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ]),
  }),
  Schema.Struct({
    kind: Schema.Literal("answer"),
    dialogId: text,
    value: Schema.Union([text, Schema.Boolean]),
    cancelled: Schema.Boolean,
  }),
]);
export const CommandSchema = Schema.Struct({
  type: Schema.Literal("command"),
  version: Schema.Literal(VERSION),
  id: text,
  paneId: text,
  generation: text,
  action: ActionSchema,
});
export const ClientSchema = Schema.Union([
  CommandSchema,
  Schema.Struct({
    type: Schema.Literal("subscribe"),
    version: Schema.Literal(VERSION),
    paneId: text,
  }),
]);
export const AckSchema = Schema.Struct({
  type: Schema.Literal("ack"),
  version: Schema.Literal(VERSION),
  id: text,
  paneId: text,
  generation: text,
  ok: Schema.Boolean,
  error: text,
});
export const RegistrationSchema = Schema.Struct({
  type: Schema.Literal("register"),
  version: Schema.Literal(VERSION),
  herdrSocket: text,
  paneId: text,
  pid: Schema.Number,
  snapshot: SnapshotSchema,
});
export const CompanionSchema = Schema.Union([
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
export const SessionSchema = Schema.Struct({
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
export const ServerSchema = Schema.Union([
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

export function applyPatch(
  state: Snapshot,
  patch: Patch,
): Snapshot | undefined {
  if (
    state.generation !== patch.generation ||
    state.revision !== patch.baseRevision ||
    patch.revision <= patch.baseRevision
  )
    return;
  const { baseRevision: _, ...changes } = patch;
  return { ...state, ...changes };
}
export function diffSnapshot(previous: Snapshot, next: Snapshot): Patch {
  const patch: Record<string, unknown> = {
    generation: next.generation,
    baseRevision: previous.revision,
    revision: next.revision,
  };
  for (const key of [
    "messages",
    "tools",
    "dialogs",
    "models",
    "model",
    "thinking",
    "busy",
    "terminalOnly",
    "error",
  ] as const) {
    if (JSON.stringify(previous[key]) !== JSON.stringify(next[key]))
      patch[key] = next[key];
  }
  return Schema.decodeUnknownSync(PatchSchema)(patch);
}
