"use client";

import { DesignButton, DesignCard } from "@/components/design-components";
import { StyledLink } from "@/components/link";
import { cn, SimpleTooltip } from "@/components/ui";
import { useThemeWatcher } from '@/lib/theme';
import MonacoEditor from '@monaco-editor/react';
import { DatabaseIcon } from "@phosphor-icons/react";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { parseJson, type Json } from "@stackframe/stack-shared/dist/utils/json";
import { useEffect, useMemo, useState } from "react";

type MetadataEditorProps = {
  title: string,
  initialValue: string,
  hint: string,
  onUpdate?: (value: Json) => Promise<void>,
};

function formatJson(json: Json) {
  return JSON.stringify(json, null, 2);
}

export function MetadataEditor({ title, initialValue, onUpdate, hint }: MetadataEditorProps) {
  const [hasChanged, setHasChanged] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  const { mounted, theme } = useThemeWatcher();

  const initialJson = useMemo(() => {
    const parsed = parseJson(initialValue);
    return parsed.status === "ok" ? parsed.data : throwErr("Metadata editor received invalid initial JSON");
  }, [initialValue]);
  const [value, setValue] = useState(formatJson(initialJson));
  const parsedValue = useMemo(() => {
    return parseJson(value);
  }, [value]);

  useEffect(() => {
    setValue(formatJson(initialJson));
    setHasChanged(false);
  }, [initialJson]);

  // Ensure proper mounting lifecycle
  useEffect(() => {
    setIsMounted(true);
    return () => {
      setIsMounted(false);
    };
  }, []);

  const handleSave = async () => {
    if (parsedValue.status === "ok") {
      const formatted = formatJson(parsedValue.data);
      setValue(formatted);
      await onUpdate?.(parsedValue.data);
      setHasChanged(false);
    }
  };

  // Only render Monaco when both mounted states are true
  const shouldRenderMonaco = mounted && isMounted;

  return <div className="flex flex-col gap-3">
    <div className="flex items-center gap-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <SimpleTooltip tooltip={hint} type="info" inline />
    </div>
    {shouldRenderMonaco ? (
      <div
        className={cn(
          "overflow-hidden rounded-xl bg-foreground/[0.025] transition-colors duration-150 hover:transition-none hover:bg-foreground/[0.04]",
          theme === 'dark' && "bg-foreground/[0.04] hover:bg-foreground/[0.06]",
        )}
      >
        <MonacoEditor
          key={`monaco-${theme}`} // Force recreation on theme change
          height="240px"
          defaultLanguage="json"
          value={value}
          onChange={(x) => {
            setValue(x ?? '');
            setHasChanged(true);
          }}
          theme={theme === 'dark' ? 'vs-dark' : 'vs'}
          options={{
            tabSize: 2,
            minimap: {
              enabled: false,
            },
            scrollBeyondLastLine: false,
            overviewRulerLanes: 0,
            lineNumbersMinChars: 3,
            showFoldingControls: 'never',
          }}
        />
      </div>
    ) : (
      <div className="h-[240px] overflow-hidden rounded-xl bg-foreground/[0.025] dark:bg-foreground/[0.04] flex items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading editor...</div>
      </div>
    )}
    <div className={cn(
      "self-end flex items-center gap-2 overflow-hidden transition-all duration-150 hover:transition-none h-0 opacity-0",
      hasChanged && "h-9 opacity-100",
    )}>
      <DesignButton
        variant="ghost"
        size="sm"
        onClick={() => {
          setValue(formatJson(initialJson));
          setHasChanged(false);
        }}>
        Revert
      </DesignButton>
      <DesignButton
        variant={parsedValue.status === "ok" ? "default" : "secondary"}
        size="sm"
        disabled={parsedValue.status !== "ok"}
        onClick={handleSave}>Save</DesignButton>
    </div>
  </div>;
}

type MetadataSectionProps = {
  clientMetadata: Json,
  clientReadOnlyMetadata: Json,
  serverMetadata: Json,
  onUpdateClientMetadata: (value: Json) => Promise<void>,
  onUpdateClientReadOnlyMetadata: (value: Json) => Promise<void>,
  onUpdateServerMetadata: (value: Json) => Promise<void>,
  docsUrl: string,
  entityName: string,
};

export function MetadataSection({
  clientMetadata,
  clientReadOnlyMetadata,
  serverMetadata,
  onUpdateClientMetadata,
  onUpdateClientReadOnlyMetadata,
  onUpdateServerMetadata,
  docsUrl,
  entityName,
}: MetadataSectionProps) {
  return (
    <DesignCard
      title="Metadata"
      icon={DatabaseIcon}
      subtitle={
        <>
          Use metadata to store a custom JSON object on the {entityName}.{" "}
          <StyledLink href={docsUrl} target="_blank">Learn more in the docs</StyledLink>.
        </>
      }
    >
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
        <MetadataEditor
          title="Client"
          hint="Custom JSON clients can read and update; avoid sensitive data."
          initialValue={JSON.stringify(clientMetadata)}
          onUpdate={onUpdateClientMetadata}
        />
        <MetadataEditor
          title="Client Read-Only"
          hint="Custom JSON clients can read but only your backend can change."
          initialValue={JSON.stringify(clientReadOnlyMetadata)}
          onUpdate={onUpdateClientReadOnlyMetadata}
        />
        <MetadataEditor
          title="Server"
          hint="Custom JSON reserved for server-side logic and never exposed to clients."
          initialValue={JSON.stringify(serverMetadata)}
          onUpdate={onUpdateServerMetadata}
        />
      </div>
    </DesignCard>
  );
}
