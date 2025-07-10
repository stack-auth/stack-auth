"use client";

import { Thread } from "@/components/assistant-ui/thread";
import { FormDialog } from "@/components/form-dialog";
import { InputField } from "@/components/form-fields";
import {
  AssistantRuntimeProvider,
  makeAssistantToolUI,
  useLocalRuntime,
  type ThreadHistoryAdapter,
  type ChatModelAdapter,
  type ThreadMessage,
} from "@assistant-ui/react";
import Editor, { Monaco } from '@monaco-editor/react';
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import {
  Button, Card, ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup, TooltipProvider, Typography
} from "@stackframe/stack-ui";
import debounce from "lodash/debounce";
import { CheckCircle, XCircle } from "lucide-react";
import { useTheme } from 'next-themes';
import { useEffect, useMemo, useState } from "react";
import * as yup from "yup";
import { useAdminApp } from "../../../use-admin-app";


export default function PageClient({ repoId }: { repoId: string }) {
  const stackAdminApp = useAdminApp();
  const [devServerUrl, setDevServerUrl] = useState<string>();
  const [emailThemeCounter, setEmailThemeCounter] = useState(0);

  useEffect(() => {
    runAsynchronously(stackAdminApp.requestEmailThemeDevServer(repoId).then(res => setDevServerUrl(res.previewUrl)));
  }, [stackAdminApp, repoId, setDevServerUrl]);

  return (
    <ResizablePanelGroup direction="horizontal" className="flex h-full">
      <ResizablePanel className="flex-1 flex flex-col" defaultSize={75}>
        <ResizablePanelGroup direction="vertical" className="flex h-full">
          <ResizablePanel className="flex flex-col flex-1 flex-shrink h-full" minSize={10}>
            <DevServerPreview devServerUrl={devServerUrl} repoId={repoId} />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel className="flex-1 flex flex-col" minSize={10}>
            <DevServerEditor repoId={repoId} emailThemeCounter={emailThemeCounter} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel className="w-96 flex flex-col">
        <DevServerChat
          repoId={repoId}
          onEmailThemeUpdated={() => setEmailThemeCounter(emailThemeCounter + 1)}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}


function SaveThemeDialog({ repoId, trigger }: { repoId: string, trigger: React.ReactNode }) {
  const adminApp = useAdminApp();
  const themeNameSchema = yup.object({
    name: yup.string().defined()
  });

  const handleCreateTheme = async (values: { name: string }) => {
    await adminApp.createEmailTheme(repoId, values.name);
  };

  return (
    <FormDialog
      trigger={trigger}
      title="Create Theme"
      formSchema={themeNameSchema}
      okButton={{ label: "Create" }}
      onSubmit={handleCreateTheme}
      render={(form) => (
        <InputField
          control={form.control}
          name="name"
          label="Theme Name"
          placeholder="Enter theme name"
          required
        />
      )}
    />
  );
}

function DevServerPreview({ devServerUrl, repoId }: { devServerUrl?: string, repoId: string }) {
  return (
    <>
      <div className="p-3 flex justify-between items-center">
        <Typography type="h4">Preview</Typography>
        <SaveThemeDialog
          repoId={repoId}
          trigger={<Button>Create Theme</Button>}
        />
      </div>
      <div className="flex-1">
        <iframe
          src={devServerUrl}
          className="w-full h-full"
          title="Email Theme Preview"
        />
      </div>
    </>
  );
}


function DevServerEditor({ repoId, emailThemeCounter }: { repoId: string, emailThemeCounter: number }) {
  const { theme } = useTheme();
  const adminApp = useAdminApp();
  const [code, setCode] = useState("");

  useEffect(() => {
    adminApp.getEmailThemeDevServerFile(repoId, "theme").then((file) => {
      setCode(file.content);
    });
  }, [adminApp, repoId, emailThemeCounter]);

  const debouncedUpdateCode = useMemo(
    () => debounce(
      (value: string) => adminApp.updateEmailThemeDevServerFile(repoId, "theme", value),
      250,
    ),
    [adminApp, repoId],
  );

  const handleChange = (value?: string) => {
    if (!value) {
      return;
    }
    setCode(value);
    runAsynchronously(debouncedUpdateCode(value));
  };

  const handleBeforeMount = (monaco: Monaco) => {
    monaco.editor.defineTheme('stack-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#000000",
      },
    });
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: false,
    });
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      jsx: monaco.languages.typescript.JsxEmit.React,
    });
  };

  return (
    <>
      <div className="p-3 flex justify-between items-center">
        <Typography type="h4">Code</Typography>
      </div>
      <Editor
        height="100%"
        theme={theme === "dark" ? "stack-dark" : "vs-light"}
        defaultLanguage="typescript"
        value={code}
        onChange={handleChange}
        beforeMount={handleBeforeMount}
        options={{
          minimap: { enabled: false },
          tabSize: 2,
          scrollbar: {
            vertical: "hidden",
            horizontal: "hidden",
          },
          overviewRulerLanes: 0,
          overviewRulerBorder: false,
        }}
      />
    </>
  );
}


function DevServerChat({ repoId, onEmailThemeUpdated }: { repoId: string, onEmailThemeUpdated: () => void }) {
  const adminApp = useAdminApp();

  const chatAdapter: ChatModelAdapter = {
    async run({ messages, abortSignal }) {
      try {
        const formattedMessages = messages.map((msg) => ({
          role: msg.role,
          content: msg.content.map((part) => {
            if (part.type === 'text') {
              return part.text;
            }
            return '';
          }).join(''),
        }));

        const response = await adminApp.sendDevServerChatMessage(repoId, formattedMessages, abortSignal);
        if (response.content.some((block) => block.type === "tool-call")) {
          onEmailThemeUpdated();
        }
        return {
          content: response.content,
        };
      } catch (error) {
        if (abortSignal.aborted) {
          return {};
        }
        throw error;
      }
    },
  };

  const CreateEmailThemeUI = makeAssistantToolUI<{ content: string }, { success: boolean }>({
    toolName: "createEmailTheme",
    render: ({ result }) => {
      return (
        <Card className="flex items-center gap-2 p-4">
          {result?.success ? <CheckCircle className="size-4 text-green-500" /> : <XCircle className="size-4 text-red-500" />}
          <span className="text-sm">Created email theme</span>
        </Card>
      );
    },
  });

  const historyAdapter: ThreadHistoryAdapter = {
    async load() {
      const { messages } = await adminApp.listChatMessages(repoId);
      return {
        messages: messages.map((message, index) => ({
          message: {
            role: message.role as "user" | "assistant",
            content: message.content,
            id: index.toString(),
            status: {
              type: "complete",
              reason: "stop",
            },
            createdAt: new Date(),
            metadata: {
              custom: {},
            } as ThreadMessage["metadata"],
          } as ThreadMessage,
          parentId: index > 0 ? (index - 1).toString() : null,
        })),
      };
    },
    async append() {},
  };

  const runtime = useLocalRuntime(
    chatAdapter,
    { adapters: { history: historyAdapter } }
  );
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <CreateEmailThemeUI />
      <TooltipProvider>
        <Thread />
      </TooltipProvider>
    </AssistantRuntimeProvider>
  );
};
