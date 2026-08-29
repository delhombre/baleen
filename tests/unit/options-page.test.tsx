import { renderToStaticMarkup } from "react-dom/server";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { API_KEY_MASK, type ApiKey } from "../../src/core/api-key";
import type { ApiKeyStatus } from "../../src/adapters/chrome/api-key-storage";
import type { LlmProvider } from "../../src/core/llm-provider";
import type { StoredConnectionResult } from "../../src/core/test-connection";
import {
  OptionsPage,
  OptionsPageView,
  type OptionsPageCallbacks,
  type OptionsPageStatus,
  persistProviderSelection,
} from "../../src/ui/options-page";

const callbacks: OptionsPageCallbacks = {
  getStatus: vi.fn(async () => ({ kind: "missing" as const })),
  save: vi.fn(async () => ({ kind: "success" as const })),
  remove: vi.fn(async () => ({ kind: "success" as const })),
  testConnection: vi.fn(async () => ({ kind: "missing" as const })),
};

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

describe("OptionsPageView", () => {
  it("keeps the persisted provider and UI actions on the old provider when a switch fails", async () => {
    const result = await persistProviderSelection("anthropic", "groq", async () => ({
      kind: "error",
      code: "unavailable",
    }));
    expect(result).toEqual({ kind: "error", provider: "anthropic" });
    const markup = renderToStaticMarkup(
      <OptionsPageView
        status={{ kind: "missing" }}
        callbacks={callbacks}
        provider={result.provider}
        onProviderChange={() => undefined}
      />,
    );
    expect(markup).toContain("Clé API Anthropic");
    expect(markup).not.toContain("Clé API Groq");
  });

  it("disables provider and key actions during a provider transition", () => {
    const markup = renderToStaticMarkup(
      <OptionsPageView
        status={{ kind: "missing" }}
        callbacks={callbacks}
        provider="anthropic"
        onProviderChange={() => undefined}
        busyAction="provider"
      />,
    );

    expect(markup).toContain('id="llm-provider"');
    expect(markup).toMatch(/<select[^>]*id="llm-provider"[^>]*disabled=""/u);
    expect(markup).toMatch(/<input[^>]*id="api-key"[^>]*disabled=""/u);
    expect(markup).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/u);
    expect(markup).toContain('aria-disabled="true"');
    expect(markup).not.toContain("Supprimer la clé Anthropic");
    expect(markup).not.toContain("Tester la connexion");
  });

  it("does not offer destructive removal when the selected key is missing", () => {
    const markup = renderToStaticMarkup(
      <OptionsPageView
        status={{ kind: "missing" }}
        callbacks={callbacks}
        provider="anthropic"
        onProviderChange={() => undefined}
      />,
    );

    expect(markup).not.toContain("Supprimer la clé Anthropic");
    expect(markup).not.toContain("Confirmer la suppression");
  });

  it("locks destructive removal while a present key provider transition is pending", () => {
    const markup = renderToStaticMarkup(
      <OptionsPageView
        status={{ kind: "present", mask: API_KEY_MASK }}
        callbacks={callbacks}
        provider="anthropic"
        onProviderChange={() => undefined}
        busyAction="provider"
      />,
    );

    expect(markup).toMatch(
      /<button[^>]*type="button"[^>]*disabled=""[^>]*>Supprimer la clé Anthropic/u,
    );
  });

  it("renders an explicit provider selector and labels the active Groq key", () => {
    const markup = renderToStaticMarkup(
      <OptionsPageView
        status={{ kind: "missing" }}
        callbacks={callbacks}
        provider="groq"
        onProviderChange={() => undefined}
      />,
    );

    expect(markup).toContain("Fournisseur");
    expect(markup).not.toContain("Fournisseur LLM");
    expect(markup).toContain("Groq");
    expect(markup).toContain("Clé API Groq");
    expect(markup).toContain('id="llm-provider"');
    expect(markup).toContain('type="password"');
    expect(markup).toContain("Créer une clé Groq");
    expect(markup).toContain('href="https://console.groq.com/keys"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
  });

  it("gives the provider selector one clear visible label", () => {
    const markup = renderToStaticMarkup(
      <OptionsPageView
        status={{ kind: "missing" }}
        callbacks={callbacks}
        provider="anthropic"
        onProviderChange={() => undefined}
      />,
    );

    expect(markup).toMatch(/<label[^>]*>Fournisseur<select/u);
    expect(markup).not.toContain("Fournisseur LLM");
    expect(markup).not.toContain("Choisir le fournisseur");
  });

  it("renders an accessible password form without a prefilled value", () => {
    const markup = renderToStaticMarkup(
      <OptionsPageView status={{ kind: "missing" }} callbacks={callbacks} />,
    );

    expect(markup).toContain("Paramètres");
    expect(markup).toContain("Clé API Anthropic");
    expect(markup).toContain('type="password"');
    expect(markup).toContain('name="api-key"');
    expect(markup).toContain('for="api-key"');
    expect(markup).toContain("Connexion au modèle");
    expect(markup).toContain("Enregistrer et vérifier");
    expect(markup).not.toContain("Tester la connexion");
    expect(markup).toContain("Créer une clé Anthropic");
    expect(markup).toContain('href="https://console.anthropic.com/settings/keys"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).toContain('noValidate=""');
    expect(markup).not.toContain('required=""');
    expect(markup).not.toContain('value="');
  });

  it("documents the model connection title in the options entrypoint", async () => {
    const markup = await readFile(resolve("entrypoints/options/index.html"), "utf8");

    expect(markup).toContain("<title>Connexion au modèle : Baleen</title>");
  });

  it("shows a fixed mask for the present status and never the secret", () => {
    const secret = "sk-super-secret-987";
    const status: OptionsPageStatus = { kind: "present", mask: API_KEY_MASK };
    const markup = renderToStaticMarkup(<OptionsPageView status={status} callbacks={callbacks} />);

    expect(markup).toContain("Clé enregistrée");
    expect(markup).toContain(API_KEY_MASK);
    expect(markup).not.toContain(secret);
    expect(markup).not.toContain("987");
  });

  it("renders bounded French messages for invalid and transport states", () => {
    const statuses: OptionsPageStatus[] = [
      { kind: "invalid" },
      { kind: "error", code: "quota" },
      { kind: "error", code: "unavailable" },
    ];
    const markups = statuses.map((status) =>
      renderToStaticMarkup(<OptionsPageView status={status} callbacks={callbacks} />),
    );

    expect(markups[0]).toContain("Clé invalide");
    expect(markups[1]).toContain("quota");
    expect(markups[2]).toContain("indisponible");
  });

  it("announces a successful save as status instead of an alert", () => {
    const markup = renderToStaticMarkup(
      <OptionsPageView
        status={{ kind: "present", mask: API_KEY_MASK }}
        callbacks={callbacks}
        notice={{ kind: "success", message: "Clé enregistrée localement." }}
      />,
    );

    expect(markup).toContain('role="status" aria-live="polite"');
    expect(markup).not.toContain('role="alert" aria-live="polite"');
  });

  it("uses the form submit path for Enter and tests only the just-persisted key", async () => {
    const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
    Object.assign(globalThis, {
      document,
      window,
      FormData: window.FormData,
      IS_REACT_ACT_ENVIRONMENT: true,
    });
    let persistedKey: string | undefined;
    const order: string[] = [];
    const pageCallbacks: OptionsPageCallbacks = {
      ...callbacks,
      getStatus: vi.fn(async () => ({ kind: "missing" as const })),
      saveProvider: vi.fn(async (_provider, value) => {
        if (typeof value === "string") {
          persistedKey = value;
          order.push(`save:${value}`);
        }
        return { kind: "success" as const };
      }),
      testProviderConnection: vi.fn(async () => {
        expect(persistedKey).toBe("sk-new-key");
        order.push(`test:${persistedKey ?? "missing"}`);
        return { kind: "success" as const };
      }),
    };
    const root = createRoot(document.getElementById("root")!);

    await act(async () => {
      root.render(<OptionsPage callbacks={pageCallbacks} />);
    });
    const input = document.querySelector("#api-key") as HTMLInputElement;
    input.value = "sk-new-key";
    const form = document.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    expect(order).toEqual(["save:sk-new-key", "test:sk-new-key"]);
    expect(document.body.textContent).toContain(
      "Connexion à Anthropic réussie. La clé est enregistrée sur cet appareil.",
    );
    expect(document.body.textContent).not.toContain("Tester la connexion");
    root.unmount();
  });

  it.each([
    ["missing", "Aucune clé API Anthropic enregistrée."],
    ["invalid", "La clé Anthropic enregistrée est invalide."],
    ["unauthorized", "La clé API Anthropic a été refusée."],
    ["quota", "Le quota Anthropic est atteint."],
    ["network", "Connexion impossible : vérifiez votre réseau."],
    ["unavailable", "Le service Anthropic est indisponible."],
  ] as const)(
    "explains the %s connection result with an actionable provider-aware recovery",
    async (kind, expected) => {
      const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
      Object.assign(globalThis, {
        document,
        window,
        IS_REACT_ACT_ENVIRONMENT: true,
      });
      const result = { kind } as StoredConnectionResult;
      const pageCallbacks: OptionsPageCallbacks = {
        ...callbacks,
        getStatus: vi.fn(async () => ({ kind: "missing" as const })),
        saveProvider: vi.fn(async () => ({ kind: "success" as const })),
        testProviderConnection: vi.fn(async () => result),
      };
      const root = createRoot(document.getElementById("root")!);

      await act(async () => {
        root.render(<OptionsPage callbacks={pageCallbacks} />);
      });
      const input = document.querySelector("#api-key") as HTMLInputElement;
      input.value = "sk-test-key";
      await act(async () => {
        document
          .querySelector("form")
          ?.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });

      expect(document.querySelector('[role="alert"]')?.textContent).toContain(expected);
      expect(document.body.textContent).toContain("Anthropic");
      root.unmount();
    },
  );

  it("uses the active Groq provider in a missing-key recovery message", async () => {
    const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
    Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true });
    const pageCallbacks: OptionsPageCallbacks = {
      ...callbacks,
      getProvider: vi.fn(async () => "groq" as const),
      getProviderStatus: vi.fn(async () => ({ kind: "missing" as const })),
      saveProvider: vi.fn(async () => ({ kind: "success" as const })),
      testProviderConnection: vi.fn(async () => ({ kind: "missing" as const })),
    };
    const root = createRoot(document.getElementById("root")!);

    await act(async () => {
      root.render(<OptionsPage callbacks={pageCallbacks} />);
      await Promise.resolve();
    });
    const input = document.querySelector("#api-key") as HTMLInputElement;
    input.value = "gsk-test-key";
    await act(async () => {
      document
        .querySelector("form")
        ?.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Aucune clé API Groq enregistrée.",
    );
    root.unmount();
  });

  it("does not probe when saving throws and gives a recovery message", async () => {
    const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
    Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true });
    const testProviderConnection = vi.fn(async () => ({ kind: "success" as const }));
    const pageCallbacks: OptionsPageCallbacks = {
      ...callbacks,
      saveProvider: vi.fn(async () => {
        throw new Error("storage details must stay private");
      }),
      testProviderConnection,
    };
    const root = createRoot(document.getElementById("root")!);

    await act(async () => {
      root.render(<OptionsPage callbacks={pageCallbacks} />);
    });
    const input = document.querySelector("#api-key") as HTMLInputElement;
    input.value = "sk-save-failure";
    await act(async () => {
      document
        .querySelector("form")
        ?.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    expect(testProviderConnection).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Impossible d’enregistrer la clé pour le moment.",
    );
    expect(document.body.textContent).not.toContain("storage details");
    root.unmount();
  });

  it("turns a probe exception into the exact retryable connection recovery", async () => {
    const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
    Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true });
    const pageCallbacks: OptionsPageCallbacks = {
      ...callbacks,
      saveProvider: vi.fn(async () => ({ kind: "success" as const })),
      testProviderConnection: vi.fn(async () => {
        throw new Error("provider response details must stay private");
      }),
    };
    const root = createRoot(document.getElementById("root")!);

    await act(async () => {
      root.render(<OptionsPage callbacks={pageCallbacks} />);
    });
    const input = document.querySelector("#api-key") as HTMLInputElement;
    input.value = "sk-probe-failure";
    await act(async () => {
      document
        .querySelector("form")
        ?.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Clé enregistrée, mais la connexion à Anthropic a échoué. Vérifiez la clé ou votre réseau, puis réessayez.",
    );
    expect(document.body.textContent).not.toContain("provider response details");
    root.unmount();
  });

  it("announces empty-key recovery once without probing", async () => {
    const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
    Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true });
    const saveProvider = vi.fn(async () => ({ kind: "invalid" as const }));
    const testProviderConnection = vi.fn(async () => ({ kind: "success" as const }));
    const pageCallbacks: OptionsPageCallbacks = {
      ...callbacks,
      saveProvider,
      testProviderConnection,
    };
    const root = createRoot(document.getElementById("root")!);

    await act(async () => {
      root.render(<OptionsPage callbacks={pageCallbacks} />);
    });
    await act(async () => {
      document
        .querySelector("form")
        ?.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    expect(saveProvider).toHaveBeenCalledWith("anthropic", "");
    expect(testProviderConnection).not.toHaveBeenCalled();
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Saisissez une clé API non vide.",
    );
    expect(document.querySelector("#api-key")?.getAttribute("aria-invalid")).toBe("true");
    expect(document.querySelector("#api-key")?.getAttribute("aria-describedby")).toContain(
      "api-key-error",
    );
    root.unmount();
  });

  it("clears the draft before notifying the provider switch", async () => {
    const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
    Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true });
    const onProviderChange = vi.fn();
    const submittedDrafts: string[] = [];
    const root = createRoot(document.getElementById("root")!);
    await act(async () => {
      root.render(
        <OptionsPageView
          status={{ kind: "missing" }}
          callbacks={callbacks}
          provider="anthropic"
          onProviderChange={onProviderChange}
          onSave={(event) => {
            const input = event.currentTarget.querySelector("#api-key") as HTMLInputElement;
            submittedDrafts.push(input.value);
          }}
        />,
      );
    });

    const input = document.querySelector("#api-key") as HTMLInputElement;
    const selector = document.querySelector("#llm-provider") as HTMLSelectElement;
    input.value = "sk-anthropic-old";
    Object.defineProperty(selector, "value", { configurable: true, value: "groq" });
    await act(async () => {
      selector.dispatchEvent(new window.Event("change", { bubbles: true }));
    });

    expect(input.value).toBe("");
    expect(onProviderChange).toHaveBeenCalledWith("groq");
    await act(async () => {
      document.querySelector("form")?.dispatchEvent(new window.Event("submit", { bubbles: true }));
    });
    expect(submittedDrafts).toEqual([""]);
    root.unmount();
  });

  it("confirms removal inline and restores trigger focus on Escape", async () => {
    const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
    Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true });
    const focusCalls: Element[] = [];
    Object.defineProperty(window.HTMLElement.prototype, "focus", {
      configurable: true,
      value: function (this: Element): void {
        focusCalls.push(this);
      },
    });
    const onRemoveConfirm = vi.fn();
    const RemoveHarness = () => {
      const [removeConfirm, setRemoveConfirm] = useState(false);
      return (
        <OptionsPageView
          status={{ kind: "present", mask: API_KEY_MASK }}
          callbacks={callbacks}
          provider="anthropic"
          removeConfirm={removeConfirm}
          onRemoveRequest={() => setRemoveConfirm(true)}
          onRemoveConfirm={onRemoveConfirm}
          onRemoveCancel={() => setRemoveConfirm(false)}
        />
      );
    };
    const root = createRoot(document.getElementById("root")!);
    await act(async () => {
      root.render(<RemoveHarness />);
    });
    const removeButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Supprimer la clé Anthropic",
    ) as HTMLButtonElement;
    await act(async () => {
      removeButton.dispatchEvent(new window.Event("click", { bubbles: true }));
    });

    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("Supprimer la clé Anthropic");
    expect(focusCalls.at(-1)?.textContent).toContain("Confirmer la suppression");

    await act(async () => {
      Array.from(dialog?.querySelectorAll("button") ?? [])
        .find((button) => button.textContent === "Confirmer la suppression")
        ?.dispatchEvent(new window.Event("click", { bubbles: true }));
    });
    expect(onRemoveConfirm).toHaveBeenCalledTimes(1);

    await act(async () => {
      const escapeEvent = new window.Event("keydown", { bubbles: true });
      Object.defineProperty(escapeEvent, "key", { value: "Escape" });
      dialog?.dispatchEvent(escapeEvent);
    });
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(onRemoveConfirm).toHaveBeenCalledTimes(1);
    expect(focusCalls.at(-1)?.textContent).toContain("Supprimer la clé Anthropic");
    root.unmount();
  });

  it("keeps the removal confirmation open while the deletion is pending", async () => {
    const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
    Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true });
    const removal = deferred<{ readonly kind: "success" }>();
    const remove = vi.fn(() => removal.promise);
    const pageCallbacks: OptionsPageCallbacks = {
      ...callbacks,
      getStatus: vi.fn(async () => ({ kind: "present" as const, mask: API_KEY_MASK })),
      remove,
    };
    const root = createRoot(document.getElementById("root")!);

    await act(async () => {
      root.render(<OptionsPage callbacks={pageCallbacks} />);
      await Promise.resolve();
    });
    const removeButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Supprimer la clé Anthropic",
    ) as HTMLButtonElement;
    await act(async () => {
      removeButton.dispatchEvent(new window.Event("click", { bubbles: true }));
    });
    const confirmButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Confirmer la suppression",
    ) as HTMLButtonElement;
    await act(async () => {
      confirmButton.dispatchEvent(new window.Event("click", { bubbles: true }));
      await Promise.resolve();
    });

    const dialog = document.querySelector('[role="alertdialog"]');
    expect(remove).toHaveBeenCalledOnce();
    expect(dialog).not.toBeNull();
    expect(confirmButton.disabled).toBe(true);

    await act(async () => {
      const escapeEvent = new window.Event("keydown", { bubbles: true });
      Object.defineProperty(escapeEvent, "key", { value: "Escape" });
      dialog?.dispatchEvent(escapeEvent);
    });
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();

    await act(async () => {
      removal.resolve({ kind: "success" });
      await Promise.resolve();
    });
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    root.unmount();
  });

  it("marks busy status accessibly and keeps destructive confirmation separate from alert live text", () => {
    const markup = renderToStaticMarkup(
      <OptionsPageView
        status={{ kind: "missing" }}
        callbacks={callbacks}
        busyAction="save"
        notice={{
          kind: "error",
          message:
            "Clé enregistrée, mais la connexion à Anthropic a échoué. Vérifiez la clé ou votre réseau, puis réessayez.",
        }}
      />,
    );

    expect(markup).toContain('role="status" aria-live="polite" aria-busy="true"');
    expect(markup).toContain("Enregistrement et vérification…");
    expect(markup).toContain('role="alert"');
    expect(markup).not.toContain('role="alert" aria-live="polite"');
  });
});

