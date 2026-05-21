"use client";

import { CodeBlock } from "@/components/code-block";
import { DesignPillToggle } from "@/components/design-components";
import { DesignAlert } from "@/components/design-components/alert";
import { DesignButton } from "@/components/design-components/button";
import { DesignCard } from "@/components/design-components/card";
import { DesignInput } from "@/components/design-components/input";
import { DesignSelectorDropdown } from "@/components/design-components/select";
import { ActionDialog, Spinner, Typography, cn } from "@/components/ui";
import { useDashboardInternalUser } from "@/lib/dashboard-user";
import { ArrowsClockwiseIcon, GithubLogoIcon, LinkBreakIcon, LockSimpleIcon, TerminalWindowIcon } from "@phosphor-icons/react";
import { type AdminOwnedProject, type PushedConfigSource } from "@stackframe/stack";
import { captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { runAsynchronouslyWithAlert, wait } from "@stackframe/stack-shared/dist/utils/promises";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import { urlString } from "@stackframe/stack-shared/dist/utils/urls";
import sodium from "libsodium-wrappers";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { RemoteSearchCombobox, type ComboboxItem } from "./link-existing-combobox";
import { OnboardingPage } from "./components";
import {
  buildWorkflowYaml,
  GITHUB_PROJECT_ID_SECRET_NAME,
  GITHUB_SECRET_SERVER_KEY_SECRET_NAME,
  WORKFLOW_FILE_NAME,
  WORKFLOW_FILE_PATH,
} from "./link-existing-onboarding-workflow";
import type { TimelineStep } from "./shared";

type LinkExistingStep = "choose-method" | "local" | "github-repository" | "github-config-path" | "github-logs";

type GithubRepository = {
  id: number,
  fullName: string,
  defaultBranch: string,
  isPrivate: boolean,
};

type GithubPublicKey = {
  key: string,
  keyId: string,
};

type GithubUser = {
  login: string,
};

type GithubWorkflowRun = {
  id: number,
  runNumber: number | null,
  status: string,
  conclusion: string | null,
  htmlUrl: string | null,
};

type GithubWorkflowJob = {
  id: number,
  name: string,
  status: string,
  conclusion: string | null,
  steps: {
    name: string,
    status: string,
    conclusion: string | null,
  }[],
};

type WorkflowFailureState = {
  runId: number,
  runNumber: number | null,
  conclusion: string | null,
  runUrl: string | null,
};

type Props = {
  project: AdminOwnedProject,
  steps: TimelineStep[],
  disabled: boolean,
  currentStep: TimelineStep["id"],
  onStepClick: (step: TimelineStep["id"]) => void,
  onBack: () => void,
  onContinueAfterLink: () => Promise<void>,
};

type PersistedLinkExistingState = {
  step: LinkExistingStep,
  selectedGithubAccountId: string | null,
  selectedRepositoryFullName: string,
  selectedBranch: string,
  configPathInput: string,
};

function createRepositoryReference(fullName: string, defaultBranch: string): GithubRepository {
  return {
    id: 0,
    fullName,
    defaultBranch,
    isPrivate: false,
  };
}

const GITHUB_SCOPE_REQUIREMENTS = ["repo", "workflow"];
const CONNECT_NEW_GITHUB_ACCOUNT_OPTION = "__connect-new-github-account__";
const LINK_EXISTING_STEPS: LinkExistingStep[] = ["choose-method", "local", "github-repository", "github-config-path", "github-logs"];

type PackageRunner = "npx" | "pnpx" | "bunx";
const PACKAGE_RUNNERS: PackageRunner[] = ["npx", "pnpx", "bunx"];

function getLinkExistingStorageKey(projectId: string): string {
  return `stack-auth-link-existing-onboarding:${projectId}`;
}

function parsePersistedLinkExistingStep(value: unknown): LinkExistingStep {
  if (typeof value !== "string") {
    return "choose-method";
  }
  return LINK_EXISTING_STEPS.includes(value as LinkExistingStep)
    ? value as LinkExistingStep
    : "choose-method";
}

function readPersistedLinkExistingState(projectId: string): PersistedLinkExistingState | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(getLinkExistingStorageKey(projectId));
  if (raw == null) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!isObject(parsed)) {
      return null;
    }
    const selectedGithubAccountIdField = parsed.selectedGithubAccountId;
    return {
      step: parsePersistedLinkExistingStep(parsed.step),
      selectedGithubAccountId: typeof selectedGithubAccountIdField === "string" ? selectedGithubAccountIdField : null,
      selectedRepositoryFullName: getObjectString(parsed, "selectedRepositoryFullName") ?? "",
      selectedBranch: getObjectString(parsed, "selectedBranch") ?? "",
      configPathInput: getObjectString(parsed, "configPathInput") ?? "stack.config.ts",
    };
  } catch {
    return null;
  }
}

function persistLinkExistingState(projectId: string, state: PersistedLinkExistingState): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(getLinkExistingStorageKey(projectId), JSON.stringify(state));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getObjectString(value: Record<string, unknown>, key: string): string | null {
  const field = value[key];
  return typeof field === "string" ? field : null;
}

function getObjectNumber(value: Record<string, unknown>, key: string): number | null {
  const field = value[key];
  return typeof field === "number" ? field : null;
}

function parseGithubRepositories(value: unknown): GithubRepository[] {
  if (!Array.isArray(value)) {
    throw new Error("GitHub returned an invalid repositories response.");
  }

  const repositories: GithubRepository[] = [];
  for (const item of value) {
    if (!isObject(item)) {
      continue;
    }

    const id = getObjectNumber(item, "id");
    const fullName = getObjectString(item, "full_name");
    const defaultBranch = getObjectString(item, "default_branch");
    const isPrivateField = item.private;
    const isPrivate = typeof isPrivateField === "boolean" ? isPrivateField : false;

    if (id == null || fullName == null || defaultBranch == null) {
      continue;
    }

    repositories.push({
      id,
      fullName,
      defaultBranch,
      isPrivate,
    });
  }

  return repositories;
}

function parseGithubBranches(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("GitHub returned an invalid branches response.");
  }

  const branches: string[] = [];
  for (const item of value) {
    if (!isObject(item)) {
      continue;
    }
    const name = getObjectString(item, "name");
    if (name != null) {
      branches.push(name);
    }
  }
  return branches;
}

function parseGithubPublicKey(value: unknown): GithubPublicKey {
  if (!isObject(value)) {
    throw new Error("GitHub returned an invalid public key response.");
  }

  const key = getObjectString(value, "key");
  const keyId = getObjectString(value, "key_id");
  if (key == null || keyId == null) {
    throw new Error("GitHub public key response is missing required fields.");
  }

  return { key, keyId };
}

function parseGithubUser(value: unknown): GithubUser {
  if (!isObject(value)) {
    throw new Error("GitHub returned an invalid user response.");
  }
  const login = getObjectString(value, "login");
  if (login == null || login.length === 0) {
    throw new Error("GitHub user response is missing login.");
  }
  return { login };
}

function parseGithubWorkflowRuns(value: unknown): GithubWorkflowRun[] {
  if (!isObject(value)) {
    throw new Error("GitHub returned an invalid workflow runs response.");
  }
  const runsField = value.workflow_runs;
  if (!Array.isArray(runsField)) {
    throw new Error("GitHub workflow runs response is missing workflow_runs.");
  }

  const runs: GithubWorkflowRun[] = [];
  for (const item of runsField) {
    if (!isObject(item)) {
      continue;
    }
    const id = getObjectNumber(item, "id");
    if (id == null) {
      continue;
    }
    const status = getObjectString(item, "status") ?? "unknown";
    const conclusionField = item.conclusion;
    const conclusion = typeof conclusionField === "string" ? conclusionField : null;
    runs.push({
      id,
      runNumber: getObjectNumber(item, "run_number"),
      status,
      conclusion,
      htmlUrl: getObjectString(item, "html_url"),
    });
  }
  return runs;
}

