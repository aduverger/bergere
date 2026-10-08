import { Schema } from "effect";

const text = Schema.String;
export const CreationRequestSchema = Schema.Union([
	Schema.Struct({ kind: Schema.Literal("session"), workspaceId: text, root: text }),
	Schema.Struct({ kind: Schema.Literal("workspace"), name: text, root: text }),
	Schema.Struct({
		kind: Schema.Literal("emidev-workspace"),
		name: text,
		repositories: Schema.Array(text),
	}),
	Schema.Struct({ kind: Schema.Literal("emidev-session"), root: text, workspaceId: text }),
]);
export const CreationClientSchema = Schema.Union([
	Schema.Struct({ type: Schema.Literal("creation-discover"), version: Schema.Literal(2) }),
	Schema.Struct({
		type: Schema.Literal("creation-start"),
		version: Schema.Literal(2),
		id: text,
		request: CreationRequestSchema,
	}),
	Schema.Struct({ type: Schema.Literal("creation-status"), version: Schema.Literal(2), id: text }),
]);
const WorkspaceSchema = Schema.Struct({
	id: text,
	name: text,
	root: text,
	savedRoot: Schema.Boolean,
});
const EmidevWorkspaceSchema = Schema.Struct({
	name: text,
	root: text,
	repositories: Schema.Array(text),
	workspaceId: text,
	candidates: Schema.Array(text),
});
const CreationCatalogSchema = Schema.Struct({
	workspaces: Schema.Array(WorkspaceSchema),
	home: text,
	emidev: Schema.Struct({
		enabled: Schema.Boolean,
		error: text,
		workspaces: Schema.Array(EmidevWorkspaceSchema),
	}),
});
export const OperationSchema = Schema.Struct({
	id: text,
	stage: Schema.Literals([
		"creating",
		"launching",
		"provisioning",
		"starting",
		"ready",
		"exited",
		"failed",
		"uncertain",
	]),
	workspaceId: text,
	paneId: text,
	terminalId: text,
	root: text,
	error: text,
});
export const CreationServerSchema = Schema.Union([
	Schema.Struct({
		type: Schema.Literal("creation-catalog"),
		version: Schema.Literal(2),
		catalog: CreationCatalogSchema,
	}),
	Schema.Struct({
		type: Schema.Literal("creation-operation"),
		version: Schema.Literal(2),
		operation: OperationSchema,
	}),
	Schema.Struct({
		type: Schema.Literal("creation-error"),
		rejected: Schema.Boolean,
		version: Schema.Literal(2),
		id: text,
		error: text,
	}),
]);
export type CreationRequest = typeof CreationRequestSchema.Type;
export type CreationCatalog = typeof CreationCatalogSchema.Type;
export type CreationClient = typeof CreationClientSchema.Type;
export type CreationServer = typeof CreationServerSchema.Type;
export type CreationOperation = typeof OperationSchema.Type;
