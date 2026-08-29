import {
  MAX_JSON_LD_BLOCK_LENGTH,
  MAX_JSON_LD_BLOCKS,
  MAX_JSON_LD_TOTAL_LENGTH,
  MAX_RAW_CONTENT_LENGTH,
  type DomSnapshot,
  type DomSpec,
} from "../../core/raw-product";

const excludedSelector = "script, style, nav, footer, aside, form, [hidden], [role='navigation' i]";
const priceSelector =
  "[itemprop='price' i], [class*='price' i], [id*='price' i], [data-testid*='price' i]";
const productEvidenceMarkerPattern =
  /(?:^|[^a-z0-9])(?:features?|highlights?|benefits?|specifications?|specs?|selling-points?|product-features?)(?:$|[^a-z0-9])/iu;
const markerAttributes = ["class", "id", "aria-label", "data-testid"] as const;
const productItemTypes = new Set(["https://schema.org/Product", "http://schema.org/Product"]);
const cssomAvailabilityByDocument = new WeakMap<Document, boolean>();
const collapsedVisibilityByDocument = new WeakMap<Document, WeakMap<Element, boolean>>();

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function readInlineStyleValue(element: Element, property: string): string | undefined {
  const style = element.getAttribute("style");

  if (style === null) {
    return undefined;
  }

  let selected: { value: string; important: boolean } | undefined;

  for (const declaration of style.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 0) {
      continue;
    }

    const name = declaration.slice(0, separator).trim().toLowerCase();
    if (name !== property) {
      continue;
    }

    const declarationValue = declaration.slice(separator + 1).trim();
    const important = /\s*!important\s*$/iu.test(declarationValue);
    if (selected === undefined || important || !selected.important) {
      selected = {
        value: declarationValue.replace(/\s*!important\s*$/iu, ""),
        important,
      };
    }
  }

  return selected?.value;
}

function cssFunctionArguments(value: string, functionName: string): readonly string[] | undefined {
  const match = value.trim().match(new RegExp(`^${functionName}\\((.*)\\)$`, "iu"));
  if (match?.[1] === undefined) {
    return undefined;
  }

  return match[1].replace(/,/gu, " ").trim().split(/\s+/u);
}

function isZeroCssLength(value: string): boolean {
  return /^0(?:\.0+)?(?:px)?$/iu.test(value);
}

function isFullyClipped(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }

  const argumentsList = cssFunctionArguments(value, "rect");
  return argumentsList?.length === 4 && argumentsList.every(isZeroCssLength);
}

function isFullyInset(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }

  const argumentsList = cssFunctionArguments(value, "inset");
  if (argumentsList === undefined || argumentsList.length < 1 || argumentsList.length > 4) {
    return false;
  }

  const values = argumentsList.map((argument) => {
    if (isZeroCssLength(argument)) {
      return 0;
    }

    const percentage = argument.match(/^([0-9]+(?:\.[0-9]+)?)%$/u)?.[1];
    return percentage === undefined ? undefined : Number(percentage);
  });
  if (values.some((value) => value === undefined)) {
    return false;
  }

  const [first, second = first, third = first, fourth = second] = values;
  if (first === undefined || second === undefined || third === undefined || fourth === undefined) {
    return false;
  }

  return first + third >= 100 || second + fourth >= 100;
}

function hasAbsoluteHiddenInlineStyle(element: Element): boolean {
  const display = readInlineStyleValue(element, "display")?.toLowerCase();
  const opacity = readInlineStyleValue(element, "opacity");
  const contentVisibility = readInlineStyleValue(element, "content-visibility")?.toLowerCase();

  return (
    display === "none" ||
    (opacity !== undefined && /^0(?:\.0+)?$/u.test(opacity)) ||
    contentVisibility === "hidden" ||
    isFullyClipped(readInlineStyleValue(element, "clip")) ||
    isFullyInset(readInlineStyleValue(element, "clip-path"))
  );
}

function hasAbsoluteHiddenComputedStyle(style: CSSStyleDeclaration): boolean {
  return (
    style.display === "none" ||
    style.opacity === "0" ||
    style.contentVisibility?.trim().toLowerCase() === "hidden" ||
    isFullyClipped(style.clip) ||
    isFullyInset(style.clipPath)
  );
}

type VisibilityMode = "collapse" | "hidden" | "visible";

