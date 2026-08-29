import { describe, expect, it } from "vitest";

import {
  CollectionSchema,
  CollectionsSchema,
  addProduct,
  createCollection,
  deleteCollection,
  resolveCurrentCollectionId,
  renameCollection,
} from "../../../src/core/collection";
import type { ProductRecord } from "../../../src/core/product-record";

const product = (id: string, name: string): ProductRecord => ({
  id,
  capturedAt: "2026-08-28T12:00:00.000Z",
  source: { url: `https://shop.example.test/products/${id}`, pageTitle: name },
  name,
  brand: "Baleen",
  price: "unknown",
  category: "unknown",
  specs: [{ label: "Capacity", value: "5 L" }],
  pros: [],
  cons: [],
  extraction: { method: "json-ld", model: "claude-sonnet-4-6" },
});

describe("collection core", () => {
  it("creates an empty collection with a trimmed nonblank name and injected id", () => {
    expect(
      createCollection("  Air fryers janvier  ", () => "4c1ee929-6c05-42e8-bfdc-8dfb602ca0db"),
    ).toEqual({
      id: "4c1ee929-6c05-42e8-bfdc-8dfb602ca0db",
      name: "Air fryers janvier",
      products: [],
    });
  });

  it("rejects blank collection names", () => {
    expect(() => createCollection(" \t\n ", () => "4c1ee929-6c05-42e8-bfdc-8dfb602ca0db")).toThrow(
      "Collection name must not be blank.",
    );
  });

  it("validates a stored collection from unknown with its complete product records", () => {
    const stored: unknown = {
      id: "4c1ee929-6c05-42e8-bfdc-8dfb602ca0db",
      name: "Air fryers janvier",
      products: [],
    };

    expect(CollectionSchema.safeParse(stored).success).toBe(true);
    expect(
      CollectionSchema.safeParse({
        id: "4c1ee929-6c05-42e8-bfdc-8dfb602ca0db",
        name: "Air fryers janvier",
        products: [{ id: "not-a-product" }],
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate collection ids and duplicate product ids while allowing cross-collection reuse", () => {
    const first = {
      id: "4c1ee929-6c05-42e8-bfdc-8dfb602ca0db",
      name: "Air fryers",
      products: [product("6d4013e0-93e4-45a3-9298-16e69ce3af1e", "CrispWave")],
    } as const;
    const secondWithDuplicateCollectionId = {
      id: first.id,
      name: "Espresso",
      products: [],
    } as const;
    const secondWithReusedProduct = {
      id: "9df4e444-6d40-45a2-a09d-4bd2e05d7b1d",
      name: "Espresso",
      products: first.products,
    } as const;

    expect(CollectionsSchema.safeParse([first, secondWithDuplicateCollectionId]).success).toBe(
      false,
    );
    expect(
      CollectionSchema.safeParse({
        ...first,
        products: [...first.products, first.products[0]],
      }).success,
    ).toBe(false);
    expect(CollectionsSchema.safeParse([first, secondWithReusedProduct]).success).toBe(true);
  });

  it("adds the complete product record without losing provenance or extraction", () => {
    const collection = createCollection("Air fryers", () => "4c1ee929-6c05-42e8-bfdc-8dfb602ca0db");
    const captured = product("6d4013e0-93e4-45a3-9298-16e69ce3af1e", "CrispWave");

    expect(addProduct(collection, captured)).toEqual({
      ...collection,
      products: [captured],
    });
    expect(collection.products).toEqual([]);
  });

  it("replaces a duplicate product id in place with the latest complete record", () => {
    const collection = createCollection("Air fryers", () => "4c1ee929-6c05-42e8-bfdc-8dfb602ca0db");
    const first = product("6d4013e0-93e4-45a3-9298-16e69ce3af1e", "First capture");
    const second = product("6d4013e0-93e4-45a3-9298-16e69ce3af1e", "Latest capture");
    const withFirst = addProduct(collection, first);

    expect(addProduct(withFirst, second).products).toEqual([second]);
  });

  it("renames a collection without changing its products or mutating the input", () => {
    const collection = addProduct(
      createCollection("Air fryers", () => "4c1ee929-6c05-42e8-bfdc-8dfb602ca0db"),
      product("6d4013e0-93e4-45a3-9298-16e69ce3af1e", "CrispWave"),
    );

    expect(renameCollection(collection, "  Final shortlist ")).toEqual({
      id: collection.id,
      name: "Final shortlist",
      products: collection.products,
    });
    expect(collection.name).toBe("Air fryers");
  });

  it("deletes only the matching collection from a list without mutating that list", () => {
    const first = createCollection("Air fryers", () => "4c1ee929-6c05-42e8-bfdc-8dfb602ca0db");
    const second = createCollection("Espresso", () => "9df4e444-6d40-45a2-a09d-4bd2e05d7b1d");
    const collections = [first, second] as const;

    expect(deleteCollection(collections, first.id)).toEqual([second]);
    expect(collections).toEqual([first, second]);
  });

  it("keeps an existing current id and falls back stably to the first collection", () => {
    const first = createCollection("Air fryers", () => "4c1ee929-6c05-42e8-bfdc-8dfb602ca0db");
    const second = createCollection("Espresso", () => "9df4e444-6d40-45a2-a09d-4bd2e05d7b1d");
    const collections = [first, second] as const;

    expect(resolveCurrentCollectionId(collections, second.id)).toBe(second.id);
    expect(resolveCurrentCollectionId(collections, "missing")).toBe(first.id);
    expect(resolveCurrentCollectionId([], first.id)).toBeUndefined();
  });
});
