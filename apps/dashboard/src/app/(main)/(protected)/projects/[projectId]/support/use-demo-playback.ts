import { useCallback, useEffect, useRef, useState } from "react";
import { DEMO_CONVERSATIONS, type DemoConversation, type DemoMessage, type DemoSender, type DossierField } from "./fixtures";

export type ConversationPlaybackState = {
  messages: DemoMessage[],
  typing: DemoSender | null,
  confidence: number,
  revealedDossierFields: ReadonlySet<DossierField>,
  draft: string,
  scriptStatus: "idle" | "playing" | "done",
  devinStage: "idle" | "working" | "done",
  repliesReleased: boolean,
};

export type DemoPlayback = {
  stateFor: (conversationId: string) => ConversationPlaybackState,
  incidentTripped: boolean,
  /** Starts (or restarts) an unfinished script. Returns a canceller suitable as an effect cleanup. */
  startScript: (conversationId: string) => (() => void) | undefined,
  replayScript: (conversationId: string) => void,
  setDraft: (conversationId: string, draft: string) => void,
  sendAgentReply: (conversationId: string, body: string) => void,
  appendSystemMessage: (conversationId: string, body: string) => void,
  tagDevin: (conversationId: string) => void,
  releaseHeldReplies: () => void,
};

const ALL_DOSSIER_FIELDS: DossierField[] = ["identity", "plan", "authEvents", "replay", "pastTickets"];

