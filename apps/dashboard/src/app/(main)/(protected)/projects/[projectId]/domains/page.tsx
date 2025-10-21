import PageClient from "./page-client";

export const metadata = {
  title: "Domains",
};

export const dynamic = "force-static";

export default function Page() {
  return (
    <PageClient />
  );
}
