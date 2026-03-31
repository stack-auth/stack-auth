"use client";

import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useStackApp } from "../../lib/hooks";
import { stackAppInternalsSymbol } from "../../lib/stack-app/common";
import { resolveApiBaseUrl, useDevToolContext, type SupportPrefill } from "../dev-tool-context";
import { DevToolTabBar, type TabDef } from "../dev-tool-tab-bar";
import { IframeTab } from "../iframe-tab";

// IF_PLATFORM react-like

type SupportSubTab = "feedback" | "feature-requests";

const SUB_TABS: TabDef<SupportSubTab>[] = [
  { id: "feedback", label: "Feedback" },
  { id: "feature-requests", label: "Feature Requests" },
];

type SubmitStatus = "idle" | "submitting" | "success" | "error";

function FeedbackForm({ prefill }: { prefill?: SupportPrefill }) {
  const app = useStackApp();
  const apiBaseUrl = resolveApiBaseUrl(app);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState(prefill?.message ?? "");
  const [feedbackType, setFeedbackType] = useState<"feedback" | "bug">(prefill?.feedbackType ?? "feedback");
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const prefillApplied = useRef(false);

  // Apply prefill when it changes (e.g. navigating from share dialog)
  useEffect(() => {
    if (prefill && !prefillApplied.current) {
      setFeedbackType(prefill.feedbackType);
      setMessage(prefill.message);
      setStatus("idle");
      prefillApplied.current = true;
    }
  }, [prefill]);

  // Feedback is routed through the Stack Auth API rather than calling an external
  // service directly from the client. This follows the same forward-to-production
  // pattern used by the AI endpoint.
  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !message.trim()) return;

    setStatus("submitting");
    setErrorMessage("");

    try {
      const opts = (app as any)[stackAppInternalsSymbol]?.getConstructorOptions?.() ?? {};
      const stackHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-Stack-Access-Type": "client",
        "X-Stack-Project-Id": app.projectId,
      };
      if ("publishableClientKey" in opts && opts.publishableClientKey) {
        stackHeaders["X-Stack-Publishable-Client-Key"] = opts.publishableClientKey;
      }
      const response = await fetch(`${apiBaseUrl}/api/latest/internal/feedback`, {
        method: "POST",
        headers: stackHeaders,
        body: JSON.stringify({
          name: name.trim() || undefined,
          email: email.trim(),
          message: message.trim(),
          feedback_type: feedbackType,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to send: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.message || "Failed to send feedback");
      }

      setStatus("success");
      setMessage("");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "An unexpected error occurred");
    }
  }, [name, email, message, feedbackType, apiBaseUrl]);

  const resetForm = useCallback(() => {
    setStatus("idle");
    setErrorMessage("");
  }, []);

  if (status === "success") {
    return (
      <div className="sdt-support-status sdt-support-status-success">
        <div className="sdt-support-status-icon">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M6 10l3 3 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div className="sdt-support-status-title">Feedback sent</div>
        <div className="sdt-support-status-msg">Thank you! We'll get back to you soon.</div>
        <button className="sdt-support-submit" onClick={resetForm} style={{ marginTop: 12, width: "auto" }}>
          Send another
        </button>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="sdt-support-status sdt-support-status-error">
        <div className="sdt-support-status-icon">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M10 6v5m0 3h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </div>
        <div className="sdt-support-status-title">Failed to send</div>
        <div className="sdt-support-status-msg">{errorMessage || "Please try again."}</div>
        <button className="sdt-support-submit" onClick={resetForm} style={{ marginTop: 12, width: "auto" }}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <form className="sdt-support-form" onSubmit={(event) => runAsynchronouslyWithAlert(handleSubmit(event))}>
      {/* Form fields */}
      <div className="sdt-support-field">
        <label className="sdt-support-label">Name <span className="sdt-support-optional">optional</span></label>
        <input
          className="sdt-support-input"
          type="text"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="sdt-support-field">
        <label className="sdt-support-label">Email</label>
        <input
          className="sdt-support-input"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div className="sdt-support-field">
        <label className="sdt-support-label">{feedbackType === "bug" ? "Description" : "Message"}</label>
        <textarea
          className="sdt-support-textarea"
          placeholder={feedbackType === "bug" ? "Steps to reproduce, expected vs. actual behavior…" : "What's on your mind?"}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
          rows={5}
        />
      </div>

      {/* Type cards */}
      <div className="sdt-support-type-cards">
        <button
          type="button"
          className={`sdt-support-type-card ${feedbackType === "feedback" ? "sdt-support-type-card-active" : ""}`}
          onClick={() => setFeedbackType("feedback")}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <span>Feedback</span>
        </button>
        <button
          type="button"
          className={`sdt-support-type-card ${feedbackType === "bug" ? "sdt-support-type-card-active" : ""}`}
          onClick={() => setFeedbackType("bug")}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 2l1.88 1.88M14.12 3.88L16 2M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/>
            <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/>
            <path d="M12 20v-9M6.53 9C4.6 8.8 3 7.1 3 5M6 13H2M6 17H3M21 5c0 2.1-1.6 3.8-3.53 4M18 13h4M21 17h-3"/>
          </svg>
          <span>Bug Report</span>
        </button>
      </div>

      {/* Submit */}
      <button
        type="submit"
        className="sdt-support-submit"
        disabled={status === "submitting" || !email.trim() || !message.trim()}
      >
        {status === "submitting" ? (
          <>
            <svg className="sdt-support-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 2v4m0 12v4m-7.07-15.07l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/>
            </svg>
            Sending…
          </>
        ) : (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5m-7 7l7-7 7 7"/>
            </svg>
            Submit
          </>
        )}
      </button>

      {/* Support channels */}
      <div className="sdt-support-channels">
        <a href="https://discord.stack-auth.com" target="_blank" rel="noopener noreferrer" className="sdt-support-channel">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
          </svg>
          <span>Discord</span>
        </a>
        <a href="mailto:team@stack-auth.com" className="sdt-support-channel">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
          </svg>
          <span>Email</span>
        </a>
        <a href="https://github.com/stack-auth/stack-auth" target="_blank" rel="noopener noreferrer" className="sdt-support-channel">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
          </svg>
          <span>GitHub</span>
        </a>
      </div>
    </form>
  );
}

