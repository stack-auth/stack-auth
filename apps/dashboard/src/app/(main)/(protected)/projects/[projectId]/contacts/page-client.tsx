"use client";

import { DesignBadge, DesignCard, DesignInput, DesignSelectorDropdown } from "@/components/design-components";
import { Typography } from "@/components/ui";
import { COMMS_CONTACTS, type CommsContact } from "@/lib/comms-mock";
import { AddressBookIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useProjectId } from "../use-admin-app";
import { ContactMiniCard } from "../comms/comms-components";

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
        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard label="Contacts" value={COMMS_CONTACTS.length.toString()} detail="Mock CRM identities" />
          <MetricCard label="User-backed" value={userBackedCount.toString()} detail="Automatically also contacts" />
          <MetricCard label="Channel handles" value={channelCount.toString()} detail="Emails, Slack, Discord, tickets, push" />
        </div>

        <DesignCard glassmorphic contentClassName="space-y-4 p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-2">
              <AddressBookIcon className="h-5 w-5 text-blue-500" />
              <Typography className="text-sm font-semibold">Contact directory</Typography>
              <DesignBadge label={`${contacts.length} shown`} color="blue" size="sm" />
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_180px]">
              <div className="relative">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <DesignInput
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search contacts"
                  className="pl-9"
                />
              </div>
              <DesignSelectorDropdown
                value={lifecycle}
                options={lifecycleOptions}
                onValueChange={(value) => setLifecycle(parseLifecycleFilter(value))}
                size="md"
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {contacts.map((contact) => (
              <ContactMiniCard key={contact.id} contact={contact} projectId={projectId} />
            ))}
          </div>
        </DesignCard>
      </PageLayout>
    </AppEnabledGuard>
  );
}

function MetricCard({ label, value, detail }: { label: string, value: string, detail: string }) {
  return (
    <DesignCard glassmorphic contentClassName="p-5">
      <Typography variant="secondary" className="text-xs font-semibold uppercase tracking-wider">{label}</Typography>
      <Typography className="mt-2 text-2xl font-semibold">{value}</Typography>
      <Typography variant="secondary" className="mt-1 text-sm">{detail}</Typography>
    </DesignCard>
  );
}

function parseLifecycleFilter(value: string): CommsContact["lifecycle"] | "all" {
  if (value === "all" || value === "Lead" || value === "Customer" || value === "Champion" || value === "At risk") {
    return value;
  }
  throw new Error(`Unknown lifecycle filter ${value}`);
}
