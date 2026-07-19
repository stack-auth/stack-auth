import { Metadata } from "next";
import PageClient from "./page-client";

export const metadata: Metadata = {
  title: "Feature Flag Activity",
};

export default function Page() {
  return (
    <PageClient />
  );
}
