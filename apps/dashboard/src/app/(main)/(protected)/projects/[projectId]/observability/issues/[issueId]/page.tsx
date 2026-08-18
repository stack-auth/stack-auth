import PageClient from "./page-client";
import { Suspense } from "react";

export const metadata = { title: "Issue" };

// Stays a static server component: the route segment is read client-side with
// `useParams`, per the repo's preference for keeping pages statically rendered.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <PageClient />
    </Suspense>
  );
}
