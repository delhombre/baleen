import { z } from "zod";

import { ProductRecordSchema, type ProductRecord } from "./product-record";

const nonblankTextSchema = z.string().trim().min(1);

export const CollectionSchema = z
  .object({
    id: z.string().uuid(),
    name: nonblankTextSchema,
    products: z.array(ProductRecordSchema).readonly(),
  })
  .strict()
  .superRefine((collection, context) => {
    const productIds = new Set<string>();
    collection.products.forEach((product, index) => {
      if (productIds.has(product.id)) {
        context.addIssue({
          code: "custom",
          path: ["products", index, "id"],
          message: "Product ids must be unique within a collection.",
        });
      }
      productIds.add(product.id);
    });
  })
  .readonly();

export const CollectionsSchema = z
  .array(CollectionSchema)
  .superRefine((collections, context) => {
    const collectionIds = new Set<string>();
    collections.forEach((collection, index) => {
      if (collectionIds.has(collection.id)) {
        context.addIssue({
          code: "custom",
          path: [index, "id"],
          message: "Collection ids must be unique.",
        });
      }
      collectionIds.add(collection.id);
    });
  })
  .readonly();

export type Collection = z.infer<typeof CollectionSchema>;
export type CollectionIdFactory = () => string;

function normalizeCollectionName(name: string): string {
  const normalized = name.trim();
  if (normalized.length === 0) {
    throw new RangeError("Collection name must not be blank.");
  }
  return normalized;
}

export function createCollection(name: string, idFactory: CollectionIdFactory): Collection {
  const collection = {
    id: idFactory(),
    name: normalizeCollectionName(name),
    products: [],
  } satisfies Collection;
  return CollectionSchema.parse(collection);
}

export function addProduct(collection: Collection, product: ProductRecord): Collection {
  const checkedCollection = CollectionSchema.parse(collection);
  const checkedProduct = ProductRecordSchema.parse(product);
  const existingIndex = checkedCollection.products.findIndex(
    (item) => item.id === checkedProduct.id,
  );
  const products = [...checkedCollection.products];

  if (existingIndex === -1) {
    products.push(checkedProduct);
  } else {
    products[existingIndex] = checkedProduct;
  }

  return CollectionSchema.parse({ ...checkedCollection, products });
}

export function renameCollection(collection: Collection, name: string): Collection {
  const checkedCollection = CollectionSchema.parse(collection);
  return CollectionSchema.parse({ ...checkedCollection, name: normalizeCollectionName(name) });
}

export function deleteCollection(
  collections: readonly Collection[],
  collectionId: string,
): readonly Collection[] {
  const checkedCollections = CollectionsSchema.parse(collections);
  return checkedCollections.filter((collection) => collection.id !== collectionId);
}

export function resolveCurrentCollectionId(
  collections: readonly Collection[],
  currentCollectionId: string | undefined,
): string | undefined {
  const checkedCollections = CollectionsSchema.parse(collections);
  if (currentCollectionId !== undefined) {
    const current = checkedCollections.find((collection) => collection.id === currentCollectionId);
    if (current !== undefined) {
      return current.id;
    }
  }

  return checkedCollections[0]?.id;
}
