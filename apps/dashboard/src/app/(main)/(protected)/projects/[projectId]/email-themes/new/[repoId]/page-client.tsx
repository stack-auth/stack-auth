"use client";

import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { Button, Typography } from "@stackframe/stack-ui";
import { useEffect, useState } from "react";
import { useAdminApp } from "../../../use-admin-app";
import DevServerChat from "@/components/dev-server-chat";


export default function PageClient({ repoId }: { repoId: string }) {
  const stackAdminApp = useAdminApp();
  const [devServerUrl, setDevServerUrl] = useState<string>();

  useEffect(() => {
    runAsynchronously(stackAdminApp.requestEmailThemeDevServer(repoId).then(res => setDevServerUrl(res.previewUrl)));
  }, [stackAdminApp, repoId, setDevServerUrl]);

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col">
        <div className="border-b p-3 flex justify-between items-center">
          <Typography type="h4">Preview</Typography>
          <Button>Save</Button>
        </div>
        <div className="flex-1">
          <iframe
            src={devServerUrl}
            className="w-full h-full"
            title="Email Theme Preview"
          />
        </div>
      </div>

      <div className="w-96 border-l flex flex-col">
        <div className="flex-1">
          <DevServerChat repoId={repoId} />
        </div>
      </div>
    </div>
  );
}
