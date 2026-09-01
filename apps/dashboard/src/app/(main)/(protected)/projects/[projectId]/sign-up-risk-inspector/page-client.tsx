"use client";

import {
  DesignAlert,
  DesignBadge,
  DesignButton,
  DesignCard,
  DesignInput,
  DesignTable,
  DesignTableBody,
  DesignTableCell,
  DesignTableHead,
  DesignTableHeader,
  DesignTableRow,
} from "@/components/design-components";
import { Skeleton } from "@/components/ui";
import { Textarea } from "@/components/ui/textarea";
import { sendInternalUserRequest } from "@/lib/hexclave-app-internals";
import { emailSchema } from "@hexclave/shared/dist/schema-fields";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import type { Json } from "@hexclave/shared/dist/utils/json";
import { useStackApp, useUser } from "@hexclave/next";
import {
  yupArray,
  yupMixed,
  yupNumber,
  yupObject,
  yupString,
} from "@hexclave/shared/dist/schema-fields";
import * as yup from "yup";
import { ChartLineUpIcon, EnvelopeSimpleIcon } from "@phosphor-icons/react";
import { Fragment, Suspense, useState } from "react";
import { PageLayout } from "../page-layout";
import { useProjectId } from "../use-admin-app";

const signUpRiskSignalIds = ["emailable", "same_ip", "same_email", "similar_email", "turnstile", "blacklist", "country", "public_email_provider", "connected_account_age"] as const;

const breakdownSchema = yupObject({
  signal: yupString().oneOf([...signUpRiskSignalIds]).defined(),
  factor: yupObject({
    bot: yupNumber().min(0).max(1).defined(),
    free_trial_abuse: yupNumber().min(0).max(1).defined(),
  }).defined(),
  details: yupMixed<Record<string, Json>>().defined(),
}).defined();

const responseSchema = yupObject({
  results: yupArray(yupObject({
    email: emailSchema.defined(),
    scores: yupObject({
      bot: yupNumber().integer().min(0).max(100).defined(),
      free_trial_abuse: yupNumber().integer().min(0).max(100).defined(),
    }).defined(),
    heuristic_facts: yupObject({
      email_normalized: yupString().nullable().defined(),
      email_base: yupString().nullable().defined(),
    }).defined(),
    breakdown: yupArray(breakdownSchema).defined(),
  }).defined()).defined(),
}).defined();

type InspectorResponse = yup.InferType<typeof responseSchema>;
type InspectorState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error", message: string }
  | { status: "ok", data: InspectorResponse };

export default function PageClient() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
      <AuthenticatedPage />
    </Suspense>
  );
}

function AuthenticatedPage() {
  const projectId = useProjectId();
  useUser({ or: "redirect", projectIdMustMatch: "internal" });

  if (projectId !== "internal") {
    return null;
  }

  return (
    <PageLayout
      title="Sign-up Risk Inspector"
      description="Inspect sign-up risk signals for a batch of emails. Internal platform tool."
    >
      <InspectorContent />
    </PageLayout>
  );
}

