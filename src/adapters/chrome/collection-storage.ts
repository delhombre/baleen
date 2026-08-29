import { z } from "zod";

import {
  CollectionsSchema,
  resolveCurrentCollectionId,
  type Collection,
} from "../../core/collection";

export const COLLECTIONS_STORAGE_KEY = "baleen.collections.v1" as const;

export type ChromeCollectionStorage = {
  readonly get: (key: string) => Promise<unknown>;
  readonly set: (items: Record<string, unknown>) => Promise<void>;
};

export type CollectionSnapshot = {
  readonly collections: readonly Collection[];
  readonly currentCollectionId: string | null;
};

export type CollectionStorageError = {
  readonly kind: "error";
  readonly code: "quota" | "unavailable";
};

export type CollectionLoadResult =
  | { readonly kind: "success"; readonly snapshot: CollectionSnapshot }
  | { readonly kind: "invalid" }
  | CollectionStorageError;

export type CollectionSaveResult =
  { readonly kind: "success" } | { readonly kind: "invalid" } | CollectionStorageError;

const SnapshotSchema = z
  .object({
    collections: CollectionsSchema,
    currentCollectionId: z.union([z.string().uuid(), z.null()]),
  })
  .strict();

function isQuotaFailure(value: unknown): boolean {
  if (typeof value === "string") return /quota/iu.test(value);
  if (typeof value !== "object" || value === null) return false;
  try {
    const record = value as Record<string, unknown>;
    return (
      record.name === "QuotaExceededError" ||
      record.code === "QUOTA_BYTES" ||
      (typeof record.message === "string" && /quota/iu.test(record.message))
    );
  } catch {
    return false;
  }
}

function storageError(value: unknown): CollectionStorageError {
  return { kind: "error", code: isQuotaFailure(value) ? "quota" : "unavailable" };
}

type StoredValueRead =
  | { readonly kind: "missing" }
  | { readonly kind: "value"; readonly value: unknown }
  | { readonly kind: "invalid" }
  | { readonly kind: "unavailable" };

function readStoredValue(response: unknown): StoredValueRead {
  if (typeof response !== "object" || response === null || Array.isArray(response)) {
    return { kind: "invalid" };
  }
  try {
    return Object.prototype.hasOwnProperty.call(response, COLLECTIONS_STORAGE_KEY)
      ? { kind: "value", value: (response as Record<string, unknown>)[COLLECTIONS_STORAGE_KEY] }
      : { kind: "missing" };
  } catch {
    return { kind: "unavailable" };
  }
}

function normalizeSnapshot(value: unknown): CollectionSnapshot | undefined {
  const parsed = SnapshotSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const currentCollectionId = resolveCurrentCollectionId(
    parsed.data.collections,
    parsed.data.currentCollectionId ?? undefined,
  );
  return { collections: parsed.data.collections, currentCollectionId: currentCollectionId ?? null };
}

export function createCollectionStorage(storage: ChromeCollectionStorage): {
  readonly load: () => Promise<CollectionLoadResult>;
  readonly save: (snapshot: CollectionSnapshot) => Promise<CollectionSaveResult>;
} {
  return {
    async load(): Promise<CollectionLoadResult> {
      try {
        const storedValue = readStoredValue(await storage.get(COLLECTIONS_STORAGE_KEY));
        if (storedValue.kind === "missing") {
          return { kind: "success", snapshot: { collections: [], currentCollectionId: null } };
        }
        if (storedValue.kind === "invalid") {
          return { kind: "invalid" };
        }
        if (storedValue.kind === "unavailable") {
          return { kind: "error", code: "unavailable" };
        }
        const snapshot = normalizeSnapshot(storedValue.value);
        return snapshot === undefined ? { kind: "invalid" } : { kind: "success", snapshot };
      } catch (error: unknown) {
        return storageError(error);
      }
    },

    async save(snapshot: CollectionSnapshot): Promise<CollectionSaveResult> {
      const normalized = normalizeSnapshot(snapshot);
      if (normalized === undefined) return { kind: "invalid" };
      try {
        await storage.set({ [COLLECTIONS_STORAGE_KEY]: normalized });
        return { kind: "success" };
      } catch (error: unknown) {
        return storageError(error);
      }
    },
  };
}
