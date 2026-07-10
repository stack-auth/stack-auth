"use client";

import { DesignBadge, DesignButton, DesignDialog, DesignSelectorDropdown } from "@/components/design-components";
import { Typography, cn } from "@/components/ui";
import {
  COMMS_PLATFORM_OPTIONS,
  type CommsDirection,
  type CommsMessage,
  type CommsPlatform,
  formatCommsTimestamp,
  getCommsContact,
  getCommsTopic,
  useCommsMessages,
} from "@/lib/comms-mock";
import { ArrowsClockwiseIcon, FunnelIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useProjectId } from "../use-admin-app";
import { ContactAvatar, MessageDetailPanel, PlatformBadge } from "./comms-components";

const directionOptions = [
  { value: "all", label: "All directions" },
  { value: "inbound", label: "Inbound" },
  { value: "outbound", label: "Sent" },
];

const platformOptions = [
  { value: "all", label: "All platforms" },
  ...COMMS_PLATFORM_OPTIONS,
];

export default function PageClient() {
  const projectId = useProjectId();
  const messages = useCommsMessages();
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [platformFilter, setPlatformFilter] = useState<CommsPlatform | "all">("all");
  const [directionFilter, setDirectionFilter] = useState<CommsDirection | "all">("all");

  const filteredMessages = useMemo(() => {
    return messages.filter((message) => {
      const platformMatches = platformFilter === "all" || message.platform === platformFilter;
      const directionMatches = directionFilter === "all" || message.direction === directionFilter;
      return platformMatches && directionMatches;
    });
  }, [directionFilter, messages, platformFilter]);

  const selectedMessage = selectedMessageId == null
    ? null
    : messages.find((message) => message.id === selectedMessageId) ?? null;

  return (
    <AppEnabledGuard appId="authentication">
      <PageLayout
        title="Message Stream"
        description="A live unified feed of inbound and outbound customer communication across every channel."
        fillWidth
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <DesignBadge label="Live feed" color="green" size="sm" />
            <DesignButton variant="outline" size="sm">
              <ArrowsClockwiseIcon className="h-4 w-4" />
              Refresh view
            </DesignButton>
          </div>
        }
      >
        <div className="flex min-w-0 flex-col">
          <div className="sticky top-0 z-10 flex flex-col gap-2 border-b border-border/50 bg-background/95 px-3 py-2 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Typography className="text-xs font-semibold uppercase tracking-wide text-foreground/70">
                Messages
              </Typography>
              <DesignBadge label={`${filteredMessages.length} shown`} color="blue" size="sm" />
              <Typography variant="secondary" className="hidden text-xs sm:inline">
                New inbound messages appear every few seconds.
              </Typography>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <DesignSelectorDropdown
                value={platformFilter}
                options={platformOptions}
                onValueChange={(value) => setPlatformFilter(parsePlatformFilter(value))}
                size="sm"
              />
              <DesignSelectorDropdown
                value={directionFilter}
                options={directionOptions}
                onValueChange={(value) => setDirectionFilter(parseDirectionFilter(value))}
                size="sm"
              />
            </div>
          </div>

          <div className="divide-y divide-border/50 border-b border-border/50">
            {filteredMessages.map((message) => (
              <CompactMessageRow
                key={message.id}
                message={message}
                onSelect={() => setSelectedMessageId(message.id)}
              />
            ))}
          </div>

          {filteredMessages.length === 0 ? (
            <div className="px-4 py-16 text-center">
              <FunnelIcon className="mx-auto h-8 w-8 text-muted-foreground" />
              <Typography className="mt-3 text-sm font-medium">No messages match these filters</Typography>
            </div>
          ) : null}
        </div>

        <DesignDialog
          open={selectedMessage != null}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedMessageId(null);
            }
          }}
          title={selectedMessage?.subject ?? "Message detail"}
          description="Channel payload, contact context, and AI topic assignment"
          size="5xl"
          noBodyPadding
        >
          {selectedMessage != null ? (
            <MessageDetailPanel message={selectedMessage} projectId={projectId} />
          ) : null}
        </DesignDialog>
      </PageLayout>
    </AppEnabledGuard>
  );
}

function CompactMessageRow({ message, onSelect }: { message: CommsMessage, onSelect: () => void }) {
  const contact = getCommsContact(message.contactId);
  const topic = getCommsTopic(message.topicId);
  if (contact == null || topic == null) {
    throw new Error(`Mock message ${message.id} references a missing contact or topic.`);
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "grid w-full grid-cols-[2.5rem_minmax(9rem,13rem)_7.5rem_minmax(0,1fr)_8rem] items-center gap-3 px-3 py-2 text-left",
        "text-sm transition-colors duration-150 hover:bg-muted/60 hover:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      )}
    >
      <ContactAvatar contact={contact} size="sm" />
      <div className="min-w-0">
        <Typography className="truncate text-sm font-medium">{contact.name}</Typography>
        <Typography variant="secondary" className="truncate text-[11px]">{contact.company}</Typography>
      </div>
      <div className="min-w-0">
        <PlatformBadge platform={message.platform} />
      </div>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <Typography className="truncate text-sm font-medium">{message.subject ?? topic.title}</Typography>
          {message.direction === "inbound" ? <DesignBadge label="Inbound" color="green" size="sm" /> : null}
          {message.urgency === "high" ? <DesignBadge label="High" color="orange" size="sm" /> : null}
        </div>
        <Typography variant="secondary" className="truncate text-xs">{message.text}</Typography>
      </div>
      <Typography variant="secondary" className="truncate text-right text-[11px] tabular-nums">
        {formatCommsTimestamp(message.timestamp)}
      </Typography>
    </button>
  );
}

function parsePlatformFilter(value: string): CommsPlatform | "all" {
  if (value === "all" || value === "email" || value === "slack" || value === "discord" || value === "support" || value === "push") {
    return value;
  }
  throw new Error(`Unknown platform filter ${value}`);
}

function parseDirectionFilter(value: string): CommsDirection | "all" {
  if (value === "all" || value === "inbound" || value === "outbound") {
    return value;
  }
  throw new Error(`Unknown direction filter ${value}`);
}