function parseGithubWorkflowJobs(value: unknown): GithubWorkflowJob[] {
  if (!isObject(value)) {
    throw new Error("GitHub returned an invalid workflow jobs response.");
  }
  const jobsField = value.jobs;
  if (!Array.isArray(jobsField)) {
    throw new Error("GitHub workflow jobs response is missing jobs.");
  }

  const jobs: GithubWorkflowJob[] = [];
  for (const jobItem of jobsField) {
    if (!isObject(jobItem)) {
      continue;
    }
    const id = getObjectNumber(jobItem, "id");
    const name = getObjectString(jobItem, "name");
    if (id == null || name == null) {
      continue;
    }
    const status = getObjectString(jobItem, "status") ?? "unknown";
    const conclusionField = jobItem.conclusion;
    const conclusion = typeof conclusionField === "string" ? conclusionField : null;

    const stepsField = jobItem.steps;
    const steps: GithubWorkflowJob["steps"] = [];
    if (Array.isArray(stepsField)) {
      for (const stepItem of stepsField) {
        if (!isObject(stepItem)) {
          continue;
        }
        const stepName = getObjectString(stepItem, "name");
        if (stepName == null) {
          continue;
        }
        const stepStatus = getObjectString(stepItem, "status") ?? "unknown";
        const stepConclusionField = stepItem.conclusion;
        const stepConclusion = typeof stepConclusionField === "string" ? stepConclusionField : null;
        steps.push({
          name: stepName,
          status: stepStatus,
          conclusion: stepConclusion,
        });
      }
    }

    jobs.push({
      id,
      name,
      status,
      conclusion,
      steps,
    });
  }

  return jobs;
}

function parseGitTreePaths(value: unknown): { paths: string[], truncated: boolean } {
  if (!isObject(value)) {
    throw new Error("GitHub returned an invalid git tree response.");
  }

  const tree = value.tree;
  if (!Array.isArray(tree)) {
    throw new Error("GitHub git tree response is missing entries.");
  }

  const truncatedField = value.truncated;
  const truncated = typeof truncatedField === "boolean" ? truncatedField : false;

  const paths: string[] = [];
  for (const item of tree) {
    if (!isObject(item)) {
      continue;
    }

    const type = getObjectString(item, "type");
    const path = getObjectString(item, "path");
    if (type === "blob" && path != null) {
      paths.push(path);
    }
  }
  return { paths, truncated };
}

// `/repos/{owner}/{repo}/git/matching-refs/heads/{prefix}` returns refs prefixed
// with `refs/heads/`. Strip the prefix so callers see plain branch names.
function parseGithubMatchingRefs(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("GitHub returned an invalid matching refs response.");
  }
  const HEADS_PREFIX = "refs/heads/";
  const branches: string[] = [];
  for (const item of value) {
    if (!isObject(item)) {
      continue;
    }
    const ref = getObjectString(item, "ref");
    if (ref != null && ref.startsWith(HEADS_PREFIX)) {
      branches.push(ref.slice(HEADS_PREFIX.length));
    }
  }
  return branches;
}

function parseGitReferenceSha(value: unknown): string {
  if (!isObject(value)) {
    throw new Error("GitHub returned an invalid branch reference response.");
  }
  const objectField = value.object;
  if (!isObject(objectField)) {
    throw new Error("GitHub branch reference is missing object details.");
  }
  const sha = getObjectString(objectField, "sha");
  if (sha == null) {
    throw new Error("GitHub branch reference is missing sha.");
  }
  return sha;
}

function parseRepositoryFullName(fullName: string): { owner: string, repo: string } {
  const slashIndex = fullName.indexOf("/");
  if (slashIndex <= 0 || slashIndex >= fullName.length - 1) {
    throw new Error("Selected repository has an invalid full name.");
  }

  return {
    owner: fullName.slice(0, slashIndex),
    repo: fullName.slice(slashIndex + 1),
  };
}

function githubRepositoryApiPath(owner: string, repo: string, tail: string): string {
  return urlString`/repos/${owner}/${repo}` + tail;
}

function encodeGitHubPath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function encryptSecretValue(value: string, base64PublicKey: string): Promise<string> {
  await sodium.ready;
  const valueBytes = sodium.from_string(value);
  const publicKeyBytes = sodium.from_base64(base64PublicKey, sodium.base64_variants.ORIGINAL);
  const encryptedBytes = sodium.crypto_box_seal(valueBytes, publicKeyBytes);
  return sodium.to_base64(encryptedBytes, sodium.base64_variants.ORIGINAL);
}

// GitHub returns 403/429 with a "rate limit" message when the primary or
// secondary rate limit is hit. We surface these as inline messages in the
// combobox rather than firing an alert, since they self-resolve.
function isGithubRateLimitError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /rate limit/i.test(error.message);
}

function buildConfigPathSuggestions(paths: string[]): string[] {
  // Keep suggestions repo-relative (no `./` prefix) so they match both the
  // workflow's push `paths` filter and the default config path input.
  return paths
    .filter((path) => path.endsWith("/stack.config.ts") || path.endsWith("/stack.config.js") || path === "stack.config.ts" || path === "stack.config.js")
    .sort((a, b) => stringCompare(a, b));
}

function getSourceLabel(source: PushedConfigSource | null): string {
  if (source == null) return "Unknown";
  if (source.type === "unlinked") return "Unlinked";
  if (source.type === "pushed-from-unknown") return "Pushed via CLI";
  return `GitHub (${source.owner}/${source.repo}@${source.branch})`;
}

function formatWorkflowState(status: string, conclusion: string | null): string {
  if (status === "completed") {
    return conclusion == null ? "completed" : `completed (${conclusion})`;
  }
  return status;
}

