import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { chromium, type BrowserContext, type Page } from "playwright";
import { expect, test } from "playwright/test";

const runCommand = promisify(execFile);

const fixtureNames = [
  "airfryer-jsonld.html",
  "espresso-jsonld-partial.html",
  "vacuum-no-jsonld.html",
  "not-a-product.html",
] as const;

type FixtureName = (typeof fixtureNames)[number];

type BuiltManifest = {
  manifest_version?: unknown;
  permissions?: unknown;
  host_permissions?: unknown;
  content_security_policy?: {
    extension_pages?: unknown;
  };
  optional_permissions?: unknown;
  optional_host_permissions?: unknown;
  side_panel?: {
    default_path?: unknown;
  };
  background?: {
    service_worker?: unknown;
  };
  content_scripts?: Array<{
    exclude_matches?: unknown;
    matches?: unknown;
    all_frames?: unknown;
    run_at?: unknown;
    world?: unknown;
    js?: unknown;
  }>;
};

type CaptureSuccess = {
  kind: "success";
  source: {
    url: string;
    pageTitle: string;
    capturedAt: string;
  };
  method: "json-ld" | "dom-fallback";
  content: unknown;
  truncated: boolean;
};

type CaptureError = {
  kind: "error";
  code: "not-product" | "ambiguous-product";
};

type CaptureResult = CaptureSuccess | CaptureError;

type ChromeServiceWorkerGlobal = typeof globalThis & {
  chrome: {
    tabs: {
      query(queryInfo: {
        active: boolean;
        currentWindow: boolean;
      }): Promise<readonly { id?: number }[]>;
      sendMessage(tabId: number, message: { type: "baleen:capture" }): Promise<unknown>;
    };
  };
};

function isLoopbackUrl(url: string): boolean {
  const parsed = new URL(url);

  return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
}

function isHttpUrl(url: string): boolean {
  const protocol = new URL(url).protocol;

  return protocol === "http:" || protocol === "https:";
}

async function startFixtureServer(): Promise<{
  baseUrl: string;
  requests: string[];
  server: Server;
}> {
  const requests: string[] = [];
  const fixtureDirectory = resolve("fixtures");
  const fixturePaths = new Map<FixtureName, string>(
    fixtureNames.map((fixtureName) => [fixtureName, resolve(fixtureDirectory, fixtureName)]),
  );
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    requests.push(`${request.method ?? "GET"} ${requestUrl.pathname}`);

    const fixturePath = fixturePaths.get(requestUrl.pathname.slice(1) as FixtureName);
    if (fixturePath === undefined || requestUrl.search.length > 0 || request.method !== "GET") {
      response.writeHead(404).end();
      return;
    }

    try {
      const html = await readFile(fixturePath, "utf8");
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
    } catch {
      response.writeHead(500).end();
    }
  });

  await new Promise<void>((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveServer());
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    await new Promise<void>((resolveServer) => server.close(() => resolveServer()));
    throw new Error("Fixture server did not expose a TCP address.");
  }

  const port = (address as AddressInfo).port;
  return { baseUrl: `http://127.0.0.1:${port}`, requests, server };
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolveServer) => server.close(() => resolveServer()));
}

async function getExtensionPage(context: BrowserContext, page: Page): Promise<Page> {
  const serviceWorker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(serviceWorker.url()).hostname;
  const manifestPath = resolve(".output/chrome-mv3/manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as BuiltManifest;
  const panelPath = manifest.side_panel?.default_path;
  if (typeof panelPath !== "string" || panelPath.length === 0) {
    throw new Error("Built manifest has no side panel default path.");
  }

  const panel = await context.newPage();
  await panel.goto(new URL(panelPath, `chrome-extension://${extensionId}/`).toString());
  await expect(panel).toHaveTitle("Baleen");
  await expect(panel.getByRole("heading", { name: "Collections" })).toBeVisible();
  await page.bringToFront();
  return panel;
}

async function openRawCaptureDetails(panel: Page): Promise<void> {
  const rawHeading = panel.getByRole("heading", { name: "Capture brute" });
  await expect(rawHeading).toBeHidden();
  await panel.getByText("Détails de capture", { exact: true }).click();
  await expect(rawHeading).toBeVisible();
}

async function captureActiveTabFromServiceWorker(context: BrowserContext): Promise<CaptureResult> {
  const serviceWorker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));

  return serviceWorker.evaluate(async () => {
    const extensionGlobal = globalThis as ChromeServiceWorkerGlobal;
    const [activeTab] = await extensionGlobal.chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (activeTab?.id === undefined) {
      throw new Error("No active tab available for the capture sensor.");
    }

    return (await extensionGlobal.chrome.tabs.sendMessage(activeTab.id, {
      type: "baleen:capture",
    })) as CaptureResult;
  });
}

