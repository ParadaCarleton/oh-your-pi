/**
 * Provider-aware prompt-cache expiry estimate.
 *
 * Callers that want to rewrite history only once the provider's reusable
 * prefix has gone cold (so the rewrite costs nothing extra) ask when the
 * entry written by the last real request is expected to expire.
 */
import type { Api, CacheRetention, Model } from "../types";
import { resolveCacheRetention } from "../utils";

const THIRTY_MINUTE_CACHE_TTL_MS = 30 * 60_000;
const ONE_HOUR_CACHE_TTL_MS = 60 * 60_000;
const ANTHROPIC_CACHE_TTL_MS = 5 * 60_000;
const OPENAI_LONG_CACHE_TTL_MS = 24 * ONE_HOUR_CACHE_TTL_MS;
const GENERIC_CACHE_TTL_MS = 5 * 60_000;

export interface PromptCacheExpiryOptions<TApi extends Api = Api> {
	model: Model<TApi>;
	/** Last successful provider request/cache touch persisted by the caller. */
	cacheTouchedAtMs: number;
	cacheRetention?: CacheRetention;
}

function supportsLongCacheRetention(model: Model): boolean {
	const compat = model.compat;
	return (
		compat !== undefined &&
		(("supportsLongCacheRetention" in compat && compat.supportsLongCacheRetention === true) ||
			("supportsLongPromptCacheRetention" in compat && compat.supportsLongPromptCacheRetention === true))
	);
}

function getPromptCacheMinimumTtlMs(model: Model): number | undefined {
	const compat = model.compat;
	if (compat === undefined || !("promptCacheBreakpointTtl" in compat)) return undefined;
	return compat.promptCacheBreakpointTtl === "30m" ? THIRTY_MINUTE_CACHE_TTL_MS : undefined;
}

/**
 * Epoch at which callers should treat a model's reusable prompt cache as
 * expired. Advertised minimum lifetimes and explicit retention policies win,
 * with a 5m generic fallback.
 */
export function getPromptCacheExpiryMs<TApi extends Api>(options: PromptCacheExpiryOptions<TApi>): number {
	const { model, cacheTouchedAtMs } = options;
	const retention = resolveCacheRetention(options.cacheRetention);
	if (retention === "none") return cacheTouchedAtMs;

	if (model.api === "openai-codex-responses") return cacheTouchedAtMs + ONE_HOUR_CACHE_TTL_MS;

	if (model.api === "anthropic-messages" || model.api === "bedrock-converse-stream") {
		if (retention === "long" && supportsLongCacheRetention(model)) {
			return cacheTouchedAtMs + ONE_HOUR_CACHE_TTL_MS;
		}
		return cacheTouchedAtMs + ANTHROPIC_CACHE_TTL_MS;
	}

	if (
		model.api === "openai-responses" ||
		model.api === "azure-openai-responses" ||
		model.api === "openai-completions"
	) {
		const retentionTtlMs =
			retention === "long" && supportsLongCacheRetention(model) ? OPENAI_LONG_CACHE_TTL_MS : GENERIC_CACHE_TTL_MS;
		// `promptCacheBreakpointTtl` advertises a *minimum* lifetime, so it raises a
		// shorter window but never truncates a longer retention window.
		const minimumTtlMs = getPromptCacheMinimumTtlMs(model) ?? 0;
		return cacheTouchedAtMs + Math.max(retentionTtlMs, minimumTtlMs);
	}

	return cacheTouchedAtMs + GENERIC_CACHE_TTL_MS;
}
