import Editor, { Monaco } from '@monaco-editor/react';
import { runAsynchronously } from '@stackframe/stack-shared/dist/utils/promises';
import { deindent } from '@stackframe/stack-shared/dist/utils/strings';
import { useTheme } from 'next-themes';
import { dtsBundles } from './dts';
import { useState, useCallback } from 'react';

type CodeEditorProps = {
  code: string,
  onCodeChange: (code: string) => void,
}

export default function CodeEditor({
  code,
  onCodeChange,
}: CodeEditorProps) {
  const { resolvedTheme } = useTheme();

  const handleBeforeMount = (monaco: Monaco) => {
    monaco.editor.defineTheme('stack-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#0a0a0a",
        "editor.lineHighlightBackground": "#1a1a1a",
        "editorLineNumber.foreground": "#4a4a4a",
        "editorLineNumber.activeForeground": "#888888",
      },
    });

    monaco.editor.defineTheme('stack-light', {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#ffffff",
        "editor.lineHighlightBackground": "#f5f5f5",
        "editorLineNumber.foreground": "#999999",
        "editorLineNumber.activeForeground": "#666666",
      },
    });

    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ESNext,
      allowNonTsExtensions: true,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      module: monaco.languages.typescript.ModuleKind.ESNext,
      noEmit: true,
      esModuleInterop: true,
      jsx: monaco.languages.typescript.JsxEmit.React,
      jsxFactory: 'React.createElement',
      jsxFragmentFactory: 'React.Fragment',
      reactNamespace: 'React',
      allowJs: false,
      allowSyntheticDefaultImports: true,
      skipLibCheck: true,
      strict: true,
      strictNullChecks: true,
      strictFunctionTypes: false,
      exactOptionalPropertyTypes: true,
    });
    runAsynchronously(addTypeFiles(monaco));
  };

  const fetchAndAddTypeDefinition = async (
    monaco: Monaco,
    moduleName: string,
    url: string,
    transform?: (content: string) => string,
  ) => {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const content = await response.text();
        const transformed = transform ? transform(content) : content;
        monaco.languages.typescript.typescriptDefaults.addExtraLib(transformed, `file:///node_modules/${moduleName}/index.d.ts`);
      }
    } catch (error) {
      console.warn(`Failed to fetch type definitions from ${url}:`, error);
    }
  };

  const addTypeFiles = async (monaco: Monaco) => {
    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      deindent`
        import * as React from 'react';
        declare global {
          const React: typeof import('react');
        }
      `,
    );
    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      deindent`
        declare module "@stackframe/emails" {
          const Subject: React.FC<{value: string}>;
          const NotificationCategory: React.FC<{value: "Transactional" | "Marketing"}>;
          type Props<T = never> = {
            variables: T;
            project: {
              displayName: string;
            };
            user: {
              displayName: string | null;
            };
          };
          type ThemeProps = {
            children: React.ReactNode;
            unsubscribeLink?: string;
            projectLogos: {
              logoUrl?: string;
              logoFullUrl?: string;
              logoDarkModeUrl?: string;
              logoFullDarkModeUrl?: string;
            };
          };
          const ProjectLogo: React.FC<{data: ThemeProps['projectLogos'], mode: 'light' | 'dark'}>;
        }
      `,
    );
    monaco.languages.typescript.typescriptDefaults.addExtraLib(dtsBundles.arkType);
    monaco.languages.typescript.typescriptDefaults.addExtraLib(dtsBundles.arkUtil);
    monaco.languages.typescript.typescriptDefaults.addExtraLib(dtsBundles.arkSchema);

    const reactEmailPackages = [
      'components', 'body', 'button', 'code-block', 'code-inline', 'column',
      'container', 'font', 'head', 'heading', 'hr', 'html', 'img', 'link',
      'markdown', 'preview', 'row', 'section', 'tailwind', 'text'
    ];
    await Promise.all([
      // latest version of react causes type issue with rendering react-email components
      fetchAndAddTypeDefinition(monaco, 'react', 'https://unpkg.com/@types/react@18.0.38/index.d.ts'),
      fetchAndAddTypeDefinition(monaco, 'csstype', 'https://unpkg.com/csstype@3.1.3/index.d.ts'),
      ...reactEmailPackages.map(packageName =>
        fetchAndAddTypeDefinition(
          monaco,
          `@react-email/${packageName}`,
          `https://unpkg.com/@react-email/${packageName}/dist/index.d.ts`,
          packageName === "tailwind" ? transformTailwindTypeFile : undefined
        )
      ),
    ]);
  };

  const transformTailwindTypeFile = (content: string) => {
    return content.replace(
      /}\s*:\s*TailwindProps\)\s*:\s*React\.ReactNode;/,
      '}: TailwindProps): JSX.Element | null;'
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          theme={resolvedTheme === "dark" ? "stack-dark" : "stack-light"}
          defaultLanguage="typescript"
          defaultPath="file:///main.tsx"
          value={code}
          onChange={value => onCodeChange(value ?? "")}
          beforeMount={handleBeforeMount}
          options={{
            quickSuggestions: { strings: "on" },
            minimap: { enabled: false },
            tabSize: 2,
            overviewRulerLanes: 0,
            overviewRulerBorder: false,
            fixedOverflowWidgets: true,
            lineNumbers: 'on',
            fontSize: 13,
            fontFamily: 'var(--font-geist-mono)',
            padding: { top: 16, bottom: 16 },
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            cursorBlinking: 'smooth',
            cursorSmoothCaretAnimation: 'on',
            renderLineHighlight: 'line',
            bracketPairColorization: { enabled: true },
            glyphMargin: false,
            folding: true,
            lineDecorationsWidth: 8,
            lineNumbersMinChars: 4,
            wordWrap: 'on',
            wrappingStrategy: 'advanced',
            wrappingIndent: 'indent',
            scrollbar: {
              verticalScrollbarSize: 8,
              horizontalScrollbarSize: 8,
              useShadows: false,
            },
          }}
        />
      </div>
    </div>
  );
}
