export const LLM_PROVIDERS = ["anthropic", "groq"] as const;

export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export const DEFAULT_LLM_PROVIDER: LlmProvider = "anthropic";

export function isLlmProvider(value: unknown): value is LlmProvider {
  return value === "anthropic" || value === "groq";
}