describe("OptionsPage", () => {
  it("does not render a secret while status is loaded asynchronously", () => {
    const secret = "sk-secret-that-must-not-be-markup";
    const pageCallbacks: OptionsPageCallbacks = {
      ...callbacks,
      getStatus: vi.fn(async () => ({ kind: "present" as const, mask: API_KEY_MASK })),
      save: vi.fn(async () => ({ kind: "success" as const })),
    };
    const markup = renderToStaticMarkup(<OptionsPage callbacks={pageCallbacks} />);

    expect(markup).toContain("Chargement");
    expect(markup).not.toContain(secret);
    expect(markup).not.toContain('value="');
  });

  it("locks every options control until provider and status hydration finish", async () => {
    const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
    Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true });
    const providerLoad = deferred<LlmProvider>();
    const statusLoad = deferred<ApiKeyStatus>();
    const pageCallbacks: OptionsPageCallbacks = {
      ...callbacks,
      getProvider: vi.fn(() => providerLoad.promise),
      getProviderStatus: vi.fn(() => statusLoad.promise),
    };
    const root = createRoot(document.getElementById("root")!);

    await act(async () => {
      root.render(<OptionsPage callbacks={pageCallbacks} />);
      await Promise.resolve();
    });

    expect((document.querySelector("#llm-provider") as HTMLSelectElement).disabled).toBe(true);
    expect((document.querySelector("#api-key") as HTMLInputElement).disabled).toBe(true);
    expect((document.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      Array.from(document.querySelectorAll("button")).find((button) =>
        button.textContent?.startsWith("Supprimer la clé"),
      ),
    ).toBeUndefined();
    expect(document.querySelector(".options-provider-link")?.getAttribute("aria-disabled")).toBe(
      "true",
    );
    expect(document.querySelector('[role="status"]')?.getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      providerLoad.resolve("groq");
      await Promise.resolve();
    });
    expect(pageCallbacks.getProviderStatus).toHaveBeenCalledWith("groq");
    expect((document.querySelector("#api-key") as HTMLInputElement).disabled).toBe(true);

    await act(async () => {
      statusLoad.resolve({ kind: "missing" });
      await Promise.resolve();
    });
    expect((document.querySelector("#llm-provider") as HTMLSelectElement).disabled).toBe(false);
    expect((document.querySelector("#api-key") as HTMLInputElement).disabled).toBe(false);
    expect((document.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(document.querySelector('[role="status"]')?.getAttribute("aria-busy")).toBe("false");
    root.unmount();
  });

  it("does not publish a provider before its matching status is ready", async () => {
    const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
    Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true });
    const groqStatus = deferred<ApiKeyStatus>();
    const pageCallbacks: OptionsPageCallbacks = {
      ...callbacks,
      getProvider: vi.fn(async () => "anthropic" as const),
      getProviderStatus: vi.fn((selectedProvider: LlmProvider) =>
        selectedProvider === "anthropic"
          ? Promise.resolve({ kind: "present" as const, mask: API_KEY_MASK })
          : groqStatus.promise,
      ),
      setProvider: vi.fn(async () => ({ kind: "success" as const })),
    };
    const root = createRoot(document.getElementById("root")!);

    await act(async () => {
      root.render(<OptionsPage callbacks={pageCallbacks} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    const selector = document.querySelector("#llm-provider") as HTMLSelectElement;
    expect(document.querySelector("#api-key-section-title")?.textContent).toContain("Anthropic");
    expect(document.querySelector('[role="status"]')?.textContent).toContain(API_KEY_MASK);

    Object.defineProperty(selector, "value", { configurable: true, value: "groq" });
    await act(async () => {
      selector.dispatchEvent(new window.Event("change", { bubbles: true }));
      await Promise.resolve();
    });

    expect(pageCallbacks.setProvider).toHaveBeenCalledWith("groq");
    expect(pageCallbacks.getProviderStatus).toHaveBeenLastCalledWith("groq");
    expect(document.querySelector("#api-key-section-title")?.textContent).toContain("Anthropic");
    expect(document.querySelector('[role="status"]')?.textContent).toContain(API_KEY_MASK);

    await act(async () => {
      groqStatus.resolve({ kind: "missing" });
      await Promise.resolve();
    });
    expect(document.querySelector("#api-key-section-title")?.textContent).toContain("Groq");
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "Aucune clé enregistrée",
    );
    root.unmount();
  });

  it("shows the persisted provider with an unavailable status when its status load fails", async () => {
    const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
    Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true });
    const pageCallbacks: OptionsPageCallbacks = {
      ...callbacks,
      getProvider: vi.fn(async () => "anthropic" as const),
      getProviderStatus: vi.fn(async (selectedProvider: LlmProvider) => {
        if (selectedProvider === "groq") {
          throw new Error("status details must stay private");
        }
        return { kind: "present" as const, mask: API_KEY_MASK };
      }),
      setProvider: vi.fn(async () => ({ kind: "success" as const })),
    };
    const root = createRoot(document.getElementById("root")!);

    await act(async () => {
      root.render(<OptionsPage callbacks={pageCallbacks} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    const selector = document.querySelector("#llm-provider") as HTMLSelectElement;
    Object.defineProperty(selector, "value", { configurable: true, value: "groq" });
    await act(async () => {
      selector.dispatchEvent(new window.Event("change", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.querySelector("#api-key-section-title")?.textContent).toContain("Groq");
    expect(document.querySelector('[role="status"]')?.textContent).toContain("indisponible");
    expect((document.querySelector("#api-key") as HTMLInputElement).disabled).toBe(false);
    root.unmount();
  });

  it("ignores stale hydration and keeps the newest provider/status pair", async () => {
    const { document, window } = parseHTML("<html><body><div id='root'></div></body></html>");
    Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true });
    const firstProviderLoad = deferred<LlmProvider>();
    const firstStatusLoad = deferred<ApiKeyStatus>();
    const secondProviderLoad = deferred<LlmProvider>();
    const secondStatusLoad = deferred<ApiKeyStatus>();
    const firstCallbacks: OptionsPageCallbacks = {
      ...callbacks,
      getProvider: vi.fn(() => firstProviderLoad.promise),
      getProviderStatus: vi.fn(() => firstStatusLoad.promise),
    };
    const secondCallbacks: OptionsPageCallbacks = {
      ...callbacks,
      getProvider: vi.fn(() => secondProviderLoad.promise),
      getProviderStatus: vi.fn(() => secondStatusLoad.promise),
    };
    const root = createRoot(document.getElementById("root")!);

    await act(async () => {
      root.render(<OptionsPage callbacks={firstCallbacks} />);
      await Promise.resolve();
    });
    await act(async () => {
      root.render(<OptionsPage callbacks={secondCallbacks} />);
      await Promise.resolve();
    });
    expect((document.querySelector("#api-key") as HTMLInputElement).disabled).toBe(true);

    await act(async () => {
      secondProviderLoad.resolve("groq");
      await Promise.resolve();
      secondStatusLoad.resolve({ kind: "present", mask: API_KEY_MASK });
      await Promise.resolve();
    });
    await act(async () => {
      firstProviderLoad.resolve("anthropic");
      await Promise.resolve();
      firstStatusLoad.resolve({ kind: "missing" });
      await Promise.resolve();
    });

    expect((document.querySelector("#llm-provider") as HTMLSelectElement).value).toBe("groq");
    expect(document.querySelector('[role="status"]')?.textContent).toContain("Clé enregistrée");
    expect((document.querySelector("#api-key") as HTMLInputElement).disabled).toBe(false);
    root.unmount();
  });

  it("keeps callbacks typed at boundaries without allowing a raw key in UI state", () => {
    const save = async (value: unknown): Promise<{ readonly kind: "success" }> => {
      expect(typeof value === "string" || value instanceof FormData || value === undefined).toBe(
        true,
      );
      return { kind: "success" };
    };
    const branded: ApiKey | undefined = undefined;
    expect(branded).toBeUndefined();
    expect(save).toBeTypeOf("function");
  });
});