function readComputedStyle(element: Element): CSSStyleDeclaration | undefined {
  const document = element.ownerDocument;
  if (cssomAvailabilityByDocument.get(document) === false) {
    return undefined;
  }

  const view = document.defaultView;
  if (view === null) {
    cssomAvailabilityByDocument.set(document, false);
    return undefined;
  }

  try {
    const style = view.getComputedStyle(element);
    cssomAvailabilityByDocument.set(document, true);
    return style;
  } catch {
    cssomAvailabilityByDocument.set(document, false);
    return undefined;
  }
}

function getVisibilityMode(element: Element): VisibilityMode | undefined {
  const computedStyle = readComputedStyle(element);
  if (computedStyle !== undefined) {
    const computedVisibility = computedStyle.visibility.trim().toLowerCase();
    if (computedVisibility === "collapse") {
      return "collapse";
    }
    if (computedVisibility === "hidden") {
      return "hidden";
    }
    if (computedVisibility === "visible") {
      return "visible";
    }

    return undefined;
  }

  const inlineVisibility = readInlineStyleValue(element, "visibility")?.toLowerCase();
  if (inlineVisibility === "collapse") {
    return "collapse";
  }
  if (inlineVisibility === "hidden") {
    return "hidden";
  }
  if (inlineVisibility === "visible") {
    return "visible";
  }

  return undefined;
}

function isSelfAbsolutelyHiddenElement(element: Element): boolean {
  if (
    element.matches(excludedSelector) ||
    (element.tagName.toLowerCase() === "details" && !element.hasAttribute("open")) ||
    (element.tagName.toLowerCase() === "header" && isSiteHeader(element)) ||
    element.getAttribute("aria-hidden")?.trim().toLowerCase() === "true"
  ) {
    return true;
  }

  const computedStyle = readComputedStyle(element);
  return computedStyle === undefined
    ? hasAbsoluteHiddenInlineStyle(element)
    : hasAbsoluteHiddenComputedStyle(computedStyle);
}

function isClosedDetailsContent(element: Element): boolean {
  let current: Element | null = element;

  while (current !== null) {
    if (current.tagName.toLowerCase() === "details" && !current.hasAttribute("open")) {
      if (current === element) {
        return true;
      }

      let child: Element = element;
      while (child.parentElement !== current && child.parentElement !== null) {
        child = child.parentElement;
      }

      if (child.tagName.toLowerCase() !== "summary") {
        return true;
      }
    }

    current = current.parentElement;
  }

  return false;
}

function isContentRoot(element: Element): boolean {
  return element.matches("main, [role='main' i], article, [role='article' i]");
}

function hasCollapsedVisibility(element: Element): boolean {
  const document = element.ownerDocument;
  let cache = collapsedVisibilityByDocument.get(document);
  if (cache === undefined) {
    cache = new WeakMap<Element, boolean>();
    collapsedVisibilityByDocument.set(document, cache);
  }

  const cached = cache.get(element);
  if (cached !== undefined) {
    return cached;
  }

  const unresolved: Element[] = [];
  let current: Element | null = element;
  let collapsed = false;

  while (current !== null) {
    const cachedAncestor = cache.get(current);
    if (cachedAncestor !== undefined) {
      collapsed = cachedAncestor;
      break;
    }

    unresolved.push(current);
    current = current.parentElement;
  }

  for (let index = unresolved.length - 1; index >= 0; index -= 1) {
    const ancestor = unresolved[index];
    if (ancestor === undefined) {
      continue;
    }

    collapsed = collapsed || getVisibilityMode(ancestor) === "collapse";
    cache.set(ancestor, collapsed);
  }

  return cache.get(element) === true;
}

function isSiteHeader(element: Element): boolean {
  if (element.tagName.toLowerCase() !== "header") {
    return false;
  }

  let current = element.parentElement;
  while (current !== null) {
    if (isContentRoot(current)) {
      return false;
    }

    current = current.parentElement;
  }

  return true;
}

function isHiddenElement(element: Element): boolean {
  if (isClosedDetailsContent(element)) {
    return true;
  }

  if (hasCollapsedVisibility(element)) {
    return true;
  }

  let current: Element | null = element;
  let visibilityResolved = false;

  while (current !== null) {
    if (
      current !== element &&
      current.tagName.toLowerCase() === "details" &&
      !current.hasAttribute("open")
    ) {
      current = current.parentElement;
      continue;
    }

    if (isSelfAbsolutelyHiddenElement(current)) {
      return true;
    }

    if (!visibilityResolved) {
      const visibility = getVisibilityMode(current);
      if (visibility === "hidden") {
        return true;
      }
      if (visibility === "visible") {
        visibilityResolved = true;
      }
    }

    current = current.parentElement;
  }

  return false;
}

