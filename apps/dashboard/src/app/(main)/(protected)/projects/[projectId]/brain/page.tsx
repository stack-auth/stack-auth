import { Metadata } from "next";
import PageClient from "./page-client";

export const metadata: Metadata = {
  title: "Brain",
};

// Brain depends on the authenticated project provider in the parent layout.
export const instant = false;

export default function Page() {
  return <PageClient />;
}
