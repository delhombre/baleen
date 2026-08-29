import { describe, expect, it } from "vitest";

import { DEFAULT_LLM_PROVIDER, isLlmProvider, LLM_PROVIDERS } from "../../../src/core/llm-provider";

describe("LLM provider contract", () => {
  it("accepts only the supported providers and defaults to Anthropic", () => {
    expect(LLM_PROVIDERS).toEqual(["anthropic", "groq"]);
    expect(DEFAULT_LLM_PROVIDER).toBe("anthropic");
    expect(isLlmProvider("anthropic")).toBe(true);
    expect(isLlmProvider("groq")).toBe(true);
    expect(isLlmProvider("openai")).toBe(false);
    expect(isLlmProvider(undefined)).toBe(false);
  });
});
