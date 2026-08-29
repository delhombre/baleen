import type { ProviderApiKeyStorage } from "../adapters/chrome/api-key-storage";
import {
  testConnectionThroughRuntime,
  type ChromeRuntimeMessaging,
} from "../adapters/chrome/runtime-client";
import type { OptionsPageCallbacks } from "./options-page";

export function createOptionsCallbacks(
  providerStorage: ProviderApiKeyStorage,
  runtime: ChromeRuntimeMessaging,
): OptionsPageCallbacks {
  return {
    getStatus: () => providerStorage.getStatus("anthropic"),
    save: (value) => providerStorage.save("anthropic", value),
    remove: () => providerStorage.remove("anthropic"),
    testConnection: () => testConnectionThroughRuntime(runtime, "anthropic"),
    getProvider: providerStorage.getProvider,
    setProvider: providerStorage.setProvider,
    getProviderStatus: providerStorage.getStatus,
    saveProvider: providerStorage.save,
    removeProvider: providerStorage.remove,
    testProviderConnection: (provider) => testConnectionThroughRuntime(runtime, provider),
  };
}
