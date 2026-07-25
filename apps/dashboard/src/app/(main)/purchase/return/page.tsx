import { Suspense } from "react";
import Loading from "@/app/loading";
import ReturnClient from "./page-client";

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <ReturnClient />
    </Suspense>
  );
}
