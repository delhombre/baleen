import { describe, expect, it } from "vitest";

import {
  COLLECTIONS_STORAGE_KEY,
  createCollectionStorage,
  type ChromeCollectionStorage,
  type CollectionSnapshot,
} from "../../../../src/adapters/chrome/collection-storage";

const firstCollection = {
  id: "4c4d2f25-5d90-4c2f-bf7b-555555555555",
  name: "Air fryers",
  products: [],
} as const;

const secondCollection = {
  id: "0ce8fb2e-b4c2-4644-8b3a-666666666666",
  name: "Espresso",
  products: [],
} as const;

const storedProduct = {
  id: "6d4013e0-93e4-45a3-9298-16e69ce3af1e",
  capturedAt: "2026-08-28T12:00:00.000Z",
  source: {
    url: "https://shop.example.test/crispwave",
    pageTitle: "CrispWave product",
  },
  name: "CrispWave Air Fryer",
  brand: "CrispWave",
  price: { amount: 129.99, currency: "EUR" },
  category: "Air fryers",
  specs: [{ label: "Capacity", value: "5.5 L" }],
  pros: [],
  cons: [],
  extraction: { method: "json-ld", model: "claude-sonnet-4-6" },
} as const;

const snapshot: CollectionSnapshot = {
  collections: [firstCollection, secondCollection],
  currentCollectionId: secondCollection.id,
};

function stored(value: unknown): Record<string, unknown> {
  return { [COLLECTIONS_STORAGE_KEY]: value };
}

describe("collection storage", () => {
  it("loads an empty store as an empty collection snapshot", async () => {
    const storage: ChromeCollectionStorage = {
      get: async () => ({}),
      set: async () => undefined,
    };

    const result = await createCollectionStorage(storage).load();

    expect(result).toEqual({
      kind: "success",
      snapshot: { collections: [], currentCollectionId: null },
    });
  });

  it("does not treat a malformed outer storage response as an empty store", async () => {
    const storage: ChromeCollectionStorage = {
      get: async () => null,
      set: async () => undefined,
    };

    await expect(createCollectionStorage(storage).load()).resolves.toEqual({ kind: "invalid" });
  });

  it("rejects an array returned at the outer storage boundary", async () => {
    const storage: ChromeCollectionStorage = {
      get: async () => [],
      set: async () => undefined,
    };

    await expect(createCollectionStorage(storage).load()).resolves.toEqual({ kind: "invalid" });
  });

  it("reports an unavailable store when reading the outer response throws", async () => {
    const hostileResponse = new Proxy(
      {},
      {
        getOwnPropertyDescriptor: () => {
          throw new Error("storage response unavailable");
        },
      },
    );
    const storage: ChromeCollectionStorage = {
      get: async () => hostileResponse,
      set: async () => undefined,
    };

    await expect(createCollectionStorage(storage).load()).resolves.toEqual({
      kind: "error",
      code: "unavailable",
    });
  });

  it("loads collections and falls back when the current id is not a member", async () => {
    const storage: ChromeCollectionStorage = {
      get: async () =>
        stored({
          collections: [firstCollection, secondCollection],
          currentCollectionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        }),
      set: async () => undefined,
    };

    const result = await createCollectionStorage(storage).load();

    expect(result).toEqual({
      kind: "success",
      snapshot: { ...snapshot, currentCollectionId: firstCollection.id },
    });
  });

  it("reports malformed persisted data as invalid without coercion", async () => {
    const storage: ChromeCollectionStorage = {
      get: async () => stored({ collections: [{ id: 12, name: "coerced", products: [] }] }),
      set: async () => undefined,
    };

    await expect(createCollectionStorage(storage).load()).resolves.toEqual({ kind: "invalid" });
  });

  it("rejects duplicate collection ids in a persisted snapshot", async () => {
    const duplicateCollection = { ...secondCollection, id: firstCollection.id };
    const storage: ChromeCollectionStorage = {
      get: async () =>
        stored({
          collections: [firstCollection, duplicateCollection],
          currentCollectionId: firstCollection.id,
        }),
      set: async () => undefined,
    };

    await expect(createCollectionStorage(storage).load()).resolves.toEqual({ kind: "invalid" });
  });

  it("rejects duplicate product ids within one persisted collection on load and save", async () => {
    const duplicateProductSnapshot = {
      collections: [
        {
          ...firstCollection,
          products: [storedProduct, storedProduct],
        },
      ],
      currentCollectionId: firstCollection.id,
    };
    const storage: ChromeCollectionStorage = {
      get: async () => stored(duplicateProductSnapshot),
      set: async () => undefined,
    };

    await expect(createCollectionStorage(storage).load()).resolves.toEqual({ kind: "invalid" });
    await expect(createCollectionStorage(storage).save(duplicateProductSnapshot)).resolves.toEqual({
      kind: "invalid",
    });
  });

  it("saves the exact complete snapshot under its namespaced key", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const storage: ChromeCollectionStorage = {
      get: async () => stored(snapshot),
      set: async (items) => {
        calls.push(items);
      },
    };

    await expect(createCollectionStorage(storage).save(snapshot)).resolves.toEqual({
      kind: "success",
    });
    expect(calls).toEqual([stored(snapshot)]);
  });

  it("does not touch unrelated storage keys and round-trips after re-instantiation", async () => {
    let state: Record<string, unknown> = { apiKey: "secret", other: "untouched" };
    const storage: ChromeCollectionStorage = {
      get: async () => state,
      set: async (items) => {
        state = { ...state, ...items };
      },
    };

    await expect(createCollectionStorage(storage).save(snapshot)).resolves.toEqual({
      kind: "success",
    });
    await expect(createCollectionStorage(storage).load()).resolves.toEqual({
      kind: "success",
      snapshot,
    });
    expect(state).toMatchObject({ apiKey: "secret", other: "untouched" });
  });

  it("maps quota and unavailable failures to structured errors", async () => {
    const quota: ChromeCollectionStorage = {
      get: async () => {
        throw new Error("QUOTA_BYTES exceeded");
      },
      set: async () => {
        throw new Error("quota");
      },
    };
    const unavailable: ChromeCollectionStorage = {
      get: async () => {
        throw new Error("service unavailable");
      },
      set: async () => {
        throw new Error("offline");
      },
    };

    await expect(createCollectionStorage(quota).load()).resolves.toEqual({
      kind: "error",
      code: "quota",
    });
    await expect(createCollectionStorage(quota).save(snapshot)).resolves.toEqual({
      kind: "error",
      code: "quota",
    });
    await expect(createCollectionStorage(unavailable).load()).resolves.toEqual({
      kind: "error",
      code: "unavailable",
    });
    await expect(createCollectionStorage(unavailable).save(snapshot)).resolves.toEqual({
      kind: "error",
      code: "unavailable",
    });
  });

  it("uses the namespaced v1 storage key", async () => {
    const keys: string[] = [];
    const storage: ChromeCollectionStorage = {
      get: async (key) => {
        keys.push(key);
        return {};
      },
      set: async () => undefined,
    };

    await createCollectionStorage(storage).load();

    expect(keys).toEqual([COLLECTIONS_STORAGE_KEY]);
  });
});
