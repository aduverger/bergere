import { spawn } from "node:child_process";
import { open } from "node:fs/promises";
import { atomicJSON, readOperation } from "./creation-store.js";
import { provisionEmidev } from "./integrations/emidev.js";

async function run(file: string) {
	const claim = await open(`${file}.claimed`, "wx", 0o600);
	await claim.close();
	let stored = await readOperation(file);
	const update = async (stage: typeof stored.operation.stage, error = "") => {
		stored = { ...stored, operation: { ...stored.operation, stage, error } };
		await atomicJSON(`${file}.status`, stored);
	};
	try {
		let root = stored.operation.root;
		const request = stored.request;
		if (request.kind === "emidev-workspace") {
			stored = { ...stored, operation: { ...stored.operation, root: "" } };
			await update("provisioning");
			root = await provisionEmidev(request.name, request.repositories);
		}
		stored = { ...stored, operation: { ...stored.operation, root } };
		await update("starting");
		process.chdir(root);
		const code = await new Promise<number | null>((resolve, reject) => {
			const child = spawn("pi", [], {
				cwd: root,
				stdio: "inherit",
				env: { ...process.env, BERGERE_BRIDGE_SOCKET: stored.bridgeSocket },
			});
			child.once("error", () =>
				reject(new Error("Cannot start Pi. Check the Herdr terminal PATH and Pi installation.")),
			);
			child.once("exit", resolve);
		});
		await update(
			code === 0 ? "exited" : "failed",
			code === 0 ? "" : "Pi exited unsuccessfully. Inspect the Herdr terminal.",
		);
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Session launch failed. Inspect the Herdr terminal.";
		await update("failed", message);
		console.error(message);
	}
}
const file = process.argv[2];
if (file)
	void run(file).catch(() => {
		console.error("Session runner could not acquire its operation. It will not retry.");
		process.exitCode = 1;
	});
