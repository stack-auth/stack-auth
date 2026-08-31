"use client";

import { PageLayout } from "../../../page-layout";
import { GrowthAppFrame } from "../../components/frame";
import { GrowthInternalResourceUnavailable } from "../../components/internal-unavailable";

export default function PageClient() {
  return (
    <GrowthAppFrame>
      <PageLayout title="Growth Brief" description="Growth briefs are available to staff only">
        <GrowthInternalResourceUnavailable resource="Growth briefs" />
      </PageLayout>
    </GrowthAppFrame>
  );
}
