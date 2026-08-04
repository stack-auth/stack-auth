import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { getInternalUser } from "../lib/app.js";
import { isProjectAuthWithSecretServerKey, resolveAuth, resolveProjectId, type ProjectAuth } from "../lib/auth.js";
import { AuthError, CliError } from "../lib/errors.js";
import {
  appendDebugIdSnippet,
  collectArtifacts,
  deriveDebugId,
  determineDebugIdFromBundleSource,
  findIntegrityManifests,
  findNextBuildRoots,
  NEXT_SERVER_SOURCE_MAPS_CONFIG_HINT,
  prepareSourceMapForUpload,
  readInlineSourceMap,
  sha256Hex,
  type SourceMapArtifactCandidate,
} from "../lib/source-maps.js";

export type SourceMapsUploadOptions = {
  release?: string,
  environment?: string,
  deleteMaps?: boolean,
  dryRun?: boolean,
  strict?: boolean,
  cloudProjectId?: string,
};

/** One bundle + map pair, injected and ready to hand to the upload step. */
export type PreparedSourceMapArtifact = {
  debugId: string,
  /** Absolute path of the bundle on disk (local logging only — never uploaded). */
  bundlePath: string,
  /** Scan-dir-relative bundle path. This is what we print, so CI paths stay local. */
  bundleRelativePath: string,
  /** The `.map` on disk this artifact came from, or null for an inline map. */
  sourceMapPath: string | null,
  /** sha256 of the prepared (uncompressed) source map JSON. Also the storage key. */
  sourceMapSha256: string,
  /** The prepared map, gzipped — maps compress 5-10x and CI uplinks are slow. */
  sourceMapGzipped: Uint8Array,
  /** Byte length of the prepared map BEFORE compression (what quota is charged on). */
  sourceMapBytes: number,
};

export type SourceMapUploadRequest = {
  auth: ProjectAuth,
  getAuthHeaders: () => Promise<Record<string, string>>,
  release: string | null,
  environment: string | null,
  artifacts: readonly PreparedSourceMapArtifact[],
};

export type SourceMapUploadResult = {
  /** Debug ids the server stored during this run. */
  uploaded: readonly string[],
  /** Debug ids the server already had (a derived id that did not change). */
  alreadyUploaded: readonly string[],
  /**
   * True when the backend has no object storage configured (self-hosters). The
   * caller warns and exits 0 unless --strict: a self-hoster's CI must not fail
   * over an optional feature.
   */
  storageNotConfigured: boolean,
};

/**
 * The single network step of this command: create the artifact rows, PUT the
 * gzipped maps to the presigned URLs, and finalize.
 *
 * Not implemented here on purpose — the two-phase upload endpoints
 * (`/source-maps/artifacts` + finalize) and their quota accounting are owned by
 * the backend track. Everything up to and including artifact preparation
 * already runs end-to-end under `--dry-run`.
 */
export async function uploadPreparedSourceMaps(request: SourceMapUploadRequest): Promise<SourceMapUploadResult> {
  throw new CliError(`not yet implemented: the source map upload endpoints are not available yet (${request.artifacts.length} artifact(s) were prepared). Re-run with --dry-run to prepare them locally.`);
}

// Same factory-not-a-fixed-object rationale as `hexclave deploy`: an upload run
// can span minutes and the refresh-token path's access token may expire
// mid-flow, so headers are rebuilt per request.
async function buildAuthHeadersFactory(auth: ProjectAuth): Promise<() => Promise<Record<string, string>>> {
  if (isProjectAuthWithSecretServerKey(auth)) {
    const headers = {
      "x-stack-access-type": "server",
      "x-stack-project-id": auth.projectId,
      "x-stack-secret-server-key": auth.secretServerKey,
    };
    return () => Promise.resolve(headers);
  }
  const user = await getInternalUser(auth);
  return async () => {
    const { accessToken } = await user.currentSession.getTokens();
    if (accessToken == null) {
      throw new AuthError("Could not obtain an access token. Run `hexclave login` again.");
    }
    return {
      "x-stack-access-type": "admin",
      "x-stack-project-id": auth.projectId,
      "x-stack-admin-access-token": accessToken,
    };
  };
}

function resolveScanDirs(dirs: readonly string[], cwd: string): string[] {
  if (dirs.length === 0) {
    throw new CliError("Pass at least one build output directory, e.g. `hexclave sourcemaps upload .next`.");
  }
  return dirs.map((dir) => {
    const resolved = path.resolve(cwd, dir);
    const stat = fs.statSync(resolved, { throwIfNoEntry: false });
    if (stat === undefined || !stat.isDirectory()) {
      throw new CliError(`Build output directory not found: ${resolved}`);
    }
    return resolved;
  });
}

