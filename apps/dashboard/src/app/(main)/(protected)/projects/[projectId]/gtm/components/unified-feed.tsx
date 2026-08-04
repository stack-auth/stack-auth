"use client";

import { DesignBadge, DesignButton } from "@/components/design-components";
import { useGtmData } from "@/lib/gtm/gtm-data";
import type { GtmAction, GtmInsight } from "@/lib/gtm/gtm-types";
import { LightbulbIcon, PencilSimpleIcon, PlayCircleIcon } from "@phosphor-icons/react";
import { useOptionalGtmAdminControls } from "./admin-context";
import { GtmLoadableSection } from "./shared";

type FeedItem =
  | { type: "insight", value: GtmInsight, time: number }
  | { type: "action", value: GtmAction, time: number };

export function UnifiedFeed(props: { limit?: number }) {
  const { data } = useGtmData();
  const admin = useOptionalGtmAdminControls();

  return (
    <GtmLoadableSection data={data}>
      {(dataset) => {
        const items: FeedItem[] = [
          ...dataset.insights.map((value): FeedItem => ({ type: "insight", value, time: value.createdAtMillis })),
          ...dataset.actions
            .filter((item) => item.status === "proposed")
            .map((value): FeedItem => ({ type: "action", value, time: value.createdAtMillis })),
        ].sort((left, right) => right.time - left.time);
        const visible = props.limit == null ? items : items.slice(0, props.limit);

        if (visible.length === 0) {
          return (
            <div className="border-y border-foreground/[0.09] py-14 text-center">
              <LightbulbIcon className="mx-auto h-7 w-7 text-muted-foreground/50" />
              <p className="mt-4 text-sm font-medium">The brief is clear for now.</p>
              <p className="mt-2 text-sm text-muted-foreground">Curated findings and actions will appear here.</p>
            </div>
          );
        }

        return (
          <div className="border-t border-foreground/[0.09]">
            {visible.map((item) => {
              const Icon = item.type === "insight" ? LightbulbIcon : PlayCircleIcon;
              const body = item.type === "insight" ? item.value.body : item.value.summary;
              const eyebrow = item.type === "insight" ? "Growth signal" : "Recorded action";
              const edit = admin == null
                ? null
                : () => item.type === "insight"
                  ? admin.editInsight(item.value)
                  : admin.editAction(item.value);

              return (
                <article
                  key={`${item.type}-${item.value.id}`}
                  className="grid gap-4 border-b border-foreground/[0.09] px-2 py-7 sm:grid-cols-[6rem_1.5rem_minmax(0,1fr)]"
                >
                  <time className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground sm:pt-1">
                    {new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(item.time)}
                  </time>
                  <Icon className="hidden h-4 w-4 text-muted-foreground sm:block" />
                  <div>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground">{eyebrow}</p>
                        <h3 className="mt-2 text-base font-semibold tracking-tight sm:text-lg">{item.value.title}</h3>
                      </div>
                      {edit != null && (
                        <DesignButton variant="plain" size="icon" aria-label={`Edit ${item.value.title}`} onClick={edit}>
                          <PencilSimpleIcon className="h-4 w-4" />
                        </DesignButton>
                      )}
                    </div>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{body}</p>
                    {item.type === "action" && (
                      <div className="mt-4">
                        <DesignBadge size="sm" color="blue" label={item.value.status} />
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        );
      }}
    </GtmLoadableSection>
  );
}
