"use client";

import { DesignAlert, DesignButton } from "@/components/design-components";
import { Link } from "@/components/link";
import { useGrowthChat } from "@/lib/growth/growth-chat";
import { useGrowthStatus } from "@/lib/growth/growth-data";
import type { GrowthStatus } from "@/lib/growth/growth-types";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { PageLayout } from "../../page-layout";
import { useAdminApp, useProjectId } from "../../use-admin-app";
import { useGrowthHref } from "../components/action-card";
import { GrowthChatComposer } from "../components/chat/composer";
import { GrowthChatConversationList } from "../components/chat/conversation-list";
import { GrowthChatThread, GrowthChatWelcome } from "../components/chat/thread";
import { GrowthAppFrame, GrowthStatusGate } from "../components/frame";
import { GrowthReportHoldPanel } from "../components/report-hold";

export default function PageClient() {
  return (
    <GrowthAppFrame>
      <PageLayout title="Growth Chat" description="Ask anything — the assistant knows your full growth context">
        {/*
          Chat is locked until the first report is released, and the gate has to be OUTSIDE
          ChatPageBody rather than a branch inside it: the body mounts useGrowthChat, which loads the
          conversation list on mount, and those endpoints 409 while the workspace is held. Rendering
          the body and hiding it would show an error where an explanation belongs.

          Why chat at all — the assistant answers from the full growth context, so an unlocked chat
          would happily describe the findings the report has not shown the customer yet.
        */}
        <GrowthStatusGate>
          {(status) => status.release.state === "released" ? <ChatPageBody /> : <ChatLocked status={status} />}
        </GrowthStatusGate>
      </PageLayout>
    </GrowthAppFrame>
  );
}

/**
 * Two different locks wearing the same panel. `preparing` is the 24-hour hold and gets the standard
 * copy; anything earlier means the customer has not finished setting Growth up at all, where
 * promising a report tomorrow would be a lie — they have not started one.
 */
function ChatLocked(props: { status: GrowthStatus }) {
  const projectId = useProjectId();
  const withQuery = useGrowthHref();
  const overviewLink = (
    <Link href={withQuery(`/projects/${projectId}/growth`)}>
      <DesignButton variant="outline" size="sm">Go to the Growth overview</DesignButton>
    </Link>
  );
  if (props.status.release.state === "preparing") {
    return <GrowthReportHoldPanel>{overviewLink}</GrowthReportHoldPanel>;
  }
  return (
    <div className="rounded-2xl border border-dashed border-foreground/[0.1] bg-foreground/[0.02] p-8 text-center">
      <p className="text-sm font-medium text-foreground">Chat opens with your first report</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        The assistant answers from your growth analysis, so it needs one to exist first. Finish setting
        Growth up on the overview and it will be here waiting.
      </p>
      <div className="mt-4 flex justify-center">{overviewLink}</div>
    </div>
  );
}

function ThreadSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading the conversation">
      <div className="ml-auto h-10 w-1/3 animate-pulse rounded-2xl border border-foreground/[0.06] bg-foreground/[0.03]" />
      <div className="h-28 w-2/3 animate-pulse rounded-2xl border border-foreground/[0.06] bg-foreground/[0.03]" />
      <div className="ml-auto h-10 w-1/4 animate-pulse rounded-2xl border border-foreground/[0.06] bg-foreground/[0.03]" />
      <div className="h-20 w-2/3 animate-pulse rounded-2xl border border-foreground/[0.06] bg-foreground/[0.03]" />
    </div>
  );
}

function ChatPageBody() {
  const app = useAdminApp();
  const { demo } = useGrowthStatus();
  const chat = useGrowthChat({ app, demo });
  const searchParams = useSearchParams();
  // ?prompt= seeds the composer (it does NOT auto-send — the customer confirms by pressing send).
  // A pre-filled create flow can navigate here with the customer's automation description.
  const [draft, setDraft] = useState(() => searchParams.get("prompt") ?? "");

  const streaming = chat.turn.status === "streaming";
  // Every thread state carries the conversation id (null only for a fresh, unpersisted chat).
  const activeConversationId = chat.thread.conversationId;
  const showWelcome = chat.thread.status === "loaded"
    && chat.thread.conversationId == null
    && chat.thread.entries.length === 0
    && chat.turn.status === "idle";

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[15rem_minmax(0,1fr)]">
      <GrowthChatConversationList
        list={chat.list}
        activeConversationId={activeConversationId}
        disabled={streaming}
        onSelect={async (conversationId) => await chat.selectConversation(conversationId)}
        onNewChat={() => chat.startNewChat()}
        onRetryLoad={async () => await chat.reloadConversations()}
      />
      <div className="flex min-w-0 flex-col gap-5">
        {chat.thread.status === "loading" && <ThreadSkeleton />}
        {chat.thread.status === "error" && (
          <DesignAlert variant="error" title="Could not load this conversation" description={chat.thread.message}>
            <div className="mt-2">
              <DesignButton variant="outline" size="sm" onClick={async () => await chat.reloadThread()}>Retry</DesignButton>
            </div>
          </DesignAlert>
        )}
        {chat.thread.status === "loaded" && (
          <>
            {showWelcome ? (
              <GrowthChatWelcome disabled={demo} onSuggestion={(text) => setDraft(text)} />
            ) : (
              <GrowthChatThread
                entries={chat.thread.entries}
                streamingEntries={chat.turn.status === "streaming" ? chat.turn.entries : []}
                thinking={streaming}
              />
            )}
            {chat.turn.status === "error" && (
              <DesignAlert
                variant="error"
                title="The growth assistant could not respond"
                description="Your message was not saved, so retrying simply sends it again."
              >
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <DesignButton variant="outline" size="sm" onClick={async () => await chat.retryFailedMessage()}>
                    Retry
                  </DesignButton>
                  <span className="text-xs text-muted-foreground">{chat.turn.message}</span>
                </div>
              </DesignAlert>
            )}
            <GrowthChatComposer
              draft={draft}
              onDraftChange={setDraft}
              onSend={async (text) => await chat.sendMessage(text)}
              disabled={demo || streaming}
              demo={demo}
            />
          </>
        )}
      </div>
    </div>
  );
}