function nowLabel(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function initialStateFor(conversation: DemoConversation): ConversationPlaybackState {
  const isScripted = conversation.script !== undefined;
  return {
    messages: conversation.seedMessages,
    typing: null,
    confidence: isScripted ? 0 : conversation.confidence,
    revealedDossierFields: new Set(isScripted ? [] : ALL_DOSSIER_FIELDS),
    draft: isScripted ? "" : (conversation.initialDraft ?? ""),
    scriptStatus: isScripted ? "idle" : "done",
    devinStage: "idle",
    repliesReleased: false,
  };
}

function buildInitialStates(): Record<string, ConversationPlaybackState> {
  return Object.fromEntries(DEMO_CONVERSATIONS.map((conversation) => [conversation.id, initialStateFor(conversation)]));
}

export function useDemoPlayback(): DemoPlayback {
  const [states, setStates] = useState<Record<string, ConversationPlaybackState>>(buildInitialStates);
  const [incidentTripped, setIncidentTripped] = useState(false);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>[]>>(new Map());
  const finishedScriptsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const list of timers.values()) {
        for (const timer of list) clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  const clearTimersFor = useCallback((conversationId: string) => {
    const list = timersRef.current.get(conversationId);
    if (list) {
      for (const timer of list) clearTimeout(timer);
    }
    timersRef.current.set(conversationId, []);
  }, []);

  const schedule = useCallback((conversationId: string, delayMs: number, fn: () => void) => {
    const timer = setTimeout(fn, delayMs);
    const list = timersRef.current.get(conversationId) ?? [];
    list.push(timer);
    timersRef.current.set(conversationId, list);
  }, []);

  const patchState = useCallback((conversationId: string, patch: (prev: ConversationPlaybackState) => Partial<ConversationPlaybackState>) => {
    setStates((prev) => {
      const current = prev[conversationId] as ConversationPlaybackState | undefined;
      if (!current) return prev;
      return { ...prev, [conversationId]: { ...current, ...patch(current) } };
    });
  }, []);

  const runScript = useCallback((conversation: DemoConversation) => {
    const script = conversation.script;
    if (!script) return;

    patchState(conversation.id, () => ({ scriptStatus: "playing" }));

    let cumulativeMs = 0;
    for (const step of script) {
      if (step.kind === "wait") {
        cumulativeMs += step.ms;
        continue;
      }
      schedule(conversation.id, cumulativeMs, () => {
        switch (step.kind) {
          case "typing": {
            patchState(conversation.id, () => ({ typing: step.sender }));
            break;
          }
          case "message": {
            patchState(conversation.id, (prev) => ({ typing: null, messages: [...prev.messages, step.message] }));
            break;
          }
          case "confidence": {
            patchState(conversation.id, () => ({ confidence: step.to }));
            break;
          }
          case "dossier": {
            patchState(conversation.id, (prev) => ({
              revealedDossierFields: new Set([...prev.revealedDossierFields, step.field]),
            }));
            break;
          }
          case "draft": {
            patchState(conversation.id, () => ({ draft: step.text }));
            break;
          }
          case "incident-trip": {
            setIncidentTripped(true);
            break;
          }
        }
      });
    }
    schedule(conversation.id, cumulativeMs, () => {
      finishedScriptsRef.current.add(conversation.id);
      patchState(conversation.id, () => ({
        typing: null,
        scriptStatus: "done",
        // Whatever the script didn't reveal step-by-step is available once
        // the AI finishes gathering.
        revealedDossierFields: new Set(ALL_DOSSIER_FIELDS),
      }));
    });
  }, [patchState, schedule]);

  const restartScript = useCallback((conversation: DemoConversation) => {
    clearTimersFor(conversation.id);
    finishedScriptsRef.current.delete(conversation.id);
    if (conversation.clusterId === "email-latency") setIncidentTripped(false);
    setStates((prev) => ({ ...prev, [conversation.id]: initialStateFor(conversation) }));
    runScript(conversation);
  }, [clearTimersFor, runScript]);

  const startScript = useCallback((conversationId: string) => {
    const conversation = DEMO_CONVERSATIONS.find((candidate) => candidate.id === conversationId);
    if (!conversation?.script) return undefined;
    if (finishedScriptsRef.current.has(conversationId)) return undefined;
    // Restart from the top on every (re)mount: dev StrictMode cancels the
    // first run's timers via the cleanup below, and mid-script tab switches
    // replay the intake from the start, which is what a demo wants anyway.
    restartScript(conversation);
    return () => clearTimersFor(conversationId);
  }, [restartScript, clearTimersFor]);

  const replayScript = useCallback((conversationId: string) => {
    const conversation = DEMO_CONVERSATIONS.find((candidate) => candidate.id === conversationId);
    if (!conversation?.script) return;
    restartScript(conversation);
  }, [restartScript]);

  const setDraft = useCallback((conversationId: string, draft: string) => {
    patchState(conversationId, () => ({ draft }));
  }, [patchState]);

  const sendAgentReply = useCallback((conversationId: string, body: string) => {
    const trimmed = body.trim();
    if (trimmed === "") return;
    patchState(conversationId, (prev) => ({
      draft: "",
      messages: [...prev.messages, {
        id: `agent-${prev.messages.length}-${trimmed.length}`,
        sender: "agent",
        kind: "text",
        body: trimmed,
        at: nowLabel(),
      }],
    }));
  }, [patchState]);

  const appendSystemMessage = useCallback((conversationId: string, body: string) => {
    patchState(conversationId, (prev) => ({
      messages: [...prev.messages, {
        id: `system-${prev.messages.length}-${body.length}`,
        sender: "system",
        kind: "status",
        body,
        at: nowLabel(),
      }],
    }));
  }, [patchState]);

  const tagDevin = useCallback((conversationId: string) => {
    patchState(conversationId, (prev) => {
      if (prev.devinStage !== "idle") return {};
      return {
        devinStage: "working",
        messages: [...prev.messages, {
          id: "devin-start",
          sender: "system",
          kind: "status",
          body: "@Devin tagged — spinning up Safari 26, reproducing the sign-in failure",
          at: nowLabel(),
        }],
      };
    });
    schedule(conversationId, 3200, () => {
      patchState(conversationId, (prev) => {
        if (prev.devinStage !== "working") return {};
        return {
          devinStage: "done",
          messages: [...prev.messages, {
            id: "devin-video",
            sender: "system",
            kind: "devin-video",
            body: "Reproduced on Safari 26 with @hexclave/next 2.8.1 — TypeError on sign-in click, fixed on 2.8.3. Recording attached.",
            at: nowLabel(),
          }],
        };
      });
    });
  }, [patchState, schedule]);

  const releaseHeldReplies = useCallback(() => {
    patchState("conv-magiclink", () => ({ repliesReleased: true }));
  }, [patchState]);

  const stateFor = useCallback((conversationId: string): ConversationPlaybackState => {
    const state = states[conversationId] as ConversationPlaybackState | undefined;
    return state ?? {
      messages: [],
      typing: null,
      confidence: 0,
      revealedDossierFields: new Set(),
      draft: "",
      scriptStatus: "done",
      devinStage: "idle",
      repliesReleased: false,
    };
  }, [states]);

  return { stateFor, incidentTripped, startScript, replayScript, setDraft, sendAgentReply, appendSystemMessage, tagDevin, releaseHeldReplies };
}