function InspectorContent() {
  const app = useStackApp();
  const [emails, setEmails] = useState<string[]>([]);
  const [bulkEmails, setBulkEmails] = useState("");
  const [singleEmail, setSingleEmail] = useState("");
  const [limitExceeded, setLimitExceeded] = useState(false);
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);
  const [state, setState] = useState<InspectorState>({ status: "idle" });
  const isLoading = state.status === "loading";

  const invalidEmails = emails.filter((email) => !emailSchema.isValidSync(email));
  const addEmails = (values: string[]) => {
    if (isLoading) return;
    const combined = [...new Set([...emails, ...values])];
    setLimitExceeded(combined.length > 50);
    setEmails(combined.slice(0, 50));
  };
  const addBulkEmails = () => {
    if (isLoading) return;
    addEmails(
      bulkEmails
        .split(/[\s,;]+/)
        .map((email) => email.trim().toLowerCase())
        .filter((email) => email.length > 0),
    );
    setBulkEmails("");
  };
  const addSingleEmail = () => {
    if (isLoading) return;
    const email = singleEmail.trim().toLowerCase();
    if (email.length > 0) {
      addEmails([email]);
      setSingleEmail("");
    }
  };
  const removeEmail = (email: string) => {
    if (isLoading) return;
    setEmails((current) => current.filter((entry) => entry !== email));
    setLimitExceeded(false);
  };
  const clearEmails = () => {
    if (isLoading) return;
    setEmails([]);
    setLimitExceeded(false);
  };
  const calculate = async () => {
    if (emails.length === 0 || invalidEmails.length > 0 || limitExceeded) return;
    setState({ status: "loading" });
    try {
      const response = await sendInternalUserRequest(app, "/internal/sign-up-risk-inspector", {
        method: "POST",
        body: JSON.stringify({ emails }),
        headers: { "content-type": "application/json" },
      });
      if (response.status === 403) {
        setState({ status: "forbidden" });
        return;
      }
      if (!response.ok) {
        setState({ status: "error", message: `Request failed (${response.status})` });
        return;
      }
      const data = await responseSchema.validate(await response.json());
      setState({ status: "ok", data });
    } catch (error) {
      captureError("sign-up-risk-inspector", error);
      setState({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <DesignCard
        title="Emails"
        subtitle="Paste a batch or add individual addresses"
        icon={EnvelopeSimpleIcon}
        contentClassName="p-4"
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-end gap-2">
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Batch input</span>
              <Textarea
                value={bulkEmails}
                onChange={(event) => setBulkEmails(event.target.value)}
                placeholder="Paste emails — comma, semicolon, whitespace or newline separated"
                rows={3}
                disabled={isLoading}
              />
            </label>
            <DesignButton variant="secondary" size="sm" onClick={addBulkEmails} disabled={isLoading}>Add</DesignButton>
          </div>
          <div className="flex items-end gap-2">
            <label className="flex min-w-0 max-w-xl flex-1 flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Single email</span>
              <DesignInput
                size="sm"
                value={singleEmail}
                onChange={(event) => setSingleEmail(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (!isLoading) addSingleEmail();
                  }
                }}
                placeholder="name@example.com"
                disabled={isLoading}
              />
            </label>
            <DesignButton variant="secondary" size="sm" onClick={addSingleEmail} disabled={isLoading}>Add</DesignButton>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {emails.map((email) => (
              <span key={email} className="hexclave-sensitive inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs">
                {emailSchema.isValidSync(email) ? (
                  <DesignBadge label={email} color="blue" size="sm" />
                ) : (
                  <DesignBadge label={`${email} · invalid`} color="red" size="sm" />
                )}
                <button
                  type="button"
                  className="rounded px-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  aria-label={`Remove ${email}`}
                  onClick={() => removeEmail(email)}
                  disabled={isLoading}
                >
                  ×
                </button>
              </span>
            ))}
            <span className="text-xs text-muted-foreground">{emails.length}/50</span>
            {emails.length > 0 ? (
              <DesignButton variant="ghost" size="sm" onClick={clearEmails} disabled={isLoading}>Clear</DesignButton>
            ) : null}
          </div>
          {invalidEmails.length > 0 ? (
            <DesignAlert variant="error">
              Invalid email{invalidEmails.length === 1 ? "" : "s"}: {invalidEmails.join(", ")}
            </DesignAlert>
          ) : null}
          {limitExceeded ? (
            <DesignAlert variant="error">Maximum 50 emails per calculation.</DesignAlert>
          ) : null}
          <div>
            <DesignButton
              onClick={calculate}
              disabled={emails.length === 0 || invalidEmails.length > 0 || limitExceeded || isLoading}
            >
              Calculate risk scores
            </DesignButton>
          </div>
        </div>
      </DesignCard>

      {state.status === "forbidden" ? (
        <DesignAlert variant="error">Restricted to the platform team (owner team of the internal project).</DesignAlert>
      ) : null}
      {state.status === "error" ? <DesignAlert variant="error">{state.message}</DesignAlert> : null}
      {state.status === "loading" ? <Skeleton className="h-96 w-full rounded-xl" /> : null}
      {state.status === "ok" ? (
        <ResultsCard
          data={state.data}
          expandedEmail={expandedEmail}
          onToggleEmail={(email) => setExpandedEmail((current) => current === email ? null : email)}
        />
      ) : null}
    </div>
  );
}

function scoreClass(score: number): string {
  if (score >= 70) return "text-red-600 dark:text-red-400";
  if (score >= 40) return "text-amber-600 dark:text-amber-400";
  return "text-foreground";
}

function ResultsCard(props: {
  data: InspectorResponse,
  expandedEmail: string | null,
  onToggleEmail: (email: string) => void,
}) {
  return (
    <DesignCard
      title="Risk results"
      subtitle={`${props.data.results.length} email${props.data.results.length === 1 ? "" : "s"}`}
      icon={ChartLineUpIcon}
      contentClassName="p-3"
    >
      <DesignTable>
        <DesignTableHeader>
          <DesignTableRow>
            <DesignTableHead>Email</DesignTableHead>
            <DesignTableHead>Bot</DesignTableHead>
            <DesignTableHead>FTA</DesignTableHead>
            <DesignTableHead>Normalized</DesignTableHead>
            <DesignTableHead>Base</DesignTableHead>
            {signUpRiskSignalIds.map((signal) => (
              <DesignTableHead key={signal}>{signal.replaceAll("_", " ")}</DesignTableHead>
            ))}
          </DesignTableRow>
        </DesignTableHeader>
        <DesignTableBody>
          {props.data.results.map((result) => {
            const expanded = props.expandedEmail === result.email;
            return (
              <Fragment key={result.email}>
                <DesignTableRow
                  className="cursor-pointer"
                  onClick={() => props.onToggleEmail(result.email)}
                >
                  <DesignTableCell><code className="hexclave-sensitive text-xs">{result.email}</code></DesignTableCell>
                  <DesignTableCell><span className={scoreClass(result.scores.bot)}>{result.scores.bot}</span></DesignTableCell>
                  <DesignTableCell><span className={scoreClass(result.scores.free_trial_abuse)}>{result.scores.free_trial_abuse}</span></DesignTableCell>
                  <DesignTableCell><code className="hexclave-sensitive text-xs">{result.heuristic_facts.email_normalized ?? "—"}</code></DesignTableCell>
                  <DesignTableCell><code className="hexclave-sensitive text-xs">{result.heuristic_facts.email_base ?? "—"}</code></DesignTableCell>
                  {signUpRiskSignalIds.map((signal) => {
                    const breakdown = result.breakdown.find((entry) => entry.signal === signal);
                    const bot = Math.round((breakdown?.factor.bot ?? 0) * 100);
                    const fta = Math.round((breakdown?.factor.free_trial_abuse ?? 0) * 100);
                    return (
                      <DesignTableCell key={signal} className={bot === 0 && fta === 0 ? "text-muted-foreground" : undefined}>
                        {bot === 0 && fta === 0 ? "—" : `${bot}% / ${fta}%`}
                      </DesignTableCell>
                    );
                  })}
                </DesignTableRow>
                {expanded ? (
                  <DesignTableRow key={`${result.email}-details`}>
                    <DesignTableCell colSpan={5 + signUpRiskSignalIds.length}>
                      <div className="grid gap-1 text-xs">
                        {result.breakdown.map((entry) => (
                          <div key={entry.signal} className="flex gap-2">
                            <span className="w-28 shrink-0 font-medium">{entry.signal}</span>
                            <code className="hexclave-sensitive break-all text-muted-foreground">{JSON.stringify(entry.details)}</code>
                          </div>
                        ))}
                      </div>
                    </DesignTableCell>
                  </DesignTableRow>
                ) : null}
              </Fragment>
            );
          })}
        </DesignTableBody>
      </DesignTable>
      <p className="pt-3 text-xs text-muted-foreground">
        score = round(100 × (1 − Π(1 − factor))) per dimension
      </p>
    </DesignCard>
  );
}