test("captures all local fixtures through the real content script", async () => {
  const { baseUrl, requests, server } = await startFixtureServer();
  const extensionPath = resolve(".output/chrome-mv3");
  const profilePath = await mkdtemp(join(tmpdir(), "baleen-capture-e2e-profile-"));
  let context: BrowserContext | undefined;
  const externalRequests: string[] = [];
  let anthropicRequests = 0;

  try {
    context = await chromium.launchPersistentContext(profilePath, {
      args: [
        "--no-sandbox",
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
      channel: "chromium",
      headless: true,
      offline: false,
    });
    const captureContext = context;
    await context.route("**/*", async (route) => {
      const requestUrl = route.request().url();
      if (requestUrl === "https://api.anthropic.com/v1/messages") {
        anthropicRequests += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  version: 1,
                  name: "e1",
                  brand: null,
                  price: null,
                  category: null,
                  specs: [],
                  pros: [],
                  cons: [],
                }),
              },
            ],
          }),
        });
        return;
      }
      if (isHttpUrl(requestUrl) && !isLoopbackUrl(requestUrl)) {
        externalRequests.push(requestUrl);
        await route.abort("blockedbyclient");
        return;
      }

      await route.continue();
    });

    const page = await context.newPage();
    const airfryerUrl = `${baseUrl}/airfryer-jsonld.html`;
    await page.goto(airfryerUrl);
    await expect(page).toHaveTitle("CrispWave Air Fryer 5.5L | Shop Harbor");
    const panel = await getExtensionPage(context, page);
    await expect(panel.getByRole("heading", { name: "Aucune collection" })).toBeVisible();
    await panel.getByLabel("Nom de la collection").fill("Air fryers janvier");
    await panel.getByRole("button", { name: "Créer la collection" }).click();
    await panel.locator("summary").filter({ hasText: "Gérer les collections" }).click();
    await expect(panel.getByRole("combobox", { name: "Collection courante" })).toBeVisible();
    await panel.evaluate(async () => {
      const extensionGlobal = globalThis as typeof globalThis & {
        chrome: {
          storage: {
            local: {
              set(items: {
                "baleen.llmProvider.v1": "anthropic";
                "baleen.anthropicApiKey.v1": string;
              }): Promise<void>;
            };
          };
        };
      };
      await extensionGlobal.chrome.storage.local.set({
        "baleen.llmProvider.v1": "anthropic",
        "baleen.anthropicApiKey.v1": "offline-e2e-key",
      });
    });
    await panel.getByRole("button", { name: "Capturer cette page produit" }).click();
    await expect(panel.getByRole("heading", { name: "Fiche normalisée" })).toBeVisible();
    await expect(panel.getByRole("heading", { name: "CrispWave Air Fryer 5.5L" })).toBeVisible();
    await expect(panel.getByText("unknown", { exact: true }).first()).toBeVisible();
    await expect(panel.getByRole("heading", { name: "Provenance" })).toBeVisible();
    await openRawCaptureDetails(panel);
    await expect(
      panel.getByLabel("Fiche normalisée").getByText("json-ld", { exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByLabel("CrispWave Air Fryer 5.5L").getByText("claude-sonnet-4-6", { exact: true }),
    ).toBeVisible();
    expect(anthropicRequests).toBe(1);
    await expect(panel.getByRole("heading", { name: "Capture brute" })).toBeVisible();
    await expect(
      panel.getByLabel("Fiche normalisée").getByText(airfryerUrl, { exact: true }),
    ).toBeVisible();
    await expect(panel.getByLabel("CrispWave Air Fryer 5.5L").locator("time")).toHaveText(
      /^\d{1,2} [\p{L}]+ 20\d\d à \d{2}:\d{2} UTC$/u,
    );
    await expect(
      panel.getByLabel("CrispWave Air Fryer 5.5L").getByText("json-ld", { exact: true }),
    ).toBeVisible();
    await expect(panel.getByLabel("Fiche normalisée").locator("pre")).toContainText(
      '"@type": "Product"',
    );

    await panel.reload();
    await expect(panel).toHaveTitle("Baleen");
    await expect(panel.getByRole("heading", { name: "Air fryers janvier" })).toBeVisible();
    await expect(panel.getByRole("heading", { name: "CrispWave Air Fryer 5.5L" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Capturer cette page produit" })).toBeVisible();

    const airfryer = await captureActiveTabFromServiceWorker(context);
    expect(airfryer).toEqual({
      kind: "success",
      source: {
        url: airfryerUrl,
        pageTitle: "CrispWave Air Fryer 5.5L | Shop Harbor",
        capturedAt: expect.stringMatching(/^2026-08-28T|^20\d\d-/),
      },
      method: "json-ld",
      content: {
        "@context": "https://schema.org",
        "@type": "Product",
        "@id": "https://shop-harbor.test/products/crispwave-air-fryer-55l",
        name: "CrispWave Air Fryer 5.5L",
        image: ["https://shop-harbor.test/images/crispwave-air-fryer.jpg"],
        description: "A family-size air fryer with a viewing window and dishwasher-safe basket.",
        sku: "CW-AF-550",
        brand: { "@type": "Brand", name: "CrispWave" },
        offers: {
          "@type": "Offer",
          url: "https://shop-harbor.test/products/crispwave-air-fryer-55l",
          priceCurrency: "EUR",
          price: "129.99",
          availability: "https://schema.org/InStock",
        },
      },
      truncated: false,
    });

    const espressoUrl = `${baseUrl}/espresso-jsonld-partial.html`;
    await page.goto(espressoUrl);
    await page.bringToFront();
    await panel.getByRole("button", { name: "Capturer cette page produit" }).click();
    await openRawCaptureDetails(panel);
    await expect(panel.getByRole("heading", { name: "Capture brute" })).toBeVisible();
    await expect(
      panel.getByLabel("Fiche normalisée").getByText(espressoUrl, { exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByLabel("Fiche normalisée").getByText("json-ld", { exact: true }),
    ).toBeVisible();
    await expect(panel.getByLabel("Fiche normalisée").locator("pre")).toContainText(
      '"@type": "https://schema.org/Product"',
    );
    await expect(panel.getByLabel("Fiche normalisée").locator("pre")).not.toContainText("249");
    const espresso = await captureActiveTabFromServiceWorker(context);
    expect(espresso).toEqual({
      kind: "success",
      source: {
        url: espressoUrl,
        pageTitle: "Barista Mini Espresso Machine | Brew Market",
        capturedAt: expect.stringMatching(/^20\d\d-/),
      },
      method: "json-ld",
      content: {
        "@context": "https://schema.org",
        "@type": "https://schema.org/Product",
        name: "Barista Mini Espresso Machine",
        description: "A compact espresso machine with a stainless-steel steam wand.",
        sku: "BM-220",
        brand: { "@type": "Brand", name: "Brew Market" },
      },
      truncated: false,
    });
    if (espresso.kind !== "success") {
      throw new Error("Espresso fixture did not produce a successful capture.");
    }
    expect(JSON.stringify(espresso.content)).not.toContain("249");

    const vacuumUrl = `${baseUrl}/vacuum-no-jsonld.html`;
    await page.goto(vacuumUrl);
    await page.bringToFront();
    await panel.getByRole("button", { name: "Capturer cette page produit" }).click();
    await openRawCaptureDetails(panel);
    await expect(panel.getByRole("heading", { name: "Capture brute" })).toBeVisible();
    await expect(
      panel.getByLabel("Fiche normalisée").getByText(vacuumUrl, { exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByLabel("Fiche normalisée").getByText("dom-fallback", { exact: true }),
    ).toBeVisible();
    await expect(panel.getByLabel("Fiche normalisée").locator("pre")).toContainText(
      "Battery runtime: 60 minutes",
    );
    await expect(panel.getByLabel("Fiche normalisée").locator("pre")).toContainText(
      "Dust capacity: 0.7 L",
    );
    await expect(panel.getByLabel("Fiche normalisée").locator("pre")).not.toContainText("249.00");
    const vacuum = await captureActiveTabFromServiceWorker(context);
    expect(vacuum).toEqual({
      kind: "success",
      source: {
        url: vacuumUrl,
        pageTitle: "Northstar QuietClean Cordless Vacuum | Northstar Home",
        capturedAt: expect.stringMatching(/^20\d\d-/),
      },
      method: "dom-fallback",
      content:
        "Title: Northstar QuietClean Cordless Vacuum\nPrices:\n- €379.00\nSpecifications:\n- Battery runtime: 60 minutes\n- Dust capacity: 0.7 L\n- Weight: 2.6 kg\nBullets:\n- HEPA filtration\n- LED floor head",
      truncated: false,
    });
    if (vacuum.kind !== "success") {
      throw new Error("Vacuum fixture did not produce a successful capture.");
    }
    expect(JSON.stringify(vacuum.content)).not.toContain("249.00");
    expect(JSON.stringify(vacuum.content)).not.toContain("999");
    expect(JSON.stringify(vacuum.content)).not.toContain("Footer");

    await test.step("capture a visible og:type product marker from the real content script", async () => {
      await page.evaluate(() => {
        for (const script of Array.from(document.querySelectorAll("script"))) {
          script.remove();
        }

        const meta = document.createElement("meta");
        meta.setAttribute("property", "og:type");
        meta.setAttribute("content", "product");
        document.head.append(meta);

        const main = document.querySelector("main");
        if (main === null) {
          throw new Error("Fixture main content is missing.");
        }

        const title = document.createElement("h1");
        title.textContent = "Meta Marker Product";
        const list = document.createElement("ul");
        list.className = "product-features";
        for (const text of ["Visible feature A", "Visible feature B"]) {
          const item = document.createElement("li");
          item.textContent = text;
          list.append(item);
        }

        main.replaceChildren(title, list);
        document.title = "Meta Marker Product";
      });

      await page.bringToFront();
      await panel.getByRole("button", { name: "Capturer cette page produit" }).click();
      await openRawCaptureDetails(panel);
      await expect(panel.getByRole("heading", { name: "Capture brute" })).toBeVisible();
      await expect(
        panel.getByLabel("Fiche normalisée").getByText("dom-fallback", { exact: true }),
      ).toBeVisible();
      await expect(panel.getByLabel("Fiche normalisée").locator("pre")).toContainText(
        "Visible feature A",
      );
      await expect(panel.getByLabel("Fiche normalisée").locator("pre")).toContainText(
        "Visible feature B",
      );

      await expect(captureActiveTabFromServiceWorker(captureContext)).resolves.toMatchObject({
        kind: "success",
        method: "dom-fallback",
        content: expect.stringContaining("Title: Meta Marker Product"),
      });
    });

    const blogUrl = `${baseUrl}/not-a-product.html`;
    await page.goto(blogUrl);
    await expect(page).toHaveTitle("How to Choose a Quiet Kitchen | The Harbor Journal");
    await expect(captureActiveTabFromServiceWorker(context)).resolves.toEqual({
      kind: "error",
      code: "not-product",
    });

    await page.bringToFront();
    await panel.getByRole("button", { name: "Capturer cette page produit" }).click();
    const captureError = panel.getByRole("alert");
    await expect(
      captureError.getByRole("heading", { name: "Page produit non détectée" }),
    ).toBeVisible();
    await expect(captureError).toContainText(
      "Baleen n’a pas trouvé assez d’informations produit. Ouvrez une page produit, puis réessayez.",
    );
    await expect(captureError.getByRole("button", { name: "Réessayer" })).toBeVisible();
    expect(externalRequests).toEqual([]);
    expect(requests).toEqual([
      "GET /airfryer-jsonld.html",
      "GET /espresso-jsonld-partial.html",
      "GET /vacuum-no-jsonld.html",
      "GET /not-a-product.html",
    ]);
  } finally {
    await context?.close();
    await closeServer(server);
    await rm(profilePath, { force: true, recursive: true });
  }
});

test("uses Chromium's cascade and local product scope through the real content script", async () => {
  const { baseUrl, requests, server } = await startFixtureServer();
  const extensionPath = resolve(".output/chrome-mv3");
  const profilePath = await mkdtemp(join(tmpdir(), "baleen-cascade-e2e-profile-"));
  let context: BrowserContext | undefined;
  const externalRequests: string[] = [];

  try {
    context = await chromium.launchPersistentContext(profilePath, {
      args: [
        "--no-sandbox",
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
      channel: "chromium",
      headless: true,
      offline: false,
    });
    await context.route("**/*", async (route) => {
      const requestUrl = route.request().url();
      if (isHttpUrl(requestUrl) && !isLoopbackUrl(requestUrl)) {
        externalRequests.push(requestUrl);
        await route.abort("blockedbyclient");
        return;
      }

      await route.continue();
    });

    const page = await context.newPage();
    const fixtureUrl = `${baseUrl}/vacuum-no-jsonld.html`;
    await page.goto(fixtureUrl);
    await page.evaluate(() => {
      const main = document.querySelector("main");
      if (main === null) {
        throw new Error("Fixture main content is missing.");
      }

      const style = document.createElement("style");
      style.textContent = [
        ".cascade-visible { display: block !important; }",
        ".cascade-hidden { display: none !important; }",
        ".collapsed-evidence { visibility: collapse; }",
        ".collapsed-evidence * { visibility: visible; }",
        ".clip-hidden { clip-path: inset(0 60% 0 40%); }",
      ].join(" ");
      document.head.append(style);

      const meta = document.createElement("meta");
      meta.setAttribute("property", "og:type");
      meta.setAttribute("content", "product");
      document.head.append(meta);

      const guide = document.createElement("article");
      const guideTitle = document.createElement("h1");
      guideTitle.textContent = "Editorial guide";
      const guidePrice = document.createElement("p");
      guidePrice.className = "product-price";
      guidePrice.textContent = "€5.00 editorial";
      const guideListSection = document.createElement("section");
      guideListSection.className = "product-features";
      const guideList = document.createElement("ul");
      for (const text of ["Guide bullet A", "Guide bullet B"]) {
        const item = document.createElement("li");
        item.textContent = text;
        guideList.append(item);
      }
      guideListSection.append(guideList);
      guide.append(guideTitle, guidePrice, guideListSection);
      document.body.insertBefore(guide, main);

      const title = document.createElement("h1");
      title.textContent = "Cascade Product";
      const visiblePrice = document.createElement("p");
      visiblePrice.className = "product-price cascade-visible";
      visiblePrice.style.display = "none";
      visiblePrice.textContent = "€379.00";
      const hiddenPrice = document.createElement("p");
      hiddenPrice.className = "product-price cascade-hidden";
      hiddenPrice.style.display = "block";
      hiddenPrice.textContent = "€999.00";
      const clippedPrice = document.createElement("p");
      clippedPrice.className = "product-price clip-hidden";
      clippedPrice.textContent = "€998.00";

      const specifications = document.createElement("table");
      const visibleBody = document.createElement("tbody");
      const visibleRow = document.createElement("tr");
      const visibleLabel = document.createElement("th");
      visibleLabel.textContent = "Battery runtime";
      const visibleValue = document.createElement("td");
      visibleValue.textContent = "60 minutes";
      visibleRow.append(visibleLabel, visibleValue);
      visibleBody.append(visibleRow);

      const collapsedBody = document.createElement("tbody");
      collapsedBody.className = "collapsed-evidence";
      const collapsedRow = document.createElement("tr");
      const collapsedLabel = document.createElement("th");
      collapsedLabel.textContent = "Hidden capacity";
      const collapsedValue = document.createElement("td");
      collapsedValue.textContent = "999 L";
      collapsedRow.append(collapsedLabel, collapsedValue);
      collapsedBody.append(collapsedRow);
      specifications.append(visibleBody, collapsedBody);

      const features = document.createElement("section");
      features.className = "product-features";
      const featureList = document.createElement("ul");
      for (const text of ["Local feature A", "Local feature B"]) {
        const item = document.createElement("li");
        item.textContent = text;
        featureList.append(item);
      }
      features.append(featureList);

      main.replaceChildren(
        title,
        visiblePrice,
        hiddenPrice,
        clippedPrice,
        specifications,
        features,
      );
      document.title = "Cascade Product";
    });

    await page.bringToFront();
    await expect(captureActiveTabFromServiceWorker(context)).resolves.toEqual({
      kind: "success",
      source: {
        url: fixtureUrl,
        pageTitle: "Cascade Product",
        capturedAt: expect.stringMatching(/^20\d\d-/),
      },
      method: "dom-fallback",
      content:
        "Title: Cascade Product\nPrices:\n- €379.00\nSpecifications:\n- Battery runtime: 60 minutes\nBullets:\n- Local feature A\n- Local feature B",
      truncated: false,
    });
    expect(externalRequests).toEqual([]);
    expect(requests).toEqual(["GET /vacuum-no-jsonld.html"]);
  } finally {
    await context?.close();
    await closeServer(server);
    await rm(profilePath, { force: true, recursive: true });
  }
});

test("captures through the selected Groq provider without external requests", async () => {
  const { baseUrl, requests, server } = await startFixtureServer();
  const extensionPath = resolve(".output/chrome-mv3");
  const profilePath = await mkdtemp(join(tmpdir(), "baleen-groq-e2e-profile-"));
  let context: BrowserContext | undefined;
  const externalRequests: string[] = [];
  let groqRequests = 0;

  try {
    context = await chromium.launchPersistentContext(profilePath, {
      args: [
        "--no-sandbox",
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
      channel: "chromium",
      headless: true,
      offline: false,
    });
    await context.route("**/*", async (route) => {
      const requestUrl = route.request().url();
      if (requestUrl === "https://api.groq.com/openai/v1/chat/completions") {
        groqRequests += 1;
        const body = JSON.parse(route.request().postData() ?? "{}") as {
          model?: unknown;
          messages: readonly [{ readonly content: string }, { readonly content: string }];
          response_format?: unknown;
        };
        expect(body.model).toBe("openai/gpt-oss-120b");
        expect(body.response_format).toEqual({
          type: "json_schema",
          json_schema: {
            name: "baleen_normalization_selection_v1",
            strict: true,
            schema: {
              type: "object",
              properties: {
                version: { type: "integer", enum: [1] },
                name: { type: ["string", "null"], pattern: "^e[1-9][0-9]*$" },
                brand: { type: ["string", "null"], pattern: "^e[1-9][0-9]*$" },
                price: { type: ["string", "null"], pattern: "^e[1-9][0-9]*$" },
                category: { type: ["string", "null"], pattern: "^e[1-9][0-9]*$" },
                specs: {
                  type: "array",
                  maxItems: 128,
                  items: { type: "string", pattern: "^e[1-9][0-9]*$" },
                },
                pros: {
                  type: "array",
                  maxItems: 128,
                  items: { type: "string", pattern: "^e[1-9][0-9]*$" },
                },
                cons: {
                  type: "array",
                  maxItems: 128,
                  items: { type: "string", pattern: "^e[1-9][0-9]*$" },
                },
              },
              required: ["version", "name", "brand", "price", "category", "specs", "pros", "cons"],
              additionalProperties: false,
            },
          },
        });
        const userContent = JSON.parse(body.messages[1].content) as {
          allowedEvidenceIds?: unknown;
        };
        expect(userContent.allowedEvidenceIds).toEqual({
          name: ["e1"],
          brand: ["e2"],
          price: ["e3"],
          category: [],
          specs: [],
          pros: [],
          cons: [],
        });
        const serializedConstraints = JSON.stringify(userContent.allowedEvidenceIds);
        expect(serializedConstraints).not.toContain("CrispWave");
        expect(serializedConstraints).not.toContain("129.99");
        expect(serializedConstraints).not.toContain("Viewing window");
        expect(serializedConstraints).not.toContain("Dishwasher-safe basket");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    version: 1,
                    name: "e1",
                    brand: null,
                    price: null,
                    category: null,
                    specs: [],
                    pros: [],
                    cons: [],
                  }),
                },
              },
            ],
          }),
        });
        return;
      }
      if (isHttpUrl(requestUrl) && !isLoopbackUrl(requestUrl)) {
        externalRequests.push(requestUrl);
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });

    const page = await context.newPage();
    await page.goto(`${baseUrl}/airfryer-jsonld.html`);
    const panel = await getExtensionPage(context, page);
    await expect(panel.getByRole("heading", { name: "Aucune collection" })).toBeVisible();
    await panel.getByLabel("Nom de la collection").fill("Groq shortlist");
    await panel.getByRole("button", { name: "Créer la collection" }).click();
    await panel.locator("summary").filter({ hasText: "Gérer les collections" }).click();
    await expect(panel.getByRole("combobox", { name: "Collection courante" })).toBeVisible();
    await panel.evaluate(async () => {
      const extensionGlobal = globalThis as typeof globalThis & {
        chrome: {
          storage: {
            local: {
              set(items: Record<string, string>): Promise<void>;
            };
          };
        };
      };
      await extensionGlobal.chrome.storage.local.set({
        "baleen.llmProvider.v1": "groq",
        "baleen.groqApiKey.v1": "gsk-offline-e2e-key",
      });
    });
    await panel.getByRole("button", { name: "Capturer cette page produit" }).click();
    await expect(panel.getByRole("heading", { name: "Fiche normalisée" })).toBeVisible();
    await expect(panel.getByText("openai/gpt-oss-120b", { exact: true })).toBeVisible();
    expect(groqRequests).toBe(1);
    expect(externalRequests).toEqual([]);
    expect(requests).toEqual(["GET /airfryer-jsonld.html"]);
  } finally {
    await context?.close();
    await closeServer(server);
    await rm(profilePath, { force: true, recursive: true });
  }
});

