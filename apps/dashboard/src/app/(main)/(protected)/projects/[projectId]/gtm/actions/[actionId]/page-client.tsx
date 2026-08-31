"use client";

import { PageLayout } from "../../../page-layout";
import { GrowthAppFrame } from "../../components/frame";
import { GrowthInternalResourceUnavailable } from "../../components/internal-unavailable";

export default function PageClient() {
  return (
    <GrowthAppFrame>
      <PageLayout title="Growth Action" description="Action detail is available to staff only">
        <GrowthInternalResourceUnavailable resource="Growth action details" />
      </PageLayout>
    </GrowthAppFrame>
  );
}
