"use client";

import { useRouter } from "@/components/router";
import { Spinner } from "@/components/ui";
import { useEffect } from "react";

export default function Page() {
  const router = useRouter();

  useEffect(() => {
    // A server redirect drops browser action IDs before the SDK can consume them.
    // Keep navigation in the client so the SDK initializes on the original URL.
    const destination = new URL(window.location.href);
    destination.pathname = "/projects";
    router.replace(destination.toString());
  }, [router]);

  return <Spinner />;
}