type TextTraversalFrame = {
  readonly node: Node;
  readonly hiddenByVisibility: boolean;
};

function collectRawText(element: Element, fragments: string[]): void {
  if (isSelfAbsolutelyHiddenElement(element) || hasCollapsedVisibility(element)) {
    return;
  }

  const rootVisibility = getVisibilityMode(element);
  let rootHiddenByVisibility = rootVisibility === "hidden";
  if (rootVisibility === undefined) {
    let ancestor = element.parentElement;
    while (ancestor !== null) {
      const visibility = getVisibilityMode(ancestor);
      if (visibility !== undefined) {
        rootHiddenByVisibility = visibility === "hidden";
        break;
      }
      ancestor = ancestor.parentElement;
    }
  }

  const pending: TextTraversalFrame[] = [];
  const children = Array.from(element.childNodes);
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index];
    if (child !== undefined) {
      pending.push({ node: child, hiddenByVisibility: rootHiddenByVisibility });
    }
  }

  while (pending.length > 0) {
    const frame = pending.pop();
    if (frame === undefined) {
      continue;
    }

    if (frame.node.nodeType === 3 || frame.node.nodeType === 4) {
      if (!frame.hiddenByVisibility) {
        fragments.push(frame.node.textContent ?? "");
      }
      continue;
    }

    if (frame.node.nodeType !== 1) {
      continue;
    }

    const childElement = frame.node as Element;
    if (isSelfAbsolutelyHiddenElement(childElement)) {
      continue;
    }

    const visibility = getVisibilityMode(childElement);
    if (visibility === "collapse") {
      continue;
    }
    const hiddenByVisibility =
      visibility === "visible" ? false : visibility === "hidden" ? true : frame.hiddenByVisibility;

    const childNodes = Array.from(childElement.childNodes);
    for (let index = childNodes.length - 1; index >= 0; index -= 1) {
      const child = childNodes[index];
      if (child !== undefined) {
        pending.push({ node: child, hiddenByVisibility });
      }
    }
  }
}

function readText(element: Element): string {
  const fragments: string[] = [];
  collectRawText(element, fragments);

  return normalizeText(fragments.join(""));
}

function appendUniqueWithinBudget(
  values: string[],
  seen: Set<string>,
  value: string,
  budget: { used: number },
): boolean {
  if (value.length === 0 || seen.has(value)) {
    return true;
  }

  const remaining = MAX_RAW_CONTENT_LENGTH - budget.used;
  if (remaining <= 0) {
    return false;
  }

  if (value.length > remaining) {
    values.push(value.slice(0, remaining));
    budget.used += remaining;
    return false;
  }

  seen.add(value);
  values.push(value);
  budget.used += value.length;
  return true;
}

type SpecEvidenceBudget = {
  used: number;
  hasTruncatedEvidence: boolean;
  hasProductSpecEvidence: boolean;
  overflowedSpecSignature: SpecSignature | undefined;
};

type SpecSignature = {
  readonly labelFingerprint: string;
  readonly valueFingerprint: string;
};

function fingerprintText(value: string): string {
  let forward = 0;
  let reverse = 0;

  for (let index = 0; index < value.length; index += 1) {
    forward = (forward * 31 + value.charCodeAt(index)) % 2_147_483_647;
    reverse = (reverse * 37 + value.charCodeAt(value.length - index - 1)) % 2_147_483_629;
  }

  return `${value.length}:${forward}:${reverse}`;
}

function createSpecSignature(label: string, value: string): SpecSignature {
  return {
    labelFingerprint: fingerprintText(label),
    valueFingerprint: fingerprintText(value),
  };
}

function matchesSpecSignature(signature: SpecSignature, label: string, value: string): boolean {
  return (
    signature.labelFingerprint === fingerprintText(label) &&
    signature.valueFingerprint === fingerprintText(value)
  );
}

