'use client';

import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { Button, Input } from "@hexclave/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStackApp, useUser } from "..";
import type { SupportConversation, SupportConversationDetail } from "../lib/hexclave-app/support";

const POLL_INTERVAL_MS = 5000;

type View =
  | { kind: "list" }
  | { kind: "new" }
  | { kind: "thread", conversationId: string };

function formatError(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong. Please try again.";
}

/**
 * Drop-in support widget for end-user apps. Renders a floating button that opens
 * a panel where the signed-in user can start a support conversation and exchange
 * messages with the project's support team. Open threads poll for new agent
 * replies so the conversation stays live without a websocket dependency.
 *
 * Requires a signed-in user (renders nothing otherwise) and the Support app to be
 * enabled on the project.
 */
export function SupportWidget(props?: { title?: string, buttonLabel?: string }) {
  const app = useStackApp();
  const user = useUser();

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>({ kind: "list" });
  const [conversations, setConversations] = useState<SupportConversation[] | null>(null);
  const [detail, setDetail] = useState<SupportConversationDetail | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    setListError(null);
    try {
      const result = await app.listSupportConversations({ limit: 50 });
      setConversations(result.conversations);
    } catch (e) {
      setListError(formatError(e));
    }
  }, [app]);

  // Load the conversation list whenever the panel opens on the list view.
  useEffect(() => {
    if (open && view.kind === "list") {
      runAsynchronouslyWithAlert(refreshList);
    }
  }, [open, view.kind, refreshList]);

  // Poll the open thread for new messages.
  const threadConversationId = view.kind === "thread" ? view.conversationId : null;
  const detailRef = useRef(detail);
  detailRef.current = detail;
  useEffect(() => {
    if (!open || threadConversationId == null) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const next = await app.getSupportConversation(threadConversationId);
        if (!cancelled) {
          setDetail(next);
          setThreadError(null);
        }
      } catch (e) {
        if (!cancelled) setThreadError(formatError(e));
      }
    };

    // Fetch immediately, then on an interval.
    runAsynchronouslyWithAlert(poll);
    const interval = setInterval(() => runAsynchronouslyWithAlert(poll), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [open, threadConversationId, app]);

  if (user == null) {
    return null;
  }

  const openThread = (conversationId: string) => {
    setDetail(null);
    setThreadError(null);
    setView({ kind: "thread", conversationId });
  };

  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 2147483000 }}>
      {open && (
        <div
          role="dialog"
          aria-label="Support"
          style={{
            position: "absolute",
            bottom: 64,
            right: 0,
            width: 360,
            maxHeight: "70vh",
            display: "flex",
            flexDirection: "column",
            background: "var(--background, #fff)",
            color: "var(--foreground, #111)",
            border: "1px solid rgba(0,0,0,0.1)",
            borderRadius: 16,
            boxShadow: "0 12px 40px rgba(0,0,0,0.18)",
            overflow: "hidden",
          }}
        >
          <SupportHeader
            title={props?.title ?? "Support"}
            view={view}
            onBack={() => setView({ kind: "list" })}
            onClose={() => setOpen(false)}
          />

          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 16 }}>
            {view.kind === "list" && (
              <SupportList
                conversations={conversations}
                error={listError}
                onRetry={() => runAsynchronouslyWithAlert(refreshList)}
                onOpen={openThread}
                onNew={() => setView({ kind: "new" })}
              />
            )}
            {view.kind === "new" && (
              <SupportNewConversation
                onCreated={(created) => {
                  setDetail(created);
                  setView({ kind: "thread", conversationId: created.conversation.conversationId });
                  runAsynchronouslyWithAlert(refreshList);
                }}
              />
            )}
            {view.kind === "thread" && (
              <SupportThread
                conversationId={view.conversationId}
                detail={detail}
                error={threadError}
                currentUserId={user.id}
              />
            )}
          </div>
        </div>
      )}

      <Button onClick={() => setOpen((v) => !v)} style={{ borderRadius: 9999 }}>
        {props?.buttonLabel ?? (open ? "Close" : "Support")}
      </Button>
    </div>
  );
}

function SupportHeader(props: { title: string, view: View, onBack: () => void, onClose: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        padding: "12px 16px",
        borderBottom: "1px solid rgba(0,0,0,0.08)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {props.view.kind !== "list" && (
          <Button size="sm" variant="ghost" onClick={props.onBack} aria-label="Back">←</Button>
        )}
        <span style={{ fontWeight: 600 }}>
          {props.view.kind === "new" ? "New conversation" : props.title}
        </span>
      </div>
      <Button size="sm" variant="ghost" onClick={props.onClose} aria-label="Close">✕</Button>
    </div>
  );
}

