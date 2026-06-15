"use client";

import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";
import {
  Alert,
  Button,
  CopyField,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Typography,
} from "@/components/ui";
import { DesignAnalyticsCard } from "@/components/design-components/analytics-card";
import { useRouter } from "@/components/router";
import type { AnalyticsClickmapTokenResponse } from "@hexclave/shared/dist/interface/admin-metrics";
import {
  CLICKMAP_OVERLAY_TOKEN_STORAGE_KEY,
  CLICKMAP_OVERLAY_TOKEN_UPDATED_EVENT,
} from "@hexclave/shared/dist/utils/analytics-clickmap-overlay";
import { typedEntries } from "@hexclave/shared/dist/utils/objects";
import { stringCompare } from "@hexclave/shared/dist/utils/strings";
import { ArrowRight, GlobeHemisphereWest } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";

type ClickmapOrigin = {
  id: string,
  origin: string,
};

function normalizeOrigin(baseUrl: string): string | null {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return null;
  }
}

// The clickmap token is a self-describing JWT (its payload carries the project
// and origin it was minted for), so the snippet only has to hand over the token
// itself — the in-page overlay derives everything else from it.
function createConsoleSnippet(token: string): string {
  return [
    `sessionStorage.setItem(${JSON.stringify(CLICKMAP_OVERLAY_TOKEN_STORAGE_KEY)}, ${JSON.stringify(token)});`,
    `window.dispatchEvent(new Event(${JSON.stringify(CLICKMAP_OVERLAY_TOKEN_UPDATED_EVENT)}));`,
  ].join("\n");
}

function ClickmapTokenDialog(props: {
  origin: ClickmapOrigin | null,
  token: AnalyticsClickmapTokenResponse | null,
  autoCopied?: boolean,
  open: boolean,
  onOpenChange: (open: boolean) => void,
}) {
  const snippet = props.token == null ? "" : createConsoleSnippet(props.token.token);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Enable clickmap toolbar</DialogTitle>
          <DialogDescription>
            Paste this in the console on {props.origin?.origin ?? "the selected site"}. The token expires in 24 hours.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {props.token == null ? (
            <Alert>Creating clickmap token...</Alert>
          ) : (
            <>
              <CopyField type="textarea" value={snippet} monospace fixedSize height={124} initialCopied={props.autoCopied} />
              <Typography type="p" variant="secondary" className="text-sm">
                The site will use normal client authentication plus this origin-bound clickmap token to fetch aggregate clickmap data.
              </Typography>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button
            className="gap-1.5"
            disabled={props.token == null}
            onClick={() => {
              const target = props.token?.origin ?? props.origin?.origin;
              if (target != null) {
                window.open(target, "_blank", "noopener,noreferrer");
              }
              props.onOpenChange(false);
            }}
          >
            Continue
            <ArrowRight className="h-4 w-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PageClient() {
  const adminApp = useAdminApp();
  const router = useRouter();
  const project = adminApp.useProject();
  const config = project.useConfig();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedOrigin, setSelectedOrigin] = useState<ClickmapOrigin | null>(null);
  const [token, setToken] = useState<AnalyticsClickmapTokenResponse | null>(null);
  const [autoCopied, setAutoCopied] = useState(false);
  const [customOrigin, setCustomOrigin] = useState("");

  useEffect(() => {
    setCustomOrigin(window.location.origin);
  }, []);

  const origins = useMemo(() => {
    const byOrigin = new Map<string, ClickmapOrigin>();
    for (const [id, domain] of typedEntries(config.domains.trustedDomains)) {
      if (domain.baseUrl == null) {
        continue;
      }
      const origin = normalizeOrigin(domain.baseUrl);
      if (origin == null) {
        continue;
      }
      byOrigin.set(origin, { id, origin });
    }
    return Array.from(byOrigin.values()).sort((a, b) => stringCompare(a.origin, b.origin));
  }, [config.domains.trustedDomains]);

  async function showClickmap(origin: ClickmapOrigin) {
    setSelectedOrigin(origin);
    setToken(null);
    setDialogOpen(true);
    let created: AnalyticsClickmapTokenResponse;
    try {
      created = await adminApp.createAnalyticsClickmapToken({ origin: origin.origin });
    } catch (error) {
      // Token creation failed (network error, expired session, invalid origin,
      // etc.); close the dialog so it doesn't hang on "Creating..." and let
      // runAsynchronouslyWithAlert surface the error to the user.
      setToken(null);
      setDialogOpen(false);
      throw error;
    }
    setToken(created);
    setAutoCopied(false);
    try {
      await navigator.clipboard.writeText(createConsoleSnippet(created.token));
      setAutoCopied(true);
    } catch {
      // Clipboard access can be denied (e.g. lost user-gesture after the
      // network round-trip); the snippet stays available to copy manually.
    }
  }

  return (
    <AppEnabledGuard appId="clickmaps">
      <PageLayout
        title="Clickmaps"
        description="Launch the clickmap toolbar on a trusted domain."
        fillWidth
      >
        {config.domains.allowLocalhost && (
          <DesignAnalyticsCard gradient="slate" className="p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1 space-y-1">
                <Typography className="font-medium">Localhost origin</Typography>
                <Typography type="p" variant="secondary" className="text-xs">
                  Use the exact origin shown in the browser address bar for your local site.
                </Typography>
                <Input value={customOrigin} onChange={(event) => setCustomOrigin(event.target.value)} placeholder="http://localhost:3000" />
              </div>
              <Button
                className="gap-1.5"
                disabled={customOrigin.trim() === ""}
                onClick={async () => {
                  const origin = normalizeOrigin(customOrigin);
                  if (origin == null) {
                    window.alert("Enter a valid HTTP(S) origin, for example http://localhost:3000.");
                    return;
                  }
                  await showClickmap({ id: "localhost", origin });
                }}
              >
                Show clickmap
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </DesignAnalyticsCard>
        )}

        {origins.length === 0 ? (
          <Alert className="rounded-2xl">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>Add a trusted domain before launching a production clickmap.</span>
              <Button
                className="shrink-0 gap-1.5"
                onClick={() => router.push(`/projects/${project.id}/domains`)}
              >
                Go to trusted domains
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </Alert>
        ) : (
          <DesignAnalyticsCard gradient="slate">
            {origins.map((origin) => (
              <div key={origin.id} className="flex flex-col gap-3 border-b border-foreground/[0.05] p-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-foreground/[0.04] ring-1 ring-foreground/[0.06]">
                    <GlobeHemisphereWest className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <Typography className="truncate font-medium">{origin.origin}</Typography>
                    <Typography type="p" variant="secondary" className="text-xs">
                      24-hour overlay token, scoped to this origin
                    </Typography>
                  </div>
                </div>
                <Button className="gap-1.5" onClick={async () => await showClickmap(origin)}>
                  Show clickmap
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </DesignAnalyticsCard>
        )}

        <ClickmapTokenDialog
          origin={selectedOrigin}
          token={token}
          autoCopied={autoCopied}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      </PageLayout>
    </AppEnabledGuard>
  );
}
