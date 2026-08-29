import { readFile, rm, mkdtemp } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { chromium, type BrowserContext, type Page } from "playwright";
import { expect, test } from "playwright/test";

const fixtureNames = [
  "airfryer-jsonld.html",
  "espresso-jsonld-partial.html",
  "vacuum-no-jsonld.html",
] as const;

function isLoopbackUrl(url: string): boolean {
  const parsed = new URL(url);
  return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
}

function isHttpUrl(url: string): boolean {
  const protocol = new URL(url).protocol;
  return protocol === "http:" || protocol === "https:";
}

async function startFixtureServer(): Promise<{
  readonly baseUrl: string;
  readonly requests: string[];
  readonly server: Server;
}> {
  const requests: string[] = [];
  const fixtureDirectory = resolve("fixtures");
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    requests.push(`${request.method ?? "GET"} ${requestUrl.pathname}`);
    const fixtureName = requestUrl.pathname.slice(1);
    if (
      request.method !== "GET" ||
      requestUrl.search.length > 0 ||
      !fixtureNames.includes(fixtureName as (typeof fixtureNames)[number])
    ) {
      response.writeHead(404).end();
      return;
    }

    try {
      const html = await readFile(join(fixtureDirectory, fixtureName), "utf8");
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
    } catch {
      response.writeHead(500).end();
    }
  });

  await new Promise<void>((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveServer);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await new Promise<void>((resolveServer) => server.close(() => resolveServer()));
    throw new Error("Fixture server did not expose a TCP address.");
  }
  return {
    baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}`,
    requests,
    server,
  };
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolveServer) => server.close(() => resolveServer()));
}

async function openPanel(context: BrowserContext, page: Page): Promise<Page> {
  const serviceWorker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(serviceWorker.url()).hostname;
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel).toHaveTitle("Baleen");
  await expect(panel.getByRole("heading", { name: "Collections" })).toBeVisible();
  await page.bringToFront();
  return panel;
}

async function createTwoCollections(panel: Page): Promise<void> {
  await panel.getByLabel("Nom de la collection").fill("Air fryers");
  await panel.getByRole("button", { name: "Créer la collection" }).click();
  await expect(panel.getByRole("option", { name: "Air fryers (0 fiches)" })).toHaveCount(1);
  await panel.locator("summary").filter({ hasText: "Gérer les collections" }).click();
  await panel.getByLabel("Nom de la collection").fill("Espresso");
  await panel.getByRole("button", { name: "Créer la collection" }).click();
  await expect(panel.getByRole("option", { name: "Espresso (0 fiches)" })).toHaveCount(1);
}

async function setAnthropicKey(panel: Page): Promise<void> {
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
      "baleen.llmProvider.v1": "anthropic",
      "baleen.anthropicApiKey.v1": "offline-e2e-key",
    });
  });
}

test("persists three fixture products and exposes an explicit comparison", async () => {
  const { baseUrl, requests, server } = await startFixtureServer();
  const extensionPath = resolve(".output/chrome-mv3");
  const profilePath = await mkdtemp(join(tmpdir(), "baleen-collections-e2e-profile-"));
  let context: BrowserContext | undefined;
  const externalRequests: string[] = [];
  let anthropicRequests = 0;
  const selections = [
    {
      version: 1,
      name: "e1",
      brand: "e2",
      price: null,
      category: null,
      specs: [],
      pros: [],
      cons: [],
    },
    {
      version: 1,
      name: "e1",
      brand: "e2",
      price: null,
      category: null,
      specs: [],
      pros: [],
      cons: [],
    },
    {
      version: 1,
      name: "e1",
      brand: null,
      price: null,
      category: null,
      specs: ["e3"],
      pros: [],
      cons: [],
    },
  ] as const;

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
      if (requestUrl === "https://api.anthropic.com/v1/messages") {
        const selection = selections[anthropicRequests];
        anthropicRequests += 1;
        if (selection === undefined) {
          await route.abort("failed");
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            content: [{ type: "text", text: JSON.stringify(selection) }],
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
    const panel = await openPanel(context, page);
    await expect(panel.getByRole("heading", { name: "Aucune collection" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Capturer cette page produit" })).toHaveCount(0);

    await panel.getByLabel("Nom de la collection").fill("Air fryers janvier");
    await panel.getByRole("button", { name: "Créer la collection" }).click();
    await panel.locator("summary").filter({ hasText: "Gérer les collections" }).click();
    await expect(panel.getByRole("combobox", { name: "Collection courante" })).toBeVisible();
    await panel.evaluate(async () => {
      const extensionGlobal = globalThis as typeof globalThis & {
        chrome: { storage: { local: { set(items: { apiKey: string }): Promise<void> } } };
      };
      await extensionGlobal.chrome.storage.local.set({ apiKey: "offline-e2e-key" });
    });

    const airfryerUrl = `${baseUrl}/airfryer-jsonld.html`;
    await page.goto(airfryerUrl);
    await page.bringToFront();
    await panel.getByRole("button", { name: "Capturer cette page produit" }).click();
    await expect(panel.getByRole("heading", { name: "CrispWave Air Fryer 5.5L" })).toBeVisible();
    await expect(panel.getByText("Fiche ajoutée à « Air fryers janvier ».")).toBeVisible();

    const espressoUrl = `${baseUrl}/espresso-jsonld-partial.html`;
    await page.goto(espressoUrl);
    await page.bringToFront();
    await panel.getByRole("button", { name: "Capturer cette page produit" }).click();
    await expect(
      panel.getByRole("heading", { name: "Barista Mini Espresso Machine" }),
    ).toBeVisible();

    const vacuumUrl = `${baseUrl}/vacuum-no-jsonld.html`;
    await page.goto(vacuumUrl);
    await page.bringToFront();
    await panel.getByRole("button", { name: "Capturer cette page produit" }).click();
    await expect(
      panel.getByRole("heading", { name: "Northstar QuietClean Cordless Vacuum" }),
    ).toBeVisible();
    expect(anthropicRequests).toBe(3);

    await panel.reload();
    await expect(panel.getByRole("heading", { name: "CrispWave Air Fryer 5.5L" })).toBeVisible();
    await expect(
      panel.getByRole("heading", { name: "Barista Mini Espresso Machine" }),
    ).toBeVisible();
    await expect(
      panel.getByRole("heading", { name: "Northstar QuietClean Cordless Vacuum" }),
    ).toBeVisible();
    const comparisonToggle = panel.getByRole("button", { name: "Comparaison" });
    await expect(comparisonToggle).toHaveAttribute("aria-pressed", "false");
    await comparisonToggle.click();
    await expect(comparisonToggle).toHaveAttribute("aria-pressed", "true");
    await expect(
      panel.getByRole("table", { name: "Comparaison des fiches produit" }),
    ).toBeVisible();
    await expect(panel.getByRole("table").locator("thead th")).toHaveCount(4);
    await expect(
      panel.getByRole("table").getByText("Battery runtime", { exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByRole("table").getByText("unknown", { exact: true }).first(),
    ).toBeVisible();

    const listToggle = panel.getByRole("button", { name: "Liste" });
    await expect(listToggle).toHaveAttribute("aria-pressed", "false");
    await listToggle.click();
    await expect(listToggle).toHaveAttribute("aria-pressed", "true");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await panel.getByRole("button", { name: "Copier l’export" }).click();
    await expect(panel.getByText("Export copié dans le presse-papiers.")).toBeVisible();
    const copiedMarkdown = await panel.evaluate(async () => navigator.clipboard.readText());
    expect(copiedMarkdown).toContain("# Air fryers janvier");
    expect(copiedMarkdown).toContain("Source URL");
    expect(copiedMarkdown).toContain(`${baseUrl}/airfryer-jsonld.html`);
    expect(copiedMarkdown).toContain("Page title");
    expect(copiedMarkdown).toContain("Captured at");
    expect(copiedMarkdown).toContain("Extraction method");
    expect(copiedMarkdown).toContain("Extraction model");
    expect(copiedMarkdown).toContain("json-ld");
    expect(copiedMarkdown).toContain("claude-sonnet-4-6");
    expect(copiedMarkdown).toContain("unknown");

    await panel.getByLabel("Format d’export").selectOption("csv");
    const downloadPromise = panel.waitForEvent("download");
    await panel.getByRole("button", { name: "Télécharger l’export" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("air-fryers-janvier.csv");
    const downloadedPath = await download.path();
    if (downloadedPath === null) {
      throw new Error("The export download did not expose a local path.");
    }
    const downloadedCsv = await readFile(downloadedPath, "utf8");
    expect(downloadedCsv).toContain("collection_name,id,name,brand,price_amount");
    expect(downloadedCsv).toContain(`${baseUrl}/airfryer-jsonld.html`);
    expect(downloadedCsv).toContain("CrispWave Air Fryer 5.5L | Shop Harbor");
    expect(downloadedCsv).toContain("unknown");
    expect(externalRequests).toEqual([]);
    expect(requests).toEqual([
      "GET /airfryer-jsonld.html",
      "GET /espresso-jsonld-partial.html",
      "GET /vacuum-no-jsonld.html",
    ]);
    expect(airfryerUrl).toContain(baseUrl);
    expect(espressoUrl).toContain(baseUrl);
    expect(vacuumUrl).toContain(baseUrl);
  } finally {
    await context?.close();
    await closeServer(server);
    await rm(profilePath, { force: true, recursive: true });
  }
});

test("locks selection while capture is pending and keeps the frozen target", async () => {
  const { baseUrl, requests, server } = await startFixtureServer();
  const extensionPath = resolve(".output/chrome-mv3");
  const profilePath = await mkdtemp(join(tmpdir(), "baleen-collection-target-e2e-profile-"));
  let context: BrowserContext | undefined;
  let releaseResponse: (() => void) | undefined;
  let resolveRequest: (() => void) | undefined;
  const responseGate = new Promise<void>((resolveResponse) => {
    releaseResponse = resolveResponse;
  });
  const requestSeen = new Promise<void>((resolveSeen) => {
    resolveRequest = resolveSeen;
  });
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
      if (requestUrl === "https://api.anthropic.com/v1/messages") {
        resolveRequest?.();
        await responseGate;
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
                  brand: "e2",
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
    await page.goto(`${baseUrl}/airfryer-jsonld.html`);
    const panel = await openPanel(context, page);
    await expect(panel.getByRole("heading", { name: "Aucune collection" })).toBeVisible();
    await createTwoCollections(panel);
    await setAnthropicKey(panel);
    await page.bringToFront();
    await panel.getByRole("button", { name: "Capturer cette page produit" }).click();
    await requestSeen;

    const selector = panel.getByRole("combobox", { name: "Collection courante" });
    await expect(selector).toBeDisabled();
    await expect(
      panel.getByRole("button", { name: "Renommer la collection Air fryers" }),
    ).toBeDisabled();
    await expect(
      panel.getByRole("button", { name: "Supprimer la collection Air fryers" }),
    ).toBeDisabled();
    releaseResponse?.();
    await expect(panel.getByText("Fiche ajoutée à « Air fryers ».")).toBeVisible();

    await expect(selector).toBeEnabled();
    await expect(selector.locator("option:checked")).toHaveText("Air fryers (1 fiche)");
    await expect(panel.getByRole("heading", { name: "CrispWave Air Fryer 5.5L" })).toBeVisible();
    await expect(panel.getByRole("option", { name: "Espresso (0 fiches)" })).toHaveCount(1);
    expect(externalRequests).toEqual([]);
    expect(requests).toEqual(["GET /airfryer-jsonld.html"]);
  } finally {
    releaseResponse?.();
    await context?.close();
    await closeServer(server);
    await rm(profilePath, { force: true, recursive: true });
  }
});

test("locks collection deletion while capture is pending and keeps the target", async () => {
  const { baseUrl, requests, server } = await startFixtureServer();
  const extensionPath = resolve(".output/chrome-mv3");
  const profilePath = await mkdtemp(join(tmpdir(), "baleen-deleted-target-e2e-profile-"));
  let context: BrowserContext | undefined;
  let releaseResponse: (() => void) | undefined;
  let resolveRequest: (() => void) | undefined;
  const responseGate = new Promise<void>((resolveResponse) => {
    releaseResponse = resolveResponse;
  });
  const requestSeen = new Promise<void>((resolveSeen) => {
    resolveRequest = resolveSeen;
  });
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
      if (requestUrl === "https://api.anthropic.com/v1/messages") {
        resolveRequest?.();
        await responseGate;
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
                  brand: "e2",
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
    await page.goto(`${baseUrl}/airfryer-jsonld.html`);
    const panel = await openPanel(context, page);
    await expect(panel.getByRole("heading", { name: "Aucune collection" })).toBeVisible();
    await createTwoCollections(panel);
    await setAnthropicKey(panel);
    await page.bringToFront();
    await panel.getByRole("button", { name: "Capturer cette page produit" }).click();
    await requestSeen;

    const firstCollection = panel.locator("li").filter({ hasText: "Air fryers" });
    const deleteButton = firstCollection.getByRole("button", {
      name: "Supprimer la collection Air fryers",
    });
    await expect(deleteButton).toBeDisabled();
    await expect(
      firstCollection.getByRole("button", { name: "Confirmer la suppression" }),
    ).toHaveCount(0);
    releaseResponse?.();

    await expect(panel.getByText("Fiche ajoutée à « Air fryers ».")).toBeVisible();
    await expect(panel.getByRole("option", { name: "Espresso (0 fiches)" })).toHaveCount(1);
    await expect(panel.getByRole("heading", { name: "CrispWave Air Fryer 5.5L" })).toBeVisible();
    expect(externalRequests).toEqual([]);
    expect(requests).toEqual(["GET /airfryer-jsonld.html"]);
  } finally {
    releaseResponse?.();
    await context?.close();
    await closeServer(server);
    await rm(profilePath, { force: true, recursive: true });
  }
});
