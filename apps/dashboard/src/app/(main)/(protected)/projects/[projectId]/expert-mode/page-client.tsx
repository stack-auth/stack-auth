"use client";

import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Input, Textarea, Typography } from "@/components/ui";
import { useAsyncCallback } from "@stackframe/stack-shared/dist/hooks/use-async-callback";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import React, { useEffect, useMemo } from "react";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

export default function PageClient() {
  const [authorized, setAuthorized] = React.useState(false);

  if (!authorized) {
    return <Gate onAuthorized={() => setAuthorized(true)} />;
  }

  return <ExpertContent />;
}

function Gate(props: { onAuthorized: () => void }) {
  const [value, setValue] = React.useState("");

  const tryEnter = () => {
    if (value === "expert-mode") {
      props.onAuthorized();
    }
  };

  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <div className="w-full max-w-sm flex flex-col gap-3">
        <Typography type="h3">are you an expert?</Typography>
        <div className="flex gap-2">
          <Input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") tryEnter(); }}
            autoFocus
          />
          <Button onClick={tryEnter}>Enter</Button>
        </div>
      </div>
    </div>
  );
}

type ConfigLevel = "branch" | "environment";

const CONFIG_LEVELS: { level: ConfigLevel, title: string, description: string }[] = [
  {
    level: "branch",
    title: "Branch Config Override",
    description: "Branch-level config (pushable). Overrides project defaults.",
  },
  {
    level: "environment",
    title: "Environment Config Override",
    description: "Environment-level config. Overrides branch config. Used for secrets, API keys, etc.",
  },
];

function ConfigOverrideEditor(props: {
  level: ConfigLevel,
  title: string,
  description: string,
}) {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();

  const [overrideJson, setOverrideJson] = React.useState<string | null>(null);
  const [editedJson, setEditedJson] = React.useState<string | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const [handleLoad, isLoading] = useAsyncCallback(async () => {
    setLoadError(null);
    try {
      const override = await project.getConfigOverride(props.level);
      const formatted = JSON.stringify(override, null, 2);
      setOverrideJson(formatted);
      setEditedJson(formatted);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to load config override";
      setLoadError(message);
    }
  }, [project, props.level]);

  // Load on first render
  const [loaded, setLoaded] = React.useState(false);
  useEffect(() => {
    if (!loaded) {
      setLoaded(true);
      runAsynchronouslyWithAlert(handleLoad);
    }
  }, [loaded, handleLoad]);

  const hasChanges = useMemo(() => {
    if (overrideJson === null || editedJson === null) return false;
    try {
      // Compare parsed JSON to ignore whitespace differences
      return JSON.stringify(JSON.parse(editedJson)) !== JSON.stringify(JSON.parse(overrideJson));
    } catch {
      // If edited JSON is invalid, consider it a change
      return editedJson !== overrideJson;
    }
  }, [overrideJson, editedJson]);

  const [handleSave, isSaving, saveError] = useAsyncCallback(async () => {
    if (editedJson === null) return;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(editedJson);
    } catch {
      throw new Error("Invalid JSON. Please fix and try again.");
    }

    await project.replaceConfigOverride(props.level, parsed);
    const formatted = JSON.stringify(parsed, null, 2);
    setOverrideJson(formatted);
    setEditedJson(formatted);
  }, [project, props.level, editedJson]);

  const handleDiscard = () => {
    setEditedJson(overrideJson);
  };

  const displayError = loadError ?? (saveError instanceof Error ? saveError.message : saveError ? String(saveError) : null);

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        <Typography variant="secondary" type="footnote">
          {props.description}
        </Typography>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 flex-1">
        {displayError && (
          <Alert variant="destructive">{displayError}</Alert>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center min-h-[200px]">
            <Typography variant="secondary">Loading...</Typography>
          </div>
        ) : (
          <>
            <Textarea
              className="font-mono text-xs min-h-[300px] flex-1"
              spellCheck={false}
              value={editedJson ?? ""}
              onChange={(e) => setEditedJson(e.target.value)}
            />

            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={handleDiscard}
                disabled={isSaving || !hasChanges}
                size="sm"
              >
                Discard
              </Button>
              <Button
                onClick={handleSave}
                loading={isSaving}
                disabled={!hasChanges}
                size="sm"
              >
                Replace Override
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ExpertContent() {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const completeConfig = project.useConfig();

  return (
    <PageLayout title="Expert Mode" description="Internal configuration viewer and override tools" fillWidth>
      <Alert>
        <div className="space-y-1">
          <Typography type="label">Warning: Advanced internal page</Typography>
          <Typography variant="secondary">
            This page is not intended for standard use. It exposes internal configuration for visibility and quick experiments. Be careful: changes here can impact your project behavior.
          </Typography>
        </div>
      </Alert>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {CONFIG_LEVELS.map(({ level, title, description }) => (
          <ConfigOverrideEditor
            key={level}
            level={level}
            title={title}
            description={description}
          />
        ))}

        {/* Complete Rendered Config (read-only) */}
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>Complete Rendered Config</CardTitle>
            <Typography variant="secondary" type="footnote">
              The final merged config after all overrides and defaults are applied. Read-only.
            </Typography>
          </CardHeader>
          <CardContent>
            <div className="border rounded-md bg-muted/30 p-2 overflow-auto text-xs leading-5 max-h-[60vh]">
              <pre className="whitespace-pre-wrap break-words">
                {JSON.stringify(completeConfig, null, 2)}
              </pre>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}
