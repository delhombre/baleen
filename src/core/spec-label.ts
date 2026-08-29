export type QualifiedSpecLabel = {
  readonly sourceLabel: string;
  readonly displayLabel: string;
};

export function qualifySpecLabels(
  sourceLabels: readonly string[],
  reservedLabels: readonly string[],
): readonly QualifiedSpecLabel[] {
  const reserved = new Set(reservedLabels);
  const usedDisplayLabels = new Set<string>();

  return sourceLabels.map((sourceLabel) => {
    const baseDisplayLabel = reserved.has(sourceLabel) ? `Spec: ${sourceLabel}` : sourceLabel;
    let displayLabel = baseDisplayLabel;
    let suffix = 2;
    while (usedDisplayLabels.has(displayLabel)) {
      displayLabel = `${baseDisplayLabel} (${suffix})`;
      suffix += 1;
    }
    usedDisplayLabels.add(displayLabel);
    return { sourceLabel, displayLabel };
  });
}
