"use client";

import { codePanelHeaderClasses, codePanelShellClasses } from '@/components/code-block';
import { getPublicEnvVar } from '@/lib/env';
import { Button, CopyButton, CopyField, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import React, { useState } from "react";
import { EyeIcon, EyeSlashIcon, FileTextIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

type EnvFileViewerProps = {
  filename: string;
  value: string;
}

export function EnvFileViewer({ filename, value }: EnvFileViewerProps) {
  const [revealAll, setRevealAll] = useState(false);

  const lines = value.split("\n").map((line, idx) => {
    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) return { key: `comment_${idx}`, val: line, isComment: true };
    const key = line.substring(0, eqIndex);
    const val = line.substring(eqIndex + 1);
    return { key, val, isComment: false };
  });

  return (
    <div className={cn(codePanelShellClasses, "w-full flex flex-col")}>
      <div className={codePanelHeaderClasses}>
        <h5 className="font-medium flex items-center gap-2">
          <FileTextIcon className="w-4 h-4" />
          {filename}
        </h5>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            className="h-6 w-6 p-1"
            onClick={() => setRevealAll(!revealAll)}
            title={revealAll ? "Mask values" : "Reveal values"}
            aria-label={revealAll ? "Mask values" : "Reveal values"}
          >
            {revealAll ? <EyeSlashIcon className="h-3.5 w-3.5" /> : <EyeIcon className="h-3.5 w-3.5" />}
          </Button>
          <CopyButton content={value} variant="secondary" />
        </div>
      </div>

      <div className="overflow-x-auto p-4 font-mono text-xs select-text">
        <table className="w-full border-collapse">
          <tbody>
            {lines.map((line, idx) => {
              return (
                <tr key={idx} className="group hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors leading-relaxed">
                  <td className="py-0.5 w-full">
                    <div className="flex items-center justify-between gap-4 w-full">
                      <div className="flex items-center flex-wrap whitespace-pre">
                        {line.isComment ? (
                          <span className="text-muted-foreground/50 italic">{line.val}</span>
                        ) : (
                          <>
                            <span className="text-indigo-600 dark:text-indigo-400 font-medium select-all">{line.key}</span>
                            <span className="text-muted-foreground/50 mx-1">=</span>
                            {revealAll ? (
                              <span className="text-teal-600 dark:text-teal-400 font-medium break-all select-all">{line.val}</span>
                            ) : (
                              <span className="text-muted-foreground/45 tracking-[0.25em] font-sans text-xs select-none">••••••••••••••••••••</span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function getEnvFileContent(props: {
  projectId: string,
  publishableClientKey?: string,
  secretServerKey?: string,
  superSecretAdminKey?: string,
}) {
  const envFileContent = Object.entries({
    NEXT_PUBLIC_HEXCLAVE_API_URL: getPublicEnvVar('NEXT_PUBLIC_STACK_API_URL') === "https://api.stack-auth.com" ? undefined : getPublicEnvVar('NEXT_PUBLIC_STACK_API_URL'),
    NEXT_PUBLIC_HEXCLAVE_PROJECT_ID: props.projectId,
    NEXT_PUBLIC_HEXCLAVE_PUBLISHABLE_CLIENT_KEY: props.publishableClientKey,
    HEXCLAVE_SECRET_SERVER_KEY: props.secretServerKey,
    HEXCLAVE_SUPER_SECRET_ADMIN_KEY: props.superSecretAdminKey,
  })
    .filter(([k, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  return envFileContent;
}

export function EnvKeys(props: {
  projectId: string,
  publishableClientKey?: string,
  secretServerKey?: string,
  superSecretAdminKey?: string,
}) {
  const handleDownloadKeys = () => {
    const blob = new Blob([getEnvFileContent(props)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `api_keys.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <Tabs defaultValue={"env"}>
      <TabsList className="flex">
        <TabsTrigger value="env" className="flex-grow">
          Next.js
        </TabsTrigger>
        <TabsTrigger value="keys" className="flex-grow">
          API Keys
        </TabsTrigger>
      </TabsList>
      <TabsContent value={"env"}>
        <NextJsEnvKeys {...props} />
      </TabsContent>
      <TabsContent value={"keys"}>
        <APIEnvKeys {...props} />
      </TabsContent>
      <Button variant="secondary" className="w-full mt-4" onClick={handleDownloadKeys}>
        Download Keys
      </Button>
    </Tabs>
  );
}

export function APIEnvKeys(props: {
  projectId: string,
  publishableClientKey?: string,
  secretServerKey?: string,
  superSecretAdminKey?: string,
}) {
  return (
    <div className="flex flex-col gap-4 w-full">
      {props.projectId && (
        <CopyField
          type="input"
          monospace
          value={props.projectId}
          label="Project ID"
          helper="This ID is used in your client-side code and is safe to expose to the public."
        />
      )}
      {props.publishableClientKey && (
        <CopyField
          type="input"
          monospace
          value={props.publishableClientKey}
          label="Publishable Client Key"
          helper="This key is used in your client-side code and is safe to expose to the public."
        />
      )}
      {props.secretServerKey && (
        <CopyField
          type="input"
          monospace
          isSecret
          value={props.secretServerKey}
          label="Secret Server Key"
          helper="This key is used on the server-side and can be used to perform actions on behalf of your users. Keep it safe."
        />
      )}
      {props.superSecretAdminKey && (
        <CopyField
          type="input"
          monospace
          isSecret
          value={props.superSecretAdminKey}
          label="Super Secret Admin Key"
          helper="This key is for administrative use only. Anyone owning this key will be able to create unlimited new keys and revoke any other keys. Be careful!"
        />
      )}
    </div>
  );
}

export function NextJsEnvKeys(props: {
  projectId: string,
  publishableClientKey?: string,
  secretServerKey?: string,
  superSecretAdminKey?: string,
}) {
  const envFileContent = getEnvFileContent(props);

  return (
    <EnvFileViewer filename=".env.local" value={envFileContent} />
  );
}

export function ViteEnvKeys(props: {
  projectId: string,
  secretServerKey?: string,
}) {
  const envFileContent = Object.entries({
    VITE_HEXCLAVE_API_URL: getPublicEnvVar('NEXT_PUBLIC_STACK_API_URL') === "https://api.stack-auth.com" ? undefined : getPublicEnvVar('NEXT_PUBLIC_STACK_API_URL'),
    VITE_HEXCLAVE_PROJECT_ID: props.projectId,
    HEXCLAVE_SECRET_SERVER_KEY: props.secretServerKey,
  })
    .filter(([, value]) => value != null)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  return (
    <EnvFileViewer filename=".env" value={envFileContent} />
  );
}
