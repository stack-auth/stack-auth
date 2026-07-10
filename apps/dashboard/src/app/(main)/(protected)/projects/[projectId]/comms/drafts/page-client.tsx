"use client";

import { DesignAlert, DesignBadge, DesignCard } from "@/components/design-components";
import { Typography } from "@/components/ui";
import { COMMS_DRAFTS, COMMS_PLATFORM_LABELS, type CommsDraft } from "@/lib/comms-mock";
import { NotePencilIcon, PaperPlaneTiltIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";
import { CommsComposer, DraftCard } from "../comms-components";

export default function PageClient() {
  const [drafts, setDrafts] = useState<CommsDraft[]>([...COMMS_DRAFTS]);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <AppEnabledGuard appId="authentication">
      <PageLayout
        title="Drafts"
        description="Compose and save channel-specific messages before sending them through Comms."
        fillWidth
      >
        {notice != null ? <DesignAlert variant="success" description={notice} /> : null}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-4">
            <DesignCard title="New draft" subtitle="The editor adapts to each platform instead of flattening every channel into email." icon={NotePencilIcon} gradient="default" glassmorphic>
              <CommsComposer
                submitLabel="Save draft"
                onSubmit={(value) => {
                  const nextDraft: CommsDraft = {
                    id: `draft-${drafts.length + 1}`,
                    platform: value.platform,
                    title: value.subject.trim() || `${COMMS_PLATFORM_LABELS[value.platform]} message`,
                    contactId: value.contactId,
                    recipients: value.recipients.split(",").map((recipient) => recipient.trim()).filter((recipient) => recipient !== ""),
                    channelLabel: value.channelLabel,
                    subject: value.subject,
                    body: value.body,
                    updatedAt: new Date().toISOString(),
                    status: "draft",
                  };
                  setDrafts((current) => [nextDraft, ...current]);
                  setNotice(`Saved ${COMMS_PLATFORM_LABELS[value.platform]} draft.`);
                }}
              />
            </DesignCard>
          </div>

          <div className="space-y-4">
            <DesignCard glassmorphic contentClassName="p-5">
              <div className="flex items-start gap-3">
                <PaperPlaneTiltIcon className="mt-0.5 h-5 w-5 text-blue-500" />
                <div>
                  <Typography className="text-sm font-semibold">Draft queue</Typography>
                  <Typography variant="secondary" className="mt-1 text-sm">
                    Drafts stay organized by channel so teams can review and send from the right platform context.
                  </Typography>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <DesignBadge label={`${drafts.length} drafts`} color="blue" size="sm" />
                <DesignBadge label={`${drafts.filter((draft) => draft.status === "scheduled").length} scheduled`} color="purple" size="sm" />
              </div>
            </DesignCard>

            <div className="space-y-3">
              {drafts.map((draft) => (
                <DraftCard key={draft.id} draft={draft} />
              ))}
            </div>
          </div>
        </div>
      </PageLayout>
    </AppEnabledGuard>
  );
}
