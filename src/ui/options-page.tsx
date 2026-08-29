import { useEffect, useRef, useState, type FormEvent } from "react";

import type {
  ApiKeyStatus,
  ApiKeyStatusStore,
  ApiKeyWriteResult,
} from "../adapters/chrome/api-key-storage";
import { API_KEY_MASK } from "../core/api-key";
import type { LlmProvider } from "../core/llm-provider";
import type { StoredConnectionResult } from "../core/test-connection";

export type OptionsPageStatus = ApiKeyStatus | { readonly kind: "loading" };

export type OptionsPageCallbacks = {
  readonly getStatus: ApiKeyStatusStore["getStatus"];
  readonly save: ApiKeyStatusStore["save"];
  readonly remove: ApiKeyStatusStore["remove"];
  readonly testConnection: () => Promise<StoredConnectionResult>;
  readonly getProvider?: () => Promise<LlmProvider>;
  readonly setProvider?: (provider: unknown) => Promise<ApiKeyWriteResult>;
  readonly getProviderStatus?: (provider: LlmProvider) => Promise<ApiKeyStatus>;
  readonly saveProvider?: (provider: LlmProvider, value: unknown) => Promise<ApiKeyWriteResult>;
  readonly removeProvider?: (
    provider: LlmProvider,
  ) => Promise<
    | { readonly kind: "success" }
    | { readonly kind: "error"; readonly code: "quota" | "unavailable" }
  >;
  readonly testProviderConnection?: (provider: LlmProvider) => Promise<StoredConnectionResult>;
};

type OptionsAction = "provider" | "save" | "remove";

