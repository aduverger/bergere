import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

// Keep this native ESM entry stable: Pi reload does not clear Node's module cache.
export default async function companion(pi) {
  const bundle = new URL("./dist/extension/index.js", import.meta.url);
  const hash = createHash("sha256")
    .update(await readFile(bundle))
    .digest("hex");
  const extension = await import(`${bundle.href}?build=${hash}`);
  return extension.default(pi);
}
