import { describe, expect, it } from "vitest";

import { scanTrackedBlobs, scanTrackedTree, type TrackedBlob } from "./public-repository-hygiene";

function blob(path: string, content: string): TrackedBlob {
  return { path, bytes: Buffer.from(content, "utf8") };
}

describe("public repository hygiene scanner", () => {
  it("reports credential-shaped values without exposing their contents", () => {
    const samples: readonly TrackedBlob[] = [
      blob("openai.txt", ["ok", ["s", "k", "-"].join("") + "A".repeat(24)].join("\n")),
      blob(
        "openai-project.txt",
        ["ok", ["s", "k", "-", "proj", "-", "A".repeat(24)].join("")].join("\n"),
      ),
      blob(
        "openai-live.txt",
        ["ok", ["s", "k", "-", "live", "-", "B".repeat(24)].join("")].join("\n"),
      ),
      blob("anthropic.txt", ["ok", ["sk", "ant", "api03", "A".repeat(18)].join("-")].join("\n")),
      blob("groq.txt", ["ok", ["gsk", "_", "A".repeat(24)].join("")].join("\n")),
      blob("github.txt", ["ok", ["gh", "p_", "A".repeat(24)].join("")].join("\n")),
      blob("google.txt", ["ok", ["AIza", "A".repeat(32)].join("")].join("\n")),
      blob("aws.txt", ["ok", ["AKIA", "A".repeat(16)].join("")].join("\n")),
      blob(
        "jwt.txt",
        ["ok", ["A".repeat(12), "B".repeat(12), "C".repeat(12)].join(".")].join("\n"),
      ),
      blob("slack.txt", ["ok", ["xox", "b-", "A".repeat(24)].join("")].join("\n")),
      blob(
        "authorization.txt",
        ["ok", ["Authorization", ": Bearer ", "A".repeat(32)].join("")].join("\n"),
      ),
      blob("bearer.txt", ["ok", ["Bearer", " ", "A".repeat(32)].join("")].join("\n")),
      blob("private-key.txt", ["ok", ["-----BEGIN ", "PRIVATE KEY-----"].join("")].join("\n")),
      blob("email.txt", ["ok", ["reviewer", "@", "example", ".", "test"].join("")].join("\n")),
      blob(
        "macos-path.txt",
        ["ok", ["/", "Users", "/", "analyst", "/", "project", "/", "file"].join("")].join("\n"),
      ),
      blob(
        "linux-path.txt",
        ["ok", ["/", "home", "/", "analyst", "/", "project", "/", "file"].join("")].join("\n"),
      ),
      blob(
        "private-var-path.txt",
        ["ok", ["/", "private", "/", "var", "/", "folders", "/", "file"].join("")].join("\n"),
      ),
      blob(
        "windows-path.txt",
        [
          "ok",
          ["C:", String.fromCharCode(92), "Users", String.fromCharCode(92), "analyst"].join(""),
        ].join("\n"),
      ),
      blob("unicode-dash.txt", ["ok", String.fromCodePoint(0x2013)].join("\n")),
    ];

    expect(scanTrackedBlobs(samples)).toEqual([
      { category: "OpenAI key", line: 2, path: "openai.txt" },
      { category: "OpenAI key", line: 2, path: "openai-project.txt" },
      { category: "OpenAI key", line: 2, path: "openai-live.txt" },
      { category: "Anthropic key", line: 2, path: "anthropic.txt" },
      { category: "Groq key", line: 2, path: "groq.txt" },
      { category: "GitHub token", line: 2, path: "github.txt" },
      { category: "Google API key", line: 2, path: "google.txt" },
      { category: "AWS access key", line: 2, path: "aws.txt" },
      { category: "JWT", line: 2, path: "jwt.txt" },
      { category: "Slack token", line: 2, path: "slack.txt" },
      { category: "authorization token", line: 2, path: "authorization.txt" },
      { category: "authorization token", line: 2, path: "bearer.txt" },
      { category: "private key", line: 2, path: "private-key.txt" },
      { category: "email", line: 2, path: "email.txt" },
      { category: "local path", line: 2, path: "macos-path.txt" },
      { category: "local path", line: 2, path: "linux-path.txt" },
      { category: "local path", line: 2, path: "private-var-path.txt" },
      { category: "local path", line: 2, path: "windows-path.txt" },
      { category: "unicode dash", line: 2, path: "unicode-dash.txt" },
    ]);
  });

  it("reports risky tracked filenames", () => {
    const paths = [
      ".env",
      [".env", "local"].join("."),
      "credentials.json",
      "secrets.txt",
      "provider.pem",
      "backup.key",
      "profile.p12",
      ".npmrc",
      ".netrc",
      ".pypirc",
      ".git-credentials",
      "id_rsa",
      "id_ed25519",
      "provider.pfx",
      "test.keystore",
    ];

    expect(scanTrackedBlobs(paths.map((path) => blob(path, "safe")))).toEqual(
      paths.map((path) => ({ category: "sensitive path", line: 1, path })),
    );
  });

  it("does not report ordinary documentation or binary bytes", () => {
    const cleanText = blob("README.md", "Use the provider documentation and local fixtures.");
    const binary: TrackedBlob = { path: "image.bin", bytes: Uint8Array.from([0, 255, 1, 2]) };

    expect(scanTrackedBlobs([cleanText, binary])).toEqual([]);
  });

  it("inspects binary blobs for ASCII credential signatures", () => {
    const token = ["gsk", "_", "A".repeat(24)].join("");
    const bytes = Uint8Array.from([0, ...Buffer.from(token, "ascii"), 255]);

    expect(scanTrackedBlobs([{ path: "payload.bin", bytes }])).toEqual([
      { category: "Groq key", line: 1, path: "payload.bin" },
    ]);
  });

  it("scans the tracked HEAD tree rather than the working directory", () => {
    expect(scanTrackedTree()).toEqual([]);
  });
});
