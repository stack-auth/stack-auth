import { Metadata } from "next";
import PageClient from "./page-client";

export const metadata: Metadata = {
  title: "Data Vault Stores",
};

type Params = {
  projectId: string,
};

export default async function Page({ params }: { params: Promise<Params> }) {
  return (
    <PageClient />
  );
}