test("audits the Phase 1 manifest content-script scope", async () => {
  const manifestPath = resolve(".output/chrome-mv3/manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as BuiltManifest;
  const contentScripts = manifest.content_scripts;

  expect(manifest.manifest_version).toBe(3);
  expect(manifest.permissions).toEqual(["sidePanel", "storage", "clipboardWrite"]);
  expect(manifest.host_permissions).toEqual([
    "https://api.anthropic.com/*",
    "https://api.groq.com/*",
  ]);
  expect(manifest.content_security_policy).toEqual({
    extension_pages:
      "script-src 'self'; object-src 'self'; connect-src https://api.anthropic.com https://api.groq.com",
  });
  expect(contentScripts).toHaveLength(1);
  expect(contentScripts?.[0]).toEqual({
    matches: ["http://*/*", "https://*/*"],
    all_frames: false,
    run_at: "document_idle",
    js: ["content-scripts/content.js"],
    world: "ISOLATED",
  });
});

test("rejects content-script scope expansion in the manifest audit", async () => {
  const manifestPath = resolve(".output/chrome-mv3/manifest.json");
  const originalManifest = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(originalManifest) as BuiltManifest;
  const contentScript = manifest.content_scripts?.[0];
  if (contentScript === undefined) {
    throw new Error("Built manifest has no content script to mutate.");
  }

  contentScript.exclude_matches = ["*://*/*"];

  try {
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(runCommand(process.execPath, ["scripts/audit-manifest.mjs"])).rejects.toThrow(
      "Manifest content script must declare exact keys.",
    );
  } finally {
    await writeFile(manifestPath, originalManifest);
  }
});

test("rejects optional permission expansion in the manifest audit", async () => {
  const manifestPath = resolve(".output/chrome-mv3/manifest.json");
  const originalManifest = await readFile(manifestPath, "utf8");
  const mutations: readonly ["optional_permissions" | "optional_host_permissions", unknown][] = [
    ["optional_permissions", ["tabs"]],
    ["optional_host_permissions", ["<all_urls>"]],
  ];

  try {
    for (const [key, value] of mutations) {
      const manifest = JSON.parse(originalManifest) as BuiltManifest;
      manifest[key] = value;
      await writeFile(manifestPath, JSON.stringify(manifest));
      await expect(runCommand(process.execPath, ["scripts/audit-manifest.mjs"])).rejects.toThrow(
        `Manifest must not declare ${key} in Phase 4.`,
      );
    }
  } finally {
    await writeFile(manifestPath, originalManifest);
  }
});
