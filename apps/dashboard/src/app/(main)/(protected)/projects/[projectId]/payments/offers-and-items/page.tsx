import PageClient from "./page-client";

export const metadata = {
  title: "Payments",
};

type Params = {
  projectId: string,
};

export default async function Page({ params }: { params: Promise<Params> }) {
  return (
    <PageClient />
  );
}
