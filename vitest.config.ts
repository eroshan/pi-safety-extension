import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: [
			"tests/extension.test.ts",
			"tests/prompt.test.ts",
			"tests/review-auth.test.ts",
			"tests/review-flow.test.ts",
			"tests/state.test.ts",
			"tests/verdict.test.ts",
		],
	},
});
