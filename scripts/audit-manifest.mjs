import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const manifestPath = resolve(".output/chrome-mv3/manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

if (manifest.manifest_version !== 3) {
  throw new Error("Manifest must declare manifest_version 3.");
}

const requiredSidePanelPath = manifest.side_panel?.default_path;
if (typeof requiredSidePanelPath !== "string" || requiredSidePanelPath.length === 0) {
  throw new Error("Manifest must declare side_panel.default_path.");
}

if (typeof manifest.action !== "object" || manifest.action === null) {
  throw new Error("Manifest must declare an action.");
}

if (
  !Array.isArray(manifest.permissions) ||
  manifest.permissions.length !== 3 ||
  manifest.permissions[0] !== "sidePanel" ||
  manifest.permissions[1] !== "storage" ||
  manifest.permissions[2] !== "clipboardWrite"
) {
  throw new Error(
    "Manifest must contain exactly sidePanel, storage, and clipboardWrite permissions in Phase 4.",
  );
}

if (
  typeof manifest.background !== "object" ||
  manifest.background === null ||
  typeof manifest.background.service_worker !== "string"
) {
  throw new Error("Manifest must declare a local background service worker for E2E discovery.");
}

if (
  !Array.isArray(manifest.host_permissions) ||
  manifest.host_permissions.length !== 2 ||
  manifest.host_permissions[0] !== "https://api.anthropic.com/*" ||
  manifest.host_permissions[1] !== "https://api.groq.com/*"
) {
  throw new Error("Manifest must contain only the Anthropic and Groq API host permissions.");
}

if (
  typeof manifest.content_security_policy !== "object" ||
  manifest.content_security_policy === null ||
  manifest.content_security_policy.extension_pages !==
    "script-src 'self'; object-src 'self'; connect-src https://api.anthropic.com https://api.groq.com"
) {
  throw new Error("Manifest must declare the exact provider extension CSP.");
}

const forbiddenKeys = [
  "optional_host_permissions",
  "optional_permissions",
  "web_accessible_resources",
];
for (const key of forbiddenKeys) {
  if (key in manifest) {
    throw new Error(`Manifest must not declare ${key} in Phase 4.`);
  }
}

if (!Array.isArray(manifest.content_scripts) || manifest.content_scripts.length !== 1) {
  throw new Error("Manifest must declare exactly one content script in Phase 1.");
}

const [contentScript] = manifest.content_scripts;
if (typeof contentScript !== "object" || contentScript === null || Array.isArray(contentScript)) {
  throw new Error("Manifest content script must be an object.");
}

const expectedContentScriptKeys = ["all_frames", "js", "matches", "run_at", "world"];
const actualContentScriptKeys = Object.keys(contentScript).sort();
const sortedExpectedContentScriptKeys = [...expectedContentScriptKeys].sort();
if (
  actualContentScriptKeys.length !== sortedExpectedContentScriptKeys.length ||
  actualContentScriptKeys.some((key, index) => key !== sortedExpectedContentScriptKeys[index])
) {
  throw new Error("Manifest content script must declare exact keys.");
}

const matches = contentScript.matches;
if (
  !Array.isArray(matches) ||
  matches.length !== 2 ||
  matches[0] !== "http://*/*" ||
  matches[1] !== "https://*/*"
) {
  throw new Error("Manifest content script must match only HTTP and HTTPS pages.");
}

if (
  contentScript.all_frames !== false ||
  contentScript.run_at !== "document_idle" ||
  contentScript.world !== "ISOLATED" ||
  !Array.isArray(contentScript.js) ||
  contentScript.js.length !== 1 ||
  contentScript.js[0] !== "content-scripts/content.js"
) {
  throw new Error("Manifest content script must be isolated, idle, top-frame and local.");
}
