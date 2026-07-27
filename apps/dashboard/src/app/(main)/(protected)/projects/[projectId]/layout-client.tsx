"use client";

import { usePathname } from "next/navigation";
import SidebarLayout from "./sidebar-layout";

const TV_PRESENTATION_PATH = /^\/projects\/[^/]+\/tv-mode\/present\/[^/]+\/?$/;

export default function ProjectLayoutClient({
  children,
  modal,
}: {
  children: React.ReactNode,
  modal?: React.ReactNode,
}) {
  const pathname = usePathname();

  // Presentation mode deliberately keeps the canonical project URL while
  // omitting dashboard chrome so this renderer can later run on a TV Box.
  if (TV_PRESENTATION_PATH.test(pathname)) {
    return children;
  }

  return (
    <SidebarLayout>
      {children}
      {modal}
    </SidebarLayout>
  );
}
