import PageClient from "../page-client";

export const metadata = {
  title: "Data Sources",
};

// The source detail view is rendered by the same client component as the list,
// which reads the selected id out of the pathname. Matching the Workflows app,
// this keeps back-and-forth navigation from tearing down and refetching the
// list.
export default function Page() {
  return (
    <PageClient />
  );
}
