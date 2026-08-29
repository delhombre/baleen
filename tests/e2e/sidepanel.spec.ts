import { chromium, type BrowserContext } from "playwright";
import { expect, test } from "playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type BuiltManifest = {
  side_panel?: {
    default_path?: unknown;
  };
  options_ui?: {
    page?: unknown;
  };
};

type ChromeSidePanelBehavior = {
  openPanelOnActionClick?: boolean;
};

type ChromeServiceWorkerGlobal = typeof globalThis & {
  chrome: {
    sidePanel: {
      getPanelBehavior(): Promise<ChromeSidePanelBehavior>;
    };
  };
};

function isHttpUrl(url: string) {
  const protocol = new URL(url).protocol;

  return protocol === "http:" || protocol === "https:";
}

test("opens the empty side panel while offline", async () => {
  const extensionPath = resolve(".output/chrome-mv3");
  const manifestPath = resolve(extensionPath, "manifest.json");
  const profilePath = await mkdtemp(join(tmpdir(), "baleen-e2e-profile-"));
  let context: BrowserContext | undefined;
  const unexpectedHttpRequests: string[] = [];

  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as BuiltManifest;
    const sidePanelPath = manifest.side_panel?.default_path;
    if (typeof sidePanelPath !== "string" || sidePanelPath.length === 0) {
      throw new Error("Built manifest has no side panel default path.");
    }

    context = await test.step("load the built extension in a unique profile", () =>
      chromium.launchPersistentContext(profilePath, {
        args: [
          "--no-sandbox",
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`,
        ],
        channel: "chromium",
        headless: true,
        offline: true,
      }));
    context.on("request", (request) => {
      const requestUrl = request.url();
      if (isHttpUrl(requestUrl)) {
        unexpectedHttpRequests.push(requestUrl);
      }
    });
    await context.route(/^https?:\/\//, (route) => route.abort("blockedbyclient"));

    const serviceWorker =
      context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    const extensionId = new URL(serviceWorker.url()).hostname;
    const sidePanelUrl = new URL(sidePanelPath, `chrome-extension://${extensionId}/`).toString();
    const page = await context.newPage();
    await page.goto(sidePanelUrl);

    await expect
      .poll(async () => {
        const panelBehavior = await serviceWorker.evaluate(async () => {
          const extensionGlobal = globalThis as ChromeServiceWorkerGlobal;

          return extensionGlobal.chrome.sidePanel.getPanelBehavior();
        });

        return panelBehavior.openPanelOnActionClick;
      })
      .toBe(true);

    await expect(page).toHaveURL(sidePanelUrl);
    await expect(page).toHaveTitle("Baleen");
    await expect(page.getByRole("heading", { name: "Aucune collection" })).toBeVisible();
    await expect(
      page.getByText("Créez une collection pour organiser vos fiches produit."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Capturer cette page produit" })).toHaveCount(0);

    const optionsPath = manifest.options_ui?.page;
    if (typeof optionsPath !== "string" || optionsPath.length === 0) {
      throw new Error("Built extension has no generated options page.");
    }
    const options = await context.newPage();
    await options.goto(new URL(optionsPath, `chrome-extension://${extensionId}/`).toString());
    await expect(options).toHaveTitle("Connexion au modèle : Baleen");
    await expect(options.getByRole("heading", { name: "Connexion au modèle" })).toBeVisible();
    await expect(options.getByRole("textbox", { name: "Clé API" })).toHaveAttribute(
      "type",
      "password",
    );
    await expect(options.getByRole("button", { name: "Enregistrer et vérifier" })).toBeVisible();
    await expect(options.getByRole("button", { name: "Tester la connexion" })).toHaveCount(0);
    await options.getByRole("button", { name: "Enregistrer et vérifier" }).click();
    await expect(options.getByRole("alert")).toContainText("Saisissez une clé API non vide.");
    expect(
      unexpectedHttpRequests,
      "No HTTP(S) request is allowed in the offline extension test.",
    ).toEqual([]);
  } finally {
    await context?.close();
    await rm(profilePath, { force: true, recursive: true });
  }
});
