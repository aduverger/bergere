import { it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, copyFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

it("Pi reload uses a rebuilt companion bundle in the same Node process", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pmh-reload-"));
  try {
    await mkdir(path.join(root, "dist/extension"), { recursive: true });
    await copyFile("companion.js", path.join(root, "companion.js"));
    await writeFile(path.join(root, "package.json"), '{"type":"module"}');
    const loader = pathToFileURL(
      path.resolve(
        "node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/jiti-loader.js",
      ),
    ).href;
    const script = `
      import { createJiti } from ${JSON.stringify(loader)};
      import { writeFile } from 'node:fs/promises';
      const bundle = ${JSON.stringify(path.join(root, "dist/extension/index.js"))};
      const wrapper = ${JSON.stringify(path.join(root, "companion.js"))};
      await writeFile(bundle, 'export default function(){return 1}');
      const first = await createJiti(import.meta.url, {moduleCache: false}).import(wrapper, {default: true});
      const before = await first({});
      await writeFile(bundle, 'export default function(){return 2}');
      const reloaded = await createJiti(import.meta.url, {moduleCache: false}).import(wrapper, {default: true});
      console.log(JSON.stringify([before, await reloaded({})]));
    `;
    const result = await promisify(execFile)(process.execPath, [
      "--input-type=module",
      "-e",
      script,
    ]);
    expect(JSON.parse(result.stdout)).toEqual([1, 2]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
