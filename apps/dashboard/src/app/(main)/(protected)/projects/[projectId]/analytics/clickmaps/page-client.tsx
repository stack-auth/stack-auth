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
import { ArrowRight, GlobeHemisphereWest, InfoIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { getClickmapOriginOptions, normalizeClickmapOrigin, type ClickmapOrigin } from "./clickmap-origins";

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

  const { origins, wildcardDomains } = useMemo(() => {
    return getClickmapOriginOptions(config.domains.trustedDomains);
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
        <DesignAnalyticsCard gradient="slate" className="p-4">
          <div className="space-y-1">
            <Typography className="font-medium">Exact page origin</Typography>
            <Typography type="p" variant="secondary" className="text-xs">
              Use the exact origin shown in the browser address bar, including for domains matched by a wildcard.
            </Typography>
            <div className="flex items-center gap-2">
              <Input className="flex-1" value={customOrigin} onChange={(event) => setCustomOrigin(event.target.value)} placeholder="https://app.example.com" />
              <Button
                className="shrink-0 gap-1.5"
                disabled={customOrigin.trim() === ""}
                onClick={async () => {
                  const origin = normalizeClickmapOrigin(customOrigin);
                  if (origin == null) {
                    window.alert("Enter a valid HTTP(S) origin, for example https://app.example.com.");
                    return;
                  }
                  await showClickmap({ id: "exact-origin", origin });
                }}
              >
                Show clickmap
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
            {wildcardDomains.length > 0 && (
              <div className="flex items-start gap-1.5 text-xs text-blue-600 dark:text-blue-400">
                <InfoIcon className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  {wildcardDomains.map((d) => d.baseUrl).join(", ")} can match real pages, but cannot be opened directly as a clickmap target.
                </span>
              </div>
            )}
          </div>
        </DesignAnalyticsCard>

        {origins.length === 0 ? (
          <Alert className="rounded-2xl">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>
                {wildcardDomains.length === 0
                  ? "Add a trusted domain before launching a production clickmap."
                  : "Enter an exact origin that matches a wildcard domain, or add a concrete trusted domain."}
              </span>
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
