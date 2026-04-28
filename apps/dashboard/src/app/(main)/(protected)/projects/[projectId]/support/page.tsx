"use client";

import { useRouter } from "@/components/router";
import { urlString } from "@stackframe/stack-shared/dist/utils/urls";
import { useParams } from "next/navigation";
import { useEffect } from "react";

export default function Page() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();

  useEffect(() => {
    router.replace(urlString`/projects/${projectId}/conversations`);
  }, [projectId, router]);

  return null;
}
