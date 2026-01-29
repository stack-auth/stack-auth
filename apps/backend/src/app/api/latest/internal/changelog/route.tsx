import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupArray, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";

const REVALIDATE_SECONDS = 60 * 60;

type ChangeType = "major" | "minor" | "patch";

type ChangelogEntry = {
  version: string,
  type: ChangeType,
  markdown: string,
  bulletCount: number,
  releasedAt?: string,
  isUnreleased?: boolean,
};

type TaggedBullet = { text: string, tags: string[] };

function parseTaggedBullet(line: string): TaggedBullet {
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

function parseVersionHeading(raw: string): { version: string, releasedAt?: string, isUnreleased: boolean } {
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

function parseRootChangelog(markdown: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  const sections = markdown.split(/(?=^## .+)/m);

  for (const section of sections) {
    if (!section.trim()) continue;

    const versionMatch = section.match(/^## (.+)/m);
    if (!versionMatch) continue;

    const heading = versionMatch[1].trim();
    const { version, releasedAt, isUnreleased } = parseVersionHeading(heading);
    const isSemver = /^\d+\.\d+\.\d+$/.test(version);
    const isCalVer = /^\d{4}\.\d{2}\.\d{2}$/.test(version);

    if (!isUnreleased && !isSemver && !isCalVer) {
      continue;
    }

    const versionContent = section.replace(/^## .+$/m, "").trim();

    let type: ChangeType = "patch";
    if (versionContent.includes("### Major Changes")) type = "major";
    else if (versionContent.includes("### Minor Changes")) type = "minor";

    const lines = versionContent.split("\n");
    const processedLines: string[] = [];

    for (const line of lines) {
      if (line.trim().startsWith("- ")) {
        const { text } = parseTaggedBullet(line);
        processedLines.push(text ? `- ${text}` : "-");
      } else {
        processedLines.push(line);
      }
    }

    const normalizedMarkdown = processedLines.join("\n").trim();
    const bulletCount = processedLines.filter(l => l.trim().startsWith("-")).length;

    entries.push({
      version,
      type,
      markdown: normalizedMarkdown,
      bulletCount,
      isUnreleased,
      releasedAt,
    });
  }

  return entries;
}

const changelogEntrySchema = yupObject({
  version: yupString().defined(),
  type: yupString().oneOf(["major", "minor", "patch"]).defined(),
  markdown: yupString().defined(),
  bulletCount: yupNumber().defined(),
  releasedAt: yupString().optional(),
  isUnreleased: yupBoolean().optional(),
}).defined();

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    method: yupString().oneOf(["GET"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200, 502]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      entries: yupArray(changelogEntrySchema).optional(),
      error: yupString().optional(),
    }).defined(),
  }),
  handler: async () => {
    const changelogUrl = getEnvVariable("STACK_CHANGELOG_URL", "");

    if (!changelogUrl) {
      return {
        statusCode: 200,
        bodyType: "json",
        body: { entries: [] },
      } as const;
    }

    const response = await fetch(changelogUrl, {
      headers: {
        "Accept": "text/plain",
        "User-Agent": "stack-auth-backend-changelog",
      },
      next: {
        revalidate: REVALIDATE_SECONDS,
      },
    });

    if (!response.ok) {
      return {
        statusCode: 502,
        bodyType: "json",
        body: { error: "Failed to download changelog" },
      } as const;
    }

    const content = await response.text();
    const entries = parseRootChangelog(content).slice(0, 8);

    return {
      statusCode: 200,
      bodyType: "json",
      body: { entries },
    } as const;
  },
});

