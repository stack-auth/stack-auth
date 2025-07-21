import Editor, { Monaco } from '@monaco-editor/react';
import { Spinner, Typography } from "@stackframe/stack-ui";
import { useTheme } from 'next-themes';

type VibeCodeEditorProps = {
  code: string,
  onCodeChange: (code: string) => void,
  isLoading?: boolean,
  title?: string,
}

export default function VibeCodeEditor({
  code,
  onCodeChange,
  isLoading = false,
  title = "Code"
}: VibeCodeEditorProps) {
  const { theme } = useTheme();

  const handleChange = (value?: string) => {
    if (!value) {
      return;
    }
    onCodeChange(value);
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
