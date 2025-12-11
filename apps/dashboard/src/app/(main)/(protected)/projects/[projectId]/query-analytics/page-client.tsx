"use client";

import Editor from "@monaco-editor/react";
import type { Monaco } from "@monaco-editor/react";
import React, { useEffect, useMemo, useRef } from "react";
import { Alert, Button, Textarea, Typography } from "@stackframe/stack-ui";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";
import { clickhouseKeywords, clickhouseTables, conf, language } from "./monaco-clickhouse";

const CLICKHOUSE_LANGUAGE_ID = "clickhouse-sql";

type Disposable = { dispose: () => void };
type CompletionItem = Parameters<Monaco["languages"]["registerCompletionItemProvider"]>[1]["provideCompletionItems"] extends (
  ...args: any
) => infer R
  ? R extends { suggestions: Array<infer U> }
    ? U
    : never
  : never;

export default function PageClient() {
  const adminApp = useAdminApp();
  const [query, setQuery] = React.useState("SELECT 1 AS value;");
  const [resultText, setResultText] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const disposables = useRef<Disposable[]>([]);
  const queryRef = useRef(query);

  const tableColumnSuggestions = useMemo(() => {
    return Object.entries(clickhouseTables).flatMap(([table, columns]) =>
      columns.map((column) => ({ table, column })),
    );
  }, []);

  useEffect(() => {
    const disposablesToDispose = disposables.current;
    return () => {
      disposablesToDispose.forEach((d) => d.dispose());
    };
  }, []);

  const runQuery = () => {
    const currentQuery = queryRef.current.trim();
    if (!currentQuery) {
      return;
    }

    const execute = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await adminApp.queryAnalytics({
          query: currentQuery,
          include_all_branches: false,
        });
        setResultText(JSON.stringify(response.result, null, 2));
      } catch (e: any) {
        setError(e?.message ?? "Failed to run analytics query.");
        setResultText("");
      } finally {
        setLoading(false);
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    void execute();
  };

  const handleEditorMount: Parameters<typeof Editor>[0]["onMount"] = (instance, monaco: Monaco) => {
    if (!monaco.languages.getLanguages().some((lang) => lang.id === CLICKHOUSE_LANGUAGE_ID)) {
      monaco.languages.register({ id: CLICKHOUSE_LANGUAGE_ID });
      monaco.languages.setLanguageConfiguration(CLICKHOUSE_LANGUAGE_ID, conf);
      monaco.languages.setMonarchTokensProvider(CLICKHOUSE_LANGUAGE_ID, language);
    }

    disposables.current.push(
      monaco.languages.registerCompletionItemProvider(CLICKHOUSE_LANGUAGE_ID, {
        triggerCharacters: [".", " "],
        provideCompletionItems: (model, position) => {
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };

          const linePrefix = model.getValueInRange({
            startLineNumber: position.lineNumber,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          });

          const tableMatch = /([a-zA-Z_][\w]*)\.\s*$/.exec(linePrefix);
          const suggestions: CompletionItem[] = [];

          if (tableMatch) {
            const tableName = tableMatch[1].toLowerCase();
            const columns = (clickhouseTables as Record<string, readonly string[] | undefined>)[tableName];
            if (columns) {
              columns.forEach((column) => {
                suggestions.push({
                  label: column,
                  kind: monaco.languages.CompletionItemKind.Field,
                  insertText: column,
                  range,
                  detail: `${tableName}.${column}`,
                });
              });
            }
          } else {
            Object.keys(clickhouseTables).forEach((table) => {
              suggestions.push({
                label: table,
                kind: monaco.languages.CompletionItemKind.Class,
                insertText: table,
                range,
                detail: "Table",
              });
            });

            tableColumnSuggestions.forEach(({ table, column }) => {
              suggestions.push({
                label: `${table}.${column}`,
                kind: monaco.languages.CompletionItemKind.Field,
                insertText: `${table}.${column}`,
                range,
              });
            });

            clickhouseKeywords.forEach((keyword) => {
              suggestions.push({
                label: keyword,
                kind: monaco.languages.CompletionItemKind.Keyword,
                insertText: keyword,
                range,
              });
            });
          }

          return { suggestions };
        },
      }),
    );

    const model = instance.getModel();
    if (model) {
      monaco.editor.setModelLanguage(model, CLICKHOUSE_LANGUAGE_ID);
    }

    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      void runQuery();
    });
  };

  return (
    <PageLayout
      title="Analytics Query"
      description="Run read-only analytics queries against your project's ClickHouse dataset."
      fillWidth
    >
      <div className="flex justify-center">
        <Button
          onClick={runQuery}
          loading={loading}
          disabled={loading || !queryRef.current.trim()}
        >
          Run query
        </Button>
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <div className="border border-border/50 rounded-md overflow-hidden h-[460px]">
            <Editor
              height="100%"
              defaultLanguage={CLICKHOUSE_LANGUAGE_ID}
              language={CLICKHOUSE_LANGUAGE_ID}
              value={query}
              onChange={(value) => {
                const next = value ?? "";
                setQuery(next);
                queryRef.current = next;
              }}
              onMount={handleEditorMount}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                scrollBeyondLastLine: false,
                wordWrap: "on",
                fixedOverflowWidgets: true,
                padding: { top: 10, bottom: 10 },
              }}
              theme="vs-dark"
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Textarea
            className="font-mono h-[460px]"
            readOnly
            spellCheck={false}
            value={resultText}
            placeholder="Query results will appear here."
          />
        </div>
      </div>
    </PageLayout>
  );
}
