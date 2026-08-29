import type { CaptureMessage } from "../../core/capture-message";
import { isCaptureMessage } from "../../core/capture-message";
import {
  extractRawProduct,
  type ExtractionResult,
  type PageSnapshot,
} from "../../core/raw-product";
import { extractDomSnapshot, extractJsonLdBlocks } from "../dom/product-page";

export type CaptureRuntimeListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: ExtractionResult) => void,
) => void;

export type CaptureRuntime = {
  readonly onMessage: {
    readonly addListener: (listener: CaptureRuntimeListener) => void;
  };
};

export type PageLocation = {
  readonly href: string;
};

type CaptureClock = () => string;

function buildPageSnapshot(
  document: Document,
  pageLocation: PageLocation,
  capturedAt: string,
): PageSnapshot {
  return {
    source: {
      url: pageLocation.href,
      pageTitle: document.title,
      capturedAt,
    },
    jsonLdBlocks: extractJsonLdBlocks(document),
    dom: extractDomSnapshot(document),
  };
}

export function createCaptureListener(
  document: Document,
  pageLocation: PageLocation,
  now: CaptureClock = () => new Date().toISOString(),
): CaptureRuntimeListener {
  return (message, _sender, sendResponse) => {
    if (!isCaptureMessage(message)) {
      return;
    }

    const capturedAt = now();
    const pageSnapshot = buildPageSnapshot(document, pageLocation, capturedAt);

    sendResponse(extractRawProduct(pageSnapshot));
  };
}

export function registerCaptureContentScript(
  runtime: CaptureRuntime,
  document: Document,
  pageLocation: PageLocation,
  now?: CaptureClock,
): void {
  runtime.onMessage.addListener(createCaptureListener(document, pageLocation, now));
}

export type { CaptureMessage };
