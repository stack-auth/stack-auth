"use client";

import { TeamMemberSearchTable } from "@/components/data-table/team-member-search-table";
import EmailPreview from "@/components/email-preview";
import { useRouterConfirm } from "@/components/router";
import { AssistantChat, CodeEditor, VibeCodeLayout } from "@/components/vibe-coding";
import { createChatAdapter, createHistoryAdapter, ToolCallContent } from "@/components/vibe-coding/chat-adapters";
import { UserAvatar } from "@stackframe/stack";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Typography, useToast } from "@stackframe/stack-ui";
import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
  const [selectedUsers, setSelectedUsers] = useState<any[]>([]);
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
      throw error;
    }
  };

  const handleSend = async (values: { scope: "all" | "users"; subject: string; notificationCategoryName: "Transactional" | "Marketing"; }) => {
    const userIds = values.scope === "all" ? (await stackAdminApp.listUsers({ limit: 1000 })).map(u => u.id) : selectedUsers.map(u => u.id);
    await stackAdminApp.sendEmail({
      userIds,
      templateTsxSource: currentCode,
      themeId: selectedThemeId || undefined,
    } as any);
    toast({ title: "Email sent", variant: "success" });
  };

  return (
    <>
      {stage === "edit" ? (
        <VibeCodeLayout
          previewComponent={
            <EmailPreview themeId={selectedThemeId ?? false} templateTsxSource={currentCode} />
          }
          editorComponent={
            <CodeEditor
              code={currentCode}
              onCodeChange={setCurrentCode}
              action={
                <div className="flex gap-2">
                  <EmailThemeSelector selectedThemeId={selectedThemeId} onThemeChange={setSelectedThemeId} className="w-48" />
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
        <SendStage
          selectedUsers={selectedUsers}
          setSelectedUsers={setSelectedUsers}
          onSend={handleSend}
        />
      )}
    </>
  );
}

function SendStage({ selectedUsers, setSelectedUsers, onSend }: {
  selectedUsers: any[],
  setSelectedUsers: (fn: (prev: any[]) => any[]) => void,
  onSend: (v: { scope: "all" | "users", subject: string, notificationCategoryName: "Transactional" | "Marketing" }) => Promise<void>,
}) {
  const [scope, setScope] = useState<"all" | "users">("all");
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<"Transactional" | "Marketing">("Transactional");

  const handleSubmit = async () => {
    await onSend({ scope, subject, notificationCategoryName: category });
  };

  return (
    <div className="flex flex-col gap-4">
      <Typography className="font-medium">Recipients</Typography>
      <div className="flex items-center gap-4">
        <Button variant={scope === "all" ? "default" : "secondary"} onClick={() => setScope("all")}>All Users</Button>
        <Button variant={scope === "users" ? "default" : "secondary"} onClick={() => setScope("users")}>Select Users</Button>
      </div>

      {scope === "users" && (
        <div className="mt-2">
          <SelectedChips users={selectedUsers} setSelectedUsers={setSelectedUsers} />
          <div className="mt-2">
            <TeamMemberSearchTable action={(user) => (
              <Button size="sm" variant="outline" onClick={() => setSelectedUsers(users => users.some(u => u.id === user.id) ? users.filter(u => u.id !== user.id) : [...users, user])}>
                {selectedUsers.some(u => u.id === user.id) ? 'Remove' : 'Add'}
              </Button>
            )} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Typography className="mb-1">Subject</Typography>
          <input className="w-full border rounded px-3 py-2 bg-background" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div>
          <Typography className="mb-1">Notification Category</Typography>
          <Select value={category} onValueChange={(v) => setCategory(v as any)}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Select category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Transactional">Transactional</SelectItem>
              <SelectItem value="Marketing">Marketing</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Button onClick={handleSubmit}>Send</Button>
      </div>
    </div>
  );
}

function SelectedChips({ users, setSelectedUsers }: { users: any[]; setSelectedUsers: (fn: (prev: any[]) => any[]) => void; }) {
  if (users.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {users.map((user) => (
        <div key={user.id} className="relative group flex items-center gap-2 border rounded-full px-3 py-1">
          <UserAvatar user={user} size={20} />
          <span className="text-sm">{user.primaryEmail}</span>
          <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => setSelectedUsers(prev => prev.filter(u => u.id !== user.id))}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}
    </div>
  );
}

