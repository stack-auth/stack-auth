"use client";

import { Thread } from "@/components/assistant-ui/thread";
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
  Card, ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup, Spinner, TooltipProvider, Typography,
  toast
} from "@stackframe/stack-ui";
import debounce from "lodash/debounce";
import { CheckCircle, XCircle } from "lucide-react";
import { useTheme } from 'next-themes';
import { useMemo, useState } from "react";
import { useAdminApp } from "../../use-admin-app";
import ThemePreview, { previewEmailHtml } from "@/components/theme-preview";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { ChatContent } from "@stackframe/stack-shared/dist/interface/admin-interface";


export default function PageClient({ themeId }: { themeId: string }) {
  const stackAdminApp = useAdminApp();
  const theme = stackAdminApp.useEmailTheme(themeId);
  const [renderedHtml, setRenderedHtml] = useState<string>();
  const [currentCode, setCurrentCode] = useState(theme.tsxSource);

  return (
    <ResizablePanelGroup direction="horizontal" className="flex h-full">
      <ResizablePanel className="flex-1 flex flex-col" defaultSize={75}>
        <ResizablePanelGroup direction="vertical" className="flex h-full">
          <ResizablePanel className="flex flex-col flex-1 flex-shrink h-full" minSize={10}>
            <div className="p-3 flex justify-between items-center">
              <Typography type="h4">Preview</Typography>
            </div>
            <div className="flex-1 p-6">
              <ThemePreview themeId={themeId} renderedHtmlOverride={renderedHtml} />
            </div>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel className="flex-1 flex flex-col" minSize={10}>
            <DevServerEditor
              themeId={themeId}
              code={currentCode}
              setCode={setCurrentCode}
              setRenderedHtml={setRenderedHtml}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel className="w-96 flex flex-col">
        <DevServerChat
          themeId={themeId}
          currentEmailTheme={currentCode}
          setCode={setCurrentCode}
          setRenderedHtml={setRenderedHtml}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}


function DevServerEditor({
  code,
  themeId,
  setCode,
  setRenderedHtml
}: {
  code: string,
  themeId: string,
  setCode: (code: string) => void,
  setRenderedHtml: (renderedHtml: string) => void,
}) {
  const { theme } = useTheme();
  const [loading, setLoading] = useState(false);
  const adminApp = useAdminApp();

  const debouncedUpdateCode = useMemo(
    () => debounce(
      async (value: string) => {
        setLoading(true);
        try {
          const { rendered_html } = await adminApp.updateEmailTheme(themeId, value, previewEmailHtml);
          setRenderedHtml(rendered_html);
        } catch (error) {
          if (KnownErrors.EmailRenderingError.isInstance(error)) {
            toast({
              title: "Failed to render email",
              description: error.message,
              variant: "destructive",
            });
            return;
          }
        } finally {
          setLoading(false);
        }
      },
      500,
    ),
    [adminApp, themeId, setRenderedHtml],
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
        {loading && <Spinner />}
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


function DevServerChat({
  themeId,
  currentEmailTheme,
  setCode,
  setRenderedHtml
}: {
  themeId: string,
  currentEmailTheme: string,
  setCode: (code: string) => void,
  setRenderedHtml: (renderedHtml: string) => void,
}) {
  const adminApp = useAdminApp();

  const isToolCall = (
    content: { type: string }
  ): content is Extract<ChatContent[number], { type: "tool-call" }> => {
    return content.type === "tool-call";
  };

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

        const response = await adminApp.sendEmailThemeChatMessage(themeId, currentEmailTheme, formattedMessages, abortSignal);
        if (response.content.some(isToolCall)) {
          setCode(response.content.find(isToolCall)?.args.content);
          adminApp.getEmailThemePreview(themeId, previewEmailHtml)
            .then(setRenderedHtml)
            .catch(() => toast({
              title: "Failed to render email",
              description: "There was an error rendering email preview",
              variant: "destructive",
            }));
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
      const { messages } = await adminApp.listEmailThemeChatMessages(themeId);
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
    async append() { },
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
