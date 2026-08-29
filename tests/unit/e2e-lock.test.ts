import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { acquirePlaywrightLock, PlaywrightLockTimeoutError } from "../../tests/e2e/e2e-lock";

describe("acquirePlaywrightLock", () => {
  it("creates an exact owner record and cleans it up", async () => {
    const directory = await mkdtemp(join(tmpdir(), "baleen-e2e-lock-test-"));
    const lockPath = join(directory, "playwright.lock");

    try {
      const lock = await acquirePlaywrightLock({
        lockPath,
        pid: 4242,
        token: "test-owner",
      });

      await expect(readFile(lockPath, "utf8")).resolves.toBe('{"pid":4242,"token":"test-owner"}');

      await lock.release();
      await expect(readFile(lockPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      await lock.release();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("waits for a second acquirer and progresses after normal cleanup", async () => {
    const directory = await mkdtemp(join(tmpdir(), "baleen-e2e-lock-test-"));
    const lockPath = join(directory, "playwright.lock");

    try {
      const first = await acquirePlaywrightLock({
        lockPath,
        pid: 7001,
        token: "first-owner",
      });
      const secondPromise = acquirePlaywrightLock({
        lockPath,
        pid: 7002,
        token: "second-owner",
        timeoutMs: 1_000,
        pollIntervalMs: 5,
        isProcessAlive: (pid) => pid === 7001,
      });

      await new Promise<void>((resolve) => setTimeout(resolve, 25));
      expect(await readFile(lockPath, "utf8")).toBe('{"pid":7001,"token":"first-owner"}');
      await first.release();

      const second = await secondPromise;
      await expect(readFile(lockPath, "utf8")).resolves.toBe('{"pid":7002,"token":"second-owner"}');
      await second.release();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("recovers a lock whose owner is dead", async () => {
    const directory = await mkdtemp(join(tmpdir(), "baleen-e2e-lock-test-"));
    const lockPath = join(directory, "playwright.lock");

    try {
      await writeFile(lockPath, '{"pid":8101,"token":"dead-owner"}', "utf8");
      const lock = await acquirePlaywrightLock({
        lockPath,
        pid: 8102,
        token: "new-owner",
        isProcessAlive: () => false,
      });

      await expect(readFile(lockPath, "utf8")).resolves.toBe('{"pid":8102,"token":"new-owner"}');
      await lock.release();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("does not steal a lock whose owner is alive", async () => {
    const directory = await mkdtemp(join(tmpdir(), "baleen-e2e-lock-test-"));
    const lockPath = join(directory, "playwright.lock");

    try {
      await writeFile(lockPath, '{"pid":8201,"token":"live-owner"}', "utf8");
      await expect(
        acquirePlaywrightLock({
          lockPath,
          pid: 8202,
          token: "must-not-own",
          timeoutMs: 30,
          pollIntervalMs: 5,
          isProcessAlive: () => true,
        }),
      ).rejects.toBeInstanceOf(PlaywrightLockTimeoutError);
      await expect(readFile(lockPath, "utf8")).resolves.toBe('{"pid":8201,"token":"live-owner"}');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("times out with a clear bounded error", async () => {
    const directory = await mkdtemp(join(tmpdir(), "baleen-e2e-lock-test-"));
    const lockPath = join(directory, "playwright.lock");

    try {
      await writeFile(lockPath, '{"pid":8301,"token":"blocking-owner"}', "utf8");
      await expect(
        acquirePlaywrightLock({
          lockPath,
          timeoutMs: 20,
          pollIntervalMs: 5,
          isProcessAlive: () => true,
        }),
      ).rejects.toThrow(
        `Unable to acquire Playwright browser lock at ${lockPath} within 20ms. Another Playwright process is still running.`,
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
