import { acquirePlaywrightLock } from "./e2e-lock";

export default async function globalSetup(): Promise<() => Promise<void>> {
  const lock = await acquirePlaywrightLock();
  let cleanupPromise: Promise<void> | undefined;

  const cleanup = (): Promise<void> => {
    cleanupPromise ??= lock.release();
    return cleanupPromise;
  };

  const handleSignal = (signal: NodeJS.Signals): void => {
    void cleanup().then(
      () => process.kill(process.pid, signal),
      () => process.kill(process.pid, signal),
    );
  };
  const onSigint = (): void => handleSignal("SIGINT");
  const onSigterm = (): void => handleSignal("SIGTERM");

  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  return async (): Promise<void> => {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    await cleanup();
  };
}
