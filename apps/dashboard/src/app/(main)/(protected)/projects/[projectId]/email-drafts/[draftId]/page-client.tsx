"use client";

import { TeamMemberSearchTable } from "@/components/data-table/team-member-search-table";
import EmailPreview from "@/components/email-preview";
import { useRouterConfirm } from "@/components/router";
import { AssistantChat, CodeEditor, VibeCodeLayout } from "@/components/vibe-coding";
import { createChatAdapter, createHistoryAdapter, ToolCallContent } from "@/components/vibe-coding/chat-adapters";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, toast, Typography, useToast } from "@stackframe/stack-ui";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useAdminApp } from "../../use-admin-app";
import { EmailThemeSelector } from "@/components/email-theme-selector";

export default function PageClient({ draftId }: { draftId: string }) {
  const stackAdminApp = useAdminApp();
  const { setNeedConfirm } = useRouterConfirm();
  const { toast } = useToast();

  const drafts = stackAdminApp.useEmailDrafts();
  const draft = useMemo(() => drafts.find((d) => d.id === draftId), [drafts, draftId]);

  const [currentCode, setCurrentCode] = useState<string>(draft?.tsxSource ?? "");
  const [stage, setStage] = useState<"edit" | "send">("edit");
  const [selectedThemeId, setSelectedThemeId] = useState<string | undefined | false>(draft?.themeId);

  useEffect(() => {
    if (!draft) return;
    if (draft.tsxSource === currentCode && draft.themeId === selectedThemeId) return;
    setNeedConfirm(true);
    return () => setNeedConfirm(false);
  }, [setNeedConfirm, draft, currentCode, selectedThemeId]);

  const handleToolUpdate = (toolCall: ToolCallContent) => {
    setCurrentCode(toolCall.args.content);
  };

  const handleNext = async () => {
    try {
      await stackAdminApp.updateEmailDraft(draftId, { tsxSource: currentCode, themeId: selectedThemeId });
      setStage("send");
      toast({ title: "Draft saved", variant: "success" });
    } catch (error) {
      if (error instanceof KnownErrors.EmailRenderingError) {
        toast({ title: "Failed to save draft", variant: "destructive", description: error.message });
        return;
      }
      toast({ title: "Failed to save draft", variant: "destructive", description: "Unknown error" });
    }
  };

  return (
    <>
      {stage === "edit" ? (
        <VibeCodeLayout
          previewComponent={
            <EmailPreview themeId={selectedThemeId} templateTsxSource={currentCode} />
          }
          editorComponent={
            <CodeEditor
              code={currentCode}
              onCodeChange={setCurrentCode}
              action={
                <div className="flex gap-2">
                  <EmailThemeSelector
                    selectedThemeId={selectedThemeId}
                    onThemeChange={setSelectedThemeId}
                    className="w-48"
                  />
                  <Button onClick={handleNext}>Next</Button>
                </div>
              }
            />
          }
          chatComponent={
            <AssistantChat
              historyAdapter={createHistoryAdapter(stackAdminApp, draftId)}
              chatAdapter={createChatAdapter(stackAdminApp, draftId, "email-template", handleToolUpdate)}
              toolComponents={[]}
            />
          }
        />
      ) : (
        <SendStage draftId={draftId} />
      )}
    </>
  );
}

function SendStage({ draftId }: { draftId: string }) {
  const stackAdminApp = useAdminApp();
  const [scope, setScope] = useState<"all" | "users">("all");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  const handleSubmit = async () => {
    const result = await stackAdminApp.sendEmail({
      userIds: selectedUserIds,
      draftId,
    });
    if (result.status === "ok") {
      toast({ title: "Email sent", variant: "success" });
      return;
    }
    if (result.error instanceof KnownErrors.RequiresCustomEmailServer) {
      toast({ title: "Action requires custom email server", variant: "destructive", description: "Please setup a custom email server and try again." });
    } else {
      toast({ title: "Failed to send email", variant: "destructive", description: "Unknown error" });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Typography className="font-medium">Recipients</Typography>
      <Select value={scope} onValueChange={(v) => setScope(v as "all" | "users")}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Users</SelectItem>
          <SelectItem value="users">Select Users</SelectItem>
        </SelectContent>
      </Select>
      {scope === "users" && (
        <div className="mt-2">
          <div className="mt-2">
            <Suspense fallback={<Skeleton className="h-20" />}>
              <TeamMemberSearchTable
                action={(user) => (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSelectedUserIds(userIds => userIds.some(u => u === user.id) ? userIds.filter(u => u !== user.id) : [...userIds, user.id])}
                  >
                    {selectedUserIds.some(u => u === user.id) ? 'Remove' : 'Add'}
                  </Button>
                )}
              />
            </Suspense>
          </div>
        </div>
      )}
      <div className="flex justify-center">
        <Button
          disabled={scope === "users" && selectedUserIds.length === 0}
          onClick={handleSubmit}
        >
          Send
        </Button>
      </div>
    </div>
  );
}
