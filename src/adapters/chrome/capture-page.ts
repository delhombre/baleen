import { CAPTURE_MESSAGE_TYPE, type CaptureMessage } from "../../core/capture-message";
import { isExtractionResult, type ExtractionResult } from "../../core/raw-product";

export type ChromeTab = {
  readonly id?: number;
};

export type ChromeTabs = {
  readonly query: (queryInfo: {
    active: boolean;
    currentWindow: boolean;
  }) => Promise<readonly ChromeTab[]>;
  readonly sendMessage: (tabId: number, message: CaptureMessage) => Promise<unknown>;
};

export type CaptureUnavailable = {
  readonly kind: "error";
  readonly code: "unavailable-page";
};

export type CapturePanelResult = ExtractionResult | CaptureUnavailable;

function unavailablePage(): CaptureUnavailable {
  return { kind: "error", code: "unavailable-page" };
}

export async function captureActiveTab(tabs: ChromeTabs): Promise<CapturePanelResult> {
  try {
    const [activeTab] = await tabs.query({ active: true, currentWindow: true });

    if (activeTab?.id === undefined) {
      return unavailablePage();
    }

    const response = await tabs.sendMessage(activeTab.id, { type: CAPTURE_MESSAGE_TYPE });

    return isExtractionResult(response) ? response : unavailablePage();
  } catch {
    return unavailablePage();
  }
}
