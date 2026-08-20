"use client";

import {
  DesignAlert,
  DesignBadge,
  DesignButton,
  DesignCard,
  DesignInput,
} from "@/components/design-components";
import { sendInternalAdminRequest } from "@/lib/hexclave-app-internals";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import {
  CheckCircleIcon,
  FileCodeIcon,
  FileJsIcon,
  MagnifyingGlassIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import { useRef, useState } from "react";
import * as yup from "yup";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";
import { prepareSourceMapUpload, putPresignedArtifact } from "./upload-source-map";

const ReleaseSchema = yup.object({
  id: yup.string().defined(),
  version: yup.string().defined(),
}).defined();

const ArtifactRegistrationSchema = yup.object({
  manifest_sha256: yup.string().defined(),
  status: yup.string().oneOf(["registered", "already_registered"]).defined(),
  finalize_path: yup.string().defined(),
  artifacts: yup.array(yup.object({
    debug_id: yup.string().defined(),
    code_file: yup.string().defined(),
    source_map_file: yup.string().nullable().defined(),
    bundle_upload_url: yup.string().defined(),
    source_map_upload_url: yup.string().nullable().defined(),
    already_finalized: yup.boolean().defined(),
  }).defined()).defined(),
}).defined();

const ArtifactFinalizeSchema = yup.object({
  manifest_sha256: yup.string().defined(),
  status: yup.string().oneOf(["finalized", "already_finalized"]).defined(),
  uploaded: yup.array(yup.string().defined()).defined(),
  already_uploaded: yup.array(yup.string().defined()).defined(),
}).defined();

const ArtifactLookupSchema = yup.object({
  manifest_sha256: yup.string().defined(),
  release: yup.string().nullable().defined(),
  dist: yup.string().nullable().defined(),
  environment: yup.string().nullable().defined(),
  artifact: yup.object({
    debug_id: yup.string().defined(),
    code_file: yup.string().defined(),
    source_map_file: yup.string().nullable().defined(),
    source_map_inline: yup.boolean().defined(),
    bundle_sha256: yup.string().defined(),
    bundle_bytes: yup.number().defined(),
    source_map_sha256: yup.string().defined(),
    source_map_bytes: yup.number().defined(),
    source_map_gzipped_bytes: yup.number().defined(),
  }).defined(),
}).defined();

type UploadResult = {
  debugId: string,
  codeFile: string,
  manifestSha256: string,
  registrationStatus: "registered" | "already_registered",
  finalizeStatus: "finalized" | "already_finalized",
  uploadStatus: "uploaded" | "already_uploaded",
};

async function readJsonOrThrow(response: Response, what: string): Promise<unknown> {
  if (!response.ok) throw new HexclaveAssertionError(`${what} failed with status ${response.status}`);
  return await response.json();
}

function selectedFilePath(file: File): string {
  const browserRelativePath = file.webkitRelativePath.trim();
  return browserRelativePath === "" ? file.name : browserRelativePath;
}

function optionalTrimmed(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function PageClient() {
  const adminApp = useAdminApp();
  const bundleInputRef = useRef<HTMLInputElement>(null);
  const sourceMapInputRef = useRef<HTMLInputElement>(null);
  const [bundleFile, setBundleFile] = useState<File | null>(null);
  const [sourceMapFile, setSourceMapFile] = useState<File | null>(null);
  const [uploadRelease, setUploadRelease] = useState("");
  const [environment, setEnvironment] = useState("");
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [lookupDebugId, setLookupDebugId] = useState("");
  const [lookupRelease, setLookupRelease] = useState("");
  const [lookupResult, setLookupResult] = useState<yup.InferType<typeof ArtifactLookupSchema> | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);

  const upload = async () => {
    if (bundleFile === null || sourceMapFile === null) {
      setUploadError("Choose both a JavaScript bundle and its source map.");
      return;
    }
    setUploading(true);
    setUploadError(null);
    setUploadResult(null);
    try {
      const release = optionalTrimmed(uploadRelease);
      const uploadEnvironment = optionalTrimmed(environment);
      if (release !== null) {
        const releaseResponse = await sendInternalAdminRequest(adminApp, "/releases", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ version: release }),
        });
        const registeredRelease = await ReleaseSchema.validate(
          await readJsonOrThrow(releaseResponse, "Creating release"),
        );
        if (registeredRelease.version !== release) {
          throw new HexclaveAssertionError("Release registration returned a different version.");
        }
      }

      const prepared = await prepareSourceMapUpload({
        projectId: adminApp.projectId,
        release,
        environment: uploadEnvironment,
        codeFile: selectedFilePath(bundleFile),
        sourceMapFile: selectedFilePath(sourceMapFile),
        bundleSource: await bundleFile.text(),
        sourceMapSource: await sourceMapFile.text(),
      });
      const registrationResponse = await sendInternalAdminRequest(adminApp, "/source-maps/artifacts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          manifest: prepared.manifest,
          manifest_sha256: prepared.manifestSha256,
        }),
      });
      const registration = await ArtifactRegistrationSchema.validate(
        await readJsonOrThrow(registrationResponse, "Registering source map"),
      );
      if (registration.manifest_sha256 !== prepared.manifestSha256) {
        throw new HexclaveAssertionError("Source map registration returned a different manifest digest.");
      }
      const descriptor = registration.artifacts.find((artifact) => artifact.debug_id === prepared.debugId);
      if (descriptor === undefined) {
        throw new HexclaveAssertionError("Source map registration did not return the prepared debug ID.");
      }
      if (descriptor.code_file !== prepared.codeFile || descriptor.source_map_file !== prepared.sourceMapFile) {
        throw new HexclaveAssertionError("Source map registration returned different artifact paths.");
      }

      if (!descriptor.already_finalized) {
        if (descriptor.source_map_upload_url === null) {
          throw new HexclaveAssertionError("Source map registration did not return a source map upload URL.");
        }
        await putPresignedArtifact(
          descriptor.bundle_upload_url,
          prepared.bundleUploadBody,
          { "content-type": "application/javascript" },
          "Uploading JavaScript bundle",
        );
        await putPresignedArtifact(
          descriptor.source_map_upload_url,
          prepared.sourceMapUploadBody,
          {
            "content-type": "application/json",
            "content-encoding": "gzip",
          },
          "Uploading source map",
        );
      }

      const finalizeResponse = await sendInternalAdminRequest(adminApp, "/source-maps/artifacts/finalize", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": prepared.manifestSha256,
        },
        body: JSON.stringify({ manifest_sha256: prepared.manifestSha256 }),
      });
      const finalized = await ArtifactFinalizeSchema.validate(
        await readJsonOrThrow(finalizeResponse, "Finalizing source map"),
      );
      if (finalized.manifest_sha256 !== prepared.manifestSha256) {
        throw new HexclaveAssertionError("Source map finalization returned a different manifest digest.");
      }
      const alreadyUploaded = descriptor.already_finalized
        || finalized.status === "already_finalized"
        || finalized.already_uploaded.includes(prepared.debugId);
      if (!alreadyUploaded && !finalized.uploaded.includes(prepared.debugId)) {
        throw new HexclaveAssertionError("Source map finalization did not confirm the prepared debug ID.");
      }
      setUploadResult({
        debugId: prepared.debugId,
        codeFile: prepared.codeFile,
        manifestSha256: prepared.manifestSha256,
        registrationStatus: registration.status,
        finalizeStatus: finalized.status,
        uploadStatus: alreadyUploaded ? "already_uploaded" : "uploaded",
      });
      setLookupDebugId(prepared.debugId);
      setLookupRelease(release ?? "");
    } catch (caught) {
      setUploadError(errorMessage(caught));
    } finally {
      setUploading(false);
    }
  };

  const lookup = async () => {
    const nextDebugId = lookupDebugId.trim();
    if (nextDebugId === "") {
      setLookupError("Enter a debug ID to look up.");
      return;
    }
    setLookingUp(true);
    setLookupError(null);
    try {
      const params = new URLSearchParams({ debug_id: nextDebugId });
      if (lookupRelease.trim() !== "") params.set("release", lookupRelease.trim());
      const response = await sendInternalAdminRequest(adminApp, `/source-maps/artifacts/lookup?${params.toString()}`, { method: "GET" });
      setLookupResult(await ArtifactLookupSchema.validate(await readJsonOrThrow(response, "Looking up source map")));
    } catch (caught) {
      setLookupResult(null);
      setLookupError(errorMessage(caught));
    } finally {
      setLookingUp(false);
    }
  };

  return (
    <AppEnabledGuard appId="observability">
      <PageLayout
        title="Source maps"
        description="Inject a stable runtime debug ID, upload a JavaScript bundle and source map, then verify what the symbolicator can resolve."
        scrollMain
      >
        <div className="grid gap-4 xl:grid-cols-2">
          <DesignCard
            title="Upload"
            subtitle="Prepare, register, upload, and finalize one bundle and source map."
            icon={UploadSimpleIcon}
            gradient="blue"
          >
            <div className="space-y-4">
              {uploadError !== null && (
                <DesignAlert variant="error" title="Source map upload failed" description={uploadError} />
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <span className="text-xs font-medium text-foreground">JavaScript bundle</span>
                  <input
                    ref={bundleInputRef}
                    type="file"
                    accept=".js,.mjs,.cjs,application/javascript,text/javascript"
                    className="hidden"
                    onChange={(event) => setBundleFile(event.target.files?.item(0) ?? null)}
                  />
                  <DesignButton
                    size="sm"
                    variant="secondary"
                    onClick={() => bundleInputRef.current?.click()}
                  >
                    Choose bundle
                  </DesignButton>
                  <p className="break-all text-xs text-muted-foreground">
                    {bundleFile === null ? "No .js, .mjs, or .cjs file selected" : selectedFilePath(bundleFile)}
                  </p>
                </div>
                <div className="space-y-2">
                  <span className="text-xs font-medium text-foreground">Source map</span>
                  <input
                    ref={sourceMapInputRef}
                    type="file"
                    accept=".map,application/json"
                    className="hidden"
                    onChange={(event) => setSourceMapFile(event.target.files?.item(0) ?? null)}
                  />
                  <DesignButton
                    size="sm"
                    variant="secondary"
                    onClick={() => sourceMapInputRef.current?.click()}
                  >
                    Choose source map
                  </DesignButton>
                  <p className="break-all text-xs text-muted-foreground">
                    {sourceMapFile === null ? "No .map file selected" : selectedFilePath(sourceMapFile)}
                  </p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5 text-xs font-medium text-foreground">
                  Release version
                  <DesignInput
                    size="sm"
                    value={uploadRelease}
                    onChange={(event) => setUploadRelease(event.target.value)}
                    placeholder="2026.08.12 (optional)"
                  />
                </label>
                <label className="space-y-1.5 text-xs font-medium text-foreground">
                  Environment
                  <DesignInput
                    size="sm"
                    value={environment}
                    onChange={(event) => setEnvironment(event.target.value)}
                    placeholder="production (optional)"
                  />
                </label>
              </div>
              <div className="flex justify-end">
                <DesignButton
                  size="sm"
                  loading={uploading}
                  onClick={upload}
                  disabled={bundleFile === null || sourceMapFile === null}
                >
                  Upload
                </DesignButton>
              </div>
              {uploadResult !== null && (
                <div className="space-y-3 rounded-xl bg-foreground/[0.03] p-3 ring-1 ring-foreground/[0.08]">
                  <div className="flex flex-wrap items-center gap-2">
                    <DesignBadge
                      label={uploadResult.uploadStatus}
                      color="green"
                      icon={CheckCircleIcon}
                      size="sm"
                    />
                    <DesignBadge label={uploadResult.registrationStatus} color="zinc" size="sm" />
                    <DesignBadge label={uploadResult.finalizeStatus} color="zinc" size="sm" />
                  </div>
                  <dl className="grid gap-2 text-xs">
                    <div>
                      <dt className="text-muted-foreground">Debug ID</dt>
                      <dd className="break-all font-mono text-foreground">{uploadResult.debugId}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Code file</dt>
                      <dd className="break-all font-mono text-foreground">{uploadResult.codeFile}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Manifest SHA-256</dt>
                      <dd className="break-all font-mono text-foreground">{uploadResult.manifestSha256}</dd>
                    </div>
                  </dl>
                </div>
              )}
            </div>
          </DesignCard>

          <DesignCard
            title="Lookup"
            subtitle="Resolve a finalized artifact by runtime debug ID."
            icon={MagnifyingGlassIcon}
            gradient="cyan"
          >
            <div className="space-y-4">
              {lookupError !== null && (
                <DesignAlert variant="error" title="Source map lookup failed" description={lookupError} />
              )}
              <div className="grid gap-2 sm:grid-cols-[1fr_11rem_auto]">
                <DesignInput
                  size="sm"
                  value={lookupDebugId}
                  onChange={(event) => setLookupDebugId(event.target.value)}
                  placeholder="Debug ID"
                  aria-label="Debug ID"
                />
                <DesignInput
                  size="sm"
                  value={lookupRelease}
                  onChange={(event) => setLookupRelease(event.target.value)}
                  placeholder="Release (optional)"
                  aria-label="Release"
                />
                <DesignButton size="sm" variant="secondary" loading={lookingUp} onClick={lookup}>
                  Look up
                </DesignButton>
              </div>
              {lookupResult === null && !lookingUp && lookupError === null && (
                <div className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-xl bg-foreground/[0.03] p-4 text-center">
                  <FileJsIcon className="h-5 w-5 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Enter a debug ID to inspect its finalized artifact.</p>
                </div>
              )}
              {lookupResult !== null && (
                <div className="space-y-3 rounded-xl bg-foreground/[0.03] p-3 ring-1 ring-foreground/[0.08]">
                  <div className="flex flex-wrap items-center gap-2">
                    <DesignBadge label="Finalized" color="green" icon={CheckCircleIcon} size="sm" />
                    {lookupResult.release !== null && (
                      <DesignBadge label={lookupResult.release} color="zinc" size="sm" />
                    )}
                    {lookupResult.environment !== null && (
                      <DesignBadge label={lookupResult.environment} color="zinc" size="sm" />
                    )}
                  </div>
                  <div className="flex items-start gap-2">
                    <FileCodeIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="break-all text-sm font-medium text-foreground">{lookupResult.artifact.code_file}</p>
                      <p className="break-all text-xs text-muted-foreground">{lookupResult.artifact.debug_id}</p>
                    </div>
                  </div>
                  <dl className="grid gap-2 text-xs sm:grid-cols-2">
                    <div><dt className="text-muted-foreground">Bundle bytes</dt><dd className="tabular-nums">{lookupResult.artifact.bundle_bytes.toLocaleString()}</dd></div>
                    <div><dt className="text-muted-foreground">Source map bytes</dt><dd className="tabular-nums">{lookupResult.artifact.source_map_bytes.toLocaleString()}</dd></div>
                    <div className="sm:col-span-2"><dt className="text-muted-foreground">Manifest SHA-256</dt><dd className="break-all font-mono">{lookupResult.manifest_sha256}</dd></div>
                  </dl>
                </div>
              )}
            </div>
          </DesignCard>
        </div>
      </PageLayout>
    </AppEnabledGuard>
  );
}
