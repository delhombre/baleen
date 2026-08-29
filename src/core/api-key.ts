declare const apiKeyBrand: unique symbol;

/** A non-blank API key whose value has been validated at an untrusted boundary. */
export type ApiKey = string & { readonly [apiKeyBrand]: "ApiKey" };

export const API_KEY_MASK = "••••••••" as const;

export function parseApiKey(value: unknown): ApiKey | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? (trimmed as ApiKey) : undefined;
}

export function maskApiKey(value: ApiKey): typeof API_KEY_MASK {
  void value;
  return API_KEY_MASK;
}
