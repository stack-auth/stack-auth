import { Suspense } from "react";
import PageClient from "./page-client";

export default function OnboardingPage() {
  return (
    <Suspense>
      <PageClient />
    </Suspense>
  );
}
