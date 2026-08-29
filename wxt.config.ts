import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    action: {},
    description: "Filtrez les pages produit et gardez les données utiles.",
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'self'; connect-src https://api.anthropic.com https://api.groq.com",
    },
    host_permissions: ["https://api.anthropic.com/*", "https://api.groq.com/*"],
    name: "Baleen",
    permissions: ["sidePanel", "storage", "clipboardWrite"],
    side_panel: {
      default_path: "sidepanel.html",
    },
    version: "0.0.1",
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
