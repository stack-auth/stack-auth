import { AuthError, CliError } from "./errors.js";
import { isRetryableFetchError, localEmulatorReadyTimeoutMs, resolveLocalEmulatorApiUrl } from "./auth.js";
import { internalPckPath, pollInternalPck } from "./emulator-paths.js";

const PER_REQUEST_TIMEOUT_MS = 5_000;

export type LocalEmulatorProjectListEntry = {
  projectId: string,
  absoluteFilePath: string,
  displayName: string,
};

async function getInternalPck(timeoutMs: number): Promise<string> {
  const contents = await pollInternalPck(timeoutMs);
  if (contents === null) {
    throw new AuthError(`Development environment publishable client key not found at ${internalPckPath()} (waited ${timeoutMs}ms). Start your development environment and try again.`);
  }
  return contents;
}

async function fetchWithRetry(url: string, init: RequestInit, totalTimeoutMs: number): Promise<Response> {
  const deadline = performance.now() + totalTimeoutMs;
  let delay = 100;
  let lastError: unknown = null;
  while (true) {
    const remainingForRequest = Math.max(1, deadline - performance.now());
    const perRequestTimeoutMs = Math.min(PER_REQUEST_TIMEOUT_MS, remainingForRequest);
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(perRequestTimeoutMs) });
    } catch (err) {
      if (!isRetryableFetchError(err)) throw err;
      lastError = err;
    }
    if (performance.now() >= deadline) {
      const message = lastError instanceof Error ? lastError.message : String(lastError);
      throw new AuthError(`Cannot reach development environment at ${url} (after ${totalTimeoutMs}ms): ${message}. Start your development environment and try again.`);
    }
    const remaining = deadline - performance.now();
    await new Promise((r) => setTimeout(r, Math.min(delay, remaining)));
    delay = Math.min(delay * 2, 1_000);
  }
}

type ListResponseBody = {
  projects: Array<{
    project_id: string,
    absolute_file_path: string,
    display_name: string,
  }>,
};

function isListResponseBody(value: unknown): value is ListResponseBody {
  if (value === null || typeof value !== "object") return false;
  const projects = (value as { projects?: unknown }).projects;
  if (!Array.isArray(projects)) return false;
  return projects.every((p) =>
    p !== null
      && typeof p === "object"
      && typeof (p as { project_id?: unknown }).project_id === "string"
      && typeof (p as { absolute_file_path?: unknown }).absolute_file_path === "string"
      && typeof (p as { display_name?: unknown }).display_name === "string"
  );
}

export async function listLocalEmulatorProjects(): Promise<LocalEmulatorProjectListEntry[]> {
  const apiUrl = resolveLocalEmulatorApiUrl();
  const readyTimeoutMs = localEmulatorReadyTimeoutMs();
  const internalPck = await getInternalPck(readyTimeoutMs);

  const res = await fetchWithRetry(
    `${apiUrl}/api/latest/internal/local-emulator/project`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Stack-Project-Id": "internal",
        "X-Stack-Access-Type": "client",
        "X-Stack-Publishable-Client-Key": internalPck,
      },
    },
    readyTimeoutMs,
  );

  if (!res.ok) {
    let body: string;
    try {
      body = await res.text();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new AuthError(`Development-environment project list failed (${res.status} ${res.statusText}). Failed to read response body: ${message}. Make sure the development environment is running with NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR=true.`);
    }
    throw new AuthError(`Development-environment project list failed (${res.status} ${res.statusText})${body ? `: ${body}` : ""}. Make sure the development environment is running with NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR=true.`);
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AuthError(`Development-environment project list returned a non-JSON response: ${message}.`);
  }
  if (!isListResponseBody(data)) {
    throw new AuthError("Development-environment project list response had an unexpected shape.");
  }

  return data.projects.map((p) => ({
    projectId: p.project_id,
    absoluteFilePath: p.absolute_file_path,
    displayName: p.display_name,
  }));
}

// Pure resolver, exported for unit tests.
export function findProjectByAbsolutePath(
  projects: LocalEmulatorProjectListEntry[],
  absolutePath: string,
): LocalEmulatorProjectListEntry | null {
  return projects.find((p) => p.absoluteFilePath === absolutePath) ?? null;
}

export async function lookupLocalEmulatorProjectIdByPath(absolutePath: string): Promise<string> {
  const projects = await listLocalEmulatorProjects();
  const match = findProjectByAbsolutePath(projects, absolutePath);
  if (!match) {
    throw new CliError(`No development-environment project registered for ${absolutePath}. Open it in the dashboard or run \`hexclave init\` from that directory first.`);
  }
  return match.projectId;
}
