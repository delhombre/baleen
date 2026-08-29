import { parseApiKey, type ApiKey } from "./api-key";

export type ApiKeySecretPort = {
  readonly readSecret: () => Promise<unknown>;
};

export type ApiKeyConnectionResponse =
  | { readonly kind: "success" }
  | {
      readonly kind: "error";
      readonly code: "unauthorized" | "quota" | "network" | "unavailable";
    };

export type ApiKeyConnectionPort = {
  readonly testConnection: (key: ApiKey) => Promise<unknown>;
};

export type StoredConnectionResult =
  | { readonly kind: "success" }
  | { readonly kind: "missing" }
  | { readonly kind: "invalid" }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "quota" }
  | { readonly kind: "network" }
  | { readonly kind: "unavailable" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExactSuccess(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length === 1 && value.kind === "success";
}

function connectionCode(
  value: unknown,
): "unauthorized" | "quota" | "network" | "unavailable" | undefined {
  if (!isRecord(value) || Object.keys(value).length !== 2 || value.kind !== "error") {
    return undefined;
  }

  return value.code === "unauthorized" ||
    value.code === "quota" ||
    value.code === "network" ||
    value.code === "unavailable"
    ? value.code
    : undefined;
}

function storageCode(value: unknown): "quota" | "unavailable" | undefined {
  if (!isRecord(value) || Object.keys(value).length !== 2 || value.kind !== "error") {
    return undefined;
  }

  return value.code === "quota" || value.code === "unavailable" ? value.code : undefined;
}

export async function testStoredConnection(
  secret: ApiKeySecretPort,
  connection: ApiKeyConnectionPort,
): Promise<StoredConnectionResult> {
  let rawSecret: unknown;
  try {
    rawSecret = await secret.readSecret();
  } catch (error: unknown) {
    const code = storageCode(error);
    return { kind: code ?? "unavailable" };
  }

  if (rawSecret === undefined) {
    return { kind: "missing" };
  }

  const key = parseApiKey(rawSecret);
  if (key === undefined) {
    return { kind: "invalid" };
  }

  try {
    const response = await connection.testConnection(key);
    if (isExactSuccess(response)) {
      return { kind: "success" };
    }

    const code = connectionCode(response);
    return { kind: code ?? "network" };
  } catch {
    return { kind: "network" };
  }
}
