"use client";

import { TeamMemberSearchTable } from "@/components/data-table/team-member-search-table";
import EmailPreview from "@/components/email-preview";
import { EmailThemeSelector } from "@/components/email-theme-selector";
import { useRouterConfirm } from "@/components/router";
import { AssistantChat, CodeEditor, VibeCodeLayout } from "@/components/vibe-coding";
import { createChatAdapter, createHistoryAdapter, ToolCallContent } from "@/components/vibe-coding/chat-adapters";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, toast, Typography, useToast } from "@stackframe/stack-ui";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useAdminApp } from "../../use-admin-app";
import { EmailDraftUI } from "@/components/vibe-coding/draft-tool-components";

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
    if (stage !== "edit") return;

    setNeedConfirm(true);
    return () => setNeedConfirm(false);
  }, [setNeedConfirm, draft, currentCode, selectedThemeId, stage]);

  const handleToolUpdate = (toolCall: ToolCallContent) => {
    setCurrentCode(toolCall.args.content);
  };

  const handleNext = async () => {
    try {
      await stackAdminApp.updateEmailDraft(draftId, { tsxSource: currentCode, themeId: selectedThemeId });
      setStage("send");
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
              chatAdapter={createChatAdapter(stackAdminApp, draftId, "email-draft", handleToolUpdate)}
              toolComponents={<EmailDraftUI setCurrentCode={setCurrentCode} />}
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
    await stackAdminApp.sendEmail(
      scope === "users"
        ? { draftId, userIds: selectedUserIds }
        : { draftId, allUsers: true }
    );
    toast({ title: "Email sent", variant: "success" });
  };

  return (
    <div className="mx-auto w-full max-w-4xl p-4">
      <Card className="p-4">
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <Typography className="font-medium">Recipients</Typography>
            {scope === "users" && (
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{selectedUserIds.length} selected</Badge>
                {selectedUserIds.length > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => setSelectedUserIds([])}>Clear</Button>
                )}
              </div>
            )}
          </div>
          <div className="max-w-sm">
            <Select value={scope} onValueChange={(v) => setScope(v as "all" | "users")}>
              <SelectTrigger>
                <SelectValue placeholder="Choose recipients" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All users</SelectItem>
                <SelectItem value="users">Select users…</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {scope === "users" && (
            <div className="mt-2">
              <Suspense fallback={<Skeleton className="h-20" />}>
                <TeamMemberSearchTable
                  action={(user) => (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSelectedUserIds(userIds => userIds.some(u => u === user.id) ? userIds.filter(u => u !== user.id) : [...userIds, user.id])}
                    >
                      {selectedUserIds.some(u => u === user.id) ? "Remove" : "Add"}
                    </Button>
                  )}
                />
              </Suspense>
            </div>
          )}
          <div className="flex justify-end">
            <Button
              disabled={scope === "users" && selectedUserIds.length === 0}
              onClick={handleSubmit}
            >
              Send
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