export type PreparationResult = {
  artifacts: PreparedSourceMapArtifact[],
  /** Human-readable warnings; `--strict` turns a non-empty list into exit code 1. */
  warnings: string[],
  /** Bundles that were injected but had no map, split out so the hint can be specific. */
  serverBundlesWithoutMaps: string[],
};

/**
 * Reads every candidate, derives its debug id, injects the snippet, and
 * prepares the map. Writes the injected bundles back to disk unless `dryRun`.
 *
 * Exported for tests: this is everything the command does before the network.
 */
export function prepareArtifacts(candidates: readonly SourceMapArtifactCandidate[], options: { repoRoot: string, dryRun: boolean }): PreparationResult {
  const artifacts: PreparedSourceMapArtifact[] = [];
  const warnings: string[] = [];
  const serverBundlesWithoutMaps: string[] = [];

  for (const candidate of candidates) {
    const relativePath = path.relative(candidate.scanDir, candidate.bundlePath);
    const source = fs.readFileSync(candidate.bundlePath, "utf-8");

    let mapText: string;
    let mapDir: string;
    if (candidate.sourceMapPath !== null) {
      mapText = fs.readFileSync(candidate.sourceMapPath, "utf-8");
      mapDir = path.dirname(candidate.sourceMapPath);
    } else {
      const inline = readInlineSourceMap(source);
      if (inline === null) {
        if (candidate.isServerBundle) serverBundlesWithoutMaps.push(relativePath);
        continue;
      }
      mapText = inline;
      mapDir = path.dirname(candidate.bundlePath);
    }

    // An id already present in the file wins over a freshly derived one. That
    // is what makes re-running the command on the same build output a true
    // no-op: the bytes changed the moment we first injected, so re-deriving
    // would mint a new id (and orphan the map already uploaded for the old one).
    const existingDebugId = determineDebugIdFromBundleSource(source);
    // Hashing the utf-8 re-encoding of the decoded text rather than the raw file
    // bytes: JS sources are utf-8 by definition, so the round trip is lossless
    // and — the property that matters — deterministic, which is all a derived id
    // needs.
    const debugId = existingDebugId ?? deriveDebugId(Buffer.from(source, "utf-8"), Buffer.from(mapText, "utf-8"));

    let parsedMap: unknown;
    try {
      parsedMap = JSON.parse(mapText);
    } catch {
      warnings.push(`Skipped ${relativePath}: its source map is not valid JSON.`);
      continue;
    }

    const prepared = prepareSourceMapForUpload(parsedMap, debugId, { sourceMapDir: mapDir, repoRoot: options.repoRoot });
    const preparedBytes = Buffer.from(prepared, "utf-8");

    const injected = appendDebugIdSnippet(source, debugId);
    if (!options.dryRun && injected !== source) {
      fs.writeFileSync(candidate.bundlePath, injected, "utf-8");
    }

    artifacts.push({
      debugId,
      bundlePath: candidate.bundlePath,
      bundleRelativePath: relativePath,
      sourceMapPath: candidate.sourceMapPath,
      sourceMapSha256: sha256Hex(preparedBytes),
      sourceMapGzipped: gzipSync(preparedBytes),
      sourceMapBytes: preparedBytes.length,
    });
  }

  return { artifacts, warnings, serverBundlesWithoutMaps };
}

