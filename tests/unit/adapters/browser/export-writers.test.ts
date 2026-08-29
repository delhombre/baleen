import { describe, expect, it, vi } from "vitest";

import {
  ClipboardWriter,
  DownloadWriter,
  type DownloadWebApis,
} from "../../../../src/adapters/browser/export-writers";

const artifact = {
  filename: "cafe.csv",
  mimeType: "text/csv",
  content: "name,price\nCafé,10\n",
};

describe("ClipboardWriter", () => {
  it("writes exactly the artifact content", async () => {
    const writeText = vi.fn(async () => undefined);
    const writer = new ClipboardWriter({ writeText });

    const result = await writer.write(artifact);

    expect(result).toEqual({ kind: "ok" });
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith(artifact.content);
  });

  it("returns a typed unavailable error without exposing the raw error", async () => {
    const writer = new ClipboardWriter({
      writeText: vi.fn(async () => {
        throw new Error("private browser detail");
      }),
    });

    await expect(writer.write(artifact)).resolves.toEqual({
      kind: "error",
      code: "unavailable",
    });
  });
});

describe("DownloadWriter", () => {
  it("downloads the exact artifact and cleans up the anchor and object URL", async () => {
    const blob = { kind: "blob" };
    const anchor = {
      href: "",
      download: "",
      click: vi.fn(),
      remove: vi.fn(),
    };
    const apis: DownloadWebApis = {
      Blob: vi.fn(() => blob),
      URL: {
        createObjectURL: vi.fn(() => "blob:export"),
        revokeObjectURL: vi.fn(),
      },
      document: { createElement: vi.fn(() => anchor) },
    };
    const writer = new DownloadWriter(apis);

    const result = await writer.write(artifact);

    expect(result).toEqual({ kind: "ok" });
    expect(apis.Blob).toHaveBeenCalledWith([artifact.content], { type: artifact.mimeType });
    expect(apis.URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(anchor.href).toBe("blob:export");
    expect(anchor.download).toBe(artifact.filename);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
    expect(apis.URL.revokeObjectURL).toHaveBeenCalledWith("blob:export");
  });

  it("cleans up and returns unavailable when download setup fails", async () => {
    const anchor = {
      href: "",
      download: "",
      click: vi.fn(() => {
        throw new Error("private browser detail");
      }),
      remove: vi.fn(),
    };
    const apis: DownloadWebApis = {
      Blob: vi.fn(() => ({ kind: "blob" })),
      URL: {
        createObjectURL: vi.fn(() => "blob:export"),
        revokeObjectURL: vi.fn(),
      },
      document: { createElement: vi.fn(() => anchor) },
    };

    await expect(new DownloadWriter(apis).write(artifact)).resolves.toEqual({
      kind: "error",
      code: "unavailable",
    });
    expect(anchor.remove).toHaveBeenCalledOnce();
    expect(apis.URL.revokeObjectURL).toHaveBeenCalledWith("blob:export");
  });

  it("returns unavailable when anchor cleanup fails and still attempts URL cleanup", async () => {
    const anchor = {
      href: "",
      download: "",
      click: vi.fn(),
      remove: vi.fn(() => {
        throw new Error("anchor cleanup failed");
      }),
    };
    const revokeObjectURL = vi.fn();
    const apis: DownloadWebApis = {
      Blob: vi.fn(() => ({ kind: "blob" })),
      URL: {
        createObjectURL: vi.fn(() => "blob:export"),
        revokeObjectURL,
      },
      document: { createElement: vi.fn(() => anchor) },
    };

    await expect(new DownloadWriter(apis).write(artifact)).resolves.toEqual({
      kind: "error",
      code: "unavailable",
    });
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:export");
  });

  it("returns unavailable when URL cleanup fails and still attempts anchor cleanup", async () => {
    const anchor = {
      href: "",
      download: "",
      click: vi.fn(),
      remove: vi.fn(),
    };
    const revokeObjectURL = vi.fn(() => {
      throw new Error("URL cleanup failed");
    });
    const apis: DownloadWebApis = {
      Blob: vi.fn(() => ({ kind: "blob" })),
      URL: {
        createObjectURL: vi.fn(() => "blob:export"),
        revokeObjectURL,
      },
      document: { createElement: vi.fn(() => anchor) },
    };

    await expect(new DownloadWriter(apis).write(artifact)).resolves.toEqual({
      kind: "error",
      code: "unavailable",
    });
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
  });
});
