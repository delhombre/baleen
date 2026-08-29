import { describe, expect, it, vi } from "vitest";

import {
  configureSidePanel,
  initializeSidePanel,
  type ChromeSidePanel,
} from "../../../../src/adapters/chrome/side-panel";

describe("initializeSidePanel", () => {
  it("awaits the toolbar action side-panel configuration", async () => {
    const setPanelBehavior = vi.fn<ChromeSidePanel["setPanelBehavior"]>(async () => undefined);
    const sidePanel: ChromeSidePanel = { setPanelBehavior };

    await expect(configureSidePanel(sidePanel)).resolves.toBeUndefined();

    expect(setPanelBehavior).toHaveBeenCalledExactlyOnceWith({
      openPanelOnActionClick: true,
    });
  });

  it("propagates a rejected configuration instead of reporting ready", async () => {
    const failure = new Error("configuration failed");
    const sidePanel: ChromeSidePanel = {
      setPanelBehavior: vi.fn(async () => {
        throw failure;
      }),
    };

    await expect(initializeSidePanel(sidePanel)).rejects.toBe(failure);
  });
});
