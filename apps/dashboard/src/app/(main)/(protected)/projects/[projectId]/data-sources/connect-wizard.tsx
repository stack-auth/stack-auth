"use client";

import {
  Alert, Button, Card, Checkbox, Input, Label, Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue, Spinner, Typography,
} from "@/components/ui";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { useState } from "react";
import {
  createSource, testConnection, type AdminAppWithInternals, type ConnectorDto,
  type DiscoveredStreamDto,
} from "./api";
import { ConnectorMark } from "./shared";

type WizardStep = "credentials" | "streams" | "schedule";

type StreamSelection = {
  enabled: boolean,
  syncMode: string,
  cursorField: string | null,
};

/**
 * The connect flow: credentials -> TEST CONNECTION GATE -> streams -> schedule.
 *
 * The gate is hard. There is no "continue anyway": the wizard cannot leave the
 * credentials step until the provider has answered 2xx, because every later
 * step is built out of data that only a working connection can supply. When it
 * fails, the provider's own error text is shown verbatim — a generic "could not
 * connect" would hide the one sentence that tells the user what to fix.
 */
export function ConnectWizard(props: {
  adminApp: AdminAppWithInternals,
  connector: ConnectorDto,
  onCancel: () => void,
  onCreated: (sourceId: string) => void,
}) {
  const [step, setStep] = useState<WizardStep>("credentials");
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [displayName, setDisplayName] = useState(props.connector.display_name);

  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<{ status: number, message: string } | null>(null);
  const [streams, setStreams] = useState<DiscoveredStreamDto[]>([]);
  const [selection, setSelection] = useState<Record<string, StreamSelection | undefined>>({});

  const [scheduleKind, setScheduleKind] = useState("interval");
  const [scheduleValue, setScheduleValue] = useState("60");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const hasSecrets = props.connector.config_fields.some(field => field.secret);

  const runTest = () => {
    setTesting(true);
    setTestError(null);
    runAsynchronously(async () => {
      try {
        const result = await testConnection(props.adminApp, props.connector.id, settings);
        if (!result.ok) {
          setTestError({ status: result.status, message: result.provider_message });
          return;
        }
        setStreams(result.streams);
        setSelection(Object.fromEntries(result.streams.map(stream => [stream.name, {
          // Everything on by default would import a customer's entire vendor
          // account on first sync; the user opts in per stream instead.
          enabled: false,
          syncMode: stream.recommendedSyncMode,
          cursorField: stream.cursorField,
        }])));
        setStep("streams");
      } catch (error) {
        setTestError({ status: 0, message: error instanceof Error ? error.message : String(error) });
      } finally {
        setTesting(false);
      }
    });
  };

  const submit = () => {
    setCreating(true);
    setCreateError(null);
    runAsynchronously(async () => {
      try {
        const selected = Object.entries(selection)
          .flatMap(([name, value]) => value?.enabled === true
            ? [{ name, sync_mode: value.syncMode, cursor_field: value.cursorField }]
            : []);
        const created = await createSource(props.adminApp, {
          connector_id: props.connector.id,
          display_name: displayName,
          settings,
          streams: selected,
          schedule: { kind: scheduleKind, value: scheduleKind === "manual" ? null : scheduleValue },
        });
        props.onCreated(created.id);
      } catch (error) {
        setCreateError(error instanceof Error ? error.message : String(error));
      } finally {
        setCreating(false);
      }
    });
  };

  const enabledCount = Object.values(selection).filter(value => value?.enabled === true).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <ConnectorMark name={props.connector.display_name} size="md" />
        <div className="min-w-0">
          <Typography type="h3" className="text-lg font-semibold">
            Connect {props.connector.display_name}
          </Typography>
          <Typography variant="secondary" className="text-xs">{props.connector.description}</Typography>
          <Typography variant="secondary" className="text-xs">
            Authentication: {props.connector.credential_mode}
          </Typography>
        </div>
      </div>

      <WizardSteps current={step} />

      {step === "credentials" && (
        <Card className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ds-display-name">Name</Label>
            <Input
              id="ds-display-name"
              value={displayName}
              onChange={event => setDisplayName(event.target.value)}
              placeholder={props.connector.display_name}
            />
          </div>

          {props.connector.config_fields.map(field => (
            <div key={field.name} className="flex flex-col gap-1.5">
              <Label htmlFor={`ds-field-${field.name}`}>
                {field.display_name}
                {field.required && <span className="ml-1 text-destructive">*</span>}
              </Label>
              <Input
                id={`ds-field-${field.name}`}
                type={field.secret ? "password" : "text"}
                autoComplete="off"
                value={settings[field.name] ?? ""}
                placeholder={field.placeholder ?? ""}
                onChange={event => setSettings(current => ({ ...current, [field.name]: event.target.value }))}
              />
              {field.description != null && (
                <Typography variant="secondary" className="text-xs">{field.description}</Typography>
              )}
            </div>
          ))}

          {hasSecrets && (
            // Stated at the point of entry, not buried in docs: users are
            // pasting production secrets here, and the reassurance is what makes
            // them willing to.
            <Alert>
              <Typography className="text-sm">
                Credentials are encrypted at rest and can never be read back. To change one,
                enter it again.
              </Typography>
            </Alert>
          )}

          {testError != null && (
            <Alert variant="destructive">
              <Typography className="text-sm font-medium">
                {testError.status === 401 || testError.status === 403
                  ? `${props.connector.display_name} rejected these credentials.`
                  : testError.status > 0
                    ? `${props.connector.display_name} returned an error.`
                    : `Couldn't reach ${props.connector.display_name}.`}
              </Typography>
              <Typography className="mt-1 whitespace-pre-wrap break-words font-mono text-xs">
                {testError.message}
              </Typography>
            </Alert>
          )}

          <div className="flex items-center justify-between gap-2">
            <Button variant="secondary" onClick={props.onCancel}>Cancel</Button>
            <Button onClick={runTest} disabled={testing}>
              {testing ? <><Spinner size={14} /> Testing…</> : "Test connection"}
            </Button>
          </div>
        </Card>
      )}

      {step === "streams" && (
        <Card className="flex flex-col gap-4 p-5">
          <div>
            <Typography className="font-medium">Select streams</Typography>
            <Typography variant="secondary" className="text-xs">
              Connection verified. Choose what to import.
            </Typography>
          </div>

          <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {streams.map(stream => {
              const current = selection[stream.name];
              if (current == null) return null;
              return (
                <div key={stream.name} className="flex flex-wrap items-center gap-3 p-3">
                  <Checkbox
                    id={`ds-stream-${stream.name}`}
                    checked={current.enabled}
                    onCheckedChange={checked => setSelection(state => ({
                      ...state,
                      [stream.name]: { ...current, enabled: checked === true },
                    }))}
                  />
                  <label htmlFor={`ds-stream-${stream.name}`} className="min-w-0 flex-1 cursor-pointer">
                    <Typography className="truncate text-sm font-medium">{stream.name}</Typography>
                    <Typography variant="secondary" className="text-xs">
                      {stream.primaryKey.length > 0
                        ? `Key: ${stream.primaryKey.join(", ")}`
                        : "No primary key, so rows are added and never updated"}
                      {stream.schema != null && ` · ${stream.schema.fields.length} fields`}
                      {stream.error != null && ` · could not sample: ${stream.error}`}
                    </Typography>
                  </label>

                  <Select
                    value={current.syncMode}
                    onValueChange={value => setSelection(state => ({
                      ...state,
                      [stream.name]: { ...current, syncMode: value },
                    }))}
                  >
                    <SelectTrigger className="w-40" aria-label={`Sync mode for ${stream.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {stream.supportedSyncModes.map(mode => (
                        <SelectItem key={mode} value={mode}>
                          {mode === "incremental" ? "Incremental" : "Full refresh"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {current.syncMode === "incremental" && (
                    <Input
                      className="w-40"
                      value={current.cursorField ?? ""}
                      placeholder="Cursor field"
                      aria-label={`Cursor field for ${stream.name}`}
                      onChange={event => setSelection(state => ({
                        ...state,
                        [stream.name]: { ...current, cursorField: event.target.value },
                      }))}
                    />
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-2">
            <Button variant="secondary" onClick={() => setStep("credentials")}>Back</Button>
            <Button onClick={() => setStep("schedule")} disabled={enabledCount === 0}>
              Continue ({enabledCount} selected)
            </Button>
          </div>
        </Card>
      )}

      {step === "schedule" && (
        <Card className="flex flex-col gap-4 p-5">
          <div>
            <Typography className="font-medium">Schedule</Typography>
            <Typography variant="secondary" className="text-xs">
              You can also sync manually at any time.
            </Typography>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ds-schedule-kind">Frequency</Label>
              <Select value={scheduleKind} onValueChange={setScheduleKind}>
                <SelectTrigger id="ds-schedule-kind" className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="interval">On an interval</SelectItem>
                  <SelectItem value="cron">Cron expression</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {scheduleKind !== "manual" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ds-schedule-value">
                  {scheduleKind === "cron" ? "Cron expression (UTC)" : "Every (minutes)"}
                </Label>
                <Input
                  id="ds-schedule-value"
                  className="w-48"
                  value={scheduleValue}
                  placeholder={scheduleKind === "cron" ? "0 * * * *" : "60"}
                  onChange={event => setScheduleValue(event.target.value)}
                />
              </div>
            )}
          </div>

          {createError != null && (
            <Alert variant="destructive">
              <Typography className="whitespace-pre-wrap break-words text-sm">{createError}</Typography>
            </Alert>
          )}

          <div className="flex items-center justify-between gap-2">
            <Button variant="secondary" onClick={() => setStep("streams")}>Back</Button>
            <Button onClick={submit} disabled={creating}>
              {creating ? <><Spinner size={14} /> Connecting…</> : "Connect source"}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function WizardSteps(props: { current: WizardStep }) {
  const steps: Array<{ id: WizardStep, label: string }> = [
    { id: "credentials", label: "1. Credentials" },
    { id: "streams", label: "2. Streams" },
    { id: "schedule", label: "3. Schedule" },
  ];
  const currentIndex = steps.findIndex(step => step.id === props.current);
  return (
    <div className="flex items-center gap-2">
      {steps.map((step, index) => (
        <div
          key={step.id}
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            index === currentIndex
              ? "bg-foreground text-background"
              : index < currentIndex
                ? "bg-muted text-foreground"
                : "bg-muted/50 text-muted-foreground"
          }`}
        >
          {step.label}
        </div>
      ))}
    </div>
  );
}
