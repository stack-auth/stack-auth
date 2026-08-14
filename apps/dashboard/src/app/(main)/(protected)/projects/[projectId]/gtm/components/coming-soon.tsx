"use client";

import type { ReactNode } from "react";
import { PageLayout } from "../../page-layout";
import { GrowthAppFrame } from "./frame";

/**
 * Placeholder body for growth pages whose real implementation lands in a later phase. Every route exists
 * from day one so navigation, deep links, and the app shell are stable while the features behind them are
 * built out.
 */
export function GrowthComingSoonPage(props: { title: string, description: string, body: ReactNode }) {
  return (
    <GrowthAppFrame>
      <PageLayout title={props.title} description={props.description}>
        <div className="rounded-2xl border border-dashed border-foreground/[0.1] bg-foreground/[0.02] p-8 text-center">
          <p className="text-sm text-muted-foreground">{props.body}</p>
        </div>
      </PageLayout>
    </GrowthAppFrame>
  );
}
