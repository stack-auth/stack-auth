"use client";

import { getPublicEnvVar } from '@/lib/env';
import { Button, CopyField, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import React, { useState } from "react";
import { EyeIcon, EyeSlashIcon, CopyIcon, CheckIcon, FileTextIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";

type EnvFileViewerProps = {
  filename: string;
  value: string;
}

export function EnvFileViewer({ filename, value }: EnvFileViewerProps) {
  const [revealAll, setRevealAll] = useState(false);
  const [copied, setCopied] = useState(false);

  const lines = value.split("\n").map((line, idx) => {
    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) return { key: `comment_${idx}`, val: line, isComment: true };
    const key = line.substring(0, eqIndex);
    const val = line.substring(eqIndex + 1);
    return { key, val, isComment: false };
  });

  const handleCopyAll = () => {
    runAsynchronously(async () => {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="overflow-hidden transition-all duration-150 hover:transition-none rounded-2xl bg-white/90 dark:bg-background/60 dark:backdrop-blur-xl ring-1 ring-black/[0.06] hover:ring-black/[0.1] dark:ring-white/[0.06] dark:hover:ring-white/[0.1] border border-black/[0.06] dark:border-white/[0.06] shadow-none w-full flex flex-col">
      {/* Tab/Header Bar */}
      <div className="text-muted-foreground font-medium pl-4 pr-3 text-sm flex justify-between items-center py-2.5 bg-black/[0.015] dark:bg-white/[0.015] border-b border-black/[0.06] dark:border-white/[0.06]">
        <div className="flex items-center gap-2">
          <FileTextIcon className="w-4 h-4 text-muted-foreground/80" />
          <span className="font-mono text-xs font-semibold text-foreground/80">{filename}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setRevealAll(!revealAll)}
            className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground/75 hover:text-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-all"
            title={revealAll ? "Mask values" : "Reveal values"}
            aria-label={revealAll ? "Mask values" : "Reveal values"}
          >
            {revealAll ? (
              <EyeSlashIcon className="h-3.5 w-3.5" />
            ) : (
              <EyeIcon className="h-3.5 w-3.5" />
            )}
          </button>

          <button
            type="button"
            onClick={handleCopyAll}
            title={copied ? "Copied" : "Copy file"}
            aria-label={copied ? "Copied" : "Copy file"}
            className={cn(
              "h-8 w-8 flex items-center justify-center rounded-lg border transition-all",
              copied
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                : "bg-white/50 dark:bg-background/40 border-black/[0.08] dark:border-white/[0.06] text-muted-foreground hover:text-foreground hover:bg-white dark:hover:bg-background/80"
            )}
          >
            {copied ? (
              <CheckIcon className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" weight="bold" />
            ) : (
              <CopyIcon className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Editor Body */}
      <div className="overflow-x-auto px-3 py-2.5 font-mono text-xs bg-black/[0.01] dark:bg-white/[0.005] select-text">
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

function getEnvFileContent(props: {
  projectId: string,
  publishableClientKey?: string,
  secretServerKey?: string,
  superSecretAdminKey?: string,
}) {
  const envFileContent = Object.entries({
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