function SupportList(props: {
  conversations: SupportConversation[] | null,
  error: string | null,
  onRetry: () => void,
  onOpen: (conversationId: string) => void,
  onNew: () => void,
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Button onClick={props.onNew}>New conversation</Button>

      {props.error != null ? (
        <ErrorState message={props.error} onRetry={props.onRetry} />
      ) : props.conversations == null ? (
        <MutedText>Loading…</MutedText>
      ) : props.conversations.length === 0 ? (
        <MutedText>No conversations yet. Start one above.</MutedText>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {props.conversations.map((conversation) => (
            <button
              key={conversation.conversationId}
              type="button"
              onClick={() => props.onOpen(conversation.conversationId)}
              style={{
                textAlign: "left",
                padding: 12,
                borderRadius: 10,
                border: "1px solid rgba(0,0,0,0.08)",
                background: "transparent",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {conversation.subject}
                </span>
                <span style={{ fontSize: 11, opacity: 0.6, textTransform: "capitalize" }}>{conversation.status}</span>
              </div>
              {conversation.preview != null && (
                <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {conversation.preview}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SupportNewConversation(props: { onCreated: (detail: SupportConversationDetail) => void }) {
  const app = useStackApp();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const canSubmit = subject.trim().length > 0 && message.trim().length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
      <textarea
        placeholder="How can we help?"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={5}
        style={{
          resize: "vertical",
          padding: 10,
          borderRadius: 8,
          border: "1px solid rgba(0,0,0,0.15)",
          background: "transparent",
          color: "inherit",
          font: "inherit",
        }}
      />
      {error != null && <ErrorState message={error} />}
      <Button
        disabled={!canSubmit}
        onClick={async () => {
          setError(null);
          try {
            const detail = await app.createSupportConversation({ subject: subject.trim(), message: message.trim() });
            props.onCreated(detail);
          } catch (e) {
            setError(formatError(e));
          }
        }}
      >
        Send
      </Button>
    </div>
  );
}

function SupportThread(props: {
  conversationId: string,
  detail: SupportConversationDetail | null,
  error: string | null,
  currentUserId: string,
}) {
  const app = useStackApp();
  const [message, setMessage] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const messageCount = props.detail?.messages.length ?? 0;
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messageCount]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, height: "100%" }}>
      {props.error != null && props.detail == null ? (
        <ErrorState message={props.error} />
      ) : props.detail == null ? (
        <MutedText>Loading…</MutedText>
      ) : (
        <>
          <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
            {props.detail.messages
              .filter((m) => m.messageType === "message")
              .map((m) => {
                const mine = m.sender.type === "user";
                return (
                  <div
                    key={m.id}
                    style={{
                      alignSelf: mine ? "flex-end" : "flex-start",
                      maxWidth: "85%",
                      padding: "8px 12px",
                      borderRadius: 12,
                      background: mine ? "var(--primary, #2563eb)" : "rgba(0,0,0,0.06)",
                      color: mine ? "#fff" : "inherit",
                      fontSize: 14,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {m.body}
                  </div>
                );
              })}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {sendError != null && <ErrorState message={sendError} />}
            <div style={{ display: "flex", gap: 6 }}>
              <Input
                placeholder="Reply…"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && message.trim().length > 0) {
                    e.preventDefault();
                    runAsynchronouslyWithAlert(sendReply);
                  }
                }}
              />
              <Button
                disabled={message.trim().length === 0}
                onClick={() => runAsynchronouslyWithAlert(sendReply)}
              >
                Send
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );

  async function sendReply() {
    const text = message.trim();
    if (text.length === 0) return;
    setSendError(null);
    setMessage("");
    try {
      await app.sendSupportConversationMessage(props.conversationId, text);
    } catch (e) {
      setSendError(formatError(e));
      setMessage(text);
    }
  }
}

function MutedText(props: { children: React.ReactNode }) {
  return <div style={{ fontSize: 13, opacity: 0.6, textAlign: "center", padding: "16px 0" }}>{props.children}</div>;
}

function ErrorState(props: { message: string, onRetry?: () => void }) {
  return (
    <div style={{ fontSize: 13, color: "var(--destructive, #dc2626)", display: "flex", flexDirection: "column", gap: 6 }}>
      <span>{props.message}</span>
      {props.onRetry != null && (
        <Button size="sm" variant="secondary" onClick={props.onRetry}>Retry</Button>
      )}
    </div>
  );
}
