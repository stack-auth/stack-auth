import PageClient from "../page-client";

export const metadata = {
  title: "Comms Conversations",
};

export default function Page() {
  return <PageClient initialView="conversations" />;
}
