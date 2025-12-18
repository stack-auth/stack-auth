import * as fs from "fs";
import * as path from "path";

export type ChangeType = "major" | "minor" | "patch";

export interface ChangelogEntry {
  version: string;
  package: string;
  type: ChangeType;
  markdown: string;
  bulletCount: number;
  bullets: { tags: string[] }[];
  releasedAt?: string;
  isUnreleased?: boolean;
  isSourceOfTruth?: boolean;
}

function parseTaggedBullet(line: string): { text: string; tags: string[] } {
  let content = line.replace(/^- /, "").trim();
  const tags: string[] = [];

  while (content.startsWith("[")) {
    const closingIndex = content.indexOf("]");
    if (closingIndex === -1) break;

    const tag = content.slice(1, closingIndex).trim();
    if (!tag) break;

    tags.push(tag);
    content = content.slice(closingIndex + 1).trim();
  }

  return { text: content, tags };
}

export function parseRootChangelog(rootDir: string): ChangelogEntry[] {
  const changelogPath = path.join(rootDir, "CHANGELOG.md");
  if (!fs.existsSync(changelogPath)) {
    return [];
  }

  const content = fs.readFileSync(changelogPath, "utf-8");
  const entries: ChangelogEntry[] = [];
  const sections = content.split(/(?=^## .+)/m);

  for (const section of sections) {
    if (!section.trim()) continue;

    const versionMatch = section.match(/^## (.+)/m);
    if (!versionMatch) continue;

    const heading = versionMatch[1].trim();
    const { version, releasedAt, isUnreleased } = parseVersionHeading(heading);
    const isSemver = /^\d+\.\d+\.\d+$/.test(version);

    if (!isUnreleased && !isSemver) {
      continue;
    }

    const versionContent = section.replace(/^## .+$/m, "").trim();

    let type: ChangeType = "patch";
    if (versionContent.includes("### Major Changes")) type = "major";
    else if (versionContent.includes("### Minor Changes")) type = "minor";

    const lines = versionContent.split("\n");
    const processedLines: string[] = [];
    const bulletMeta: { tags: string[] }[] = [];

    for (const line of lines) {
      if (line.trim().startsWith("- ")) {
        const { text, tags } = parseTaggedBullet(line);
        bulletMeta.push({ tags });
        processedLines.push(text ? `- ${text}` : "-");
      } else {
        processedLines.push(line);
      }
    }

    const normalizedMarkdown = processedLines.join("\n").trim();
    const bulletCount = bulletMeta.length;

    entries.push({
      version,
      package: "Stack Auth",
      type,
      markdown: normalizedMarkdown,
      bulletCount,
      bullets: bulletMeta,
      isUnreleased,
      releasedAt,
      isSourceOfTruth: true,
    });
  }

  return entries;
}

function parseVersionHeading(raw: string): { version: string; releasedAt?: string; isUnreleased: boolean } {
  const normalized = raw.trim();
  const isUnreleased = normalized.toLowerCase() === "unreleased";

  if (isUnreleased) {
    return { version: "Unreleased", isUnreleased: true };
  }

  const datePattern = /^(\d+\.\d+\.\d+)\s*(?:\(|-)\s*(\d{4}-\d{2}-\d{2})\)?$/;
  const match = normalized.match(datePattern);

  if (match) {
    return {
      version: match[1],
      releasedAt: match[2],
      isUnreleased: false,
    };
  }

  return {
    version: normalized,
    isUnreleased: false,
  };
}
