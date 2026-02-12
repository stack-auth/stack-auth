"use client";

import { Button } from "@/components/ui";
import { useDebouncedAction } from "@/hooks/use-debounced-action";
import {
  CreateDashboardResponseSchema,
  CreateDashboardResponse,
} from "@/lib/ai-dashboard/contracts";
import { cn } from "@/lib/utils";
import { usePathname } from "next/navigation";
import { memo, useCallback, useMemo, useState } from "react";
import { CmdKPreviewProps } from "../../cmdk-commands";
import { DashboardSandboxHost } from "./dashboard-sandbox-host";
import { useProjectId } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";

type GenerationState = "idle" | "generating" | "ready" | "error";

export function CreateDashboardPreview({ query, ...rest }: CmdKPreviewProps) {
  return <CreateDashboardPreviewInner key={query} query={query} {...rest} />;
}

const CreateDashboardPreviewInner = memo(function CreateDashboardPreviewInner({
  query,
}: CmdKPreviewProps) {
  const projectId = useProjectId();
  const prompt = query.trim();

  const [state, setState] = useState<GenerationState>("idle");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [artifact, setArtifact] = useState<CreateDashboardResponse | null>(null);

  const generateDashboard = useCallback(async () => {
    if (!projectId || !prompt) {
      return;
    }
    setState("generating");
    setErrorText(null);
    setArtifact(null);

    const response = await fetch("/api/create-dashboard", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        projectId,
        prompt,
      }),
    });
    if (!response.ok) {
      const responseText = await response.text();
      setState("error");
      setErrorText(responseText || `Request failed with status ${response.status}`);
      return;
    }

    const json = await response.json();
    const parsed = CreateDashboardResponseSchema.safeParse(json);
    if (!parsed.success) {
      setState("error");
      setErrorText(`Failed to parse generation response: ${parsed.error.issues[0]?.message ?? "Unknown error"}`);
      return;
    }
    setArtifact(parsed.data);
    setState("ready");
  }, [projectId, prompt]);

  useDebouncedAction({
    action: generateDashboard,
    delayMs: 500,
    skip: !projectId || !prompt,
  });

  if (!prompt) {
    return (
      <div className="flex flex-col h-full w-full items-center justify-center p-6 text-center">
        <h3 className="text-base font-semibold text-foreground">Create Dashboard</h3>
        <p className="text-xs text-muted-foreground mt-1">Describe the dashboard you want and we will generate it in a sandbox.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      <div className="px-3 py-2 border-b border-foreground/[0.08] space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[12px] font-medium text-foreground">Create Dashboard</div>
            <div className="text-[10px] text-muted-foreground truncate">{prompt}</div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={state === "generating"}
            onClick={async () => {
              await generateDashboard();
            }}
          >
            {state === "generating" ? "Generating..." : "Regenerate"}
          </Button>
        </div>
        {state === "error" && errorText && (
          <div className={cn("rounded-md border px-2 py-1.5 text-[10px]", "border-red-500/30 bg-red-500/10 text-red-200")}>
            {errorText}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 p-2">
        {state === "generating" && (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Generating dashboard...</div>
        )}
        {state !== "generating" && artifact && (
          <DashboardSandboxHost artifact={artifact} />
        )}
        {state !== "generating" && !artifact && state !== "error" && (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Waiting for generation...</div>
        )}
      </div>
    </div>
  );
});
