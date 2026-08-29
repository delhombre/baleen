import type { ExportArtifact } from "../../core/export-artifact";

export type ExportWriteResult =
  { readonly kind: "ok" } | { readonly kind: "error"; readonly code: "unavailable" };

export type ClipboardApi = {
  readonly writeText: (content: string) => Promise<void>;
};

export class ClipboardWriter {
  public constructor(private readonly clipboard?: ClipboardApi) {}

  public async write(artifact: ExportArtifact): Promise<ExportWriteResult> {
    if (this.clipboard === undefined) {
      return { kind: "error", code: "unavailable" };
    }

    try {
      await this.clipboard.writeText(artifact.content);
      return { kind: "ok" };
    } catch {
      return { kind: "error", code: "unavailable" };
    }
  }
}

export type DownloadAnchor = {
  href: string;
  download: string;
  click: () => void;
  remove: () => void;
};

export type DownloadWebApis = {
  readonly Blob: (parts: readonly string[], options: { readonly type: string }) => unknown;
  readonly URL: {
    readonly createObjectURL: (blob: unknown) => string;
    readonly revokeObjectURL: (url: string) => void;
  };
  readonly document: {
    readonly createElement: (tagName: "a") => DownloadAnchor;
  };
};

export class DownloadWriter {
  public constructor(private readonly apis?: DownloadWebApis) {}

  public async write(artifact: ExportArtifact): Promise<ExportWriteResult> {
    if (this.apis === undefined) {
      return { kind: "error", code: "unavailable" };
    }

    let anchor: DownloadAnchor | undefined;
    let objectUrl: string | undefined;
    let result: ExportWriteResult = { kind: "error", code: "unavailable" };
    let cleanupFailed = false;

    try {
      const blob = this.apis.Blob([artifact.content], { type: artifact.mimeType });
      objectUrl = this.apis.URL.createObjectURL(blob);
      anchor = this.apis.document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = artifact.filename;
      anchor.click();
      result = { kind: "ok" };
    } catch {
      // Keep the unavailable default result for setup or click failures.
    } finally {
      try {
        anchor?.remove();
      } catch {
        cleanupFailed = true;
      }
      try {
        if (objectUrl !== undefined) {
          this.apis.URL.revokeObjectURL(objectUrl);
        }
      } catch {
        cleanupFailed = true;
      }
    }

    return cleanupFailed ? { kind: "error", code: "unavailable" } : result;
  }
}

export function createClipboardWriter(): ClipboardWriter {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  return new ClipboardWriter(clipboard);
}

export function createDownloadWriter(): DownloadWriter {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    return new DownloadWriter();
  }

  return new DownloadWriter({
    Blob: (parts, options) => new Blob([...parts], options),
    URL: {
      createObjectURL: (blob) => URL.createObjectURL(blob as Blob),
      revokeObjectURL: (url) => URL.revokeObjectURL(url),
    },
    document,
  });
}