/**
 * Uses the same mount-and-keep-alive pattern as the main panel's TabContent:
 * each sub-pane is mounted on first visit and stays in the DOM (preserving
 * iframe state, scroll position, form input, etc.).
 */
export function SupportTab() {
  const { state, setState } = useDevToolContext();
  const [subTab, setSubTab] = useState<SupportSubTab>("feedback");
  const [mountedTabs, setMountedTabs] = useState<Set<SupportSubTab>>(() => new Set(["feedback"]));
  const [prefill, setPrefill] = useState<SupportPrefill | undefined>();

  // Consume prefill from global state when navigating to this tab
  useEffect(() => {
    if (state.supportPrefill) {
      setPrefill(state.supportPrefill);
      setSubTab("feedback");
      setState((prev) => ({ ...prev, supportPrefill: undefined }));
    }
  }, [state.supportPrefill, setState]);

  useEffect(() => {
    setMountedTabs((prev) => {
      if (prev.has(subTab)) return prev;
      const next = new Set(prev);
      next.add(subTab);
      return next;
    });
  }, [subTab]);

  return (
    <div className="sdt-support-tab">
      <DevToolTabBar
        tabs={SUB_TABS}
        activeTab={subTab}
        onTabChange={setSubTab}
        variant="pills"
      />

      <div className="sdt-support-content">
        {mountedTabs.has("feedback") && (
          <div className={`sdt-support-pane ${subTab === "feedback" ? "sdt-support-pane-active" : ""}`}>
            <div className="sdt-support-feedback-pane">
              <FeedbackForm prefill={prefill} />
            </div>
          </div>
        )}
        {mountedTabs.has("feature-requests") && (
          <div className={`sdt-support-pane ${subTab === "feature-requests" ? "sdt-support-pane-active" : ""}`}>
            <div className="sdt-support-iframe-pane">
              <IframeTab
                src="https://feedback.stack-auth.com"
                title="Stack Auth Feature Requests"
                loadingMessage="Loading feature requests…"
                errorMessage="Unable to load feature requests"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// END_PLATFORM
