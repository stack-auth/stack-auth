"use client";

import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import React, { useCallback, useEffect, useState } from "react";
import { DevToolTabBar, type TabDef } from "../dev-tool-tab-bar";
import { IframeTab } from "../iframe-tab";

// IF_PLATFORM react-like

/**
 * Same Web3Forms endpoint & public access key used by the dashboard's
 * FeedbackForm in the Stack Companion — keeps the submission logic DRY.
 */
const WEB3FORMS_ENDPOINT = "https://api.web3forms.com/submit";
const WEB3FORMS_ACCESS_KEY = "4f0fc468-c066-4e45-95c1-546fd652a44a";

type SupportSubTab = "feedback" | "feature-requests";

const SUB_TABS: TabDef<SupportSubTab>[] = [
  { id: "feedback", label: "Feedback" },
  { id: "feature-requests", label: "Feature Requests" },
];

type SubmitStatus = "idle" | "submitting" | "success" | "error";

function FeedbackForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [feedbackType, setFeedbackType] = useState<"feedback" | "bug">("feedback");
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !message.trim()) return;

    setStatus("submitting");
    setErrorMessage("");

    try {
      const response = await fetch(WEB3FORMS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          name: name.trim() || undefined,
          email: email.trim(),
          message: message.trim(),
          type: feedbackType,
          source: "dev-tool",
          access_key: WEB3FORMS_ACCESS_KEY,
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
  }, [name, email, message, feedbackType]);

  const resetForm = useCallback(() => {
    setStatus("idle");
    setErrorMessage("");
  }, []);

  if (status === "success") {
    return (
      <div className="sdt-support-status sdt-support-status-success">
        <div className="sdt-support-status-icon">✓</div>
        <div className="sdt-support-status-title">Sent successfully!</div>
        <div className="sdt-support-status-msg">We'll get back to you soon.</div>
        <button className="sdt-secondary-btn" onClick={resetForm} style={{ marginTop: 8 }}>
          Send Another
        </button>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="sdt-support-status sdt-support-status-error">
        <div className="sdt-support-status-icon">!</div>
        <div className="sdt-support-status-title">Failed to send</div>
        <div className="sdt-support-status-msg">{errorMessage || "Please try again."}</div>
        <button className="sdt-secondary-btn" onClick={resetForm} style={{ marginTop: 8 }}>
          Try Again
        </button>
      </div>
    );
  }

  return (
    <form className="sdt-support-form" onSubmit={(event) => runAsynchronouslyWithAlert(handleSubmit(event))}>
      <div className="sdt-support-type-toggle">
        <button
          type="button"
          className={`sdt-support-type-btn ${feedbackType === "feedback" ? "sdt-support-type-btn-active" : ""}`}
          onClick={() => setFeedbackType("feedback")}
        >
          💬 Feedback
        </button>
        <button
          type="button"
          className={`sdt-support-type-btn ${feedbackType === "bug" ? "sdt-support-type-btn-active" : ""}`}
          onClick={() => setFeedbackType("bug")}
        >
          🐛 Bug Report
        </button>
      </div>

      <input
        className="sdt-support-input"
        type="text"
        placeholder="Name (optional)"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className="sdt-support-input"
        type="email"
        placeholder="Email *"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <textarea
        className="sdt-support-textarea"
        placeholder={feedbackType === "bug" ? "Describe the bug…" : "Your feedback…"}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        required
        rows={4}
      />
      <button
        type="submit"
        className="sdt-support-submit"
        disabled={status === "submitting" || !email.trim() || !message.trim()}
      >
        {status === "submitting" ? "Sending…" : "Send"}
      </button>

      {/* Support links — same as the dashboard companion */}
      <div className="sdt-support-links">
        <a href="https://discord.stack-auth.com" target="_blank" rel="noopener noreferrer" className="sdt-support-link">
          Discord
        </a>
        <span className="sdt-support-link-sep">·</span>
        <a href="mailto:team@stack-auth.com" className="sdt-support-link">
          team@stack-auth.com
        </a>
        <span className="sdt-support-link-sep">·</span>
        <a href="https://github.com/stack-auth/stack-auth" target="_blank" rel="noopener noreferrer" className="sdt-support-link">
          GitHub
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
  const [subTab, setSubTab] = useState<SupportSubTab>("feedback");
  const [mountedTabs, setMountedTabs] = useState<Set<SupportSubTab>>(() => new Set(["feedback"]));

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
              <FeedbackForm />
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
