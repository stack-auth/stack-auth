"use client";

import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Typography,
} from "@/components/ui";
import { useState } from "react";
import { notFound } from "next/navigation";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

const stackAppInternalsSymbol = Symbol.for("StackAuth--DO-NOT-USE-OR-YOU-WILL-BE-FIRED--StackAppInternals");

type AdminAppInternals = {
  sendRequest: (path: string, requestOptions: RequestInit, requestType?: "client" | "server" | "admin") => Promise<Response>,
};

type AdminAppWithInternals = ReturnType<typeof useAdminApp> & {
  [stackAppInternalsSymbol]: AdminAppInternals,
};

type ResyncResult = {
  synced_projects: number,
  total_projects: number,
  errors: string[],
};

export default function PageClient() {
  const adminApp = useAdminApp() as AdminAppWithInternals;
  const [allProjectsResult, setAllProjectsResult] = useState<ResyncResult | null>(null);
  const [singleProjectResult, setSingleProjectResult] = useState<ResyncResult | null>(null);
  const [projectIdInput, setProjectIdInput] = useState("");

  if (adminApp.projectId !== "internal") {
    return notFound();
  }

  const runResync = async (projectId?: string) => {
    const response = await adminApp[stackAppInternalsSymbol].sendRequest(
      "/internal/payments/resync-subscriptions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(projectId ? { project_id: projectId } : {}),
      },
      "admin",
    );
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body?.error ?? `Resync failed with status ${response.status}`);
    }
    return body as ResyncResult;
  };

  return (
    <PageLayout
      title="Resync Subscriptions"
      description="Re-fetch all subscription data from Stripe and update the database."
    >
      <div className="space-y-6 max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>Resync All Projects</CardTitle>
            <CardDescription>
              Iterates over every project with a connected Stripe account and resyncs all customer subscriptions.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              onClick={async () => {
                setAllProjectsResult(null);
                const result = await runResync();
                setAllProjectsResult(result);
              }}
            >
              Resync All Projects
            </Button>
            {allProjectsResult && (
              <ResyncResultDisplay result={allProjectsResult} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Resync Single Project</CardTitle>
            <CardDescription>
              Resync subscriptions for a specific project by ID.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={projectIdInput}
                onChange={(e) => setProjectIdInput(e.target.value)}
                placeholder="Project ID"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <Button
                disabled={!projectIdInput.trim()}
                onClick={async () => {
                  setSingleProjectResult(null);
                  const result = await runResync(projectIdInput.trim());
                  setSingleProjectResult(result);
                }}
              >
                Resync
              </Button>
            </div>
            {singleProjectResult && (
              <ResyncResultDisplay result={singleProjectResult} />
            )}
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}

function ResyncResultDisplay({ result }: { result: ResyncResult }) {
  return (
    <div className="space-y-2">
      <Typography variant="secondary" className="text-sm">
        Synced {result.synced_projects} / {result.total_projects} projects
      </Typography>
      {result.errors.length > 0 && (
        <Alert variant="destructive">
          <Typography className="font-medium text-sm">
            {result.errors.length} error(s):
          </Typography>
          <ul className="list-disc pl-4 mt-1 text-xs space-y-0.5">
            {result.errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </Alert>
      )}
      {result.errors.length === 0 && (
        <Typography variant="secondary" className="text-sm text-green-600 dark:text-green-400">
          All projects synced successfully.
        </Typography>
      )}
    </div>
  );
}
