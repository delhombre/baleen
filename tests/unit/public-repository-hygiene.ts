import { execFileSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type TrackedBlob = {
  readonly path: string;
  readonly bytes: Uint8Array;
};

export type Finding = {
  readonly category: string;
  readonly line: number;
  readonly path: string;
};

type ContentPattern = {
  readonly category: string;
  readonly test: RegExp;
};

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const slash = String.fromCharCode(47);
const backslash = String.fromCharCode(92);

function escapeRegexLiteral(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

const slashPattern = escapeRegexLiteral(slash);
const backslashPattern = escapeRegexLiteral(backslash);
const pathSeparatorPattern = `(?:${slashPattern}|${backslashPattern})`;
const unixRoots = [
  "Users",
  "home",
  ["private", "tmp"].join(slash),
  ["private", "var"].join(slash),
  ["opt", "homebrew"].join(slash),
  "tmp",
  "var",
  "Volumes",
  "root",
  "mnt",
  "workspace",
  "workspaces",
];

const localPathPattern = new RegExp(
  [
    `(?<![A-Za-z0-9_.-])${slashPattern}(?:${unixRoots
      .map((root) => escapeRegexLiteral(root))
      .join("|")})${slashPattern}[^\\s"<>]+`,
    `(?<![A-Za-z0-9_.-])[A-Za-z]:${pathSeparatorPattern}[^\\s"<>]+`,
  ].join("|"),
  "u",
);

const openAiPrefix = ["s", "k", "-"].join("");
const anthropicPrefix = [openAiPrefix, "ant", "-"].join("");
const groqPrefix = ["g", "sk", "_"].join("");
const githubPrefix = ["g", "h"].join("");

const contentPatterns: readonly ContentPattern[] = [
  {
    category: "OpenAI key",
    test: new RegExp(
      `${escapeRegexLiteral(openAiPrefix)}(?:proj|live|test|svcacct)${escapeRegexLiteral("-")}[A-Za-z0-9_-]{16,}|${escapeRegexLiteral(openAiPrefix)}[A-Za-z0-9]{24,}`,
      "u",
    ),
  },
  {
    category: "Anthropic key",
    test: new RegExp(
      `${escapeRegexLiteral(anthropicPrefix)}(?:api[0-9]+${escapeRegexLiteral("-")})?[A-Za-z0-9_-]{16,}`,
      "u",
    ),
  },
  {
    category: "Groq key",
    test: new RegExp(`${escapeRegexLiteral(groqPrefix)}[A-Za-z0-9_-]{20,}`, "u"),
  },
  {
    category: "GitHub token",
    test: new RegExp(
      `${escapeRegexLiteral(githubPrefix)}[A-Za-z0-9]{1,4}_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}`,
      "u",
    ),
  },
  {
    category: "Google API key",
    test: new RegExp(["AIza", "[A-Za-z0-9_-]{30,}"].join(""), "u"),
  },
  {
    category: "AWS access key",
    test: new RegExp("(?:AKIA|ASIA)[A-Z0-9]{16}", "u"),
  },
  {
    category: "JWT",
    test: new RegExp("[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}", "u"),
  },
  {
    category: "Slack token",
    test: new RegExp(["xox", "[a-z]-[A-Za-z0-9-]{20,}"].join(""), "u"),
  },
  {
    category: "authorization token",
    test: new RegExp(
      ["(?:Authorization\\s*:\\s*)?", "(?:Bearer|Basic)\\s+", "[A-Za-z0-9._~+/=-]{24,}"].join(""),
      "iu",
    ),
  },
  {
    category: "private key",
    test: new RegExp(["-----BEGIN", "(?: [A-Z0-9]+)? PRIVATE KEY-----"].join(""), "u"),
  },
  {
    category: "email",
    test: new RegExp("[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}", "iu"),
  },
  {
    category: "local path",
    test: localPathPattern,
  },
  {
    category: "unicode dash",
    test: new RegExp("[" + String.fromCodePoint(0x2013, 0x2014) + "]", "u"),
  },
];

const sensitivePathPatterns: readonly RegExp[] = [
  new RegExp(`(?:^|${slashPattern})\\.env(?:\\..*)?$`, "iu"),
  new RegExp(
    `(?:^|${slashPattern})(?:\\.npmrc|\\.netrc|\\.pypirc|\\.git-credentials|id_(?:rsa|ed25519))$`,
    "iu",
  ),
  new RegExp(`(?:^|${slashPattern})[^${slash}]*credential[^${slash}]*$`, "iu"),
  new RegExp(`(?:^|${slashPattern})[^${slash}]*secret[^${slash}]*$`, "iu"),
  new RegExp(`(?:\\.(?:pem|key|p12|pfx|keystore)|keystore)$`, "iu"),
];

function decode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf8");
}

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function isSensitivePath(path: string): boolean {
  return sensitivePathPatterns.some((pattern) => pattern.test(path));
}

export function scanTrackedBlobs(blobs: readonly TrackedBlob[]): readonly Finding[] {
  const findings: Finding[] = [];

  for (const blob of blobs) {
    if (isSensitivePath(blob.path)) {
      findings.push({ category: "sensitive path", line: 1, path: blob.path });
    }

    const text = decode(blob.bytes);
    for (const { category, test } of contentPatterns) {
      const match = test.exec(text);
      if (match?.index !== undefined) {
        findings.push({ category, line: lineAt(text, match.index), path: blob.path });
      }
    }
  }

  return findings;
}

function trackedPaths(root: string): readonly string[] {
  return execFileSync("git", ["ls-tree", "-rz", "--name-only", "HEAD"], { cwd: root })
    .toString("utf8")
    .split("\0")
    .filter((path) => path.length > 0);
}

function trackedBlobs(root: string): readonly TrackedBlob[] {
  return trackedPaths(root).map((path) => ({
    path,
    bytes: execFileSync("git", ["show", `HEAD:${path}`], { cwd: root }),
  }));
}

export function scanTrackedTree(root: string = repositoryRoot): readonly Finding[] {
  return scanTrackedBlobs(trackedBlobs(root));
}
