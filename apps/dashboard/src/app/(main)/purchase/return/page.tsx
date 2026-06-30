import { Suspense } from "react";
import ReturnClient from "./page-client";

export default function Page() {
  return (
    <Suspense>
      <ReturnClient />
    </Suspense>
  );
}
