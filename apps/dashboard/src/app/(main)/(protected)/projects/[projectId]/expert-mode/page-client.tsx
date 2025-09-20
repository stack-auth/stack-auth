"use client";

import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Input, Textarea, Typography } from "@stackframe/stack-ui";
import React from "react";
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

function ExpertContent() {
  const app = useAdminApp();
  const project = app.useProject();
  const completeConfig = project.useConfig();

  const [jsonInput, setJsonInput] = React.useState<string>("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    setSuccess(null);
    let parsed: any;
    try {
      parsed = jsonInput.trim() ? JSON.parse(jsonInput) : {};
    } catch (e: any) {
      setError("Invalid JSON. Please fix and try again.");
      return;
    }
    setBusy(true);
    try {
      await project.updateConfig(parsed as any);
      setSuccess("Configuration override applied successfully.");
      setJsonInput("");
    } catch (e: any) {
      setError(e?.message ?? "Failed to update configuration.");
    } finally {
      setBusy(false);
    }
  };

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

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Current Config */}
        <Card className="min-h-[300px]">
          <CardHeader>
            <CardTitle>Current complete config (read-only)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="border rounded-md bg-muted/30 p-2 overflow-auto text-xs leading-5 max-h-[60vh]">
              <pre className="whitespace-pre-wrap break-words">
                {JSON.stringify(completeConfig, null, 2)}
              </pre>
            </div>
          </CardContent>
        </Card>

        {/* Update Config Override */}
        <Card className="min-h-[300px] flex flex-col">
          <CardHeader>
            <CardTitle>Update Config Overrides</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 flex-1">
            <Typography variant="secondary" type="footnote">
              Paste a JSON object representing config overrides. Keep it minimal — only include keys you want to change.
            </Typography>

            {error && (
              <Alert variant="destructive">{error}</Alert>
            )}
            {success && (
              <Alert>{success}</Alert>
            )}

            <Textarea
              className="font-mono text-xs min-h-[200px] flex-1"
              spellCheck={false}
              placeholder={`{\n  "some.config.key": true\n}`}
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
            />

            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setJsonInput("");
                  setError(null);
                  setSuccess(null);
                }}
                disabled={busy}
              >
                Reset
              </Button>
              <Button onClick={handleSubmit} loading={busy} disabled={busy}>
                Apply Override
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}