function appendUniqueSpecWithinBudget(
  specs: DomSpec[],
  seen: Set<string>,
  label: string,
  value: string,
  budget: SpecEvidenceBudget,
): boolean {
  if (label.length === 0 || value.length === 0) {
    return true;
  }

  const entryLength = label.length + value.length + 4;
  if (entryLength <= MAX_RAW_CONTENT_LENGTH && seen.has(`${label}\u0000${value}`)) {
    return true;
  }

  if (budget.hasTruncatedEvidence) {
    const overflowedSpecSignature = budget.overflowedSpecSignature;
    if (
      overflowedSpecSignature !== undefined &&
      matchesSpecSignature(overflowedSpecSignature, label, value)
    ) {
      return true;
    }

    budget.hasProductSpecEvidence = true;
    return false;
  }

  const remaining = MAX_RAW_CONTENT_LENGTH - budget.used;
  if (entryLength <= remaining) {
    seen.add(`${label}\u0000${value}`);
    specs.push({ label, value });
    budget.used += entryLength;
    return true;
  }

  const partialTextLength = remaining - 4;
  if (partialTextLength >= 2) {
    const partialLabelLength = Math.min(label.length, partialTextLength - 1);
    const partialValueLength = partialTextLength - partialLabelLength;
    specs.push({
      label: label.slice(0, partialLabelLength),
      value: value.slice(0, partialValueLength),
    });
    budget.used += partialLabelLength + partialValueLength + 4;
  }

  budget.hasTruncatedEvidence = true;
  if (seen.size >= 1) {
    budget.hasProductSpecEvidence = true;
    return false;
  }

  budget.overflowedSpecSignature = createSpecSignature(label, value);
  return true;
}

function nearestContentRoot(element: Element): Element | undefined {
  let current: Element | null = element;

  while (current !== null) {
    if (isContentRoot(current)) {
      return current;
    }

    current = current.parentElement;
  }

  return undefined;
}

function isInEvidenceScope(candidate: Element, scope: Document | Element): boolean {
  return scope === candidate.ownerDocument || nearestContentRoot(candidate) === scope;
}

function firstVisibleText(candidates: Iterable<Element>): string {
  for (const candidate of candidates) {
    if (!isHiddenElement(candidate)) {
      const text = readText(candidate);

      if (text.length > 0) {
        return text;
      }
    }
  }

  return "";
}

function hasLocalPriceOrSpecificationEvidence(root: Element): boolean {
  if (isHiddenElement(root)) {
    return false;
  }

  const hasPrice = Array.from(root.querySelectorAll(priceSelector)).some(
    (candidate) =>
      nearestContentRoot(candidate) === root &&
      !isHiddenElement(candidate) &&
      readText(candidate).length > 0,
  );
  if (hasPrice) {
    return true;
  }

  const hasTableSpec = Array.from(root.querySelectorAll("table tr")).some((row) => {
    if (nearestContentRoot(row) !== root || isHiddenElement(row)) {
      return false;
    }

    const cells = Array.from(row.children).filter(isTableCell);
    if (cells.length < 2 || cells.some((cell) => isHiddenElement(cell))) {
      return false;
    }

    const label = cells[0] === undefined ? "" : readText(cells[0]);
    const value =
      cells
        .slice(1)
        .map(readText)
        .find((text) => text.length > 0) ?? "";
    return label.length > 0 && value.length > 0;
  });
  if (hasTableSpec) {
    return true;
  }

  const hasDescriptionSpec = Array.from(root.querySelectorAll("dl")).some((descriptionList) => {
    if (nearestContentRoot(descriptionList) !== root || isHiddenElement(descriptionList)) {
      return false;
    }

    const children = Array.from(descriptionList.children);
    for (let index = 0; index < children.length - 1; index += 1) {
      const labelElement = children[index];
      const valueElement = children[index + 1];
      if (
        labelElement?.tagName === "DT" &&
        valueElement?.tagName === "DD" &&
        !isHiddenElement(labelElement) &&
        !isHiddenElement(valueElement) &&
        readText(labelElement).length > 0 &&
        readText(valueElement).length > 0
      ) {
        return true;
      }
    }

    return false;
  });
  if (hasDescriptionSpec) {
    return true;
  }

  return false;
}

function extractTitle(scope: Document | Element): string {
  const visibleH1 = firstVisibleText(
    Array.from(scope.querySelectorAll("h1")).filter((candidate) =>
      isInEvidenceScope(candidate, scope),
    ),
  );
  if (visibleH1.length > 0) {
    return visibleH1;
  }

  return firstVisibleText(
    Array.from(scope.querySelectorAll("[itemprop='name' i]")).filter((candidate) =>
      isInEvidenceScope(candidate, scope),
    ),
  );
}

