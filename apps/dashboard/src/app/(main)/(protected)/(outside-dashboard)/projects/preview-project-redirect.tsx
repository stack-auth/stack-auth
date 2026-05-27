'use client';

import Loading from "@/app/loading";
import { useRouter } from "@/components/router";
import { stackAppInternalsSymbol } from "@/lib/stack-app-internals";
import { useStackApp, useUser } from "@stackframe/stack";
import { HexclaveAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { useEffect, useMemo, useRef } from "react";

export default function PreviewProjectRedirect() {
  const app = useStackApp();
  const user = useUser();
  const router = useRouter();
  const appInternals = useMemo(() => {
    const internals = Reflect.get(app as any, stackAppInternalsSymbol);
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

  useEffect(() => {
    if (!user || creating.current) return;
    creating.current = true;

    runAsynchronouslyWithAlert(async () => {
      const response = await appInternals.sendRequest(
        "/internal/preview/create-project",
        { method: "POST" },
        "client",
      );

      if (!response.ok) {
        const text = await response.text();
        throw new HexclaveAssertionError(`Failed to create preview project: ${response.status} ${text}`);
      }

      const body = await response.json();
      // Refresh the client-side owned-projects cache before navigating —
      // otherwise the [projectId] route's `useAdminApp` reads a stale list
      // that doesn't include the just-created project and calls `notFound()`.
      // (The normal create-project flow in page-client.tsx does the same.)
      await appInternals.refreshOwnedProjects();
      router.push(`/projects/${encodeURIComponent(body.project_id)}`);
    });
  }, [user, appInternals, router]);

  return <Loading />;
}
