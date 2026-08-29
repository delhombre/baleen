import { describe, expect, it } from "vitest";

import {
  COLLECTIONS_STORAGE_KEY,
  createCollectionStorage,
  type ChromeCollectionStorage,
} from "../../../../src/adapters/chrome/collection-storage";
import { createCollectionsController } from "../../../../src/adapters/chrome/collections-controller";
import type { ProductRecord } from "../../../../src/core/product-record";

const collectionId = "4c1ee929-6c05-42e8-bfdc-8dfb602ca0db";

const product: ProductRecord = {
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
};

describe("collections controller", () => {
  it("creates the first collection and persists its complete snapshot", async () => {
    let state: Record<string, unknown> = {};
    const writes: Array<Record<string, unknown>> = [];
    const chromeStorage: ChromeCollectionStorage = {
      get: async () => state,
      set: async (items) => {
        writes.push(items);
        state = { ...state, ...items };
      },
    };
    const controller = createCollectionsController(
      createCollectionStorage(chromeStorage),
      () => collectionId,
    );

    await expect(controller.load()).resolves.toEqual({
      kind: "success",
      snapshot: { collections: [], currentCollectionId: null },
    });
    await expect(controller.createCollection("  Air fryers janvier  ")).resolves.toEqual({
      kind: "success",
      snapshot: {
        collections: [{ id: collectionId, name: "Air fryers janvier", products: [] }],
        currentCollectionId: collectionId,
      },
    });
    expect(writes).toEqual([
      {
        [COLLECTIONS_STORAGE_KEY]: {
          collections: [{ id: collectionId, name: "Air fryers janvier", products: [] }],
          currentCollectionId: collectionId,
        },
      },
    ]);
  });

  it("rejects blank names without persisting a collection", async () => {
    let state: Record<string, unknown> = {};
    let writeCount = 0;
    const chromeStorage: ChromeCollectionStorage = {
      get: async () => state,
      set: async (items) => {
        writeCount += 1;
        state = { ...state, ...items };
      },
    };
    const controller = createCollectionsController(
      createCollectionStorage(chromeStorage),
      () => collectionId,
    );

    await controller.load();

    await expect(controller.createCollection(" \t ")).resolves.toEqual({
      kind: "error",
      code: "invalid-name",
    });
    expect(writeCount).toBe(0);
  });

  it("supports CRUD while keeping the current collection stable", async () => {
    let state: Record<string, unknown> = {};
    const chromeStorage: ChromeCollectionStorage = {
      get: async () => state,
      set: async (items) => {
        state = { ...state, ...items };
      },
    };
    const ids = [collectionId, "9df4e444-6d40-45a2-a09d-4bd2e05d7b1d"];
    const controller = createCollectionsController(createCollectionStorage(chromeStorage), () => {
      const id = ids.shift();
      if (id === undefined) {
        throw new Error("id factory exhausted");
      }
      return id;
    });

    await controller.load();
    await controller.createCollection("Air fryers");
    await controller.createCollection("Espresso");
    await expect(
      controller.selectCollection("9df4e444-6d40-45a2-a09d-4bd2e05d7b1d"),
    ).resolves.toEqual({
      kind: "success",
      snapshot: {
        collections: [
          { id: collectionId, name: "Air fryers", products: [] },
          {
            id: "9df4e444-6d40-45a2-a09d-4bd2e05d7b1d",
            name: "Espresso",
            products: [],
          },
        ],
        currentCollectionId: "9df4e444-6d40-45a2-a09d-4bd2e05d7b1d",
      },
    });
    await controller.renameCollection(
      "9df4e444-6d40-45a2-a09d-4bd2e05d7b1d",
      "  Espresso shortlist ",
    );
    await expect(
      controller.deleteCollection("9df4e444-6d40-45a2-a09d-4bd2e05d7b1d"),
    ).resolves.toMatchObject({
      kind: "success",
      snapshot: {
        collections: [{ id: collectionId, name: "Air fryers", products: [] }],
        currentCollectionId: collectionId,
      },
    });
    await expect(controller.deleteCollection(collectionId)).resolves.toMatchObject({
      kind: "success",
      snapshot: { collections: [], currentCollectionId: null },
    });
  });

  it("adds a validated product once and preserves it after a fresh load", async () => {
    let state: Record<string, unknown> = {};
    const chromeStorage: ChromeCollectionStorage = {
      get: async () => state,
      set: async (items) => {
        state = { ...state, ...items };
      },
    };
    const controller = createCollectionsController(
      createCollectionStorage(chromeStorage),
      () => collectionId,
    );

    await controller.load();
    await controller.createCollection("Air fryers");
    await expect(controller.addProduct(collectionId, product)).resolves.toEqual({
      kind: "success",
      snapshot: {
        collections: [{ id: collectionId, name: "Air fryers", products: [product] }],
        currentCollectionId: collectionId,
      },
    });

    const restored = createCollectionsController(createCollectionStorage(chromeStorage), () => {
      throw new Error("id factory must not be used during load");
    });
    await expect(restored.load()).resolves.toEqual({
      kind: "success",
      snapshot: {
        collections: [{ id: collectionId, name: "Air fryers", products: [product] }],
        currentCollectionId: collectionId,
      },
    });
  });

  it("does not persist an unvalidated product", async () => {
    let state: Record<string, unknown> = {};
    let writeCount = 0;
    const chromeStorage: ChromeCollectionStorage = {
      get: async () => state,
      set: async (items) => {
        writeCount += 1;
        state = { ...state, ...items };
      },
    };
    const controller = createCollectionsController(
      createCollectionStorage(chromeStorage),
      () => collectionId,
    );

    await controller.load();
    await controller.createCollection("Air fryers");
    const writesAfterCollection = writeCount;

    await expect(controller.addProduct(collectionId, { id: "not-a-product" })).resolves.toEqual({
      kind: "error",
      code: "invalid-data",
    });
    expect(writeCount).toBe(writesAfterCollection);
  });

  it("keeps the previous snapshot when a product save fails", async () => {
    const storedSnapshot = {
      collections: [{ id: collectionId, name: "Air fryers", products: [] }],
      currentCollectionId: collectionId,
    };
    const chromeStorage: ChromeCollectionStorage = {
      get: async () => ({ [COLLECTIONS_STORAGE_KEY]: storedSnapshot }),
      set: async () => {
        throw new Error("QUOTA_BYTES exceeded");
      },
    };
    const controller = createCollectionsController(
      createCollectionStorage(chromeStorage),
      () => collectionId,
    );

    await controller.load();
    await expect(controller.addProduct(collectionId, product)).resolves.toEqual({
      kind: "error",
      code: "quota",
    });
    await expect(controller.load()).resolves.toEqual({
      kind: "success",
      snapshot: storedSnapshot,
    });
  });

  it("does not add a product when there is no current collection", async () => {
    let writeCount = 0;
    const chromeStorage: ChromeCollectionStorage = {
      get: async () => ({}),
      set: async () => {
        writeCount += 1;
      },
    };
    const controller = createCollectionsController(
      createCollectionStorage(chromeStorage),
      () => collectionId,
    );

    await controller.load();
    await expect(controller.addProduct(collectionId, product)).resolves.toEqual({
      kind: "error",
      code: "no-current-collection",
    });
    expect(writeCount).toBe(0);
  });

  it("keeps one entry when the same normalized record is delivered twice", async () => {
    let state: Record<string, unknown> = {};
    const chromeStorage: ChromeCollectionStorage = {
      get: async () => state,
      set: async (items) => {
        state = { ...state, ...items };
      },
    };
    const controller = createCollectionsController(
      createCollectionStorage(chromeStorage),
      () => collectionId,
    );

    await controller.load();
    await controller.createCollection("Air fryers");
    await controller.addProduct(collectionId, product);
    await expect(controller.addProduct(collectionId, product)).resolves.toEqual({
      kind: "success",
      snapshot: {
        collections: [{ id: collectionId, name: "Air fryers", products: [product] }],
        currentCollectionId: collectionId,
      },
    });
  });

  it("rejects duplicate persisted collection and product ids through the controller", async () => {
    const duplicateCollectionSnapshot = {
      collections: [
        { id: collectionId, name: "Air fryers", products: [] },
        { id: collectionId, name: "Duplicate", products: [] },
      ],
      currentCollectionId: collectionId,
    };
    const duplicateProductSnapshot = {
      collections: [{ id: collectionId, name: "Air fryers", products: [product, product] }],
      currentCollectionId: collectionId,
    };

    for (const persisted of [duplicateCollectionSnapshot, duplicateProductSnapshot]) {
      const chromeStorage: ChromeCollectionStorage = {
        get: async () => ({ [COLLECTIONS_STORAGE_KEY]: persisted }),
        set: async () => undefined,
      };
      const controller = createCollectionsController(
        createCollectionStorage(chromeStorage),
        () => collectionId,
      );

      await expect(controller.load()).resolves.toEqual({ kind: "error", code: "invalid-data" });
    }
  });

  it("rejects a created collection when its generated id already exists", async () => {
    const persisted = {
      collections: [{ id: collectionId, name: "Air fryers", products: [] }],
      currentCollectionId: collectionId,
    };
    let state: Record<string, unknown> = { [COLLECTIONS_STORAGE_KEY]: persisted };
    const chromeStorage: ChromeCollectionStorage = {
      get: async () => state,
      set: async (items) => {
        state = { ...state, ...items };
      },
    };
    const controller = createCollectionsController(
      createCollectionStorage(chromeStorage),
      () => collectionId,
    );

    await controller.load();
    await expect(controller.createCollection("Duplicate")).resolves.toEqual({
      kind: "error",
      code: "invalid-data",
    });
    expect(state).toEqual({ [COLLECTIONS_STORAGE_KEY]: persisted });
  });

  it("serializes concurrent collection mutations instead of losing the first write", async () => {
    let state: Record<string, unknown> = {};
    const writes: Array<Record<string, unknown>> = [];
    let releaseFirstWrite: (() => void) | undefined;
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    const chromeStorage: ChromeCollectionStorage = {
      get: async () => state,
      set: async (items) => {
        writes.push(items);
        if (writes.length === 1) {
          await firstWrite;
        }
        state = { ...state, ...items };
      },
    };
    const ids = [collectionId, "9df4e444-6d40-45a2-a09d-4bd2e05d7b1d"];
    const controller = createCollectionsController(createCollectionStorage(chromeStorage), () => {
      const id = ids.shift();
      if (id === undefined) {
        throw new Error("id factory exhausted");
      }
      return id;
    });

    await controller.load();
    const first = controller.createCollection("Air fryers");
    const second = controller.createCollection("Espresso");
    await Promise.resolve();
    expect(writes).toHaveLength(1);
    releaseFirstWrite?.();

    await expect(Promise.all([first, second])).resolves.toEqual([
      {
        kind: "success",
        snapshot: {
          collections: [{ id: collectionId, name: "Air fryers", products: [] }],
          currentCollectionId: collectionId,
        },
      },
      {
        kind: "success",
        snapshot: {
          collections: [
            { id: collectionId, name: "Air fryers", products: [] },
            {
              id: "9df4e444-6d40-45a2-a09d-4bd2e05d7b1d",
              name: "Espresso",
              products: [],
            },
          ],
          currentCollectionId: collectionId,
        },
      },
    ]);
  });

  it("adds a deferred capture to its frozen target after the current selection changes", async () => {
    let state: Record<string, unknown> = {};
    const chromeStorage: ChromeCollectionStorage = {
      get: async () => state,
      set: async (items) => {
        state = { ...state, ...items };
      },
    };
    const secondCollectionId = "9df4e444-6d40-45a2-a09d-4bd2e05d7b1d";
    const ids = [collectionId, secondCollectionId];
    const controller = createCollectionsController(createCollectionStorage(chromeStorage), () => {
      const id = ids.shift();
      if (id === undefined) {
        throw new Error("id factory exhausted");
      }
      return id;
    });

    await controller.load();
    await controller.createCollection("Air fryers");
    await controller.createCollection("Espresso");
    await controller.selectCollection(collectionId);
    const targetCollectionId = collectionId;
    let releaseNormalization: ((value: ProductRecord) => void) | undefined;
    const normalized = new Promise<ProductRecord>((resolve) => {
      releaseNormalization = resolve;
    });
    const pendingAdd = normalized.then((record) =>
      controller.addProduct(targetCollectionId, record),
    );

    await controller.selectCollection(secondCollectionId);
    releaseNormalization?.(product);

    await expect(pendingAdd).resolves.toMatchObject({
      kind: "success",
      snapshot: {
        currentCollectionId: secondCollectionId,
        collections: [
          { id: collectionId, products: [product] },
          { id: secondCollectionId, products: [] },
        ],
      },
    });
  });

  it("rejects a deferred add when its target was deleted instead of falling back", async () => {
    let state: Record<string, unknown> = {};
    const chromeStorage: ChromeCollectionStorage = {
      get: async () => state,
      set: async (items) => {
        state = { ...state, ...items };
      },
    };
    const secondCollectionId = "9df4e444-6d40-45a2-a09d-4bd2e05d7b1d";
    const ids = [collectionId, secondCollectionId];
    const controller = createCollectionsController(createCollectionStorage(chromeStorage), () => {
      const id = ids.shift();
      if (id === undefined) {
        throw new Error("id factory exhausted");
      }
      return id;
    });

    await controller.load();
    await controller.createCollection("Air fryers");
    await controller.createCollection("Espresso");
    await controller.selectCollection(collectionId);
    const targetCollectionId = collectionId;
    let releaseNormalization: ((value: ProductRecord) => void) | undefined;
    const normalized = new Promise<ProductRecord>((resolve) => {
      releaseNormalization = resolve;
    });
    const pendingAdd = normalized.then((record) =>
      controller.addProduct(targetCollectionId, record),
    );

    await controller.deleteCollection(targetCollectionId);
    releaseNormalization?.(product);

    await expect(pendingAdd).resolves.toEqual({ kind: "error", code: "not-found" });
    await expect(controller.load()).resolves.toMatchObject({
      kind: "success",
      snapshot: {
        collections: [{ id: secondCollectionId, products: [] }],
        currentCollectionId: secondCollectionId,
      },
    });
  });
});
