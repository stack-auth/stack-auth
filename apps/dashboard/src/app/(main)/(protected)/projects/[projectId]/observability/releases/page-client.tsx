"use client";

import {
  DesignAlert,
  DesignBadge,
  DesignButton,
  DesignCard,
  DesignInput,
  DesignListItemRow,
  DesignSelectorDropdown,
} from "@/components/design-components";
import { sendInternalAdminRequest } from "@/lib/hexclave-app-internals";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import {
  ClockCounterClockwiseIcon,
  GitCommitIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  RocketLaunchIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import * as yup from "yup";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";

const CommitSchema = yup.object({
  id: yup.string().defined(),
  release_id: yup.string().defined(),
  repository: yup.string().defined(),
  commit_sha: yup.string().defined(),
  position: yup.number().integer().defined(),
  message: yup.string().nullable().defined(),
  author_name: yup.string().nullable().defined(),
  committed_at: yup.string().nullable().defined(),
  url: yup.string().nullable().defined(),
  created_at: yup.string().defined(),
}).defined();

const DeploymentSchema = yup.object({
  id: yup.string().defined(),
  release_id: yup.string().defined(),
  deployment_key: yup.string().defined(),
  environment: yup.string().defined(),
  name: yup.string().nullable().defined(),
  url: yup.string().nullable().defined(),
  started_at: yup.string().nullable().defined(),
  finished_at: yup.string().defined(),
  created_at: yup.string().defined(),
}).defined();

const ReleaseSchema = yup.object({
  id: yup.string().defined(),
  version: yup.string().defined(),
  status: yup.string().oneOf(["open", "archived"]).defined(),
  ref: yup.string().nullable().defined(),
  url: yup.string().nullable().defined(),
  date_added: yup.string().defined(),
  date_started: yup.string().nullable().defined(),
  date_released: yup.string().nullable().defined(),
  created_at: yup.string().defined(),
  updated_at: yup.string().defined(),
  commits: yup.array(CommitSchema).optional(),
  deployments: yup.array(DeploymentSchema).optional(),
}).defined();

const ReleaseListSchema = yup.object({
  items: yup.array(ReleaseSchema).defined(),
  truncated: yup.boolean().defined(),
}).defined();

type Release = yup.InferType<typeof ReleaseSchema>;
type ReleaseCommit = yup.InferType<typeof CommitSchema>;
type ReleaseDeployment = yup.InferType<typeof DeploymentSchema>;

const RELEASE_STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "archived", label: "Archived" },
];

async function readJsonOrThrow(response: Response, what: string): Promise<unknown> {
  if (!response.ok) throw new HexclaveAssertionError(`${what} failed with status ${response.status}`);
  return await response.json();
}

async function fetchRecentReleases(adminApp: object): Promise<yup.InferType<typeof ReleaseListSchema>> {
  const response = await sendInternalAdminRequest(adminApp, "/releases/recent", { method: "GET" });
  return await ReleaseListSchema.validate(await readJsonOrThrow(response, "Loading recent releases"));
}

async function fetchReleaseByVersion(adminApp: object, version: string): Promise<Release> {
  const params = new URLSearchParams({ version });
  const response = await sendInternalAdminRequest(adminApp, `/releases?${params.toString()}`, { method: "GET" });
  return await ReleaseSchema.validate(await readJsonOrThrow(response, "Looking up release"));
}

