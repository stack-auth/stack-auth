import Loading from "@/app/loading";
import { Suspense } from "react";
import PageClient from "./page-client";

export const metadata = {
  title: "Internal Support Dashboard - Stack Auth",
};

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <PageClient />
    </Suspense>
  );
}

