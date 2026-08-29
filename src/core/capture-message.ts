export const CAPTURE_MESSAGE_TYPE = "baleen:capture" as const;

export type CaptureMessage = {
  readonly type: typeof CAPTURE_MESSAGE_TYPE;
};

export function isCaptureMessage(value: unknown): value is CaptureMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  return "type" in value && value.type === CAPTURE_MESSAGE_TYPE;
}