function optionalValue(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function optionalReleasedAt(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const date = new Date(trimmed);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Release date must be a valid date and time.");
  }
  return date.toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mergeById<Item extends { id: string }>(serverItems: readonly Item[], sessionItems: readonly Item[]): Item[] {
  const items = new Map<string, Item>();
  for (const item of serverItems) items.set(item.id, item);
  for (const item of sessionItems) items.set(item.id, item);
  return [...items.values()];
}

export default function PageClient() {
  const adminApp = useAdminApp();
  const [recent, setRecent] = useState<Release[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [recentTruncated, setRecentTruncated] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [lookupVersion, setLookupVersion] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [createVersion, setCreateVersion] = useState("");
  const [createRef, setCreateRef] = useState("");
  const [createUrl, setCreateUrl] = useState("");
  const [createStatus, setCreateStatus] = useState("open");
  const [createReleasedAt, setCreateReleasedAt] = useState("");
  const [creating, setCreating] = useState(false);
  const [selectedRelease, setSelectedRelease] = useState<Release | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sessionCommits, setSessionCommits] = useState<Map<string, ReleaseCommit>>(() => new Map());
  const [sessionDeployments, setSessionDeployments] = useState<Map<string, ReleaseDeployment>>(() => new Map());
  const [commitRepository, setCommitRepository] = useState("");
  const [commitSha, setCommitSha] = useState("");
  const [commitPosition, setCommitPosition] = useState("0");
  const [commitMessage, setCommitMessage] = useState("");
  const [addingCommit, setAddingCommit] = useState(false);
  const [deploymentKey, setDeploymentKey] = useState("");
  const [deploymentEnvironment, setDeploymentEnvironment] = useState("");
  const [deploymentName, setDeploymentName] = useState("");
  const [deploymentUrl, setDeploymentUrl] = useState("");
  const [addingDeployment, setAddingDeployment] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRecentLoading(true);
    setRecentError(null);
    runAsynchronously(async () => {
      try {
        const page = await fetchRecentReleases(adminApp);
        if (cancelled) return;
        setRecent(page.items);
        setRecentTruncated(page.truncated);
      } catch (caught) {
        if (cancelled) return;
        setRecentError(errorMessage(caught));
      } finally {
        if (!cancelled) setRecentLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [adminApp, reloadToken]);

  // Guards against out-of-order lookup responses: clicking release rows in
  // quick succession keeps several fetches in flight, and without the sequence
  // check the slowest response (or a late failure) would overwrite the
  // selection the user actually made last.
  const lookupSeqRef = useRef(0);

  const lookup = async (version: string) => {
    const nextVersion = version.trim();
    if (nextVersion === "") {
      setOperationError("Enter a release version to look up.");
      return;
    }
    const seq = ++lookupSeqRef.current;
    setLookingUp(true);
    setOperationError(null);
    setNotice(null);
    try {
      const release = await fetchReleaseByVersion(adminApp, nextVersion);
      if (seq !== lookupSeqRef.current) return;
      setSelectedRelease(release);
      setLookupVersion(release.version);
    } catch (caught) {
      if (seq !== lookupSeqRef.current) return;
      setSelectedRelease(null);
      setOperationError(errorMessage(caught));
    } finally {
      if (seq === lookupSeqRef.current) setLookingUp(false);
    }
  };

  const create = async () => {
    const nextVersion = createVersion.trim();
    if (nextVersion === "") {
      setOperationError("Enter a version to create.");
      return;
    }
    setCreating(true);
    setOperationError(null);
    setNotice(null);
    try {
      const ref = optionalValue(createRef);
      const url = optionalValue(createUrl);
      const dateReleased = optionalReleasedAt(createReleasedAt);
      const response = await sendInternalAdminRequest(adminApp, "/releases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: nextVersion,
          status: createStatus,
          ...(ref === undefined ? {} : { ref }),
          ...(url === undefined ? {} : { url }),
          ...(dateReleased === undefined ? {} : { date_released: dateReleased }),
        }),
      });
      const created = await ReleaseSchema.validate(await readJsonOrThrow(response, "Creating release"));
      setSelectedRelease(await fetchReleaseByVersion(adminApp, created.version));
      setLookupVersion(created.version);
      setNotice(`Release ${created.version} is registered.`);
      setReloadToken((current) => current + 1);
    } catch (caught) {
      setOperationError(errorMessage(caught));
    } finally {
      setCreating(false);
    }
  };

  const addCommit = async () => {
    if (selectedRelease === null) {
      setOperationError("Select a release before adding a commit.");
      return;
    }
    const repository = commitRepository.trim();
    const sha = commitSha.trim();
    if (repository === "" || sha === "") {
      setOperationError("Repository and commit SHA are required.");
      return;
    }
    const position = Number(commitPosition);
    if (!Number.isSafeInteger(position) || position < 0) {
      setOperationError("Commit position must be a non-negative integer.");
      return;
    }
    setAddingCommit(true);
    setOperationError(null);
    setNotice(null);
    try {
      const message = optionalValue(commitMessage);
      const response = await sendInternalAdminRequest(adminApp, "/releases/commits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          release_id: selectedRelease.id,
          repository,
          commit_sha: sha,
          position,
          ...(message === undefined ? {} : { message }),
        }),
      });
      const commit = await CommitSchema.validate(await readJsonOrThrow(response, "Adding release commit"));
      setSessionCommits((current) => {
        const next = new Map(current);
        next.set(commit.id, commit);
        return next;
      });
      // Apply the refreshed release only while it is still the selected one:
      // the admin may have clicked another release while this request was in
      // flight, and unconditionally setting would yank the view back to the
      // release the commit was added to.
      const refreshedRelease = await fetchReleaseByVersion(adminApp, selectedRelease.version);
      setSelectedRelease((current) => (current?.id === refreshedRelease.id ? refreshedRelease : current));
      setCommitSha("");
      setCommitMessage("");
      setCommitPosition(String(position + 1));
      setNotice(`Commit ${commit.commit_sha} is registered on ${selectedRelease.version}.`);
    } catch (caught) {
      setOperationError(errorMessage(caught));
    } finally {
      setAddingCommit(false);
    }
  };

  const addDeployment = async () => {
    if (selectedRelease === null) {
      setOperationError("Select a release before adding a deployment.");
      return;
    }
    const key = deploymentKey.trim();
    const environment = deploymentEnvironment.trim();
    if (key === "" || environment === "") {
      setOperationError("Deployment key and environment are required.");
      return;
    }
    setAddingDeployment(true);
    setOperationError(null);
    setNotice(null);
    try {
      const name = optionalValue(deploymentName);
      const url = optionalValue(deploymentUrl);
      const response = await sendInternalAdminRequest(adminApp, "/releases/deployments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          release_id: selectedRelease.id,
          deployment_key: key,
          environment,
          ...(name === undefined ? {} : { name }),
          ...(url === undefined ? {} : { url }),
        }),
      });
      const deployment = await DeploymentSchema.validate(
        await readJsonOrThrow(response, "Adding release deployment"),
      );
      setSessionDeployments((current) => {
        const next = new Map(current);
        next.set(deployment.id, deployment);
        return next;
      });
      // Same stale-selection guard as addCommit above.
      const refreshedRelease = await fetchReleaseByVersion(adminApp, selectedRelease.version);
      setSelectedRelease((current) => (current?.id === refreshedRelease.id ? refreshedRelease : current));
      setDeploymentKey("");
      setDeploymentName("");
      setDeploymentUrl("");
      setNotice(`Deployment ${deployment.deployment_key} is registered on ${selectedRelease.version}.`);
    } catch (caught) {
      setOperationError(errorMessage(caught));
    } finally {
      setAddingDeployment(false);
    }
  };

  const selectedCommits = selectedRelease === null
    ? []
    : mergeById(
      selectedRelease.commits ?? [],
      [...sessionCommits.values()].filter((commit) => commit.release_id === selectedRelease.id),
    );
  const selectedDeployments = selectedRelease === null
    ? []
    : mergeById(
      selectedRelease.deployments ?? [],
      [...sessionDeployments.values()].filter((deployment) => deployment.release_id === selectedRelease.id),
    );

  return (
    <AppEnabledGuard appId="observability">
      <PageLayout
        title="Releases"
        description="Register releases, browse recent versions, and attach the commits and deployments that explain production changes."
        scrollMain
      >
        <div className="space-y-4">
          {operationError !== null && (
            <DesignAlert variant="error" title="Release request failed" description={operationError} />
          )}
          {notice !== null && (
            <DesignAlert variant="success" title="Release updated" description={notice} />
          )}

          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <DesignCard
              title="Create or update"
              subtitle="Register release metadata before associating artifacts, commits, or deployments."
              icon={PlusIcon}
              gradient="blue"
            >
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1.5 text-xs font-medium text-foreground">
                    Version
                    <DesignInput
                      size="sm"
                      value={createVersion}
                      onChange={(event) => setCreateVersion(event.target.value)}
                      placeholder="2026.08.12"
                    />
                  </label>
                  <label className="space-y-1.5 text-xs font-medium text-foreground">
                    Status
                    <DesignSelectorDropdown
                      value={createStatus}
                      onValueChange={setCreateStatus}
                      options={RELEASE_STATUS_OPTIONS}
                      triggerClassName="w-full"
                    />
                  </label>
                  <label className="space-y-1.5 text-xs font-medium text-foreground">
                    Ref
                    <DesignInput
                      size="sm"
                      value={createRef}
                      onChange={(event) => setCreateRef(event.target.value)}
                      placeholder="main (optional)"
                    />
                  </label>
                  <label className="space-y-1.5 text-xs font-medium text-foreground">
                    Release URL
                    <DesignInput
                      size="sm"
                      type="url"
                      value={createUrl}
                      onChange={(event) => setCreateUrl(event.target.value)}
                      placeholder="https://… (optional)"
                    />
                  </label>
                  <label className="space-y-1.5 text-xs font-medium text-foreground sm:col-span-2">
                    Released at
                    <DesignInput
                      size="sm"
                      type="datetime-local"
                      value={createReleasedAt}
                      onChange={(event) => setCreateReleasedAt(event.target.value)}
                    />
                  </label>
                </div>
                <div className="flex justify-end">
                  <DesignButton size="sm" loading={creating} onClick={create}>
                    Save release
                  </DesignButton>
                </div>
              </div>
            </DesignCard>

            <DesignCard
              title="Recent releases"
              subtitle="Newest releases in this project branch."
              icon={ClockCounterClockwiseIcon}
              gradient="cyan"
              actions={(
                <DesignButton
                  size="sm"
                  variant="secondary"
                  loading={recentLoading}
                  onClick={() => setReloadToken((current) => current + 1)}
                >
                  Refresh
                </DesignButton>
              )}
            >
              <div className="space-y-3">
                <div className="flex gap-2">
                  <DesignInput
                    size="sm"
                    leadingIcon={<MagnifyingGlassIcon />}
                    value={lookupVersion}
                    onChange={(event) => setLookupVersion(event.target.value)}
                    placeholder="Look up any release version"
                    aria-label="Release version"
                  />
                  <DesignButton size="sm" variant="secondary" loading={lookingUp} onClick={() => lookup(lookupVersion)}>
                    Look up
                  </DesignButton>
                </div>
                {recentError !== null && (
                  <DesignAlert variant="error" title="Recent releases failed to load" description={recentError} />
                )}
                {recentLoading && recent.length === 0 && (
                  <p className="py-6 text-center text-xs text-muted-foreground">Loading recent releases…</p>
                )}
                {!recentLoading && recentError === null && recent.length === 0 && (
                  <div className="py-6 text-center">
                    <RocketLaunchIcon className="mx-auto h-5 w-5 text-muted-foreground" />
                    <p className="mt-2 text-xs text-muted-foreground">No releases have been registered yet.</p>
                  </div>
                )}
                {recent.length > 0 && (
                  <div className="max-h-80 space-y-1 overflow-y-auto pr-1">
                    {recent.map((release) => (
                      <DesignListItemRow
                        key={release.id}
                        title={release.version}
                        subtitle={`${release.status} · ${release.date_added}`}
                        icon={RocketLaunchIcon}
                        size="sm"
                        onClick={() => {
                          setLookupVersion(release.version);
                          setOperationError(null);
                          setNotice(null);
                          runAsynchronously(() => lookup(release.version));
                        }}
                        className={selectedRelease?.id === release.id ? "bg-foreground/[0.06]" : undefined}
                      />
                    ))}
                  </div>
                )}
                {recentTruncated && (
                  <DesignAlert
                    variant="info"
                    title="Showing the newest 50 releases"
                    description="Use version lookup to open an older release."
                  />
                )}
              </div>
            </DesignCard>
          </div>

          {selectedRelease === null ? (
            <DesignCard title="Release detail" icon={RocketLaunchIcon} gradient="default">
              <div className="py-8 text-center">
                <p className="text-sm text-muted-foreground">Select a recent release or look one up by version.</p>
              </div>
            </DesignCard>
          ) : (
            <DesignCard
              title={selectedRelease.version}
              subtitle="Release detail and graph registrations"
              icon={RocketLaunchIcon}
              gradient="default"
              actions={(
                <DesignBadge
                  label={selectedRelease.status}
                  color={selectedRelease.status === "open" ? "green" : "zinc"}
                  size="sm"
                />
              )}
            >
              <div className="space-y-5">
                <dl className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                  <div><dt className="text-muted-foreground">Release ID</dt><dd className="break-all font-mono">{selectedRelease.id}</dd></div>
                  <div><dt className="text-muted-foreground">Ref</dt><dd>{selectedRelease.ref ?? "—"}</dd></div>
                  <div><dt className="text-muted-foreground">URL</dt><dd className="break-all">{selectedRelease.url ?? "—"}</dd></div>
                  <div><dt className="text-muted-foreground">Added</dt><dd>{selectedRelease.date_added}</dd></div>
                  <div><dt className="text-muted-foreground">Started</dt><dd>{selectedRelease.date_started ?? "—"}</dd></div>
                  <div><dt className="text-muted-foreground">Released</dt><dd>{selectedRelease.date_released ?? "—"}</dd></div>
                  <div><dt className="text-muted-foreground">Created</dt><dd>{selectedRelease.created_at}</dd></div>
                  <div><dt className="text-muted-foreground">Updated</dt><dd>{selectedRelease.updated_at}</dd></div>
                </dl>

                <div className="grid gap-4 xl:grid-cols-2">
                  <section className="space-y-3 rounded-xl bg-foreground/[0.03] p-4 ring-1 ring-foreground/[0.08]">
                    <div className="flex items-center gap-2">
                      <GitCommitIcon className="h-4 w-4 text-muted-foreground" />
                      <h3 className="text-xs font-semibold uppercase tracking-wider">Add commit</h3>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <DesignInput size="sm" value={commitRepository} onChange={(event) => setCommitRepository(event.target.value)} placeholder="Repository" aria-label="Commit repository" />
                      <DesignInput size="sm" value={commitSha} onChange={(event) => setCommitSha(event.target.value)} placeholder="Commit SHA" aria-label="Commit SHA" />
                      <DesignInput size="sm" type="number" min={0} value={commitPosition} onChange={(event) => setCommitPosition(event.target.value)} placeholder="Position" aria-label="Commit position" />
                      <DesignInput size="sm" value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder="Message (optional)" aria-label="Commit message" />
                    </div>
                    <div className="flex justify-end">
                      <DesignButton size="sm" variant="secondary" loading={addingCommit} onClick={addCommit}>
                        Add commit
                      </DesignButton>
                    </div>
                    <div className="space-y-1">
                      {selectedCommits.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No commits are registered on this release yet.</p>
                      ) : selectedCommits.map((commit) => (
                        <div key={commit.id} className="rounded-lg bg-background/60 px-3 py-2 ring-1 ring-foreground/[0.06]">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-medium">{commit.repository}</span>
                            <span className="text-[10px] tabular-nums text-muted-foreground">#{commit.position}</span>
                          </div>
                          <p className="truncate font-mono text-[11px] text-muted-foreground">{commit.commit_sha}</p>
                          {commit.message !== null && <p className="mt-1 text-xs text-foreground">{commit.message}</p>}
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="space-y-3 rounded-xl bg-foreground/[0.03] p-4 ring-1 ring-foreground/[0.08]">
                    <div className="flex items-center gap-2">
                      <UploadSimpleIcon className="h-4 w-4 text-muted-foreground" />
                      <h3 className="text-xs font-semibold uppercase tracking-wider">Add deployment</h3>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <DesignInput size="sm" value={deploymentKey} onChange={(event) => setDeploymentKey(event.target.value)} placeholder="Deployment key" aria-label="Deployment key" />
                      <DesignInput size="sm" value={deploymentEnvironment} onChange={(event) => setDeploymentEnvironment(event.target.value)} placeholder="Environment" aria-label="Deployment environment" />
                      <DesignInput size="sm" value={deploymentName} onChange={(event) => setDeploymentName(event.target.value)} placeholder="Name (optional)" aria-label="Deployment name" />
                      <DesignInput size="sm" type="url" value={deploymentUrl} onChange={(event) => setDeploymentUrl(event.target.value)} placeholder="URL (optional)" aria-label="Deployment URL" />
                    </div>
                    <div className="flex justify-end">
                      <DesignButton size="sm" variant="secondary" loading={addingDeployment} onClick={addDeployment}>
                        Add deployment
                      </DesignButton>
                    </div>
                    <div className="space-y-1">
                      {selectedDeployments.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No deployments are registered on this release yet.</p>
                      ) : selectedDeployments.map((deployment) => (
                        <div key={deployment.id} className="rounded-lg bg-background/60 px-3 py-2 ring-1 ring-foreground/[0.06]">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-medium">{deployment.name ?? deployment.deployment_key}</span>
                            <DesignBadge label={deployment.environment} color="zinc" size="sm" />
                          </div>
                          <p className="truncate font-mono text-[11px] text-muted-foreground">{deployment.deployment_key}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              </div>
            </DesignCard>
          )}
        </div>
      </PageLayout>
    </AppEnabledGuard>
  );
}
