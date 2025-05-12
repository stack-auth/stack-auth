import { isTruthy } from "@stackframe/stack-shared/dist/utils/booleans";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { numberCompare } from "@stackframe/stack-shared/dist/utils/numbers";


// SmartRouter may be imported on the edge, so we can't import fs at the top level
// hence, we define some wrapper functions
const listRecursively: typeof import("@stackframe/stack-shared/dist/utils/fs").listRecursively = async (...args) => {
  // SmartRouter may be imported on the edge, so we can't import fs at the top level
  // hence, this wrapper function
  const m = await import("@stackframe/stack-shared/dist/utils/fs");
  return await m.listRecursively(...args);
};
const readFile = async (path: string) => {
  const fs = await import("fs");
  return await fs.promises.readFile(path, "utf-8");
};


export const SmartRouter = {
  listRoutes: async () => {
    const routePaths = await listRecursively("src/app", { excludeDirectories: true });
    const res = [];
    for (const path of routePaths) {
      const isRoute = !!path.match(/route\.[^/]+$/);
      const isPage = !!path.match(/page\.[^/]+$/);
      if (!isRoute && !isPage) {
        continue;
      }
      const normalizedPath = normalizeAppPath(path.replace("src/app", ""));
      if (normalizedPath.includes("/_")) {
        continue;
      }

      res.push({
        filePath: path,
        normalizedPath,
        match: (path: string) => matchPath(path, normalizedPath),
        isRoute,
        isPage,
      });
    }
    return res;
  },

  listApiVersions: async () => {
    const allFiles = await listRecursively("src/app/api/migrations", { excludeDirectories: true });
    return await Promise.all([
      "v1",
      ...new Set(
        allFiles.map((path) => path.match(/src\/app\/api\/migrations\/(v[^/]+)/)?.[1])
          .filter(isTruthy)
          .sort((a, b) => {
            const parsedA = parseApiVersionStringToArray(a!);
            const parsedB = parseApiVersionStringToArray(b!);
            return numberCompare(parsedA[0], parsedB[0]) * 2 + numberCompare(parsedA[1], parsedB[1]);
          })
      ),
      "latest",
    ].map(async (version) => {
      if (version === "latest") {
        return {
          name: version,
          changes: undefined,
          betaChanges: undefined,
          migrationFolder: "/api/latest",
          servedRoute: "/api/latest",
        } as const;
      } else if (version === "v1") {
        return {
          name: version,
          changes: "Initial release.\n",
          betaChanges: "Initial release.\n",
          migrationFolder: undefined,
          servedRoute: "/api/v1",
        } as const;
      } else {
        if (!allFiles.includes(`src/app/api/migrations/${version}/beta-changes.txt`)) {
          throw new StackAssertionError(`API version ${version} does not have a beta-changes.txt file. The beta-changes.txt file should contain the changes since the last beta release.`);
        }
        if (!version.includes("beta") && !allFiles.includes(`src/app/api/migrations/${version}/changes.txt`)) {
          throw new StackAssertionError(`API version ${version} does not have a changes.txt file. The changes.txt file should contain the changes since the last full (non-beta) release.`);
        }
        return {
          name: version,
          changes: !version.includes("beta") ? await readFile(`src/app/api/migrations/${version}/changes.txt`) : undefined,
          betaChanges: await readFile(`src/app/api/migrations/${version}/beta-changes.txt`),
          migrationFolder: `/api/migrations/${version}`,
          servedRoute: `/api/${version}`,
        };
      }
    }));
  },

  matchNormalizedPath: (path: string, normalizedPath: string) => matchPath(path, normalizedPath),
};

function parseApiVersionStringToArray(version: string): [number, number] {
  const matchResult = version.match(/^v(\d+)(?:beta(\d+))?$/);
  if (!matchResult) throw new StackAssertionError(`Invalid API version string: ${version}`);
  return [+matchResult[1], matchResult[2] === "" ? Number.POSITIVE_INFINITY : +matchResult[2]];
}


function matchPath(path: string, toMatchWith: string): Record<string, string | string[]> | false {
  // get the relative part, and modify it to have a leading slash, without a trailing slash, without ./.., etc.
  const url = new URL(path + "/", "http://example.com");
  const modifiedPath = url.pathname.slice(1, -1);
  const modifiedToMatchWith = toMatchWith.slice(1);

  if (modifiedPath === "" && modifiedToMatchWith === "") {
    return {};
  }

  const pathFirst = modifiedPath.split("/")[0];
  const toMatchWithFirst = modifiedToMatchWith.split("/")[0];
  const recurse = () => matchPath(modifiedPath.slice((modifiedPath + "/").indexOf("/")), modifiedToMatchWith.slice((modifiedToMatchWith + "/").indexOf("/")));

  if (toMatchWithFirst.startsWith("[[...") && toMatchWithFirst.endsWith("]]")) {
    if (modifiedToMatchWith.includes("/")) {
      throw new StackAssertionError("Optional catch-all routes must be at the end of the path", { modifiedPath, modifiedToMatchWith });
    }
    return {
      [toMatchWithFirst.slice(5, -2)]: modifiedPath === "" ? [] : modifiedPath.split("/"),
    };
  } else if (toMatchWithFirst.startsWith("[...") && toMatchWithFirst.endsWith("]")) {
    if (modifiedToMatchWith.includes("/")) {
      throw new StackAssertionError("Catch-all routes must be at the end of the path", { modifiedPath, modifiedToMatchWith });
    }
    if (modifiedPath === "") return false;
    return {
      [toMatchWithFirst.slice(4, -1)]: modifiedPath.split("/"),
    };
  } else if (toMatchWithFirst.startsWith("[") && toMatchWithFirst.endsWith("]")) {
    if (modifiedPath === "") return false;
    const recurseResult = recurse();
    if (!recurseResult) return false;
    return {
      [toMatchWithFirst.slice(1, -1)]: pathFirst,
      ...recurseResult,
    };
  } else if (toMatchWithFirst === pathFirst) {
    return recurse();
  } else {
    return false;
  }
}

/**
 * Modified from: https://github.com/vercel/next.js/blob/6ff13369bb18045657d0f84ddc86b540340603a1/packages/next/src/shared/lib/router/utils/app-paths.ts#L23
 */
function normalizeAppPath(route: string) {
  let res = route.split('/').reduce((pathname, segment, index, segments) => {
    // Empty segments are ignored.
    if (!segment) {
      return pathname;
    }

    // Groups are ignored.
    if (segment.startsWith('(') && segment.endsWith(')')) {
      return pathname;
    }

    // Parallel segments are ignored.
    if (segment[0] === '@') {
      return pathname;
    }

    // The last segment (if it's a leaf) should be ignored.
    if (
      (segment.startsWith('page.') || segment.startsWith('route.')) &&
      index === segments.length - 1
    ) {
      return pathname;
    }

    return `${pathname}/${segment}`;
  }, '');

  if (!res.startsWith('/')) {
    res = `/${res}`;
  }
  return res;
}