type Notice =
  | { readonly kind: "success"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

type ProviderStatus = {
  readonly provider: LlmProvider;
  readonly status: OptionsPageStatus;
};

type OptionsPageViewProps = {
  readonly status: OptionsPageStatus;
  readonly callbacks: OptionsPageCallbacks;
  readonly notice?: Notice;
  readonly busyAction?: OptionsAction;
  readonly hydrating?: boolean;
  readonly onSave?: (event: FormEvent<HTMLFormElement>) => void;
  readonly removeConfirm?: boolean;
  readonly onRemoveRequest?: () => void;
  readonly onRemoveConfirm?: () => void;
  readonly onRemoveCancel?: () => void;
  readonly provider?: LlmProvider;
  readonly onProviderChange?: (provider: LlmProvider) => void;
};

export type ProviderSelectionResult =
  | { readonly kind: "success"; readonly provider: LlmProvider }
  | { readonly kind: "error"; readonly provider: LlmProvider };

export async function persistProviderSelection(
  current: LlmProvider,
  next: LlmProvider,
  persist: (provider: LlmProvider) => Promise<ApiKeyWriteResult>,
): Promise<ProviderSelectionResult> {
  try {
    const result = await persist(next);
    return result.kind === "success"
      ? { kind: "success", provider: next }
      : { kind: "error", provider: current };
  } catch {
    return { kind: "error", provider: current };
  }
}

function statusCopy(status: OptionsPageStatus): string {
  switch (status.kind) {
    case "loading":
      return "Chargement…";
    case "missing":
      return "Aucune clé enregistrée";
    case "invalid":
      return "Clé invalide";
    case "present":
      return `Clé enregistrée : ${status.mask}`;
    case "error":
      return status.code === "quota"
        ? "Le stockage local a atteint son quota."
        : "Le stockage local est indisponible.";
  }
}

function providerLabel(provider: LlmProvider): string {
  return provider === "groq" ? "Groq" : "Anthropic";
}

function providerKeyUrl(provider: LlmProvider): string {
  return provider === "groq"
    ? "https://console.groq.com/keys"
    : "https://console.anthropic.com/settings/keys";
}

function saveErrorCopy(result: ApiKeyWriteResult): string {
  if (result.kind === "invalid") {
    return "Saisissez une clé API non vide.";
  }
  if (result.kind === "success") {
    return "";
  }
  return result.code === "quota"
    ? "Impossible d’enregistrer : quota de stockage atteint."
    : "Impossible d’enregistrer la clé pour le moment.";
}

function readApiKey(form: HTMLFormElement): unknown {
  const input = form.querySelector("#api-key");
  return input?.tagName === "INPUT" ? (input as HTMLInputElement).value : undefined;
}

function clearApiKey(form: HTMLFormElement): void {
  const input = form.querySelector("#api-key");
  if (input?.tagName === "INPUT") {
    (input as HTMLInputElement).value = "";
  }
}

function unexpectedConnectionResult(value: never): never {
  void value;
  throw new Error("Unexpected connection result.");
}

function testResultCopy(
  result: StoredConnectionResult,
  provider: LlmProvider = "anthropic",
): Notice {
  const label = providerLabel(provider);
  if (result.kind === "success") {
    return {
      kind: "success",
      message: `Connexion à ${label} réussie. La clé est enregistrée sur cet appareil.`,
    };
  }

  switch (result.kind) {
    case "missing":
      return {
        kind: "error",
        message: `Clé enregistrée, mais la connexion à ${label} a échoué. Aucune clé API ${label} enregistrée. Saisissez-la puis réessayez.`,
      };
    case "invalid":
      return {
        kind: "error",
        message: `Clé enregistrée, mais la connexion à ${label} a échoué. La clé ${label} enregistrée est invalide. Vérifiez-la puis réessayez.`,
      };
    case "unauthorized":
      return {
        kind: "error",
        message: `Clé enregistrée, mais la connexion à ${label} a échoué. La clé API ${label} a été refusée. Vérifiez ses droits puis réessayez.`,
      };
    case "quota":
      return {
        kind: "error",
        message: `Clé enregistrée, mais la connexion à ${label} a échoué. Le quota ${label} est atteint. Vérifiez votre compte puis réessayez.`,
      };
    case "network":
      return {
        kind: "error",
        message: `Clé enregistrée, mais la connexion à ${label} a échoué. Connexion impossible : vérifiez votre réseau. Vérifiez la clé ou votre réseau, puis réessayez.`,
      };
    case "unavailable":
      return {
        kind: "error",
        message: `Clé enregistrée, mais la connexion à ${label} a échoué. Le service ${label} est indisponible. Réessayez plus tard.`,
      };
    default:
      return unexpectedConnectionResult(result);
  }
}

export function OptionsPageView({
  status,
  notice,
  busyAction,
  hydrating = false,
  onSave,
  removeConfirm = false,
  onRemoveRequest,
  onRemoveConfirm,
  onRemoveCancel,
  provider = "anthropic",
  onProviderChange,
}: OptionsPageViewProps) {
  const saving = busyAction === "save";
  const removing = busyAction === "remove";
  const controlsDisabled = hydrating || busyAction !== undefined;
  const label = providerLabel(provider);
  const removeTriggerRef = useRef<HTMLButtonElement>(null);
  const removeConfirmRef = useRef<HTMLButtonElement>(null);
  const removeConfirmWasOpen = useRef(false);

  useEffect(() => {
    if (removeConfirm) {
      removeConfirmRef.current?.focus();
    } else if (removeConfirmWasOpen.current) {
      removeTriggerRef.current?.focus();
    }
    removeConfirmWasOpen.current = removeConfirm;
  }, [removeConfirm]);

  return (
    <main
      aria-labelledby="options-page-title"
      className="options-page min-h-screen px-5 py-6 text-slate-50"
    >
      <header className="options-header mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">BALEEN</p>
        <h1 id="options-page-title" className="mt-3 text-2xl font-semibold tracking-tight">
          Connexion au modèle
        </h1>
        <p className="mt-3 max-w-md text-sm leading-6 text-slate-300">
          Paramètres de connexion : choisissez un fournisseur et vérifiez sa clé API localement.
        </p>
      </header>

      <section className="options-panel max-w-[40rem] space-y-5" aria-label="Fournisseur">
        <div>
          {onProviderChange && (
            <label htmlFor="llm-provider" className="mt-4 block text-sm font-medium text-slate-200">
              Fournisseur
              <select
                id="llm-provider"
                name="llm-provider"
                value={provider}
                disabled={controlsDisabled}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  if (value === "anthropic" || value === "groq") {
                    const input = document.getElementById("api-key");
                    if (input?.tagName === "INPUT") {
                      (input as HTMLInputElement).value = "";
                    }
                    onProviderChange(value);
                  }
                }}
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-50 outline-none focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/30"
              >
                <option value="anthropic">Anthropic</option>
                <option value="groq">Groq</option>
              </select>
            </label>
          )}
        </div>

        <section
          className="options-sensitive-zone space-y-5 rounded-2xl p-5"
          aria-labelledby="api-key-section-title"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 id="api-key-section-title" className="text-lg font-medium">
              Clé API {label}
            </h2>
            <a
              className="options-provider-link text-sm font-medium text-cyan-200 underline underline-offset-4"
              href={providerKeyUrl(provider)}
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={controlsDisabled}
              tabIndex={controlsDisabled ? -1 : undefined}
              onClick={(event) => {
                if (controlsDisabled) {
                  event.preventDefault();
                }
              }}
            >
              Créer une clé {label}
            </a>
          </div>

          <p
            className="options-status rounded-xl border p-4 text-sm"
            role="status"
            aria-live="polite"
            aria-busy={controlsDisabled}
          >
            {statusCopy(status)}
          </p>

          <form className="space-y-4" noValidate onSubmit={onSave}>
            <div>
              <label htmlFor="api-key" className="text-sm font-medium text-slate-200">
                Clé API
              </label>
              <input
                id="api-key"
                name="api-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                disabled={controlsDisabled}
                aria-invalid={status.kind === "invalid"}
                aria-describedby={
                  status.kind === "invalid" ? "api-key-help api-key-error" : "api-key-help"
                }
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base text-slate-50 outline-none focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/30"
              />
              <p id="api-key-help" className="mt-2 text-xs leading-5 text-slate-400">
                La clé est enregistrée uniquement dans le stockage local de cette extension. Elle
                est transmise uniquement au fournisseur actif lors d’un test ou d’une capture,
                jamais affichée ni journalisée.
              </p>
              {status.kind === "invalid" && (
                <p id="api-key-error" className="mt-2 text-sm text-rose-200" role="alert">
                  Saisissez une clé API non vide.
                </p>
              )}
            </div>
            <button
              type="submit"
              disabled={controlsDisabled}
              className="options-primary-action rounded-xl px-5 py-3 text-sm font-semibold transition-colors disabled:cursor-wait disabled:opacity-60"
            >
              {saving ? "Enregistrement et vérification…" : "Enregistrer et vérifier"}
            </button>
          </form>

          {status.kind === "present" &&
            (removeConfirm ? (
              <div
                className="options-remove-confirm rounded-xl border p-4"
                role="alertdialog"
                aria-labelledby="remove-key-title"
                aria-describedby="remove-key-description"
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    if (controlsDisabled) {
                      return;
                    }
                    onRemoveCancel?.();
                  }
                }}
              >
                <h3 id="remove-key-title" className="font-medium">
                  Supprimer la clé {label} ?
                </h3>
                <p id="remove-key-description" className="mt-2 text-sm text-slate-300">
                  Cette clé sera supprimée de cet appareil. Cette action est irréversible.
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    ref={removeConfirmRef}
                    type="button"
                    disabled={controlsDisabled}
                    onClick={onRemoveConfirm}
                    className="options-danger-action rounded-xl px-5 py-3 text-sm font-semibold transition-colors disabled:cursor-wait disabled:opacity-60"
                  >
                    {removing ? "Suppression…" : "Confirmer la suppression"}
                  </button>
                  <button
                    type="button"
                    disabled={controlsDisabled}
                    onClick={onRemoveCancel}
                    className="rounded-xl border border-slate-600 px-5 py-3 text-sm font-semibold text-slate-200 transition-colors hover:border-slate-400 disabled:cursor-wait disabled:opacity-60"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            ) : (
              <button
                ref={removeTriggerRef}
                type="button"
                disabled={controlsDisabled}
                onClick={onRemoveRequest}
                className="options-danger-action rounded-xl border px-5 py-3 text-sm font-semibold transition-colors disabled:cursor-wait disabled:opacity-60"
              >
                Supprimer la clé {label}
              </button>
            ))}
        </section>

        {notice && (
          <p
            className={
              notice.kind === "success"
                ? "options-notice-success text-sm"
                : "options-notice-error text-sm"
            }
            role={notice.kind === "success" ? "status" : "alert"}
            aria-live={notice.kind === "success" ? "polite" : undefined}
          >
            {notice.message}
          </p>
        )}
      </section>
    </main>
  );
}

