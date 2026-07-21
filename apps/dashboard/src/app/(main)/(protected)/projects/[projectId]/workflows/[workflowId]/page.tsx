import PageClient from "../page-client";

export const metadata = {
  title: "Workflow",
};

export default function Page() {
  // PageClient intentionally derives the id with usePathname. Keeping the
  // route static avoids a dynamic server params dependency for a client-only
  // management surface.
  return <PageClient />;
}
