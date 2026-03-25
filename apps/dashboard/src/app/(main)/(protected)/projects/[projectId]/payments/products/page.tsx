import PageClient from "./page-client";

export const metadata = {
  title: "Products & Items",
};

type Params = {
  projectId: string,
};

export default async function Page() {
  return (
    <PageClient />
  );
}