export function OptionsPage({ callbacks }: { readonly callbacks: OptionsPageCallbacks }) {
  const [providerStatus, setProviderStatus] = useState<ProviderStatus>({
    provider: "anthropic",
    status: { kind: "loading" },
  });
  const [hydrating, setHydrating] = useState(true);
  const [busyAction, setBusyAction] = useState<OptionsAction | undefined>();
  const [notice, setNotice] = useState<Notice>();
  const [removeConfirm, setRemoveConfirm] = useState(false);
  const providerTransition = useRef(0);
  const { provider, status } = providerStatus;

  useEffect(() => {
    let active = true;
    setHydrating(true);
    void (async () => {
      let loadedProvider: LlmProvider = "anthropic";
      try {
        loadedProvider =
          callbacks.getProvider === undefined ? "anthropic" : await callbacks.getProvider();
        const nextStatus =
          callbacks.getProviderStatus === undefined
            ? await callbacks.getStatus()
            : await callbacks.getProviderStatus(loadedProvider);
        if (active) {
          setProviderStatus({ provider: loadedProvider, status: nextStatus });
          setHydrating(false);
        }
      } catch {
        if (active) {
          setProviderStatus({
            provider: loadedProvider,
            status: { kind: "error", code: "unavailable" },
          });
          setHydrating(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [callbacks]);

  const handleProviderChange = async (nextProvider: LlmProvider): Promise<void> => {
    const transition = providerTransition.current + 1;
    providerTransition.current = transition;
    const currentProvider = provider;
    setBusyAction("provider");
    setNotice(undefined);
    setRemoveConfirm(false);
    const result = await persistProviderSelection(
      currentProvider,
      nextProvider,
      callbacks.setProvider ?? (async () => ({ kind: "success" as const })),
    );
    if (providerTransition.current !== transition) {
      return;
    }
    if (result.kind === "error") {
      setNotice({ kind: "error", message: "Impossible de changer de fournisseur pour le moment." });
      setBusyAction(undefined);
      return;
    }
    try {
      const nextStatus =
        callbacks.getProviderStatus === undefined
          ? await callbacks.getStatus()
          : await callbacks.getProviderStatus(nextProvider);
      if (providerTransition.current === transition) {
        setProviderStatus({ provider: result.provider, status: nextStatus });
      }
    } catch {
      if (providerTransition.current === transition) {
        setProviderStatus({
          provider: result.provider,
          status: { kind: "error", code: "unavailable" },
        });
        setNotice({
          kind: "error",
          message: "Impossible de charger l’état de cette clé. Réessayez.",
        });
      }
    } finally {
      if (providerTransition.current === transition) {
        setBusyAction(undefined);
      }
    }
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const form = event.currentTarget;
    const value: unknown = readApiKey(form);
    setBusyAction("save");
    setNotice(undefined);
    try {
      const result =
        callbacks.saveProvider === undefined
          ? await callbacks.save(value)
          : await callbacks.saveProvider(provider, value);
      if (result.kind !== "success") {
        if (result.kind === "invalid") {
          setProviderStatus({ provider, status: { kind: "invalid" } });
          setNotice(undefined);
          return;
        }
        setNotice({ kind: "error", message: saveErrorCopy(result) });
        return;
      }

      setProviderStatus({ provider, status: { kind: "present", mask: API_KEY_MASK } });
      clearApiKey(form);
      try {
        const testResult =
          callbacks.testProviderConnection === undefined
            ? await callbacks.testConnection()
            : await callbacks.testProviderConnection(provider);
        setNotice(testResultCopy(testResult, provider));
      } catch {
        setNotice({
          kind: "error",
          message: `Clé enregistrée, mais la connexion à ${providerLabel(provider)} a échoué. Vérifiez la clé ou votre réseau, puis réessayez.`,
        });
      }
    } catch {
      setNotice({ kind: "error", message: "Impossible d’enregistrer la clé pour le moment." });
    } finally {
      setBusyAction(undefined);
    }
  };

  const handleRemove = async (): Promise<void> => {
    setBusyAction("remove");
    setNotice(undefined);
    try {
      const result =
        callbacks.removeProvider === undefined
          ? await callbacks.remove()
          : await callbacks.removeProvider(provider);
      if (result.kind === "success") {
        setProviderStatus({ provider, status: { kind: "missing" } });
        setNotice({ kind: "success", message: `Clé ${providerLabel(provider)} supprimée.` });
      } else {
        setNotice({
          kind: "error",
          message:
            result.code === "quota"
              ? "Impossible de supprimer : quota de stockage atteint."
              : "Impossible de supprimer la clé pour le moment.",
        });
      }
    } catch {
      setNotice({ kind: "error", message: "Impossible de supprimer la clé pour le moment." });
    } finally {
      setBusyAction(undefined);
      setRemoveConfirm(false);
    }
  };

  return (
    <OptionsPageView
      status={status}
      callbacks={callbacks}
      busyAction={busyAction}
      hydrating={hydrating}
      notice={notice}
      provider={provider}
      removeConfirm={removeConfirm}
      onProviderChange={
        callbacks.getProvider === undefined ? undefined : (next) => void handleProviderChange(next)
      }
      onSave={(event) => {
        void handleSave(event);
      }}
      onRemoveRequest={() => {
        setRemoveConfirm(true);
      }}
      onRemoveConfirm={() => {
        void handleRemove();
      }}
      onRemoveCancel={() => {
        setRemoveConfirm(false);
      }}
    />
  );
}
