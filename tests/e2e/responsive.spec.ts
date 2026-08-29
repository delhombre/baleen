import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { chromium, type BrowserContext, type Page } from "playwright";
import { expect, test } from "playwright/test";

import type { CollectionSnapshot } from "../../src/adapters/chrome/collection-storage";
import type { ProductRecord } from "../../src/core/product-record";

const collectionId = "4c1ee929-6c05-42e8-bfdc-8dfb602ca0db";

function product(id: string, name: string): ProductRecord {
  return {
    id,
    capturedAt: "2026-08-28T12:00:00.000Z",
    source: { url: `https://shop.example.test/${id}`, pageTitle: name },
    name,
    brand: "Baleen",
    price: { amount: 129.9, currency: "EUR" },
    category: "Air fryer",
    specs: [
      { label: "Capacité", value: "5 L" },
      { label: "Puissance", value: "1 350 W" },
      { label: "Autonomie", value: "60 minutes" },
      ...Array.from({ length: 18 }, (_, index) => ({
        label: `Mesure ${index + 1}`,
        value: `${index + 1} unités`,
      })),
    ],
    pros: ["Cuisson rapide"],
    cons: ["Panier lourd"],
    extraction: { method: "json-ld", model: "claude-sonnet-4-6" },
  };
}

const snapshot: CollectionSnapshot = {
  collections: [
    {
      id: collectionId,
      name: "Air fryers",
      products: [
        product("550e8400-e29b-41d4-a716-446655440000", "CrispWave"),
        product("550e8400-e29b-41d4-a716-446655440001", "Barista Mini"),
        product("550e8400-e29b-41d4-a716-446655440002", "QuietClean"),
      ],
    },
  ],
  currentCollectionId: collectionId,
};

type ChromeExtensionGlobal = typeof globalThis & {
  chrome: {
    storage: {
      local: {
        set(items: Record<string, unknown>): Promise<void>;
      };
    };
  };
};

