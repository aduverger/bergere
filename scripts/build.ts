import { build } from "esbuild";

await build({
	entryPoints: ["src/server/main.ts", "src/extension/index.ts"],
	outdir: "dist",
	outbase: "src",
	bundle: true,
	platform: "node",
	format: "esm",
	packages: "external",
	sourcemap: true,
	target: "node24",
});
