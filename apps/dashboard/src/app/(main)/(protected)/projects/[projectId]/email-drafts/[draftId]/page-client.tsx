"use client";

import { TeamMemberSearchTable } from "@/components/data-table/team-member-search-table";
import EmailPreview, { type OnWysiwygEditCommit } from "@/components/email-preview";
import { EmailThemeSelector } from "@/components/email-theme-selector";
import { useRouterConfirm } from "@/components/router";
import { Badge, Button, Card, CardContent, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, Typography, toast, useToast } from "@/components/ui";
import { AssistantChat, CodeEditor, VibeCodeLayout, type ViewportMode, type WysiwygDebugInfo } from "@/components/vibe-coding";
import { type WysiwygDebugInfo as EmailDebugInfo } from "@/components/email-preview";
import { ToolCallContent, createChatAdapter, createHistoryAdapter } from "@/components/vibe-coding/chat-adapters";
import { EmailDraftUI } from "@/components/vibe-coding/draft-tool-components";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { useAdminApp } from "../../use-admin-app";

export default function PageClient({ draftId }: { draftId: string }) {
  const stackAdminApp = useAdminApp();
  const { setNeedConfirm } = useRouterConfirm();
  const { toast } = useToast();

  const drafts = stackAdminApp.useEmailDrafts();
  const draft = useMemo(() => drafts.find((d) => d.id === draftId), [drafts, draftId]);

  const [currentCode, setCurrentCode] = useState<string>(draft?.tsxSource ?? "");
  const [stage, setStage] = useState<"edit" | "send">("edit");
  const [selectedThemeId, setSelectedThemeId] = useState<string | undefined | false>(draft?.themeId);
  const [viewport, setViewport] = useState<ViewportMode>('edit');
  const [wysiwygDebugInfo, setWysiwygDebugInfo] = useState<WysiwygDebugInfo | undefined>(undefined);

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

  const handleSave = async () => {
    try {
      await stackAdminApp.updateEmailDraft(draftId, { tsxSource: currentCode, themeId: selectedThemeId });
      toast({ title: "Draft saved", variant: "success" });
    } catch (error) {
      if (error instanceof KnownErrors.EmailRenderingError) {
        toast({ title: "Failed to save draft", variant: "destructive", description: error.message });
        return;
      }
      toast({ title: "Failed to save draft", variant: "destructive", description: "Unknown error" });
    }
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

  const handleUndo = () => {
    if (draft) {
      setCurrentCode(draft.tsxSource);
      setSelectedThemeId(draft.themeId);
    }
  };

  const previewActions = null;
  const isDirty = currentCode !== draft?.tsxSource || selectedThemeId !== draft.themeId;

  // Handle WYSIWYG edit commits - calls the AI endpoint to update source code
  const handleWysiwygEditCommit: OnWysiwygEditCommit = useCallback(async (data) => {
    const result = await stackAdminApp.applyWysiwygEdit({
      sourceType: 'draft',
      sourceCode: currentCode,
      oldText: data.oldText,
      newText: data.newText,
      metadata: data.metadata,
      domPath: data.domPath,
      htmlContext: data.htmlContext,
    });
    setCurrentCode(result.updatedSource);
    return result.updatedSource;
  }, [stackAdminApp, currentCode]);

  return (
    <AppEnabledGuard appId="emails">
      {stage === "edit" ? (
        <VibeCodeLayout
          viewport={viewport}
          onViewportChange={setViewport}
          onSave={handleSave}
          saveLabel="Save draft"
          onUndo={handleUndo}
          isDirty={isDirty}
          previewActions={previewActions}
          editorTitle="Draft Source Code"
          editModeEnabled
          wysiwygDebugInfo={wysiwygDebugInfo}
          headerAction={
            <EmailThemeSelector
              selectedThemeId={selectedThemeId}
              onThemeChange={setSelectedThemeId}
            />
          }
          primaryAction={{
            label: "Next: Recipients",
            onClick: handleNext,
          }}
          previewComponent={
            <EmailPreview
              themeId={selectedThemeId}
              templateTsxSource={currentCode}
              editMode={viewport === 'edit'}
              viewport={viewport === 'desktop' || viewport === 'edit' ? undefined : (viewport === 'tablet' ? { id: 'tablet', name: 'Tablet', width: 820, height: 1180, type: 'tablet' } : { id: 'phone', name: 'Phone', width: 390, height: 844, type: 'phone' })}
              emailSubject={draft?.displayName}
              onDebugInfoChange={setWysiwygDebugInfo}
              onWysiwygEditCommit={handleWysiwygEditCommit}
            />
          }
          editorComponent={
            <CodeEditor
              code={currentCode}
              onCodeChange={setCurrentCode}
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
    </AppEnabledGuard>
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
