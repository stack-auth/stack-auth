"use client";

import { PageLayout } from "../../../page-layout";
import { GrowthAppFrame } from "../../components/frame";
import { GrowthInternalResourceUnavailable } from "../../components/internal-unavailable";

export default function PageClient() {
  return (
    <GrowthAppFrame>
      <PageLayout title="Growth Evidence" description="Finding detail and supporting evidence">
        <GrowthInternalResourceUnavailable resource="Growth evidence" />
      </PageLayout>
    </GrowthAppFrame>
  );
}
