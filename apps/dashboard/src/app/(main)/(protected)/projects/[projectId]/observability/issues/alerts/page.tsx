import PageClient from "./page-client";

export const metadata = { title: "Issue alerts" };

// Keep this route statically rendered; the authenticated project context and
// alert data are loaded by the client surface, matching the existing Issues
// route's boundary.
export default function Page() {
  return <PageClient />;
}
