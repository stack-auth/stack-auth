"use client";

import { DesignAlert, DesignBadge, DesignButton, DesignCard } from "@/components/design-components";
import { Typography, cn } from "@/components/ui";
import { COMMS_TOPICS, type CommsMessage, type CommsTopic, useCommsMessages } from "@/lib/comms-mock";
import { GitMergeIcon, SparkleIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";
import { CommsComposer, MergeOverrideMenu, MessageBubble } from "../comms-components";

export default function PageClient() {
  const liveMessages = useCommsMessages();
  const [topics, setTopics] = useState<CommsTopic[]>([...COMMS_TOPICS]);
  const [selectedTopicId, setSelectedTopicId] = useState(COMMS_TOPICS[0]?.id ?? "");
  const [notice, setNotice] = useState<string | null>(null);

  const selectedTopic = topics.find((topic) => topic.id === selectedTopicId) ?? topics[0] ?? null;
  const topicMessages = useMemo(() => {
    if (selectedTopic == null) {
      return [];
    }
    return liveMessages
      .filter((message) => message.topicId === selectedTopic.id || selectedTopic.messageIds.includes(message.id))
      .sort(compareMessageTimestampAscending);
  }, [liveMessages, selectedTopic]);

  return (
    <AppEnabledGuard appId="authentication">
      <PageLayout
        title="Topics"
        description="AI groups inbound and outbound communication into topics, with manual override controls for merge and split mistakes."
        fillWidth
      >
        {notice != null ? <DesignAlert variant="info" description={notice} /> : null}
        <div className="grid min-h-0 gap-4 xl:grid-cols-[380px_1fr]">
          <DesignCard glassmorphic contentClassName="flex min-h-[720px] flex-col gap-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <SparkleIcon className="h-4 w-4 text-purple-500" />
                  <Typography className="text-sm font-semibold">AI topics</Typography>
                </div>
                <Typography variant="secondary" className="mt-1 text-xs">Auto-categorized from every channel.</Typography>
              </div>
              <DesignBadge label={topics.length.toString()} color="purple" size="sm" />
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              {topics.map((topic) => (
                <button
                  key={topic.id}
                  type="button"
                  onClick={() => setSelectedTopicId(topic.id)}
                  className={cn(
                    "w-full rounded-2xl border p-4 text-left transition-colors duration-150 hover:bg-foreground/[0.04] hover:transition-none",
                    selectedTopic?.id === topic.id ? "border-purple-500/40 bg-purple-500/[0.07]" : "border-border/60 bg-background/70"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <Typography className="min-w-0 text-sm font-semibold">{topic.title}</Typography>
                    <DesignBadge label={topic.status} color={topic.status === "resolved" ? "green" : topic.status === "waiting" ? "orange" : "blue"} size="sm" />
                  </div>
                  <Typography variant="secondary" className="mt-2 line-clamp-2 text-xs">{topic.summary}</Typography>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <DesignBadge label={`${topic.confidence}% confidence`} color="purple" size="sm" />
                    <DesignBadge label={`${topic.messageIds.length} seed messages`} color="blue" size="sm" />
                  </div>
                </button>
              ))}
            </div>
          </DesignCard>

          {selectedTopic != null ? (
            <DesignCard glassmorphic contentClassName="flex min-h-[720px] flex-col p-0">
              <div className="border-b border-border/60 p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap gap-2">
                      {selectedTopic.labels.map((label) => <DesignBadge key={label} label={label} color="cyan" size="sm" />)}
                    </div>
                    <Typography className="text-lg font-semibold">{selectedTopic.title}</Typography>
                    <Typography variant="secondary" className="mt-1 max-w-3xl text-sm">{selectedTopic.summary}</Typography>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <MergeOverrideMenu
                      label="Override AI"
                      onMerge={() => {
                        const otherTopic = topics.find((topic) => topic.id !== selectedTopic.id);
                        if (otherTopic == null) {
                          setNotice("No other mock topic is available to merge.");
                          return;
                        }
                        setTopics((current) => current.filter((topic) => topic.id !== otherTopic.id));
                        setNotice(`Mock merged "${otherTopic.title}" into "${selectedTopic.title}".`);
                      }}
                      onSplit={() => {
                        setNotice(`Mock split prepared for "${selectedTopic.title}". In the real app, selected messages would move into a new topic.`);
                      }}
                    />
                    <DesignButton variant="outline" size="sm">
                      <GitMergeIcon className="h-4 w-4" />
                      Merge topics
                    </DesignButton>
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
                {topicMessages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}
              </div>

              <div className="border-t border-border/60 p-5">
                <Typography className="mb-3 text-sm font-semibold">Respond in this topic</Typography>
                <CommsComposer
                  compact
                  submitLabel="Send mock reply"
                  initialContactId={selectedTopic.contactIds[0]}
                  onSubmit={(value) => {
                    setNotice(`Mock ${value.platform} reply composed for "${selectedTopic.title}".`);
                  }}
                />
              </div>
            </DesignCard>
          ) : (
            <DesignCard glassmorphic contentClassName="flex min-h-[720px] items-center justify-center p-8 text-center">
              <Typography variant="secondary">Select a topic to inspect its conversation and compose a response.</Typography>
            </DesignCard>
          )}
        </div>
      </PageLayout>
    </AppEnabledGuard>
  );
}

function compareMessageTimestampAscending(a: CommsMessage, b: CommsMessage) {
  return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
}
