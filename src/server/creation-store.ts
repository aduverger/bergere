import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Schema } from "effect";
import { CreationRequestSchema, OperationSchema } from "../shared/creation.js";

const StoredOperationSchema = Schema.Struct({
	request: CreationRequestSchema,
	operation: OperationSchema,
	herdrSocket: Schema.String,
	bridgeSocket: Schema.String,
});
export type StoredOperation = typeof StoredOperationSchema.Type;
export async function readOperation(file: string): Promise<StoredOperation> {
	return Schema.decodeUnknownSync(StoredOperationSchema)(JSON.parse(await readFile(file, "utf8")));
}
export async function atomicJSON(file: string, value: unknown) {
	await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
	const temporary = `${file}.${randomUUID()}.tmp`;
	await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
	await rename(temporary, file);
}
