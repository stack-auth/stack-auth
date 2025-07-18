import Editor, { Monaco } from '@monaco-editor/react';
import { runAsynchronously } from '@stackframe/stack-shared/dist/utils/promises';
import { Spinner, Typography, toast } from "@stackframe/stack-ui";
import { debounce } from 'lodash';
import { useTheme } from 'next-themes';
import { useMemo, useState } from 'react';

type CodeEditorProps = {
  code: string,
  onCodeChange: (code: string) => void,
  onDebouncedCodeChange: (code: string) => Promise<void>,
  title?: string,
}

export default function CodeEditor({
  code,
  onCodeChange,
  onDebouncedCodeChange,
  title = "Code"
}: CodeEditorProps) {
  const { theme } = useTheme();
  const [isLoading, setIsLoading] = useState(false);

  const debouncedUpdate = useMemo(
    () => debounce(
      async (value: string) => {
        setIsLoading(true);
        try {
          await onDebouncedCodeChange(value);
        } catch (error) {
          toast({
            title: "Failed to render email",
            description: "There was an error rendering email preview",
            variant: "destructive",
          });
        } finally {
          setIsLoading(false);
        }
      },
      500,
    ),
    [onDebouncedCodeChange],
  );

  const handleChange = (value?: string) => {
    if (!value) {
      return;
    }
    onCodeChange(value);
    runAsynchronously(debouncedUpdate(value));
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
        <Typography type="h4">{title}</Typography>
        {isLoading && <Spinner />}
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