export function registerSourceMapsCommand(program: Command) {
  const sourceMaps = program
    .command("sourcemaps")
    .description("Upload source maps so Hexclave can symbolicate the stack traces of captured errors.");

  sourceMaps
    .command("upload <dir...>")
    .description("Inject debug IDs into the bundles under <dir...> and upload their source maps. Scan both your browser assets and your server build (e.g. `hexclave sourcemaps upload .next/static .next/server`).")
    .option("--release <release>", "Release identifier this build corresponds to (informational; symbolication never joins on it)")
    .option("--environment <environment>", "Environment this build is deployed to (informational)")
    .option("--delete-maps", "Delete the .map files from the build output after a successful upload, so they are never served to browsers")
    .option("--dry-run", "Prepare everything locally and print what would be uploaded, without writing to the build output or contacting the API")
    .option("--strict", "Exit with a non-zero code on warnings (missing source maps, unconfigured object storage)")
    .option("--cloud-project-id <id>", "Hexclave project ID to upload to (defaults to the HEXCLAVE_PROJECT_ID env var)")
    .addHelpText("after", "\nAuthentication: uses HEXCLAVE_SECRET_SERVER_KEY if set (recommended for CI), otherwise your `hexclave login` session.")
    .action(async (dirs: string[], opts: SourceMapsUploadOptions) => {
      const dryRun = opts.dryRun === true;
      const strict = opts.strict === true;
      const scanDirs = resolveScanDirs(dirs, process.cwd());

      // Subresource integrity is computed by the bundler over the bytes it
      // emitted. Appending anything invalidates those hashes and the browser
      // refuses to execute the chunk, so this is a hard stop rather than a
      // warning — a "successful" upload that bricks production is worse than a
      // failed CI step.
      const integrityManifests = findIntegrityManifests([...scanDirs, ...findNextBuildRoots(scanDirs)]);
      if (integrityManifests.length > 0) {
        throw new CliError(
          `This build uses subresource integrity (found \`integrity\` hashes in ${integrityManifests.length} manifest(s), e.g. ${path.relative(process.cwd(), integrityManifests[0])}).\n`
          + "Injecting debug IDs rewrites the bundle files, which invalidates those hashes and would make the browser refuse to execute them.\n"
          + "Disable SRI for this build, or generate the manifests after running this command.",
        );
      }

      const candidates = collectArtifacts(scanDirs);
      if (candidates.length === 0) {
        throw new CliError(`No .js/.mjs/.cjs files found under ${scanDirs.join(", ")}. Did you run your build first?`);
      }

      const { artifacts, warnings, serverBundlesWithoutMaps } = prepareArtifacts(candidates, { repoRoot: process.cwd(), dryRun });

      if (serverBundlesWithoutMaps.length > 0) {
        // Next.js does not emit server source maps unless this is enabled, so
        // saying "no maps found" would send the user hunting for a bug that
        // isn't there. Print the exact line instead.
        warnings.push(
          `${serverBundlesWithoutMaps.length} server chunk(s) have no source map (e.g. ${serverBundlesWithoutMaps[0]}). `
          + `Next.js does not emit them unless you add \`${NEXT_SERVER_SOURCE_MAPS_CONFIG_HINT}\` to your next.config.js; without it, server-side stack traces stay minified.`,
        );
      }
      if (artifacts.length === 0) {
        warnings.push(`No source maps found under ${scanDirs.join(", ")}. Nothing to upload.`);
      }
      for (const warning of warnings) console.error(`Warning: ${warning}`);

      const totalBytes = artifacts.reduce((sum, artifact) => sum + artifact.sourceMapBytes, 0);
      const totalGzippedBytes = artifacts.reduce((sum, artifact) => sum + artifact.sourceMapGzipped.length, 0);
      console.error(`Prepared ${artifacts.length} source map(s) (${(totalBytes / 1024).toFixed(1)} KiB, ${(totalGzippedBytes / 1024).toFixed(1)} KiB compressed).`);

      if (dryRun) {
        console.log(JSON.stringify({
          dryRun: true,
          release: opts.release ?? null,
          environment: opts.environment ?? null,
          artifacts: artifacts.map((artifact) => ({
            debugId: artifact.debugId,
            file: artifact.bundleRelativePath,
            sha256: artifact.sourceMapSha256,
            bytes: artifact.sourceMapBytes,
            gzippedBytes: artifact.sourceMapGzipped.length,
          })),
        }, null, 2));
        if (strict && warnings.length > 0) process.exitCode = 1;
        return;
      }

      const auth = resolveAuth(resolveProjectId(opts.cloudProjectId));
      const getAuthHeaders = await buildAuthHeadersFactory(auth);
      const result = await uploadPreparedSourceMaps({
        auth,
        getAuthHeaders,
        release: opts.release ?? null,
        environment: opts.environment ?? null,
        artifacts,
      });

      if (result.storageNotConfigured) {
        console.error("Warning: this Hexclave instance has no object storage configured, so source maps cannot be uploaded. Error stack traces will stay minified; everything else keeps working.");
        if (strict) process.exitCode = 1;
        return;
      }

      if (opts.deleteMaps === true) {
        // Only maps that were actually uploaded, and only after the upload
        // succeeded: deleting a skipped map (or deleting before the upload)
        // would leave the build with neither a served map nor a stored one.
        for (const artifact of artifacts) {
          if (artifact.sourceMapPath !== null) fs.rmSync(artifact.sourceMapPath, { force: true });
        }
      }

      console.log(JSON.stringify({
        uploaded: result.uploaded.length,
        alreadyUploaded: result.alreadyUploaded.length,
      }, null, 2));
      if (strict && warnings.length > 0) process.exitCode = 1;
    });
}