function extractPrices(scope: Document | Element): string[] {
  const prices: string[] = [];
  const seen = new Set<string>();
  const candidates = scope.querySelectorAll(priceSelector);
  let lastProcessedCandidate: Element | undefined;
  let capturedLength = 0;

  for (const candidate of candidates) {
    if (lastProcessedCandidate?.contains(candidate)) {
      continue;
    }

    if (!isInEvidenceScope(candidate, scope)) {
      continue;
    }

    if (!isHiddenElement(candidate)) {
      const text = readText(candidate);
      if (text.length === 0 || seen.has(text)) {
        continue;
      }

      const remaining = MAX_RAW_CONTENT_LENGTH - capturedLength;
      if (text.length > remaining) {
        if (remaining > 0) {
          prices.push(text.slice(0, remaining));
        }
        break;
      }

      seen.add(text);
      prices.push(text);
      capturedLength += text.length;
      lastProcessedCandidate = candidate;
    }
  }

  return prices;
}

function isTableCell(element: Element): boolean {
  return element.tagName === "TH" || element.tagName === "TD";
}

function extractTableSpecs(
  scope: Document | Element,
  specs: DomSpec[],
  seen: Set<string>,
  budget: SpecEvidenceBudget,
): boolean {
  for (const row of scope.querySelectorAll("table tr")) {
    if (!isInEvidenceScope(row, scope) || isHiddenElement(row)) {
      continue;
    }

    const cells = Array.from(row.children).filter(isTableCell);
    if (cells.length < 2 || cells.some((cell) => isHiddenElement(cell))) {
      continue;
    }

    const [labelCell, ...valueCells] = cells;
    if (labelCell === undefined || valueCells.length === 0) {
      continue;
    }

    const label = readText(labelCell);
    const value = valueCells
      .map((cell) => readText(cell))
      .filter((text) => text.length > 0)
      .join(" | ");

    if (!appendUniqueSpecWithinBudget(specs, seen, label, value, budget)) {
      return false;
    }
  }

  return true;
}

function extractDescriptionListSpecs(
  scope: Document | Element,
  specs: DomSpec[],
  seen: Set<string>,
  budget: SpecEvidenceBudget,
): boolean {
  for (const descriptionList of scope.querySelectorAll("dl")) {
    if (!isInEvidenceScope(descriptionList, scope) || isHiddenElement(descriptionList)) {
      continue;
    }

    const children = Array.from(descriptionList.children);
    for (let index = 0; index < children.length - 1; index += 1) {
      const labelElement = children[index];
      const valueElement = children[index + 1];

      if (
        labelElement?.tagName !== "DT" ||
        valueElement?.tagName !== "DD" ||
        isHiddenElement(labelElement) ||
        isHiddenElement(valueElement)
      ) {
        continue;
      }

      const label = readText(labelElement);
      const value = readText(valueElement);
      if (!appendUniqueSpecWithinBudget(specs, seen, label, value, budget)) {
        return false;
      }
    }
  }

  return true;
}

function extractSpecs(scope: Document | Element): {
  readonly specs: readonly DomSpec[];
  readonly hasTruncatedEvidence: boolean;
  readonly hasProductSpecEvidence: boolean;
} {
  const specs: DomSpec[] = [];
  const seen = new Set<string>();
  const budget: SpecEvidenceBudget = {
    used: 0,
    hasTruncatedEvidence: false,
    hasProductSpecEvidence: false,
    overflowedSpecSignature: undefined,
  };

  const completedTableSpecs = extractTableSpecs(scope, specs, seen, budget);
  if (completedTableSpecs) {
    extractDescriptionListSpecs(scope, specs, seen, budget);
  }

  return {
    specs,
    hasTruncatedEvidence: budget.hasTruncatedEvidence,
    hasProductSpecEvidence: budget.hasProductSpecEvidence,
  };
}

