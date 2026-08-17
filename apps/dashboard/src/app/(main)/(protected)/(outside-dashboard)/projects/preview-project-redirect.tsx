'use client';

import Loading from "@/app/loading";
import { useRouter } from "@/components/router";
import { hexclaveAppInternalsSymbol } from "@/lib/hexclave-app-internals";
import { PreviewFlowError } from "@/components/preview-flow-error";
import { useStackApp, useUser } from "@hexclave/next";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously, wait } from "@hexclave/shared/dist/utils/promises";
import { useEffect, useMemo, useRef, useState } from "react";

const MAX_CREATE_PROJECT_ATTEMPTS = 3;

function getResponseStatus(error: unknown): number | undefined {
  if (error instanceof Response) return error.status;
  if (error instanceof Error && error.cause !== undefined) {
    return getResponseStatus(error.cause);
  }
  return undefined;
}

export default function PreviewProjectRedirect() {
  const app = useStackApp();
  const user = useUser();
  const router = useRouter();
  const appInternals = useMemo(() => {
    const internals = Reflect.get(app as any, hexclaveAppInternalsSymbol);
    if (
      !internals ||
      typeof internals.sendRequest !== "function" ||
      typeof internals.refreshOwnedProjects !== "function"
    ) {
      throw new Error("The Stack client app cannot send internal requests.");
    }
    return internals as {
      sendRequest: (path: string, options: RequestInit, type: string) => Promise<Response>,
      refreshOwnedProjects: () => Promise<void>,
    };
  }, [app]);
  const creating = useRef(false);
  const [createProjectError, setCreateProjectError] = useState(false);
  const [createProjectRetry, setCreateProjectRetry] = useState(0);

  useEffect(() => {
    if (!user || creating.current) return;
    creating.current = true;

    const createProject = async () => {
      try {
        let response: Response | undefined;
        let lastError: unknown;
        for (let attempt = 0; attempt < MAX_CREATE_PROJECT_ATTEMPTS; attempt++) {
          try {
            response = await appInternals.sendRequest(
              "/internal/preview/create-project",
              { method: "POST" },
              "client",
            );
            if (!response.ok) {
              const text = await response.text();
              throw new Error(`Failed to create preview project: ${response.status} ${text}`, { cause: response });
            }
            break;
          } catch (error) {
            lastError = error;
            const status = getResponseStatus(error);
            if (status !== undefined && status >= 400 && status < 500) throw error;
            if (attempt === MAX_CREATE_PROJECT_ATTEMPTS - 1) throw error;

            // The fallback seed path is intentionally slow and can briefly fail while ClickHouse warms up.
            await wait(250 * 2 ** attempt);
          }
        }

        if (response == null) {
          throw lastError ?? new Error("Preview project creation did not return a response.");
        }

        const body = await response.json();
        // Refresh the client-side owned-projects cache before navigating —
        // otherwise the [projectId] route's `useAdminApp` reads a stale list
        // that doesn't include the just-created project and calls `notFound()`.
        // (The normal create-project flow in page-client.tsx does the same.)
        await appInternals.refreshOwnedProjects();
        router.push(`/projects/${encodeURIComponent(body.project_id)}`);
      } catch (error) {
        captureError("preview-project-create", error);
        setCreateProjectError(true);
      }
    };
    runAsynchronously(createProject());
  }, [user, appInternals, router, createProjectRetry]);

  if (createProjectError) {
    return (
      <PreviewFlowError
        onRetry={() => {
          creating.current = false;
          setCreateProjectError(false);
          setCreateProjectRetry((retry) => retry + 1);
        }}
      />
    );
  }
  return <Loading />;
}
