"use client";

import { StyledLink } from "@/components/link";
import { SettingCard } from "@/components/settings";
import { Button, cn, SimpleTooltip } from "@/components/ui";
import { useThemeWatcher } from '@/lib/theme';
import MonacoEditor from '@monaco-editor/react';
import { isJsonSerializable } from "@stackframe/stack-shared/dist/utils/json";
import { useEffect, useMemo, useState } from "react";

type MetadataEditorProps = {
  title: string,
  initialValue: string,
  hint: string,
  onUpdate?: (value: any) => Promise<void>,
};

export function MetadataEditor({ title, initialValue, onUpdate, hint }: MetadataEditorProps) {
  const formatJson = (json: string) => JSON.stringify(JSON.parse(json), null, 2);
  const [hasChanged, setHasChanged] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  const { mounted, theme } = useThemeWatcher();

  const [value, setValue] = useState(formatJson(initialValue));
  const isJson = useMemo(() => {
    return isJsonSerializable(value);
  }, [value]);

  // Ensure proper mounting lifecycle
  useEffect(() => {
    setIsMounted(true);
    return () => {
      setIsMounted(false);
    };
  }, []);

  const handleSave = async () => {
    if (isJson) {
      const formatted = formatJson(value);
      setValue(formatted);
      await onUpdate?.(JSON.parse(formatted));
      setHasChanged(false);
    }
  };

  // Only render Monaco when both mounted states are true
  const shouldRenderMonaco = mounted && isMounted;

  return <div className="flex flex-col">
    <h3 className='text-sm mb-4 font-semibold'>
      {title}
      <SimpleTooltip tooltip={hint} type="info" inline className="ml-2 mb-[2px]" />
    </h3>
    {shouldRenderMonaco ? (
      <div className={cn("rounded-md overflow-hidden", theme !== 'dark' && "border")}>
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
      <div className={cn("rounded-md overflow-hidden h-[240px] flex items-center justify-center", theme !== 'dark' && "border")}>
        <div className="text-sm text-muted-foreground">Loading editor...</div>
      </div>
    )}
    <div className={cn('self-end flex items-end gap-2 transition-all h-0 opacity-0 overflow-hidden', hasChanged && 'h-[48px] opacity-100')}>
      <Button
        variant="ghost"
        onClick={() => {
          setValue(formatJson(initialValue));
          setHasChanged(false);
        }}>
        Revert
      </Button>
      <Button
        variant={isJson ? "default" : "secondary"}
        disabled={!isJson}
        onClick={handleSave}>Save</Button>
    </div>
  </div>;
}

type MetadataSectionProps = {
  clientMetadata: any,
  clientReadOnlyMetadata: any,
  serverMetadata: any,
  onUpdateClientMetadata: (value: any) => Promise<void>,
  onUpdateClientReadOnlyMetadata: (value: any) => Promise<void>,
  onUpdateServerMetadata: (value: any) => Promise<void>,
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
    <SettingCard
      title="Metadata"
      description={
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
    </SettingCard>
  );
}
