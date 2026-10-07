import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
	globalIgnores(["dist/**", "test-results/**", "playwright-report/**", ".run/**", "ios/**"]),
	{
		files: ["src/**/*.{ts,tsx}", "scripts/**/*.ts", "tests/**/*.ts", "*.config.ts"],
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
		},
		plugins: { "@typescript-eslint": tseslint.plugin },
		rules: {
			"@typescript-eslint/await-thenable": "error",
			"@typescript-eslint/no-floating-promises": "error",
			"@typescript-eslint/no-misused-promises": "error",
			"@typescript-eslint/no-unnecessary-condition": "error",
			"@typescript-eslint/only-throw-error": "error",
			"@typescript-eslint/switch-exhaustiveness-check": "error",
		},
	},
);
