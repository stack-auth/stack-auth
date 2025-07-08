"use client";

import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { Typography } from "@stackframe/stack-ui";
import { useEffect, useState } from "react";
import { useAdminApp } from "../../../use-admin-app";


export default function PageClient({ repoId }: { repoId: string }) {
  const stackAdminApp = useAdminApp();
  const [devServerUrl, setDevServerUrl] = useState<string>();

  useEffect(() => {
    runAsynchronously(stackAdminApp.requestEmailThemeDevServer(repoId).then(res => setDevServerUrl(res.previewUrl)));
  }, [stackAdminApp, repoId, setDevServerUrl]);

  return (
    <div className="flex h-screen">
      {/* Live Preview */}
      <div className="flex-1 flex flex-col">
        <div className="border-b p-4">
          <Typography type="h4">Preview</Typography>
        </div>
        <div className="flex-1">
          <iframe
            src={devServerUrl}
            className="w-full h-full"
            title="Email Theme Preview"
          />
        </div>
      </div>

      {/* Chatbox */}
      <div className="w-96 border-l flex flex-col">
        <div className="border-b p-4">
          <Typography type="h4">Chat</Typography>
        </div>
        <div className="flex-1">
        </div>
      </div>
    </div>
  );
}
