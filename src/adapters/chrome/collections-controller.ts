import {
  addProduct,
  createCollection,
  deleteCollection,
  renameCollection,
  resolveCurrentCollectionId,
  type Collection,
} from "../../core/collection";
import { ProductRecordSchema } from "../../core/product-record";
import {
  createCollectionStorage,
  type CollectionLoadResult,
  type CollectionSaveResult,
  type CollectionSnapshot,
} from "./collection-storage";

type CollectionStorage = ReturnType<typeof createCollectionStorage>;

export type CollectionsControllerErrorCode =
  | "invalid-name"
  | "not-found"
  | "no-current-collection"
  | "not-loaded"
  | "invalid-data"
  | "quota"
  | "unavailable";

export type CollectionsControllerSuccess = {
  readonly kind: "success";
  readonly snapshot: CollectionSnapshot;
};

export type CollectionsControllerResult =
  | CollectionsControllerSuccess
  | { readonly kind: "error"; readonly code: CollectionsControllerErrorCode };

export type CollectionsController = {
  readonly load: () => Promise<CollectionsControllerResult>;
  readonly createCollection: (name: string) => Promise<CollectionsControllerResult>;
  readonly selectCollection: (collectionId: string) => Promise<CollectionsControllerResult>;
  readonly renameCollection: (
    collectionId: string,
    name: string,
  ) => Promise<CollectionsControllerResult>;
  readonly deleteCollection: (collectionId: string) => Promise<CollectionsControllerResult>;
  readonly addProduct: (
    collectionId: string,
    product: unknown,
  ) => Promise<CollectionsControllerResult>;
};

type CollectionIdFactory = () => string;

function error(code: CollectionsControllerErrorCode): CollectionsControllerResult {
  return { kind: "error", code };
}

function mapStorageResult(result: CollectionSaveResult): CollectionsControllerResult {
  switch (result.kind) {
    case "success":
      throw new Error("Collection save success requires a next snapshot.");
    case "invalid":
      return error("invalid-data");
    case "error":
      return error(result.code);
  }
}

function mapLoadResult(result: CollectionLoadResult): CollectionsControllerResult {
  switch (result.kind) {
    case "success":
      return { kind: "success", snapshot: result.snapshot };
    case "invalid":
      return error("invalid-data");
    case "error":
      return error(result.code);
  }
}

function replaceCollection(
  collections: readonly Collection[],
  replacement: Collection,
): readonly Collection[] {
  return collections.map((collection) =>
    collection.id === replacement.id ? replacement : collection,
  );
}

export function createCollectionsController(
  storage: CollectionStorage,
  idFactory: CollectionIdFactory,
): CollectionsController {
  let currentSnapshot: CollectionSnapshot | undefined;
  let operationQueue: Promise<void> = Promise.resolve();

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = operationQueue.then(operation, operation);
    operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const persist = async (
    nextSnapshot: CollectionSnapshot,
  ): Promise<CollectionsControllerResult> => {
    const result = await storage.save(nextSnapshot);
    if (result.kind !== "success") {
      return mapStorageResult(result);
    }
    currentSnapshot = nextSnapshot;
    return { kind: "success", snapshot: nextSnapshot };
  };

  const loaded = (): CollectionSnapshot | undefined => currentSnapshot;

  return {
    load(): Promise<CollectionsControllerResult> {
      return enqueue(async () => {
        const result = mapLoadResult(await storage.load());
        if (result.kind === "success") {
          currentSnapshot = result.snapshot;
        } else {
          currentSnapshot = undefined;
        }
        return result;
      });
    },

    createCollection(name: string): Promise<CollectionsControllerResult> {
      return enqueue(async () => {
        const snapshot = loaded();
        if (snapshot === undefined) {
          return error("not-loaded");
        }

        let collection: Collection;
        try {
          collection = createCollection(name, idFactory);
        } catch (caught: unknown) {
          return error(caught instanceof RangeError ? "invalid-name" : "invalid-data");
        }

        return persist({
          collections: [...snapshot.collections, collection],
          currentCollectionId: snapshot.currentCollectionId ?? collection.id,
        });
      });
    },

    selectCollection(collectionId: string): Promise<CollectionsControllerResult> {
      return enqueue(async () => {
        const snapshot = loaded();
        if (snapshot === undefined) {
          return error("not-loaded");
        }
        if (!snapshot.collections.some((collection) => collection.id === collectionId)) {
          return error("not-found");
        }

        return persist({ ...snapshot, currentCollectionId: collectionId });
      });
    },

    renameCollection(collectionId: string, name: string): Promise<CollectionsControllerResult> {
      return enqueue(async () => {
        const snapshot = loaded();
        if (snapshot === undefined) {
          return error("not-loaded");
        }
        const collection = snapshot.collections.find((item) => item.id === collectionId);
        if (collection === undefined) {
          return error("not-found");
        }

        let renamed: Collection;
        try {
          renamed = renameCollection(collection, name);
        } catch (caught: unknown) {
          return error(caught instanceof RangeError ? "invalid-name" : "invalid-data");
        }

        return persist({
          ...snapshot,
          collections: replaceCollection(snapshot.collections, renamed),
        });
      });
    },

    deleteCollection(collectionId: string): Promise<CollectionsControllerResult> {
      return enqueue(async () => {
        const snapshot = loaded();
        if (snapshot === undefined) {
          return error("not-loaded");
        }
        if (!snapshot.collections.some((collection) => collection.id === collectionId)) {
          return error("not-found");
        }

        const collections = deleteCollection(snapshot.collections, collectionId);
        const currentCollectionId = resolveCurrentCollectionId(
          collections,
          snapshot.currentCollectionId === collectionId
            ? undefined
            : (snapshot.currentCollectionId ?? undefined),
        );
        return persist({ collections, currentCollectionId: currentCollectionId ?? null });
      });
    },

    addProduct(collectionId: string, product: unknown): Promise<CollectionsControllerResult> {
      return enqueue(async () => {
        const snapshot = loaded();
        if (snapshot === undefined) {
          return error("not-loaded");
        }
        if (snapshot.currentCollectionId === null) {
          return error("no-current-collection");
        }
        const collection = snapshot.collections.find((item) => item.id === collectionId);
        if (collection === undefined) {
          return error("not-found");
        }

        let nextCollection: Collection;
        try {
          nextCollection = addProduct(collection, ProductRecordSchema.parse(product));
        } catch {
          return error("invalid-data");
        }

        return persist({
          ...snapshot,
          collections: replaceCollection(snapshot.collections, nextCollection),
        });
      });
    },
  };
}
