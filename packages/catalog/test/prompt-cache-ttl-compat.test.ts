import { describe, expect, it } from "bun:test";
import { resolveModelPolicy } from "../src/compat/resolve";
import type { Api, ModelSpec } from "../src/types";

function spec<TApi extends Api>(api: TApi, overrides: Partial<ModelSpec<TApi>>): ModelSpec<TApi> {
	return {
		api,
		id: "model-1",
		name: "Model 1",
		provider: "prov",
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		maxTokens: 8_192,
		contextWindow: 200_000,
		reasoning: true,
		...overrides,
	} as ModelSpec<TApi>;
}

describe("prompt cache lifetimes resolve from provider rules", () => {
	it("gives the Codex subscription route its one-hour reusable prefix", () => {
		const compat = resolveModelPolicy(
			spec("openai-codex-responses", { provider: "openai-codex", id: "gpt-5.6-sol" }),
		).compat;
		expect(compat.promptCacheTtl).toBe("1h");
	});

	it("gives the official OpenAI API the 24-hour opt-in retention window", () => {
		const compat = resolveModelPolicy(
			spec("openai-responses", {
				provider: "openai",
				id: "gpt-5.6-sol",
				baseUrl: "https://api.openai.com/v1",
			}),
		).compat;
		expect(compat.promptCacheLongTtl).toBe("24h");
	});

	it("gives Anthropic a five-minute prefix that extends to an hour on request", () => {
		const compat = resolveModelPolicy(
			spec("anthropic-messages", {
				provider: "anthropic",
				id: "claude-opus-4-8",
				baseUrl: "https://api.anthropic.com",
			}),
		).compat;
		expect(compat.promptCacheTtl).toBe("5m");
		expect(compat.promptCacheLongTtl).toBe("1h");
	});

	it("leaves a self-hosted deployment of the same wire API without a baked lifetime", () => {
		const compat = resolveModelPolicy(
			spec("openai-responses", {
				provider: "self-hosted",
				id: "gpt-5.6-sol",
				baseUrl: "https://llm.internal.example.com/v1",
			}),
		).compat;
		expect(compat.promptCacheTtl).toBeUndefined();
		expect(compat.promptCacheLongTtl).toBeUndefined();
	});
});
