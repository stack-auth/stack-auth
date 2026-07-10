"use client";

import { Link } from "@/components/link";
import { DesignBadge, DesignInput, DesignSelectorDropdown } from "@/components/design-components";
import { Typography } from "@/components/ui";
import { COMMS_CONTACTS, type CommsContact } from "@/lib/comms-mock";
import { AddressBookIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useProjectId } from "../use-admin-app";
import { ContactAvatar } from "../comms/comms-components";

const lifecycleOptions = [
  { value: "all", label: "All lifecycles" },
  { value: "Lead", label: "Lead" },
  { value: "Customer", label: "Customer" },
  { value: "Champion", label: "Champion" },
  { value: "At risk", label: "At risk" },
];

export default function PageClient() {
  const projectId = useProjectId();
  const [query, setQuery] = useState("");
  const [lifecycle, setLifecycle] = useState<CommsContact["lifecycle"] | "all">("all");

  const contacts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return COMMS_CONTACTS.filter((contact) => {
      const lifecycleMatches = lifecycle === "all" || contact.lifecycle === lifecycle;
      const queryMatches = normalizedQuery === ""
        || contact.name.toLowerCase().includes(normalizedQuery)
        || contact.company.toLowerCase().includes(normalizedQuery)
        || contact.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery));
      return lifecycleMatches && queryMatches;
    });
  }, [lifecycle, query]);

  const userBackedCount = COMMS_CONTACTS.filter((contact) => contact.userId != null).length;
  const channelCount = COMMS_CONTACTS.reduce((sum, contact) => {
    return sum
      + contact.channels.emails.length
      + contact.channels.slackIds.length
      + contact.channels.discordIds.length
      + contact.channels.supportIds.length
      + contact.channels.pushTokens.length;
  }, 0);

  return (
    <AppEnabledGuard appId="authentication">
      <PageLayout
        title="Contacts"
        description="CRM-style contact records for everyone your company has interacted with, including users and channel-only identities."
        fillWidth
      >
        <div className="mb-4 grid gap-4 md:grid-cols-3">
          <MetricBlock label="Contacts" value={COMMS_CONTACTS.length.toString()} detail="CRM identities" />
          <MetricBlock label="User-backed" value={userBackedCount.toString()} detail="Automatically also contacts" />
          <MetricBlock label="Channel handles" value={channelCount.toString()} detail="Emails, Slack, Discord, tickets, push" />
        </div>

        <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-background">
          <div className="flex flex-col gap-3 border-b border-border/70 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <AddressBookIcon className="h-4 w-4 text-muted-foreground" />
              <Typography className="text-sm font-semibold">Contact directory</Typography>
              <Typography variant="secondary" className="text-xs">{contacts.length} shown</Typography>
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_180px]">
              <div className="relative">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <DesignInput
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search contacts"
                  className="h-8 pl-9 text-sm"
                />
              </div>
              <DesignSelectorDropdown
                value={lifecycle}
                options={lifecycleOptions}
                onValueChange={(value) => setLifecycle(parseLifecycleFilter(value))}
                size="sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-[minmax(16rem,1.5fr)_8rem_12rem_10rem_8rem] gap-3 border-b border-border/70 bg-muted/30 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <div>Contact</div>
            <div>Status</div>
            <div>Channels</div>
            <div>Owner</div>
            <div className="text-right">Last touched</div>
          </div>

          <div className="divide-y divide-border/70">
            {contacts.map((contact) => (
              <ContactRow key={contact.id} contact={contact} projectId={projectId} />
            ))}
          </div>
        </div>
      </PageLayout>
    </AppEnabledGuard>
  );
}

function MetricBlock({ label, value, detail }: { label: string, value: string, detail: string }) {
  return (
    <div className="rounded-xl border border-border bg-background px-4 py-3">
      <Typography variant="secondary" className="text-xs font-semibold uppercase tracking-wider">{label}</Typography>
      <Typography className="mt-1 text-2xl font-semibold">{value}</Typography>
      <Typography variant="secondary" className="mt-1 text-sm">{detail}</Typography>
    </div>
  );
}

function ContactRow({ contact, projectId }: { contact: CommsContact, projectId: string }) {
  const channels = [
    contact.channels.emails.length > 0 ? `${contact.channels.emails.length} email${contact.channels.emails.length === 1 ? "" : "s"}` : null,
    contact.channels.slackIds.length > 0 ? `${contact.channels.slackIds.length} Slack` : null,
    contact.channels.discordIds.length > 0 ? `${contact.channels.discordIds.length} Discord` : null,
    contact.channels.supportIds.length > 0 ? `${contact.channels.supportIds.length} ticket${contact.channels.supportIds.length === 1 ? "" : "s"}` : null,
  ].filter((value) => value != null);

  return (
    <Link
      href={`/projects/${encodeURIComponent(projectId)}/contacts/${encodeURIComponent(contact.id)}`}
      className="grid grid-cols-[minmax(16rem,1.5fr)_8rem_12rem_10rem_8rem] items-center gap-3 px-4 py-2.5 text-sm transition-colors duration-150 hover:bg-muted/50 hover:transition-none"
    >
      <div className="flex min-w-0 items-center gap-3">
        <ContactAvatar contact={contact} size="sm" />
        <div className="min-w-0">
          <Typography className="truncate text-sm font-medium">{contact.name}</Typography>
          <Typography variant="secondary" className="truncate text-xs">{contact.role} · {contact.company}</Typography>
        </div>
      </div>
      <div>
        <DesignBadge label={contact.lifecycle} color={contact.lifecycle === "At risk" ? "orange" : contact.lifecycle === "Champion" ? "green" : "blue"} size="sm" />
      </div>
      <Typography variant="secondary" className="truncate text-xs">{channels.join(", ") || "No channels"}</Typography>
      <Typography className="truncate text-xs">{contact.owner}</Typography>
      <Typography variant="secondary" className="truncate text-right text-xs">{formatContactDate(contact.lastTouchedAt)}</Typography>
    </Link>
  );
}

function formatContactDate(value: string) {
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
}

function parseLifecycleFilter(value: string): CommsContact["lifecycle"] | "all" {
  if (value === "all" || value === "Lead" || value === "Customer" || value === "Champion" || value === "At risk") {
    return value;
  }
  throw new Error(`Unknown lifecycle filter ${value}`);
}