function extractBullets(scope: Document | Element, document: Document): string[] {
  const markedLists = getVisibleProductLists(document, scope);
  const qualifyingList = findProductBulletEvidenceList(document, scope);

  if (qualifyingList !== undefined) {
    return extractDirectListBullets(qualifyingList);
  }

  const firstMarkedListWithTwoBullets = markedLists.find(hasTwoVisibleBullets);
  if (firstMarkedListWithTwoBullets !== undefined) {
    return extractDirectListBullets(firstMarkedListWithTwoBullets);
  }

  if (markedLists.length > 0) {
    const firstMarkedList = markedLists[0];
    if (firstMarkedList !== undefined) {
      return extractDirectListBullets(firstMarkedList);
    }
  }

  const firstVisibleList = Array.from(scope.querySelectorAll("ul, ol")).find(
    (list) => isInEvidenceScope(list, scope) && !isHiddenElement(list),
  );

  return firstVisibleList === undefined ? [] : extractDirectListBullets(firstVisibleList);
}

function extractDirectListBullets(list: Element): string[] {
  const bullets: string[] = [];
  const seen = new Set<string>();
  const budget = { used: 0 };

  for (const candidate of Array.from(list.children)) {
    if (candidate.tagName.toLowerCase() !== "li" || isHiddenElement(candidate)) {
      continue;
    }

    const text = readText(candidate);
    if (!appendUniqueWithinBudget(bullets, seen, text, budget)) {
      break;
    }
  }

  return bullets;
}

function hasProductEvidenceMarker(element: Element): boolean {
  for (const attribute of markerAttributes) {
    const value = element.getAttribute(attribute);
    if (value === null) {
      continue;
    }

    const normalized = value.replace(/([a-z])([A-Z])/gu, "$1 $2");
    if (productEvidenceMarkerPattern.test(normalized)) {
      return true;
    }
  }

  return false;
}

function hasProductItemTypeMarker(element: Element): boolean {
  const itemType = element.getAttribute("itemtype");

  return (
    itemType !== null &&
    itemType
      .trim()
      .split(/\s+/u)
      .some((value) => productItemTypes.has(value))
  );
}

function hasProductPageTypeMarker(element: Element): boolean {
  return element.getAttribute("data-page-type")?.trim().toLowerCase() === "product";
}

function hasVisibleMetaProductMarker(document: Document): boolean {
  const head = document.head;
  if (head === null) {
    return false;
  }

  for (const meta of head.querySelectorAll("meta[property]")) {
    if (
      meta.getAttribute("property")?.trim().toLowerCase() === "og:type" &&
      meta.getAttribute("content")?.trim().toLowerCase() === "product"
    ) {
      return true;
    }
  }

  return false;
}

function isProductEvidenceList(list: Element): boolean {
  let current: Element | null = list;

  while (current !== null && !isContentRoot(current) && current.tagName.toLowerCase() !== "body") {
    if (hasProductEvidenceMarker(current)) {
      return true;
    }

    current = current.parentElement;
  }

  return false;
}

function getVisibleProductLists(document: Document, scope: Document | Element): Element[] {
  return Array.from(document.querySelectorAll("ul, ol")).filter(
    (list) =>
      isInEvidenceScope(list, scope) && !isHiddenElement(list) && isProductEvidenceList(list),
  );
}

function hasTwoVisibleBullets(list: Element): boolean {
  let count = 0;

  for (const child of Array.from(list.children)) {
    if (
      child.tagName.toLowerCase() === "li" &&
      !isHiddenElement(child) &&
      readText(child).length > 0
    ) {
      count += 1;
      if (count >= 2) {
        return true;
      }
    }
  }

  return false;
}

function hasLocalProductPageMarker(list: Element, metaProductMarker: boolean): boolean {
  let current: Element | null = list;
  let withinVisibleContentRoot = false;
  let localStructuralMarker = false;

  while (current !== null) {
    if (!isHiddenElement(current)) {
      if (hasProductItemTypeMarker(current) || hasProductPageTypeMarker(current)) {
        localStructuralMarker = true;
      }
    }

    if (isContentRoot(current)) {
      withinVisibleContentRoot = !isHiddenElement(current);
      break;
    }

    if (current.tagName.toLowerCase() === "body") {
      withinVisibleContentRoot = !isHiddenElement(current);
      break;
    }

    current = current.parentElement;
  }

  return localStructuralMarker || (metaProductMarker && withinVisibleContentRoot);
}

function findProductBulletEvidenceList(
  document: Document,
  scope: Document | Element = document,
): Element | undefined {
  const metaProductMarker = hasVisibleMetaProductMarker(document);

  for (const list of getVisibleProductLists(document, scope)) {
    if (hasTwoVisibleBullets(list) && hasLocalProductPageMarker(list, metaProductMarker)) {
      return list;
    }
  }

  return undefined;
}

