"use client";

import { useAdminApp, useProjectId } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { useRouter } from "@/components/router";
import { Button } from "@/components/ui";
import { useDebouncedAction } from "@/hooks/use-debounced-action";
import { buildDashboardMessages } from "@/lib/ai-dashboard/shared-prompt";
import type { AppId } from "@/lib/apps-frontend";
import { buildStackAuthHeaders } from "@/lib/api-headers";
import { useUpdateConfig } from "@/lib/config-update";
import { getPublicEnvVar } from "@/lib/env";
import { cn } from "@/lib/utils";
import { FloppyDiskIcon } from "@phosphor-icons/react";
import { useUser } from "@stackframe/stack";
import { ALL_APPS } from "@stackframe/stack-shared/dist/apps/apps-config";
import { captureError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import { useChat, type UIMessage } from "@ai-sdk/react";
import { convertToModelMessages, DefaultChatTransport } from "ai";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { CmdKPreviewProps } from "../../cmdk-commands";
import { DashboardSandboxHost } from "./dashboard-sandbox-host";
import { StreamingCodeViewer } from "../../streaming-code-viewer";

type DashboardArtifact = {
  prompt: string,
  projectId: string,
  runtimeCodegen: {
    title: string,
    description: string,
    uiRuntimeSourceCode: string,
  },
};

function sanitizeGeneratedCode(code: string): string {
  let result = code.trim();

  if (result.startsWith("```")) {
    const lines = result.split("\n");
    lines.shift();
    if (lines[lines.length - 1]?.trim() === "```") {
      lines.pop();
    }
    result = lines.join("\n").trim();
  }

  result = result
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

  result = result.replace(/;(\s*\n\s*[A-Za-z_$][\w$]*\s*:)/g, ",$1");

  return result;
}

function extractToolPart(messages: UIMessage[]): {
  state: string,
  code: string,
} | null {
  const lastAssistant = messages.findLast((m) => m.role === "assistant");
  if (!lastAssistant) return null;

  for (const part of lastAssistant.parts) {
    if (!part.type.startsWith("tool-")) continue;
    const toolPart = part as { type: string, state: string, input?: Record<string, unknown> };
    const code = typeof toolPart.input?.content === "string" ? toolPart.input.content : "";
    if (code) {
      return { state: toolPart.state, code };
    }
  }
  return null;
}

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
  const backendBaseUrl = getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL") ?? throwErr("NEXT_PUBLIC_STACK_API_URL is not set");
  const browserBaseUrl = getPublicEnvVar("NEXT_PUBLIC_BROWSER_STACK_API_URL") ?? backendBaseUrl;
  const updateConfig = useUpdateConfig();
  const router = useRouter();
  const prompt = query.trim();

  const enabledAppIds = useMemo(() =>
    typedEntries(config.apps.installed)
      .filter(([appId, appConfig]) => appConfig?.enabled && appId in ALL_APPS)
      .map(([appId]) => appId as AppId),
    [config.apps.installed]
  );

  const [artifact, setArtifact] = useState<DashboardArtifact | null>(null);
  const [iframeReady, setIframeReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const enabledAppIdsRef = useRef(enabledAppIds);
  enabledAppIdsRef.current = enabledAppIds;
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;
  const backendBaseUrlRef = useRef(backendBaseUrl);
  backendBaseUrlRef.current = backendBaseUrl;
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  const finalizedRef = useRef(false);

  const transport = useMemo(() => new DefaultChatTransport({
    api: `${browserBaseUrl}/api/latest/ai/query/stream`,
    headers: () => buildStackAuthHeaders(currentUserRef.current),
    prepareSendMessagesRequest: async ({ messages: uiMessages, headers }) => {
      const modelMessages = await convertToModelMessages(uiMessages);
      const userMessages = modelMessages.map(m => ({
        role: m.role as string,
        content: m.content as unknown,
      }));
      const contextMessages = await buildDashboardMessages(
        backendBaseUrlRef.current,
        currentUserRef.current,
        userMessages,
        undefined,
        enabledAppIdsRef.current,
      );
      return {
        body: {
          systemPrompt: "create-dashboard",
          tools: ["update-dashboard"],
          quality: "smart",
          speed: "slow",
          projectId: projectIdRef.current,
          messages: [...contextMessages, ...userMessages],
        },
        headers,
      };
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [browserBaseUrl]);

  const {
    messages,
    status,
    sendMessage,
    stop,
    setMessages,
    error: aiError,
  } = useChat({ transport });

  const toolPart = extractToolPart(messages);
  const chatActive = status === "submitted" || status === "streaming";

  let phase: "idle" | "waiting" | "streaming" | "booting" | "ready" | "error";
  if (artifact && iframeReady) {
    phase = "ready";
  } else if (artifact && !iframeReady) {
    phase = "booting";
  } else if (toolPart?.state === "input-streaming") {
    phase = "streaming";
  } else if (chatActive) {
    phase = "waiting";
  } else if (aiError || errorText) {
    phase = "error";
  } else {
    phase = "idle";
  }

  const displayCode = toolPart?.code ?? "";

  if (toolPart?.state === "input-available" && !artifact && !finalizedRef.current) {
    finalizedRef.current = true;
    const sanitized = sanitizeGeneratedCode(toolPart.code);
    setArtifact({
      prompt,
      projectId,
      runtimeCodegen: {
        title: prompt.slice(0, 120),
        description: "",
        uiRuntimeSourceCode: sanitized,
      },
    });
    setIframeReady(false);
  }

  if (status === "ready" && !chatActive && !toolPart && !artifact && messages.length > 0 && !errorText) {
    setErrorText("AI did not return dashboard code.");
  }

  if (aiError && !errorText && !artifact) {
    captureError("create-dashboard-preview", aiError);
    setErrorText("Failed to generate dashboard. Please try again.");
  }

  const handleIframeReady = useCallback(() => {
    setIframeReady(true);
  }, []);

  const generateDashboard = useCallback(async () => {
    if (!projectId || !prompt) return;

    try {
      await stop();
    } catch {
      // nothing to stop
    }
    setMessages([]);
    setArtifact(null);
    setErrorText(null);
    setIframeReady(false);
    finalizedRef.current = false;

    await sendMessage({ text: prompt });
  }, [projectId, prompt, sendMessage, stop, setMessages]);

  useDebouncedAction({
    action: generateDashboard,
    delayMs: 500,
    skip: !projectId || !prompt,
  });

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

  if (!prompt) {
    return (
      <div className="flex flex-col h-full w-full items-center justify-center p-6 text-center">
        <h3 className="text-base font-semibold text-foreground">Create Dashboard</h3>
        <p className="text-xs text-muted-foreground mt-1">Describe the dashboard you want and we will generate it in a sandbox.</p>
      </div>
    );
  }

  const isGenerating = phase === "streaming" || phase === "booting" || phase === "waiting";

  return (
    <div className="flex h-full w-full flex-col">
      <div className="px-3 py-2 border-b border-foreground/[0.08] space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[12px] font-medium text-foreground">Create Dashboard</div>
            <div className="text-[10px] text-muted-foreground truncate">{prompt}</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {phase === "ready" && artifact && (
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
              disabled={isGenerating}
              onClick={() => runAsynchronouslyWithAlert(generateDashboard())}
            >
              {isGenerating ? "Generating..." : "Regenerate"}
            </Button>
          </div>
        </div>
        {phase === "error" && (errorText || aiError?.message) && (
          <div className={cn("rounded-md border px-2 py-1.5 text-[10px]", "border-red-500/30 bg-red-500/10 text-red-200")}>
            {errorText || aiError?.message}
          </div>
        )}
      </div>

      <div className="relative flex-1 min-h-0 p-2">
        {(phase === "waiting" || phase === "streaming" || phase === "booting" || (phase === "ready" && artifact)) && (
          <div className={cn(
            "absolute inset-2 z-10 transition-opacity duration-700",
            iframeReady ? "opacity-0 pointer-events-none" : "opacity-100"
          )}>
            <StreamingCodeViewer code={displayCode} isStreaming={phase === "waiting" || phase === "streaming"} />
          </div>
        )}

        {(phase === "booting" || phase === "ready") && artifact && (
          <div className={cn(
            "h-full w-full transition-opacity duration-700",
            iframeReady ? "opacity-100" : "opacity-0"
          )}>
            <DashboardSandboxHost artifact={artifact} onReady={handleIframeReady} />
          </div>
        )}

        {phase === "idle" && (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Waiting for generation...</div>
        )}

        {phase === "error" && !artifact && (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Generation failed</div>
        )}
      </div>
    </div>
  );
});
