"use client";

import { codePanelHeaderClasses, codePanelShellClasses } from "@/components/code-block";
import { useTheme } from "@/lib/theme";
import Editor from "@monaco-editor/react";
import { configureWorkflowsMonaco } from "../../workflows/shared";
import { getWorkflowFileName } from "../../workflows/run-states";

/**
 * Read-only Monaco viewer for an action item's attached workflow source. Deliberately NOT the
 * workflows app's EditableCodePanel: that panel deploys a new version on save, while the growth
 * action detail must only ever *show* the proposed/deployed source — edits belong in the workflows
 * app, where versioning and deploy semantics are explicit. Reuses configureWorkflowsMonaco so the
 * typedefs, diagnostics, and syntax setup can never drift from the real editor.
 */
export function GrowthWorkflowSourceViewer(props: { workflowId: string, source: string, height?: number }) {
  const { resolvedTheme } = useTheme();
  return (
    <div className={codePanelShellClasses}>
      <div className={codePanelHeaderClasses}>
        <span className="font-mono text-xs">{getWorkflowFileName(props.workflowId)}</span>
        <span className="text-[11px] text-muted-foreground">read-only</span>
      </div>
      <Editor
        height={props.height ?? 380}
        language="typescript"
        path={`file:///growth-workflows/${props.workflowId}.ts`}
        value={props.source}
        theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
        beforeMount={configureWorkflowsMonaco}
        options={{
          readOnly: true,
          minimap: { enabled: false },
          fontSize: 12,
          scrollBeyondLastLine: false,
          wordWrap: "on",
          automaticLayout: true,
          padding: { top: 12, bottom: 12 },
        }}
      />
    </div>
  );
}
