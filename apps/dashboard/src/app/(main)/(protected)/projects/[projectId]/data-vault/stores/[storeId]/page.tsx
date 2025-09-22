import { Metadata } from "next";
import PageClient from "./page-client";

export const metadata: Metadata = {
  title: "Data Vault Store",
};

type Params = {
  projectId: string,
  storeId: string,
};

export default async function Page({ params }: { params: Promise<Params> }) {
  const { storeId } = await params;
  return (
    <PageClient storeId={storeId} />
  );
}
