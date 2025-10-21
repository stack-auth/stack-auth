import LayoutClient from "./layout-client";

export { generateStaticParams } from "@/lib/generate-empty-static-params";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <LayoutClient>{children}</LayoutClient>;
}