function hasProductBulletEvidence(document: Document, scope: Document | Element): boolean {
  return findProductBulletEvidenceList(document, scope) !== undefined;
}

function hasLocalProductBulletEvidence(document: Document, scope: Document | Element): boolean {
  return getVisibleProductLists(document, scope).some(
    (list) => hasTwoVisibleBullets(list) && hasLocalProductPageMarker(list, false),
  );
}

function selectEvidenceScope(document: Document): Document | Element {
  const semanticRoots = Array.from(
    document.querySelectorAll("main, [role='main' i], article, [role='article' i]"),
  );
  const mainRoots = semanticRoots.filter((root) => root.matches("main, [role='main' i]"));
  const mainRootSet = new Set(mainRoots);
  const secondaryRoots = semanticRoots.filter((root) => !mainRootSet.has(root));
  const primaryRoots = [...mainRoots, ...secondaryRoots];
  const rootGroups = [mainRoots, secondaryRoots];

  for (const roots of rootGroups) {
    const rootWithLocalMarker = roots.find(
      (root) =>
        !isHiddenElement(root) &&
        (hasProductItemTypeMarker(root) || hasProductPageTypeMarker(root)),
    );
    if (rootWithLocalMarker !== undefined) {
      return rootWithLocalMarker;
    }

    const rootWithLocalPriceOrSpecifications = roots.find(
      (root) => !isHiddenElement(root) && hasLocalPriceOrSpecificationEvidence(root),
    );
    if (rootWithLocalPriceOrSpecifications !== undefined) {
      return rootWithLocalPriceOrSpecifications;
    }
  }

  for (const roots of rootGroups) {
    const rootWithLocallyMarkedBullets = roots.find(
      (root) => !isHiddenElement(root) && hasLocalProductBulletEvidence(document, root),
    );
    if (rootWithLocallyMarkedBullets !== undefined) {
      return rootWithLocallyMarkedBullets;
    }
  }

  for (const roots of rootGroups) {
    const rootWithOgSupportedBullets = roots.find(
      (root) => !isHiddenElement(root) && hasProductBulletEvidence(document, root),
    );
    if (rootWithOgSupportedBullets !== undefined) {
      return rootWithOgSupportedBullets;
    }
  }

  const outerSemanticRoot = semanticRoots.find((root) => {
    let ancestor = root.parentElement;

    while (ancestor !== null) {
      if (isContentRoot(ancestor)) {
        return false;
      }

      ancestor = ancestor.parentElement;
    }

    return true;
  });

  return outerSemanticRoot ?? primaryRoots[0] ?? document;
}

export function extractDomSnapshot(document: Document): DomSnapshot {
  collapsedVisibilityByDocument.set(document, new WeakMap<Element, boolean>());
  const scope = selectEvidenceScope(document);
  const extractedSpecs = extractSpecs(scope);

  return {
    title: extractTitle(scope),
    priceTexts: extractPrices(scope),
    specs: extractedSpecs.specs,
    bullets: extractBullets(scope, document),
    hasProductBulletEvidence: hasProductBulletEvidence(document, scope),
    ...(extractedSpecs.hasProductSpecEvidence ? { hasProductSpecEvidence: true } : {}),
    ...(extractedSpecs.hasTruncatedEvidence ? { hasTruncatedEvidence: true } : {}),
  };
}

export const captureDomSnapshot = extractDomSnapshot;

export function extractJsonLdBlocks(document: Document): readonly string[] {
  const blocks: string[] = [];
  let inspectedBlocks = 0;
  let retainedCharacters = 0;

  for (const script of document.querySelectorAll("script")) {
    if (script.getAttribute("type")?.trim().toLowerCase() !== "application/ld+json") {
      continue;
    }

    if (inspectedBlocks >= MAX_JSON_LD_BLOCKS) {
      break;
    }
    inspectedBlocks += 1;

    const block = script.textContent ?? "";
    if (block.length > MAX_JSON_LD_BLOCK_LENGTH) {
      continue;
    }

    if (block.length > MAX_JSON_LD_TOTAL_LENGTH - retainedCharacters) {
      break;
    }

    blocks.push(block);
    retainedCharacters += block.length;
  }

  return blocks;
}