async function openExtensionPage(context: BrowserContext, path: string): Promise<Page> {
  const serviceWorker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(serviceWorker.url()).hostname;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/${path}`);
  await page.emulateMedia({ reducedMotion: "reduce" });
  return page;
}

async function setCollectionSnapshot(page: Page): Promise<void> {
  await page.evaluate(async (value) => {
    const extensionGlobal = globalThis as ChromeExtensionGlobal;
    await extensionGlobal.chrome.storage.local.set({ "baleen.collections.v1": value });
  }, snapshot);
}

type ControlMetrics = {
  readonly tag: string;
  readonly text: string;
  readonly width: number;
  readonly height: number;
  readonly fontSize: number;
};

async function readControlMetrics(page: Page): Promise<readonly ControlMetrics[]> {
  return page.locator("input:visible, select:visible, button:visible").evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        tag: element.tagName.toLowerCase(),
        text: element.textContent?.trim() ?? "",
        width: rect.width,
        height: rect.height,
        fontSize: Number.parseFloat(style.fontSize),
      };
    }),
  );
}

async function expectNoGlobalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  expect(dimensions.documentScrollWidth).toBe(dimensions.documentWidth);
  expect(dimensions.bodyScrollWidth).toBe(dimensions.bodyWidth);
}

async function readCollectionToggleColors(page: Page): Promise<{
  readonly activePressed: string | null;
  readonly activeBackground: string;
  readonly inactivePressed: string | null;
  readonly inactiveBackground: string;
}> {
  return page.evaluate(() => {
    const readButton = (name: string): HTMLButtonElement => {
      const button = Array.from(document.querySelectorAll("button")).find(
        (element) => element.textContent?.trim() === name,
      );
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`Missing collection view toggle: ${name}`);
      }
      return button;
    };
    const active = readButton("Comparaison");
    const inactive = readButton("Liste");
    return {
      activePressed: active.getAttribute("aria-pressed"),
      activeBackground: getComputedStyle(active).backgroundColor,
      inactivePressed: inactive.getAttribute("aria-pressed"),
      inactiveBackground: getComputedStyle(inactive).backgroundColor,
    };
  });
}

test("keeps extension UI usable at 320px with reduced motion and a scrollable comparison", async () => {
  const extensionPath = resolve(".output/chrome-mv3");
  const profilePath = await mkdtemp(join(tmpdir(), "baleen-responsive-e2e-profile-"));
  let context: BrowserContext | undefined;
  const unexpectedHttpRequests: string[] = [];

  try {
    context = await chromium.launchPersistentContext(profilePath, {
      args: [
        "--no-sandbox",
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
      channel: "chromium",
      deviceScaleFactor: 2,
      headless: true,
      offline: true,
      viewport: { width: 320, height: 800 },
    });
    context.on("request", (request) => {
      if (/^https?:\/\//u.test(request.url())) {
        unexpectedHttpRequests.push(request.url());
      }
    });

    const panel = await openExtensionPage(context, "sidepanel.html");
    await setCollectionSnapshot(panel);
    await panel.reload();
    await panel.emulateMedia({ reducedMotion: "reduce" });
    await expect(panel.getByRole("heading", { name: "Air fryers" }).first()).toBeVisible();

    expect(await panel.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(
      true,
    );
    await expectNoGlobalOverflow(panel);

    const panelControls = await readControlMetrics(panel);
    expect(panelControls.length).toBeGreaterThan(0);
    expect(panelControls.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);

    const comparisonToggle = panel.getByRole("button", { name: "Comparaison" });
    await comparisonToggle.click();
    const comparisonRegion = panel.getByRole("region", { name: "Tableau comparatif" });
    await expect(comparisonRegion).toBeVisible();
    await expect
      .poll(() => readCollectionToggleColors(panel), { timeout: 1_000 })
      .toEqual({
        activePressed: "true",
        activeBackground: "oklch(0.968 0.007 247.896)",
        inactivePressed: "false",
        inactiveBackground: "oklch(0.208 0.042 265.755)",
      });
    const comparisonMetrics = await comparisonRegion.evaluate((region) => {
      const header = region.querySelector("th[scope=col]");
      const rowHeader = region.querySelector("th[scope=row]");
      const regionRect = region.getBoundingClientRect();
      const headerBefore = header?.getBoundingClientRect().top ?? 0;
      region.scrollLeft = region.scrollWidth;
      region.scrollTop = region.scrollHeight;
      const headerAfter = header?.getBoundingClientRect().top ?? 0;
      const rowHeaderRect = rowHeader?.getBoundingClientRect();
      return {
        clientHeight: region.clientHeight,
        clientWidth: region.clientWidth,
        scrollHeight: region.scrollHeight,
        scrollLeft: region.scrollLeft,
        scrollTop: region.scrollTop,
        scrollWidth: region.scrollWidth,
        headerPosition: header === null ? "" : getComputedStyle(header).position,
        headerTopDelta: Math.abs(headerAfter - headerBefore),
        regionTop: regionRect.top,
        rowHeaderPosition: rowHeader === null ? "" : getComputedStyle(rowHeader).position,
        rowHeaderLeft: rowHeaderRect?.left ?? 0,
        regionLeft: regionRect.left,
      };
    });
    expect(comparisonMetrics.scrollWidth).toBeGreaterThan(comparisonMetrics.clientWidth);
    expect(comparisonMetrics.scrollHeight).toBeGreaterThan(comparisonMetrics.clientHeight);
    expect(comparisonMetrics.scrollLeft).toBeGreaterThan(0);
    expect(comparisonMetrics.scrollTop).toBeGreaterThan(0);
    expect(comparisonMetrics.headerPosition).toBe("sticky");
    expect(comparisonMetrics.rowHeaderPosition).toBe("sticky");
    expect(comparisonMetrics.headerTopDelta).toBeLessThan(2);
    expect(
      Math.abs(comparisonMetrics.rowHeaderLeft - comparisonMetrics.regionLeft),
    ).toBeLessThanOrEqual(2);
    await expectNoGlobalOverflow(panel);

    await panel.getByRole("button", { name: "Liste" }).click();
    await expect(panel.getByRole("heading", { name: "Air fryers" }).last()).toBeVisible();
    await panel.waitForTimeout(25);
    await panel.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
    const headerMetrics = await panel.evaluate(() => {
      const title = document.getElementById("collections-view-title");
      const subtitle = title?.nextElementSibling;
      const box = (element: Element | null | undefined) => {
        if (element === null || element === undefined) return undefined;
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom };
      };
      return {
        scrollY: window.scrollY,
        documentScrollTop: document.documentElement.scrollTop,
        bodyScrollTop: document.body.scrollTop,
        title: box(title),
        subtitle: box(subtitle),
      };
    });
    expect(headerMetrics.scrollY).toBe(0);
    expect(headerMetrics.documentScrollTop).toBe(0);
    expect(headerMetrics.bodyScrollTop).toBe(0);
    expect(headerMetrics.title?.top).toBeGreaterThanOrEqual(0);
    expect(headerMetrics.subtitle?.bottom).toBeLessThanOrEqual(800);

    const options = await openExtensionPage(context, "options.html");
    await expect(options.getByRole("heading", { name: "Connexion au modèle" })).toBeVisible();
    expect(
      await options.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches),
    ).toBe(true);
    const optionControls = await readControlMetrics(options);
    expect(optionControls.length).toBeGreaterThan(0);
    expect(optionControls.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);
    expect(
      optionControls
        .filter(({ tag }) => tag === "input" || tag === "select")
        .every(({ fontSize }) => fontSize >= 16),
    ).toBe(true);
    await expectNoGlobalOverflow(options);
    expect(unexpectedHttpRequests).toEqual([]);
  } finally {
    await context?.close();
    await rm(profilePath, { force: true, recursive: true });
  }
});

test("keeps the side panel free of global overflow at 200% layout and text zoom, independently of DPR", async () => {
  const extensionPath = resolve(".output/chrome-mv3");
  const profilePath = await mkdtemp(join(tmpdir(), "baleen-zoom-e2e-profile-"));
  let context: BrowserContext | undefined;
  const unexpectedHttpRequests: string[] = [];

  try {
    context = await chromium.launchPersistentContext(profilePath, {
      args: [
        "--no-sandbox",
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
      channel: "chromium",
      deviceScaleFactor: 1,
      headless: true,
      offline: true,
      viewport: { width: 640, height: 900 },
    });
    context.on("request", (request) => {
      if (/^https?:\/\//u.test(request.url())) {
        unexpectedHttpRequests.push(request.url());
      }
    });

    const panel = await openExtensionPage(context, "sidepanel.html");
    await setCollectionSnapshot(panel);
    await panel.reload();
    await expect(panel.getByRole("heading", { name: "Air fryers" }).first()).toBeVisible();
    await panel.setViewportSize({ width: 320, height: 450 });
    const cdp = await context.newCDPSession(panel);
    await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
    const zoomMetrics = await panel.evaluate(() => {
      return {
        devicePixelRatio: window.devicePixelRatio,
        layoutWidth: document.documentElement.clientWidth,
        visualScale: window.visualViewport?.scale ?? 1,
        visualWidth: window.visualViewport?.width ?? 0,
      };
    });

    expect(zoomMetrics.devicePixelRatio).toBe(1);
    expect(zoomMetrics.layoutWidth).toBe(320);
    expect(zoomMetrics.visualScale).toBe(2);
    expect(zoomMetrics.visualWidth).toBeLessThanOrEqual(160);
    await expectNoGlobalOverflow(panel);
    expect(unexpectedHttpRequests).toEqual([]);
  } finally {
    await context?.close();
    await rm(profilePath, { force: true, recursive: true });
  }
});
