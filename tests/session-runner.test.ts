import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { atomicJSON, readOperation, type StoredOperation } from "../src/server/creation-store.js";

it.each([false, true])(
	"runs Emidev in the pane runner, honors its root and stops on failure (%s)",
	async (fail) => {
		const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "bergere-runner-")));
		const workspace = path.join(root, "actual-root");
		await mkdir(workspace);
		await mkdir(path.join(root, "bin"));
		const calls = path.join(root, "calls");
		const operation: StoredOperation = {
			request: {
				kind: "emidev-workspace",
				name: "different-name",
				repositories: ["emidat-api", "emidat-frontend"],
			},
			herdrSocket: "/unused",
			bridgeSocket: "/private/bridge.sock",
			operation: {
				id: randomUUID(),
				stage: "launching",
				workspaceId: "w1",
				paneId: "p1",
				terminalId: "t1",
				root,
				error: "",
			},
		};
		const file = path.join(root, "operation.json");
		await atomicJSON(file, operation);
		await writeFile(
			path.join(root, "bin/emidev"),
			`#!${process.execPath}\nimport fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2))+'\\n');\nconsole.log(JSON.stringify({ok:${!fail},data:{workspace:{name:'different-name',path:${JSON.stringify(workspace)},repositories:['emidat-api']}}}));\nprocess.exit(${fail ? 1 : 0});\n`,
			{ mode: 0o700 },
		);
		await writeFile(
			path.join(root, "bin/pi"),
			`#!${process.execPath}\nimport fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({cwd:process.cwd(),bridge:process.env.BERGERE_BRIDGE_SOCKET})+'\\n');\n`,
			{ mode: 0o700 },
		);
		const launch = () =>
			new Promise<number | null>((resolve, reject) => {
				const child = spawn(
					process.execPath,
					["--import", "tsx", "src/server/session-runner.ts", file],
					{
						env: { ...process.env, PATH: `${path.join(root, "bin")}:${process.env.PATH}` },
						stdio: "ignore",
					},
				);
				child.once("error", reject);
				child.once("exit", resolve);
			});
		try {
			await launch();
			const status = await readOperation(`${file}.status`);
			expect(status.operation.stage).toBe(fail ? "failed" : "exited");
			const entries = (await readFile(calls, "utf8"))
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
			expect(entries[0]).toEqual([
				"workspace",
				"create",
				"--json",
				"-n",
				"different-name",
				"-r",
				"emidat-api",
				"-r",
				"emidat-frontend",
			]);
			if (fail) expect(entries).toHaveLength(1);
			else expect(entries[1]).toEqual({ cwd: workspace, bridge: "/private/bridge.sock" });
			expect(await launch()).toBe(1);
			expect((await readFile(calls, "utf8")).trim().split("\n")).toHaveLength(entries.length);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	},
);
