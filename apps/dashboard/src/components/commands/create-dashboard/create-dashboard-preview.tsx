"use client";

import { useAdminApp, useProjectId } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { useRouter } from "@/components/router";
import { Button } from "@/components/ui";
import { generateDashboardCode } from "@/components/vibe-coding/chat-adapters";
import { useDebouncedAction } from "@/hooks/use-debounced-action";
import { useUpdateConfig } from "@/lib/config-update";
import { getPublicEnvVar } from "@/lib/env";
import { cn } from "@/lib/utils";
import { FloppyDiskIcon } from "@phosphor-icons/react";
import { ALL_APPS } from "@stackframe/stack-shared/dist/apps/apps-config";
import { captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import { useUser } from "@stackframe/stack";
import type { AppId } from "@/lib/apps-frontend";
import { memo, useCallback, useMemo, useState } from "react";
import { CmdKPreviewProps } from "../../cmdk-commands";
import { DashboardSandboxHost } from "./dashboard-sandbox-host";

type GenerationState = "idle" | "generating" | "ready" | "error";

type DashboardArtifact = {
  prompt: string,
  projectId: string,
  runtimeCodegen: {
    title: string,
    description: string,
    uiRuntimeSourceCode: string,
  },
};

export function CreateDashboardPreview({ query, ...rest }: CmdKPreviewProps) {
  return <CreateDashboardPreviewInner key={query} query={query} {...rest} />;
}

const CreateDashboardPreviewInner = memo(function CreateDashboardPreviewInner({
  query,
  onClose,
}: CmdKPreviewProps) {
  const projectId = useProjectId();
  const adminApp = useAdminApp(projectId);
  const project = adminApp.useProject();
  const config = project.useConfig();
  const currentUser = useUser({ or: "redirect" });
  const backendBaseUrl = getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL") ?? "";
  const updateConfig = useUpdateConfig();
  const router = useRouter();
  const prompt = query.trim();

  const enabledAppIds = useMemo(() =>
    typedEntries(config.apps.installed)
      .filter(([appId, appConfig]) => appConfig?.enabled && appId in ALL_APPS)
      .map(([appId]) => appId as AppId),
    [config.apps.installed]
  );

  const [state, setState] = useState<GenerationState>("idle");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [artifact, setArtifact] = useState<DashboardArtifact | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const generateDashboard = useCallback(async () => {
    if (!projectId || !prompt) {
      return;
    }
    setState("generating");
    setErrorText(null);
    setArtifact(null);

    try {
      const userMessages: Array<{ role: string, content: string }> = [{ role: "user", content: prompt }];
      const { toolCall } = await generateDashboardCode(backendBaseUrl, currentUser, userMessages, { enabledAppIds });

      if (!toolCall?.args?.content) {
        setState("error");
        setErrorText("AI did not return dashboard code");
        return;
      }

      setArtifact({
        prompt,
        projectId,
        runtimeCodegen: {
          title: prompt.slice(0, 120),
          description: "",
          uiRuntimeSourceCode: toolCall.args.content,
        },
      });
      setState("ready");
    } catch (error) {
      captureError("create-dashboard-preview", error);
      setState("error");
      setErrorText("Failed to generate dashboard. Please try again.");
    }
  }, [projectId, prompt, currentUser, backendBaseUrl, enabledAppIds]);

  const handleSave = useCallback(async () => {
    if (!artifact) return;
    setIsSaving(true);
    try {
      const id = generateUuid();
      await updateConfig({
        adminApp,
        configUpdate: {
          [`customDashboards.${id}`]: {
            displayName: artifact.runtimeCodegen.title,
            tsxSource: artifact.runtimeCodegen.uiRuntimeSourceCode,
          },
        },
        pushable: false,
      });
      onClose();
      router.push(`/projects/${projectId}/dashboards/${id}`);
    } finally {
      setIsSaving(false);
    }
  }, [artifact, adminApp, updateConfig, router, projectId, onClose]);

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
          <div className="flex items-center gap-2">
            {state === "ready" && artifact && (
              <Button
                size="sm"
                disabled={isSaving}
                onClick={() => runAsynchronouslyWithAlert(handleSave)}
                className="gap-1.5"
              >
                <FloppyDiskIcon className="h-3.5 w-3.5" />
                {isSaving ? "Saving..." : "Save"}
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              disabled={state === "generating"}
              onClick={() => runAsynchronouslyWithAlert(generateDashboard())}
            >
              {state === "generating" ? "Generating..." : "Regenerate"}
            </Button>
          </div>
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