export function LinkExistingOnboarding(props: Props) {
  const { project, onContinueAfterLink } = props;
  const user = useDashboardInternalUser();
  const githubAccounts = user.useConnectedAccounts().filter((account) => account.provider === "github");
  const persistedState = useMemo(() => readPersistedLinkExistingState(project.id), [project.id]);

  const [step, setStep] = useState<LinkExistingStep>(persistedState?.step ?? "choose-method");
  const [selectedGithubAccountId, setSelectedGithubAccountId] = useState<string | null>(persistedState?.selectedGithubAccountId ?? null);
  const [githubAccountLogins, setGithubAccountLogins] = useState<Map<string, string>>(new Map());
  const [repositories, setRepositories] = useState<GithubRepository[]>([]);
  const [loadingRepositories, setLoadingRepositories] = useState(false);
  const [selectedRepositoryFullName, setSelectedRepositoryFullName] = useState<string>(persistedState?.selectedRepositoryFullName ?? "");
  const [branches, setBranches] = useState<string[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<string>(persistedState?.selectedBranch ?? "");
  const [configPathSuggestions, setConfigPathSuggestions] = useState<string[]>([]);
  const [gitTreeTruncated, setGitTreeTruncated] = useState(false);
  const [loadingConfigPathSuggestions, setLoadingConfigPathSuggestions] = useState(false);
  const [isCommitDialogOpen, setIsCommitDialogOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("chore(stack-auth): add Stack Auth config sync workflow");
  const [commitDescription, setCommitDescription] = useState("Add a GitHub Actions workflow that pushes stack.config to Stack Auth whenever it changes.");
  const [isSettingUpGithubWorkflow, setIsSettingUpGithubWorkflow] = useState(false);
  const [isCheckingSource, setIsCheckingSource] = useState(false);
  const [isAwaitingLocalPush, setIsAwaitingLocalPush] = useState(false);
  const [pushedConfigSource, setPushedConfigSource] = useState<PushedConfigSource | null>(null);
  const [latestWorkflowRunUrl, setLatestWorkflowRunUrl] = useState<string | null>(null);
  const [workflowFailure, setWorkflowFailure] = useState<WorkflowFailureState | null>(null);
  const [generatedSecretServerKey, setGeneratedSecretServerKey] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const pollingRunIdRef = useRef(0);
  const localMonitoringRunIdRef = useRef(0);
  const latestWorkflowSnapshotRef = useRef<string | null>(null);
  const capturedWorkflowFailureRef = useRef<string | null>(null);
  const localAutoMonitoringKeyRef = useRef<string | null>(null);
  const githubLogsAutoPollingKeyRef = useRef<string | null>(null);
  const repositoriesLoadedAccountRef = useRef<string | null>(null);
  const loadRepositoriesRunIdRef = useRef(0);
  const [configPathInput, setConfigPathInput] = useState<string>(persistedState?.configPathInput ?? "stack.config.ts");
  const [packageRunner, setPackageRunner] = useState<PackageRunner>("npx");
  const [repoSearchQuery, setRepoSearchQuery] = useState("");
  const [repoSearchResults, setRepoSearchResults] = useState<GithubRepository[]>([]);
  const [loadingRepoSearch, setLoadingRepoSearch] = useState(false);
  const [repoSearchError, setRepoSearchError] = useState<string | null>(null);
  const [branchSearchQuery, setBranchSearchQuery] = useState("");
  const [branchSearchResults, setBranchSearchResults] = useState<string[]>([]);
  const [loadingBranchSearch, setLoadingBranchSearch] = useState(false);
  const [branchSearchError, setBranchSearchError] = useState<string | null>(null);
  const [configPathError, setConfigPathError] = useState<string | null>(null);
  const [isCheckingConfigPath, setIsCheckingConfigPath] = useState(false);

  const persistState = useCallback((partial: Partial<PersistedLinkExistingState>) => {
    const existingState = readPersistedLinkExistingState(project.id);
    persistLinkExistingState(project.id, {
      step: partial.step ?? existingState?.step ?? step,
      selectedGithubAccountId: partial.selectedGithubAccountId ?? existingState?.selectedGithubAccountId ?? selectedGithubAccountId,
      selectedRepositoryFullName: partial.selectedRepositoryFullName ?? existingState?.selectedRepositoryFullName ?? selectedRepositoryFullName,
      selectedBranch: partial.selectedBranch ?? existingState?.selectedBranch ?? selectedBranch,
      configPathInput: partial.configPathInput ?? existingState?.configPathInput ?? configPathInput,
      ...partial,
    });
  }, [configPathInput, project.id, selectedBranch, selectedGithubAccountId, selectedRepositoryFullName, step]);

  const setStepWithPersistence = useCallback((nextStep: LinkExistingStep) => {
    if (nextStep !== "github-logs") {
      pollingRunIdRef.current += 1;
      setIsCheckingSource(false);
      latestWorkflowSnapshotRef.current = null;
    }
    if (nextStep !== "local") {
      localMonitoringRunIdRef.current += 1;
      setIsAwaitingLocalPush(false);
    }
    setStep(nextStep);
    persistState({ step: nextStep });
  }, [persistState]);

  const setSelectedGithubAccountIdWithPersistence = useCallback((nextAccountId: string | null) => {
    setSelectedGithubAccountId(nextAccountId);
    persistState({ selectedGithubAccountId: nextAccountId });
  }, [persistState]);

  const setSelectedRepositoryFullNameWithPersistence = useCallback((nextRepositoryFullName: string) => {
    setSelectedRepositoryFullName(nextRepositoryFullName);
    setConfigPathError(null);
    persistState({ selectedRepositoryFullName: nextRepositoryFullName });
  }, [persistState]);

  const setSelectedBranchWithPersistence = useCallback((nextBranch: string) => {
    setSelectedBranch(nextBranch);
    setConfigPathError(null);
    persistState({ selectedBranch: nextBranch });
  }, [persistState]);

  const setConfigPathInputWithPersistence = useCallback((nextConfigPath: string) => {
    setConfigPathInput(nextConfigPath);
    setConfigPathError(null);
    persistState({ configPathInput: nextConfigPath });
  }, [persistState]);

  const selectedGithubAccount = useMemo(() => {
    if (githubAccounts.length === 0) {
      return null;
    }
    if (selectedGithubAccountId == null) {
      return githubAccounts[0];
    }
    return githubAccounts.find((account) => account.providerAccountId === selectedGithubAccountId) ?? githubAccounts[0];
  }, [githubAccounts, selectedGithubAccountId]);

  const selectedRepository = useMemo(() => {
    const repository = repositories.find((entry) => entry.fullName === selectedRepositoryFullName) ?? null;
    if (repository != null) {
      return repository;
    }
    if (selectedRepositoryFullName.length === 0) {
      return null;
    }
    return createRepositoryReference(selectedRepositoryFullName, selectedBranch);
  }, [repositories, selectedBranch, selectedRepositoryFullName]);

  const appendLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((previous) => {
      const next = [...previous, `[${timestamp}] ${message}`];
      return next.slice(-200);
    });
  }, []);

  const githubFetch = useCallback(async (
    path: string,
    requestInit?: RequestInit,
    accountOverride?: typeof selectedGithubAccount,
  ): Promise<unknown> => {
    const account = accountOverride ?? selectedGithubAccount;
    if (account == null) {
      throw new Error("Connect a GitHub account before continuing.");
    }
    const tokenResult = await account.getAccessToken({ scopes: GITHUB_SCOPE_REQUIREMENTS });
    if (tokenResult.status === "error") {
      throw new Error("Could not get a GitHub access token. Reconnect your GitHub account and try again.");
    }

    const response = await fetch(new URL(path, "https://api.github.com").toString(), {
      ...requestInit,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${tokenResult.data.accessToken}`,
        ...(requestInit?.headers ?? {}),
      },
    });

    if (response.status === 204) {
      if (!response.ok) {
        throw new Error("GitHub API request failed.");
      }
      return null;
    }

    const responseText = await response.text();
    const parsedBody = responseText.length > 0 ? JSON.parse(responseText) : null;

    if (!response.ok) {
      const parsedMessage = isObject(parsedBody) ? getObjectString(parsedBody, "message") : null;
      throw new Error(parsedMessage ?? `GitHub API request failed with status ${response.status}.`);
    }

    return parsedBody;
  }, [selectedGithubAccount]);

  const refreshSourceStatus = useCallback(async () => {
    const source = await project.getPushedConfigSource();
    setPushedConfigSource(source);
    if (source.type === "unlinked") {
      appendLog("Config source is still unlinked.");
    } else if (source.type === "pushed-from-unknown") {
      appendLog("Config has been pushed from CLI.");
    } else {
      appendLog(`Config now linked to ${source.owner}/${source.repo}@${source.branch}.`);
    }
    return source;
  }, [appendLog, project]);

  const refreshLatestWorkflowLogs = useCallback(async (repositoryFullName: string, branch: string) => {
    if (repositoryFullName.length === 0 || branch.length === 0) {
      return;
    }
    const { owner, repo } = parseRepositoryFullName(repositoryFullName);
    const runsQuery = new URLSearchParams({
      branch,
      per_page: "1",
    }).toString();

    const workflowRunsResponse = await githubFetch(
      githubRepositoryApiPath(owner, repo, urlString`/actions/workflows/${WORKFLOW_FILE_NAME}/runs?${runsQuery}`),
    );
    const workflowRuns = parseGithubWorkflowRuns(workflowRunsResponse);
    if (workflowRuns.length === 0) {
      setLatestWorkflowRunUrl(null);
      setWorkflowFailure(null);
      if (latestWorkflowSnapshotRef.current !== "no-run") {
        appendLog("No workflow run found yet. Waiting for GitHub to start it...");
        latestWorkflowSnapshotRef.current = "no-run";
      }
      return;
    }

    const latestRun = workflowRuns[0];
    setLatestWorkflowRunUrl(latestRun.htmlUrl);
    const jobsResponse = await githubFetch(
      githubRepositoryApiPath(owner, repo, urlString`/actions/runs/${latestRun.id}/jobs?per_page=100`),
    );
    const jobs = parseGithubWorkflowJobs(jobsResponse);

    const workflowFailed = latestRun.status === "completed" && latestRun.conclusion !== "success";
    if (workflowFailed) {
      const failure = {
        runId: latestRun.id,
        runNumber: latestRun.runNumber,
        conclusion: latestRun.conclusion,
        runUrl: latestRun.htmlUrl,
      };
      setWorkflowFailure(failure);
      const captureKey = JSON.stringify(failure);
      if (capturedWorkflowFailureRef.current !== captureKey) {
        capturedWorkflowFailureRef.current = captureKey;
        captureError("link-existing-workflow-failed", {
          projectId: project.id,
          repositoryFullName,
          branch,
          configPath: configPathInput,
          pushedConfigSource,
          run: {
            id: latestRun.id,
            number: latestRun.runNumber,
            status: latestRun.status,
            conclusion: latestRun.conclusion,
            htmlUrl: latestRun.htmlUrl,
          },
          jobs,
        });
      }
    } else {
      setWorkflowFailure(null);
    }

    const snapshot = JSON.stringify({
      runId: latestRun.id,
      status: latestRun.status,
      conclusion: latestRun.conclusion,
      jobs: jobs.map((job) => ({
        id: job.id,
        status: job.status,
        conclusion: job.conclusion,
        steps: job.steps.map((step) => ({
          name: step.name,
          status: step.status,
          conclusion: step.conclusion,
        })),
      })),
    });
    if (latestWorkflowSnapshotRef.current === snapshot) {
      return;
    }
    latestWorkflowSnapshotRef.current = snapshot;

    appendLog(
      `Workflow run #${latestRun.runNumber ?? latestRun.id}: ${formatWorkflowState(latestRun.status, latestRun.conclusion)}.`,
    );
    if (latestRun.htmlUrl != null) {
      appendLog(`Run URL: ${latestRun.htmlUrl}`);
    }
    for (const job of jobs) {
      appendLog(`Job ${job.name}: ${formatWorkflowState(job.status, job.conclusion)}.`);
      for (const stepEntry of job.steps) {
        appendLog(`  - ${stepEntry.name}: ${formatWorkflowState(stepEntry.status, stepEntry.conclusion)}.`);
      }
    }
  }, [appendLog, configPathInput, githubFetch, project.id, pushedConfigSource]);

  const pollForLinkedSource = useCallback(async (options?: {
    repositoryFullName?: string,
    branch?: string,
  }) => {
    const repositoryFullName = options?.repositoryFullName ?? selectedRepositoryFullName;
    const branch = options?.branch ?? selectedBranch;
    const startedRunId = pollingRunIdRef.current + 1;
    pollingRunIdRef.current = startedRunId;
    setIsCheckingSource(true);

    try {
      while (true) {
        if (pollingRunIdRef.current !== startedRunId) {
          return;
        }

        if (repositoryFullName.length > 0 && branch.length > 0) {
          try {
            await refreshLatestWorkflowLogs(repositoryFullName, branch);
          } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            const errorSnapshot = `workflow-log-error:${message}`;
            if (latestWorkflowSnapshotRef.current !== errorSnapshot) {
              latestWorkflowSnapshotRef.current = errorSnapshot;
              appendLog(`Could not fetch workflow logs yet: ${message}`);
            }
          }
        }

        const source = await project.getPushedConfigSource();
        setPushedConfigSource(source);
        if (source.type !== "unlinked") {
          try {
            await project.getConfig();
          } catch (error) {
            captureError("link-existing-refresh-config-cache", {
              projectId: project.id,
              context: "github-logs",
              repositoryFullName,
              branch,
              cause: error,
            });
          }
          appendLog("Config push detected. You can continue.");
          return;
        }

        appendLog("Waiting for the config push to complete...");
        await wait(1000);
      }
    } finally {
      if (pollingRunIdRef.current === startedRunId) {
        setIsCheckingSource(false);
      }
    }
  }, [appendLog, project, refreshLatestWorkflowLogs, selectedBranch, selectedRepositoryFullName]);

  const loadRepositories = useCallback(async (
    options?: {
      accountOverride?: typeof selectedGithubAccount,
    },
  ): Promise<void> => {
    const account = options?.accountOverride ?? selectedGithubAccount;
    if (account == null) {
      throw new Error("Connect a GitHub account before loading repositories.");
    }

    const runId = ++loadRepositoriesRunIdRef.current;
    const isCurrent = () => loadRepositoriesRunIdRef.current === runId;
    setLoadingRepositories(true);
    try {
      const userResponse = await githubFetch("/user", undefined, account);
      if (!isCurrent()) return;
      const githubUser = parseGithubUser(userResponse);
      setGithubAccountLogins((previous) => {
        const next = new Map(previous);
        next.set(account.providerAccountId, githubUser.login);
        return next;
      });

      const response = await githubFetch(
        "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member",
        undefined,
        account,
      );
      if (!isCurrent()) return;
      const parsedRepositories = parseGithubRepositories(response);
      setRepositories(parsedRepositories);
      setBranches([]);
      setSelectedBranchWithPersistence("");
      setConfigPathSuggestions([]);
      setGitTreeTruncated(false);

      let nextRepositoryFullName = selectedRepositoryFullName;
      if (nextRepositoryFullName.length === 0) {
        for (const repository of parsedRepositories) {
          nextRepositoryFullName = repository.fullName;
          break;
        }
      }
      setSelectedRepositoryFullNameWithPersistence(nextRepositoryFullName);

      if (nextRepositoryFullName.length > 0) {
        let matchingRepository: GithubRepository | undefined = parsedRepositories.find((repository) => repository.fullName === nextRepositoryFullName);
        if (matchingRepository === undefined) {
          for (const repository of parsedRepositories) {
            matchingRepository = repository;
            break;
          }
        }
        if (matchingRepository !== undefined) {
          setSelectedBranchWithPersistence(matchingRepository.defaultBranch);
        }
      }
    } finally {
      if (isCurrent()) {
        setLoadingRepositories(false);
      }
    }
  }, [githubFetch, selectedGithubAccount, selectedRepositoryFullName, setSelectedBranchWithPersistence, setSelectedRepositoryFullNameWithPersistence]);

  const openGithubRepositoryStep = useCallback(async (options?: { forceConnect?: boolean }) => {
    setStepWithPersistence("github-repository");
    appendLog("Switched to GitHub linking flow.");
    if (options?.forceConnect) {
      await user.getOrLinkConnectedAccount("github", { scopes: GITHUB_SCOPE_REQUIREMENTS });
    }
  }, [appendLog, setStepWithPersistence, user]);

  const loadBranches = useCallback(async (repositoryFullName: string): Promise<string> => {
    if (repositoryFullName.length === 0) {
      throw new Error("Select a repository before loading branches.");
    }
    const repository = repositories.find((item) => item.fullName === repositoryFullName) ?? createRepositoryReference(repositoryFullName, selectedBranch);

    const { owner, repo } = parseRepositoryFullName(repository.fullName);
    setLoadingBranches(true);
    try {
      const response = await githubFetch(githubRepositoryApiPath(owner, repo, "/branches?per_page=100"));
      const parsedBranches = parseGithubBranches(response);
      setBranches(parsedBranches);
      const resolvedBranch = parsedBranches.includes(repository.defaultBranch) ? repository.defaultBranch : (parsedBranches[0] ?? "");
      setSelectedBranchWithPersistence(resolvedBranch);
      return resolvedBranch;
    } finally {
      setLoadingBranches(false);
    }
  }, [githubFetch, repositories, selectedBranch, setSelectedBranchWithPersistence]);

  type LoadConfigSuggestionsOptions = {
    repository: GithubRepository,
    branch: string,
  };

  const loadConfigSuggestions = useCallback(async (options?: LoadConfigSuggestionsOptions) => {
    const repository = options?.repository ?? selectedRepository;
    const branch = options?.branch ?? selectedBranch;
    if (repository == null || branch.length === 0) {
      throw new Error("Select repository and branch first.");
    }

    const { owner, repo } = parseRepositoryFullName(repository.fullName);
    setLoadingConfigPathSuggestions(true);
    try {
      setConfigPathInputWithPersistence("");
      setGitTreeTruncated(false);
      const referenceResponse = await githubFetch(githubRepositoryApiPath(owner, repo, urlString`/git/ref/heads/${branch}`));
      const treeSha = parseGitReferenceSha(referenceResponse);
      let allPaths: string[] = [];
      let truncated = false;
      try {
        const treeResponse = await githubFetch(githubRepositoryApiPath(owner, repo, urlString`/git/trees/${treeSha}?recursive=1`));
        const parsedTree = parseGitTreePaths(treeResponse);
        allPaths = parsedTree.paths;
        truncated = parsedTree.truncated;
      } catch (error) {
        // GitHub returns 404 for the empty-tree SHA
        // (4b825dc642cb6eb9a060e54bf8d69288fbee4904) instead of an empty array,
        // so a freshly-initialized repo with no files lands here. Treat it as
        // "no files yet" rather than surfacing a fatal alert.
        const message = error instanceof Error ? error.message : "";
        if (!message.includes("Not Found")) {
          throw error;
        }
      }
      setGitTreeTruncated(truncated);
      const suggestions = buildConfigPathSuggestions(allPaths);
      setConfigPathSuggestions(suggestions);
      if (suggestions.length === 1) {
        setConfigPathInputWithPersistence(suggestions[0]);
      }
    } finally {
      setLoadingConfigPathSuggestions(false);
    }
  }, [githubFetch, selectedBranch, selectedRepository, setConfigPathInputWithPersistence]);

  const upsertGitHubSecret = useCallback(async (
    owner: string,
    repo: string,
    secretName: string,
    secretValue: string,
    publicKey: GithubPublicKey,
  ) => {
    const encryptedValue = await encryptSecretValue(secretValue, publicKey.key);
    await githubFetch(githubRepositoryApiPath(owner, repo, urlString`/actions/secrets/${secretName}`), {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        encrypted_value: encryptedValue,
        key_id: publicKey.keyId,
      }),
    });
  }, [githubFetch]);

  const getExistingWorkflowSha = useCallback(async (owner: string, repo: string, branch: string) => {
    const refQuery = new URLSearchParams({ ref: branch }).toString();
    const response = await githubFetch(
      githubRepositoryApiPath(owner, repo, `/contents/${encodeGitHubPath(WORKFLOW_FILE_PATH)}?${refQuery}`),
    );

    if (!isObject(response)) {
      return null;
    }

    const sha = getObjectString(response, "sha");
    return sha;
  }, [githubFetch]);

  const checkConfigPathExists = useCallback(async (
    owner: string,
    repo: string,
    branch: string,
    path: string,
  ): Promise<boolean> => {
    const normalizedPath = path.trim().replace(/^\.?\/+/, "");
    if (normalizedPath.length === 0 || normalizedPath.split("/").includes("..")) {
      return false;
    }
    const refQuery = new URLSearchParams({ ref: branch }).toString();
    try {
      const response = await githubFetch(
        githubRepositoryApiPath(owner, repo, `/contents/${encodeGitHubPath(normalizedPath)}?${refQuery}`),
      );
      if (!isObject(response) || Array.isArray(response)) {
        return false;
      }
      return getObjectString(response, "type") === "file";
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("Not Found")) {
        return false;
      }
      throw error;
    }
  }, [githubFetch]);

  const createGithubWorkflowCommit = useCallback(async (
    owner: string,
    repo: string,
    branch: string,
    workflowContent: string,
    workflowCommitMessage: string,
    workflowCommitDescription: string,
  ) => {
    let existingSha: string | null = null;

    try {
      existingSha = await getExistingWorkflowSha(owner, repo, branch);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown GitHub error";
      if (!errorMessage.includes("Not Found")) {
        throw error;
      }
    }

    await sodium.ready;
    const encodedContent = sodium.to_base64(sodium.from_string(workflowContent), sodium.base64_variants.ORIGINAL);
    const fullCommitMessage = workflowCommitDescription.trim().length > 0
      ? `${workflowCommitMessage.trim()}\n\n${workflowCommitDescription.trim()}`
      : workflowCommitMessage.trim();

    await githubFetch(githubRepositoryApiPath(owner, repo, `/contents/${encodeGitHubPath(WORKFLOW_FILE_PATH)}`), {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: fullCommitMessage,
        content: encodedContent,
        branch,
        sha: existingSha ?? undefined,
      }),
    });
  }, [getExistingWorkflowSha, githubFetch]);

  const triggerGithubWorkflow = useCallback(async (owner: string, repo: string, branch: string) => {
    await githubFetch(githubRepositoryApiPath(owner, repo, urlString`/actions/workflows/${WORKFLOW_FILE_NAME}/dispatches`), {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ ref: branch }),
    });
  }, [githubFetch]);

  const setupGithubWorkflow = useCallback(async () => {
    if (selectedRepository == null) {
      throw new Error("Select a repository first.");
    }
    if (selectedBranch.length === 0) {
      throw new Error("Select a branch first.");
    }
    if (configPathInput.trim().length === 0) {
      throw new Error("Config path is required.");
    }

    const { owner, repo } = parseRepositoryFullName(selectedRepository.fullName);
    setIsSettingUpGithubWorkflow(true);
    setLogs([]);
    setWorkflowFailure(null);
    setLatestWorkflowRunUrl(null);
    latestWorkflowSnapshotRef.current = null;
    capturedWorkflowFailureRef.current = null;
    appendLog("Preparing GitHub workflow setup...");
    if (gitTreeTruncated) {
      appendLog("Note: GitHub returned a truncated tree when suggesting config paths; double-check the workflow path if the run fails.");
    }

    try {
      let secretServerKey = generatedSecretServerKey;
      if (secretServerKey == null) {
        appendLog("Generating a project secret server key...");
        const createdApiKey = await project.app.createInternalApiKey({
          description: `GitHub config sync (${owner}/${repo})`,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
          hasPublishableClientKey: false,
          hasSecretServerKey: true,
          hasSuperSecretAdminKey: false,
        });
        if (createdApiKey.secretServerKey == null) {
          throw new Error("Stack Auth did not return a secret server key.");
        }
        secretServerKey = createdApiKey.secretServerKey;
        setGeneratedSecretServerKey(secretServerKey);
        appendLog("Secret server key created.");
      }

      appendLog("Fetching GitHub Actions public key...");
      const publicKeyResponse = await githubFetch(githubRepositoryApiPath(owner, repo, "/actions/secrets/public-key"));
      const publicKey = parseGithubPublicKey(publicKeyResponse);

      appendLog(`Setting ${GITHUB_PROJECT_ID_SECRET_NAME} secret...`);
      await upsertGitHubSecret(owner, repo, GITHUB_PROJECT_ID_SECRET_NAME, project.id, publicKey);
      appendLog(`Setting ${GITHUB_SECRET_SERVER_KEY_SECRET_NAME} secret...`);
      await upsertGitHubSecret(owner, repo, GITHUB_SECRET_SERVER_KEY_SECRET_NAME, secretServerKey, publicKey);

      appendLog("Creating Stack Auth sync workflow commit...");
      const workflowYaml = buildWorkflowYaml(selectedBranch, configPathInput.trim());
      await createGithubWorkflowCommit(
        owner,
        repo,
        selectedBranch,
        workflowYaml,
        commitMessage,
        commitDescription,
      );

      // workflow_dispatch only works once the workflow exists on the default
      // branch, so it 404s for runs targeting other branches. The workflow-file
      // commit above already triggers a run via the push `paths` filter, so a
      // failed dispatch is non-fatal — continue and let the logs step monitor.
      try {
        appendLog("Dispatching workflow run...");
        await triggerGithubWorkflow(owner, repo, selectedBranch);
        appendLog("Workflow dispatched. Waiting for Stack Auth push...");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        appendLog(
          "Skipping direct workflow dispatch — this is expected when the " +
          "workflow file is not yet on the repository's default branch. " +
          "The workflow commit above triggers a run via the push filter, " +
          "so we'll continue monitoring."
        );
        appendLog(`(Dispatch error: ${message})`);
      }

      setStepWithPersistence("github-logs");
      setIsCommitDialogOpen(false);
    } finally {
      setIsSettingUpGithubWorkflow(false);
    }
  }, [
    appendLog,
    commitDescription,
    commitMessage,
    configPathInput,
    gitTreeTruncated,
    createGithubWorkflowCommit,
    generatedSecretServerKey,
    githubFetch,
    project,
    selectedBranch,
    selectedRepository,
    setStepWithPersistence,
    triggerGithubWorkflow,
    upsertGitHubSecret,
  ]);

  const startGithubLogsMonitoring = useCallback(async () => {
    await refreshSourceStatus();
    await pollForLinkedSource({
      repositoryFullName: selectedRepositoryFullName,
      branch: selectedBranch,
    });
  }, [pollForLinkedSource, refreshSourceStatus, selectedBranch, selectedRepositoryFullName]);

  const startLocalPushMonitoring = useCallback(async () => {
    const startedRunId = localMonitoringRunIdRef.current + 1;
    localMonitoringRunIdRef.current = startedRunId;
    setIsAwaitingLocalPush(true);
    try {
      while (true) {
        if (localMonitoringRunIdRef.current !== startedRunId) {
          return;
        }
        const source = await project.getPushedConfigSource();
        setPushedConfigSource(source);
        if (source.type !== "unlinked") {
          setIsAwaitingLocalPush(false);
          try {
            await project.getConfig();
          } catch (error) {
            captureError("link-existing-refresh-config-cache", {
              projectId: project.id,
              context: "local-cli",
              cause: error,
            });
          }
          await onContinueAfterLink();
          return;
        }
        await wait(1000);
      }
    } finally {
      if (localMonitoringRunIdRef.current === startedRunId) {
        setIsAwaitingLocalPush(false);
      }
    }
  }, [onContinueAfterLink, project]);

  const githubWorkflowLinks = useMemo(() => {
    if (selectedRepositoryFullName.length === 0) {
      return null;
    }
    try {
      const { owner, repo } = parseRepositoryFullName(selectedRepositoryFullName);
      const workflowPageUrl = latestWorkflowRunUrl
        ?? urlString`https://github.com/${owner}/${repo}/actions/workflows/${WORKFLOW_FILE_NAME}`;
      const workflowFileUrl = selectedBranch.length > 0
        ? `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(selectedBranch)}/${WORKFLOW_FILE_PATH}`
        : null;
      return {
        workflowPageUrl,
        workflowFileUrl,
      };
    } catch {
      return null;
    }
  }, [latestWorkflowRunUrl, selectedBranch, selectedRepositoryFullName]);

  const canContinue = pushedConfigSource != null && pushedConfigSource.type !== "unlinked";

  const loginCommand = `${packageRunner} @stackframe/stack-cli@latest login`;
  const configPushCommand = `${packageRunner} @stackframe/stack-cli@latest config push --cloud-project-id ${JSON.stringify(project.id)} --config-file <path-to-your-config-file>`;

  // Also covers landing back on this step after the connect-account OAuth
  // redirect or a page reload, since the effect runs whenever the account
  // resolves and we have not yet loaded for it.
  useEffect(() => {
    if (step !== "github-repository") {
      return;
    }
    const account = selectedGithubAccount;
    if (account == null) {
      return;
    }
    if (repositoriesLoadedAccountRef.current === account.providerAccountId) {
      return;
    }
    repositoriesLoadedAccountRef.current = account.providerAccountId;
    runAsynchronouslyWithAlert(async () => {
      try {
        await loadRepositories({ accountOverride: account });
      } catch (error) {
        if (repositoriesLoadedAccountRef.current === account.providerAccountId) {
          repositoriesLoadedAccountRef.current = null;
        }
        throw error;
      }
    });
  }, [loadRepositories, selectedGithubAccount, step]);

  // Debounced GitHub search for repositories. /user/repos only returns the
  // first 100 entries, so for users with many repos we hit /search/repositories
  // as they type. We scope the query with `user:LOGIN` so results stay within
  // the connected user's repos — without it, /search/repositories is global
  // and would surface unrelated public repos ahead of the user's own.
  // Note: this also excludes repos the user only has access to via org
  // membership; those still appear via the prefetched /user/repos list.
  const selectedGithubLogin = selectedGithubAccount != null
    ? githubAccountLogins.get(selectedGithubAccount.providerAccountId) ?? null
    : null;
  useEffect(() => {
    const trimmed = repoSearchQuery.trim();
    if (step !== "github-repository" || trimmed.length === 0 || selectedGithubAccount == null) {
      setRepoSearchResults([]);
      setLoadingRepoSearch(false);
      setRepoSearchError(null);
      return;
    }
    let cancelled = false;
    setLoadingRepoSearch(true);
    const handle = setTimeout(() => {
      runAsynchronouslyWithAlert(async () => {
        try {
          const qualifiers = selectedGithubLogin != null ? ` user:${selectedGithubLogin}` : "";
          const queryString = new URLSearchParams({
            q: `${trimmed}${qualifiers} fork:true`,
            per_page: "30",
            sort: "updated",
          }).toString();
          const json = await githubFetch(`/search/repositories?${queryString}`);
          if (cancelled) {
            return;
          }
          if (isObject(json) && Array.isArray(json.items)) {
            setRepoSearchResults(parseGithubRepositories(json.items));
          } else {
            setRepoSearchResults([]);
          }
          setRepoSearchError(null);
        } catch (error) {
          if (cancelled) return;
          if (isGithubRateLimitError(error)) {
            setRepoSearchResults([]);
            setRepoSearchError("GitHub rate-limited the search. Wait a moment and try again.");
            return;
          }
          setRepoSearchError(null);
          throw error;
        } finally {
          if (!cancelled) {
            setLoadingRepoSearch(false);
          }
        }
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [githubFetch, repoSearchQuery, selectedGithubAccount, selectedGithubLogin, step]);

  // Debounced GitHub search for branches. The branches endpoint has no search,
  // but /git/matching-refs/heads/{prefix} returns prefix-matched refs and is
  // the right tool for repos with many branches.
  useEffect(() => {
    const trimmed = branchSearchQuery.trim();
    if (step !== "github-repository" || trimmed.length === 0 || selectedRepository == null) {
      setBranchSearchResults([]);
      setLoadingBranchSearch(false);
      setBranchSearchError(null);
      return;
    }
    const { owner, repo } = parseRepositoryFullName(selectedRepository.fullName);
    let cancelled = false;
    setLoadingBranchSearch(true);
    const handle = setTimeout(() => {
      runAsynchronouslyWithAlert(async () => {
        try {
          const json = await githubFetch(
            githubRepositoryApiPath(owner, repo, urlString`/git/matching-refs/heads/${trimmed}`),
          );
          if (cancelled) {
            return;
          }
          setBranchSearchResults(parseGithubMatchingRefs(json));
          setBranchSearchError(null);
        } catch (error) {
          if (cancelled) return;
          if (isGithubRateLimitError(error)) {
            setBranchSearchResults([]);
            setBranchSearchError("GitHub rate-limited the search. Wait a moment and try again.");
            return;
          }
          setBranchSearchError(null);
          throw error;
        } finally {
          if (!cancelled) {
            setLoadingBranchSearch(false);
          }
        }
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [branchSearchQuery, githubFetch, selectedRepository, step]);

  let title = "Link an existing config";
  let subtitle = "Connect GitHub automation or push your local stack.config file.";
  let content: React.ReactNode;
  let primaryAction: React.ReactNode;
  let secondaryAction: React.ReactNode | undefined;

  if (step === "choose-method") {
    content = (
      <div className="grid gap-4 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => {
            setStepWithPersistence("local");
          }}
          className="relative flex flex-col items-center gap-6 rounded-2xl bg-white/60 p-8 text-center ring-1 ring-black/[0.06] transition-[box-shadow,background-color] duration-150 hover:transition-none hover:ring-black/[0.10] dark:bg-background/60 dark:ring-white/[0.08] dark:hover:ring-white/[0.12]"
        >
          <div className="rounded-xl bg-foreground/[0.06] p-4 text-muted-foreground">
            <TerminalWindowIcon className="h-7 w-7" />
          </div>
          <div className="space-y-1.5">
            <Typography className="text-base font-semibold">Local / Manual Push</Typography>
            <Typography variant="secondary" className="text-sm leading-relaxed">
              Push your existing config from the CLI.
            </Typography>
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            runAsynchronouslyWithAlert(async () => {
              await openGithubRepositoryStep({ forceConnect: true });
            });
          }}
          className="relative flex flex-col items-center gap-6 rounded-2xl bg-white/60 p-8 text-center ring-1 ring-black/[0.06] transition-[box-shadow,background-color] duration-150 hover:transition-none hover:ring-black/[0.10] dark:bg-background/60 dark:ring-white/[0.08] dark:hover:ring-white/[0.12]"
        >
          <div className="rounded-xl bg-foreground/[0.06] p-4 text-muted-foreground">
            <GithubLogoIcon className="h-7 w-7" />
          </div>
          <div className="space-y-1.5">
            <Typography className="text-base font-semibold">Connect with GitHub</Typography>
            <Typography variant="secondary" className="text-sm leading-relaxed">
              Configure an automated workflow for stack.config pushes.
            </Typography>
          </div>
        </button>
      </div>
    );

    primaryAction = (
      <DesignButton variant="outline" className="w-full rounded-full" onClick={props.onBack}>
        Go Back
      </DesignButton>
    );
  } else if (step === "local") {
    title = "Link from local CLI";
    subtitle = "Push your local config file to link this project.";

    content = (
      <div className="space-y-4">
        <DesignCard glassmorphic className="border-0 bg-white/70 dark:bg-background/60">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Typography className="text-sm font-semibold">CLI commands</Typography>
              <DesignPillToggle
                options={PACKAGE_RUNNERS.map((runner) => ({ id: runner, label: runner }))}
                selected={packageRunner}
                onSelect={(id) => {
                  const runner = PACKAGE_RUNNERS.find((entry) => entry === id);
                  if (runner != null) {
                    setPackageRunner(runner);
                  }
                }}
                size="sm"
              />
            </div>

            <div className="space-y-1.5">
              <Typography variant="secondary" className="text-xs font-medium">
                1. Sign in to Stack Auth
              </Typography>
              <CodeBlock
                title="Sign in"
                icon="terminal"
                language="bash"
                content={loginCommand}
              />
            </div>

            <div className="space-y-1.5">
              <Typography variant="secondary" className="text-xs font-medium">
                2. Push your config
              </Typography>
              <CodeBlock
                title="Push config"
                icon="terminal"
                language="bash"
                content={configPushCommand}
              />
              <Typography variant="secondary" className="text-xs leading-relaxed">
                Replace <code>&lt;path-to-your-config-file&gt;</code> with your local config file path.
              </Typography>
            </div>
          </div>
        </DesignCard>

        <DesignCard glassmorphic className="border-0 bg-white/70 dark:bg-background/60">
          <div className="flex items-center gap-2">
            <Spinner size={16} />
            <Typography variant="secondary" className="text-sm">
              Awaiting config...
            </Typography>
          </div>
        </DesignCard>
      </div>
    );

    primaryAction = (
      <DesignButton
        className="w-full rounded-full"
        loading={isAwaitingLocalPush}
        disabled
      >
        Awaiting Push
      </DesignButton>
    );

    secondaryAction = (
      <DesignButton variant="outline" className="rounded-full px-6" onClick={() => setStepWithPersistence("choose-method")}>
        Back
      </DesignButton>
    );
  } else if (step === "github-repository") {
    title = "Choose repository and branch";
    subtitle = "Connect your GitHub account, then choose where the workflow should run.";

    const repoComboboxItems: ComboboxItem[] = (
      repoSearchQuery.trim().length > 0 ? repoSearchResults : repositories
    ).map((repository) => ({
      value: repository.fullName,
      label: repository.fullName,
      trailingIcon: repository.isPrivate ? (
        <LockSimpleIcon weight="fill" className="h-3.5 w-3.5" aria-label="Private repository" />
      ) : undefined,
    }));
    const branchComboboxItems: ComboboxItem[] = (
      branchSearchQuery.trim().length > 0 ? branchSearchResults : branches
    ).map((branch) => ({
      value: branch,
      label: branch,
    }));

    content = (
      <div className="space-y-4">
        <DesignCard glassmorphic className="border-0 bg-white/70 dark:bg-background/60">
          <div className="space-y-4">
            <div className="space-y-2">
              <Typography className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Connected GitHub account
              </Typography>
              {githubAccounts.length === 0 ? (
                <div className="space-y-3">
                  <DesignAlert
                    variant="info"
                    description="No connected GitHub account found. Connect one to continue."
                    glassmorphic
                  />
                  <DesignButton
                    className="w-full rounded-full"
                    onClick={() => runAsynchronouslyWithAlert(async () => {
                      await user.getOrLinkConnectedAccount("github", { scopes: GITHUB_SCOPE_REQUIREMENTS });
                    })}
                  >
                    Connect GitHub account
                  </DesignButton>
                </div>
              ) : selectedGithubAccount != null && !githubAccountLogins.has(selectedGithubAccount.providerAccountId) ? (
                // Hide the dropdown until the GitHub /user fetch populates the
                // login, so we never briefly show the numeric providerAccountId.
                <div className="flex items-center gap-2 py-1.5">
                  <Spinner size={14} />
                  <Typography variant="secondary" className="text-sm">
                    Loading GitHub account...
                  </Typography>
                </div>
              ) : (
                <DesignSelectorDropdown
                  value={selectedGithubAccount?.providerAccountId ?? ""}
                  onValueChange={(value) => runAsynchronouslyWithAlert(async () => {
                    if (value === CONNECT_NEW_GITHUB_ACCOUNT_OPTION) {
                      // linkConnectedAccount always starts a fresh OAuth flow;
                      // getOrLinkConnectedAccount would just return the existing
                      // account and never let the user add another one.
                      await user.linkConnectedAccount("github", { scopes: GITHUB_SCOPE_REQUIREMENTS });
                      return;
                    }

                    const account = githubAccounts.find((entry) => entry.providerAccountId === value) ?? null;
                    if (account == null) {
                      throw new Error("Selected GitHub account not found.");
                    }

                    setSelectedGithubAccountIdWithPersistence(value);
                  })}
                  options={[
                    {
                      value: CONNECT_NEW_GITHUB_ACCOUNT_OPTION,
                      label: "Connect new",
                    },
                    ...githubAccounts.map((account) => ({
                      value: account.providerAccountId,
                      label: githubAccountLogins.get(account.providerAccountId) ?? account.providerAccountId,
                    })),
                  ]}
                  size="md"
                />
              )}
            </div>

            <div className="space-y-2">
              <Typography className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Repository</Typography>
              <RemoteSearchCombobox
                value={selectedRepositoryFullName}
                items={repoComboboxItems}
                query={repoSearchQuery}
                onQueryChange={setRepoSearchQuery}
                onSelect={(nextRepository) => runAsynchronouslyWithAlert(async () => {
                  setSelectedRepositoryFullNameWithPersistence(nextRepository);
                  setBranches([]);
                  setSelectedBranchWithPersistence("");
                  setBranchSearchQuery("");
                  setBranchSearchResults([]);
                  setConfigPathSuggestions([]);
                  setGitTreeTruncated(false);
                  setRepoSearchQuery("");
                  if (nextRepository.length > 0) {
                    await loadBranches(nextRepository);
                  }
                })}
                triggerPlaceholder={loadingRepositories ? "Loading repositories..." : "Select a repository"}
                inputPlaceholder="Search GitHub repositories..."
                loading={loadingRepoSearch || (loadingRepositories && repositories.length === 0)}
                emptyMessage={
                  repoSearchError
                    ?? (repoSearchQuery.trim().length === 0 ? "No repositories loaded yet." : "No matching repositories.")
                }
                disabled={selectedGithubAccount == null}
              />
            </div>

            <div className="space-y-2">
              <Typography className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Branch</Typography>
              <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                  <RemoteSearchCombobox
                    value={selectedBranch}
                    items={branchComboboxItems}
                    query={branchSearchQuery}
                    onQueryChange={setBranchSearchQuery}
                    onSelect={(nextBranch) => {
                      setSelectedBranchWithPersistence(nextBranch);
                      setBranchSearchQuery("");
                    }}
                    triggerPlaceholder={loadingBranches ? "Loading branches..." : "Select a branch"}
                    inputPlaceholder="Search branches..."
                    loading={loadingBranchSearch || (loadingBranches && branches.length === 0)}
                    emptyMessage={
                      branchSearchError
                        ?? (branchSearchQuery.trim().length === 0 ? "No branches loaded yet." : "No matching branches.")
                    }
                    disabled={selectedRepositoryFullName.length === 0}
                  />
                </div>
                <button
                  type="button"
                  aria-label="Refresh branches"
                  title="Refresh branches"
                  disabled={selectedRepositoryFullName.length === 0 || loadingBranches}
                  onClick={() => runAsynchronouslyWithAlert(async () => {
                    await loadBranches(selectedRepositoryFullName);
                  })}
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                    "border border-black/[0.08] bg-white/80 shadow-sm ring-1 ring-black/[0.08]",
                    "transition-all duration-150 hover:transition-none hover:ring-black/[0.12]",
                    "focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/30",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                    "dark:border-white/[0.06] dark:bg-background/60 dark:ring-white/[0.06] dark:hover:ring-white/[0.1]",
                  )}
                >
                  <ArrowsClockwiseIcon className={cn("h-4 w-4 opacity-70", loadingBranches && "animate-spin")} />
                </button>
              </div>
            </div>
          </div>
        </DesignCard>
      </div>
    );

    primaryAction = (
      <DesignButton
        className="w-full rounded-full"
        disabled={selectedRepositoryFullName.length === 0 || selectedBranch.length === 0}
        onClick={() => runAsynchronouslyWithAlert(async () => {
          const repository = selectedRepository;
          if (repository == null) {
            throw new Error("Select a repository before continuing.");
          }
          const branchToUse = branches.length === 0
            ? await loadBranches(repository.fullName)
            : selectedBranch;
          if (branchToUse.length === 0) {
            throw new Error("Pick a branch, or refresh branches and try again.");
          }
          setStepWithPersistence("github-config-path");
          await loadConfigSuggestions({ repository, branch: branchToUse });
        })}
      >
        Continue
      </DesignButton>
    );

    secondaryAction = (
      <DesignButton variant="outline" className="rounded-full px-6" onClick={() => setStepWithPersistence("choose-method")}>
        Back
      </DesignButton>
    );
  } else if (step === "github-config-path") {
    title = "Select config file";
    subtitle = "Choose the path to the config file of your Stack Auth project";

    content = (
      <div className="space-y-4">
        {gitTreeTruncated && (
          <DesignAlert
            variant="warning"
            title="Repository tree was truncated"
            description="GitHub returned a partial file list. Suggestions may miss stack.config files—type the path manually or retry after reducing repo size."
            glassmorphic
          />
        )}
        {configPathError != null && (
          <DesignAlert
            variant="error"
            title="Config file not found"
            description={configPathError}
            glassmorphic
          />
        )}
        <DesignCard glassmorphic className="border-0 bg-white/70 dark:bg-background/60">
          <div className="space-y-4">
            <div className="space-y-2">
              <Typography className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Config path
              </Typography>
              <DesignInput
                value={configPathInput}
                onChange={(event) => setConfigPathInputWithPersistence(event.target.value)}
                placeholder="stack.config.ts"
              />
              {configPathSuggestions.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {configPathSuggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => setConfigPathInputWithPersistence(suggestion)}
                      className={cn(
                        "rounded-full px-3 py-1 text-xs ring-1 transition-colors duration-150 hover:transition-none",
                        suggestion === configPathInput
                          ? "bg-blue-500/12 text-blue-600 ring-blue-500/30 dark:text-blue-300"
                          : "bg-background/60 text-muted-foreground ring-border",
                      )}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
              <Typography variant="secondary" className="text-xs leading-relaxed">
                The path to your stack.config.ts file. If you don&apos;t have one yet,{" "}
                <button
                  type="button"
                  onClick={props.onBack}
                  className="underline decoration-dotted underline-offset-4 transition-colors duration-150 hover:transition-none hover:text-foreground"
                >
                  create a new project
                </button>{" "}
                instead.
              </Typography>
            </div>
          </div>
        </DesignCard>
      </div>
    );

    primaryAction = (
      <DesignButton
        className="w-full rounded-full"
        disabled={configPathInput.trim().length === 0 || isCheckingConfigPath}
        onClick={() => runAsynchronouslyWithAlert(async () => {
          if (selectedRepository == null || selectedBranch.length === 0) {
            return;
          }
          const { owner, repo } = parseRepositoryFullName(selectedRepository.fullName);
          const path = configPathInput.trim();
          setConfigPathError(null);
          setIsCheckingConfigPath(true);
          try {
            const exists = await checkConfigPathExists(owner, repo, selectedBranch, path);
            if (!exists) {
              setConfigPathError(`"${path}" was not found on branch "${selectedBranch}". Double-check the path or push the file to that branch first.`);
              return;
            }
            setIsCommitDialogOpen(true);
          } finally {
            setIsCheckingConfigPath(false);
          }
        })}
      >
        {isCheckingConfigPath ? "Checking..." : "Create GitHub Action"}
      </DesignButton>
    );

    secondaryAction = (
      <DesignButton
        variant="outline"
        className="rounded-full px-6"
        onClick={() => runAsynchronouslyWithAlert(async () => {
          await openGithubRepositoryStep();
        })}
      >
        Back
      </DesignButton>
    );
  } else {
    title = "Waiting for config push";
    subtitle = "Once the workflow push completes you'll be able to continue.";

    content = (
      <div className="space-y-4">
        {gitTreeTruncated && (
          <DesignAlert
            variant="info"
            title="Earlier suggestion pass was partial"
            description="Config path suggestions may have been incomplete due to GitHub tree truncation. If the workflow fails, verify the committed config path in the repository."
            glassmorphic
          />
        )}
        <DesignCard glassmorphic className="border-0 bg-white/70 dark:bg-background/60">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              {isCheckingSource ? <Spinner size={16} /> : <LinkBreakIcon className="h-4 w-4 text-muted-foreground" />}
              <Typography className="text-sm font-medium">
                {isCheckingSource ? "Checking push status..." : "Waiting for config push"}
              </Typography>
            </div>
            {githubWorkflowLinks != null && (
              <div className="flex flex-wrap gap-3 text-xs">
                <a
                  href={githubWorkflowLinks.workflowPageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-dotted underline-offset-4 transition-colors duration-150 hover:transition-none hover:text-foreground"
                >
                  Go to workflow
                </a>
                {githubWorkflowLinks.workflowFileUrl != null && (
                  <a
                    href={githubWorkflowLinks.workflowFileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-dotted underline-offset-4 transition-colors duration-150 hover:transition-none hover:text-foreground"
                  >
                    Open workflow file
                  </a>
                )}
              </div>
            )}
            <Typography variant="secondary" className="text-xs">
              Current source: {getSourceLabel(pushedConfigSource)}
            </Typography>
            <div className="max-h-48 overflow-y-auto rounded-xl bg-foreground/[0.04] p-3 text-xs font-mono text-muted-foreground">
              {logs.length > 0 ? logs.map((entry, index) => (
                <div key={`${entry}-${index}`}>{entry}</div>
              )) : <div>No logs yet.</div>}
            </div>
          </div>
        </DesignCard>

        {!canContinue && (
          <DesignAlert
            variant="info"
            description="Continue unlocks automatically as soon as branch config source is linked."
            glassmorphic
          />
        )}
        {workflowFailure != null && (
          <DesignAlert
            variant="error"
            title="Workflow failed"
            description={`The latest workflow run did not succeed (${workflowFailure.conclusion ?? "unknown"}). Fix the workflow on GitHub and this page will continue monitoring automatically.`}
            glassmorphic
          />
        )}
      </div>
    );

    primaryAction = canContinue ? (
      <DesignButton
        className="w-full rounded-full"
        onClick={() => runAsynchronouslyWithAlert(props.onContinueAfterLink)}
      >
        Continue
      </DesignButton>
    ) : (
      null
    );

    secondaryAction = (
      <div className="flex items-center gap-3">
        {workflowFailure != null && githubWorkflowLinks != null && (
          <DesignButton
            variant="secondary"
            className="rounded-full px-6"
            onClick={() => {
              const detailsUrl = workflowFailure.runUrl ?? githubWorkflowLinks.workflowPageUrl;
              window.open(detailsUrl, "_blank", "noopener,noreferrer");
            }}
          >
            Fix on GitHub
          </DesignButton>
        )}
        <DesignButton variant="outline" className="rounded-full px-6" onClick={() => setStepWithPersistence("github-config-path")}>
          Back
        </DesignButton>
      </div>
    );
  }

  if (step === "local") {
    const localMonitoringKey = project.id;
    if (localAutoMonitoringKeyRef.current !== localMonitoringKey) {
      localAutoMonitoringKeyRef.current = localMonitoringKey;
      runAsynchronouslyWithAlert(startLocalPushMonitoring);
    }
  } else if (localAutoMonitoringKeyRef.current !== null) {
    localAutoMonitoringKeyRef.current = null;
  }

  if (step === "github-logs") {
    const nextAutoPollingKey = `${selectedRepositoryFullName}:${selectedBranch}`;
    if (githubLogsAutoPollingKeyRef.current !== nextAutoPollingKey) {
      githubLogsAutoPollingKeyRef.current = nextAutoPollingKey;
      runAsynchronouslyWithAlert(startGithubLogsMonitoring);
    }
  } else if (githubLogsAutoPollingKeyRef.current !== null) {
    githubLogsAutoPollingKeyRef.current = null;
  }

  return (
    <>
      <OnboardingPage
        stepKey={`config-choice-link-existing-${step}`}
        title={title}
        subtitle={subtitle}
        steps={props.steps}
        currentStep={props.currentStep}
        onStepClick={props.onStepClick}
        disabled={props.disabled || isSettingUpGithubWorkflow}
        primaryAction={primaryAction}
        secondaryAction={secondaryAction}
      >
        {content}
      </OnboardingPage>

      <ActionDialog
        open={isCommitDialogOpen}
        onClose={() => setIsCommitDialogOpen(false)}
        preventClose={isSettingUpGithubWorkflow}
        title="Create workflow commit"
        description="Review the commit content used to add the Stack Auth sync workflow."
        okButton={{
          label: "Commit and run workflow",
          onClick: async () => {
            await setupGithubWorkflow();
          },
        }}
        cancelButton
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Typography className="text-sm font-medium">Commit message</Typography>
            <DesignInput
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
              placeholder="chore(stack-auth): add Stack Auth config sync workflow"
            />
          </div>
          <div className="space-y-2">
            <Typography className="text-sm font-medium">Commit description</Typography>
            <textarea
              value={commitDescription}
              onChange={(event) => setCommitDescription(event.target.value)}
              className="min-h-[88px] w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none ring-offset-background transition-colors duration-150 placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring hover:transition-none"
              placeholder="Add workflow and actions secrets for Stack Auth config push."
            />
          </div>
          <Typography variant="secondary" className="text-xs">
            This creates or updates `{WORKFLOW_FILE_PATH}` and dispatches the workflow on `{selectedBranch}`.
          </Typography>
        </div>
      </ActionDialog>
    </>
  );
}
