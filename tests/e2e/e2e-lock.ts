import { randomUUID } from "node:crypto";
import { open, readFile, unlink, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 50;
const DEFAULT_LOCK_PATH = join(tmpdir(), "baleen-playwright-headless.lock");

export type PlaywrightLockOwner = Readonly<{
  pid: number;
  token: string;
}>;

export type PlaywrightLockOptions = Readonly<{
  lockPath?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  pid?: number;
  token?: string;
  isProcessAlive?: (pid: number) => boolean;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}>;

export type PlaywrightLock = Readonly<{
  lockPath: string;
  owner: PlaywrightLockOwner;
  release: () => Promise<void>;
}>;

export class PlaywrightLockTimeoutError extends Error {
  readonly lockPath: string;
  readonly timeoutMs: number;

  constructor(lockPath: string, timeoutMs: number) {
    super(
      `Unable to acquire Playwright browser lock at ${lockPath} within ${timeoutMs}ms. ` +
        "Another Playwright process is still running.",
    );
    this.name = "PlaywrightLockTimeoutError";
    this.lockPath = lockPath;
    this.timeoutMs = timeoutMs;
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function defaultIsProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    if (isNodeError(error, "ESRCH")) {
      return false;
    }
    return true;
  }
}

function parseOwner(text: string): PlaywrightLockOwner | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return undefined;
    }

    const record = value as Record<string, unknown>;
    if (
      typeof record.pid !== "number" ||
      !Number.isInteger(record.pid) ||
      record.pid <= 0 ||
      typeof record.token !== "string" ||
      record.token.length === 0
    ) {
      return undefined;
    }

    return { pid: record.pid, token: record.token };
  } catch {
    return undefined;
  }
}

async function readOwner(lockPath: string): Promise<PlaywrightLockOwner | undefined> {
  try {
    return parseOwner(await readFile(lockPath, "utf8"));
  } catch {
    return undefined;
  }
}

async function unlinkIfPresent(lockPath: string): Promise<void> {
  try {
    await unlink(lockPath);
  } catch (error: unknown) {
    if (!isNodeError(error, "ENOENT")) {
      throw error;
    }
  }
}

async function writeOwner(fileHandle: FileHandle, owner: PlaywrightLockOwner): Promise<void> {
  await fileHandle.writeFile(JSON.stringify(owner), "utf8");
}

function validateMilliseconds(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < 0) {
    throw new RangeError(`${name} must be a finite non-negative number.`);
  }
  return resolved;
}

async function removeStaleOwner(
  lockPath: string,
  isProcessAlive: (pid: number) => boolean,
): Promise<boolean> {
  const owner = await readOwner(lockPath);
  if (owner === undefined || isProcessAlive(owner.pid)) {
    return false;
  }

  await unlinkIfPresent(lockPath);
  return true;
}

export async function acquirePlaywrightLock(
  options: PlaywrightLockOptions = {},
): Promise<PlaywrightLock> {
  const lockPath = options.lockPath ?? DEFAULT_LOCK_PATH;
  const timeoutMs = validateMilliseconds(options.timeoutMs, DEFAULT_TIMEOUT_MS, "timeoutMs");
  const pollIntervalMs = validateMilliseconds(
    options.pollIntervalMs,
    DEFAULT_POLL_INTERVAL_MS,
    "pollIntervalMs",
  );
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, milliseconds);
      }));
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const owner: PlaywrightLockOwner = {
    pid: options.pid ?? process.pid,
    token: options.token ?? randomUUID(),
  };
  const deadline = now() + timeoutMs;

  while (true) {
    let fileHandle: FileHandle | undefined;
    try {
      fileHandle = await open(lockPath, "wx", 0o600);
      await writeOwner(fileHandle, owner);
      await fileHandle.close();
      fileHandle = undefined;
      let released = false;

      return {
        lockPath,
        owner,
        release: async () => {
          if (released) {
            return;
          }
          released = true;
          const currentOwner = await readOwner(lockPath);
          if (currentOwner?.pid === owner.pid && currentOwner.token === owner.token) {
            await unlinkIfPresent(lockPath);
          }
        },
      };
    } catch (error: unknown) {
      await fileHandle?.close();
      if (!isNodeError(error, "EEXIST")) {
        throw error;
      }
    }

    await removeStaleOwner(lockPath, isProcessAlive);
    const remainingMs = deadline - now();
    if (remainingMs <= 0) {
      throw new PlaywrightLockTimeoutError(lockPath, timeoutMs);
    }
    await sleep(Math.min(pollIntervalMs, remainingMs));
  }
}
