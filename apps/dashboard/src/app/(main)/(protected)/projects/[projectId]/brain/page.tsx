import { Metadata } from "next";
import PageClient from "./page-client";

export const metadata: Metadata = {
  title: "Brain",
};

export default function Page() {
  return <PageClient />;
}
