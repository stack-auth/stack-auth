import { Metadata } from "next";
import PageClient from "./page-client";

export const metadata: Metadata = {
  title: "Data Vault Stores",
};

export default async function Page() {
  return (
    <PageClient />
  );
}
