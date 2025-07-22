import Editor, { Monaco } from '@monaco-editor/react';
import { runAsynchronously } from '@stackframe/stack-shared/dist/utils/promises';
import { deindent } from '@stackframe/stack-shared/dist/utils/strings';
import { Typography } from "@stackframe/stack-ui";
import { useTheme } from 'next-themes';


type CodeEditorProps = {
  code: string,
  onCodeChange: (code: string) => void,
  action?: React.ReactNode,
  title?: string,
}

export default function CodeEditor({
  code,
  onCodeChange,
  action,
  title = "Code"
}: CodeEditorProps) {
  const { theme } = useTheme();

  const handleBeforeMount = (monaco: Monaco) => {
    monaco.editor.defineTheme('stack-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#000000",
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
      exactOptionalPropertyTypes: true,
    });
    runAsynchronously(addTypeFiles(monaco));
  };

  const fetchAndAddTypeDefinition = async (
    monaco: Monaco,
    moduleName: string,
    url: string,
  ) => {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const content = await response.text();
        monaco.languages.typescript.typescriptDefaults.addExtraLib(content, `file:///node_modules/${moduleName}/index.d.ts`);
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
        }
      `,
    );
    // There is some issue with arktype type definitions and monaco editor that isn't letting them work properly.
    // TODO: add actual type definitions for arktype.
    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      deindent`
        declare module "arktype" {
          const type: any;
        }
      `,
    );

    const reactEmailPackages = [
      'components', 'body', 'button', 'code-block', 'code-inline', 'column',
      'container', 'font', 'head', 'heading', 'hr', 'html', 'img', 'link',
      'markdown', 'preview', 'render', 'row', 'section', 'tailwind', 'text'
    ];
    await Promise.all([
      // latest version of react causes type issue with rendering react-email components
      fetchAndAddTypeDefinition(monaco, 'react', 'https://unpkg.com/@types/react@18.0.38/index.d.ts'),
      fetchAndAddTypeDefinition(monaco, 'csstype', 'https://unpkg.com/csstype@3.1.3/index.d.ts'),
      ...reactEmailPackages.map(packageName =>
        fetchAndAddTypeDefinition(monaco, `@react-email/${packageName}`, `https://unpkg.com/@react-email/${packageName}/dist/index.d.ts`)
      ),
    ]);
  };

  return (
    <>
      <div className="p-3 flex justify-between items-center">
        <Typography type="h4">{title}</Typography>
        {action}
      </div>
      <Editor
        height="100%"
        theme={theme === "dark" ? "stack-dark" : "vs-light"}
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
          fixedOverflowWidgets: true // fixes issue with tooltips getting clipped
        }}
      />
    </>
  );
}
