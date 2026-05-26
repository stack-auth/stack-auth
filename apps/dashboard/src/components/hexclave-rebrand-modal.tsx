"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useUser } from "@stackframe/stack";
import Image from "next/image";
import { useEffect, useState } from "react";

const STORAGE_KEY = "hexclave-rebrand-modal-dismissed";
const MIGRATION_DOCS_URL = "https://docs.hexclave.com/migration";

// Users who signed up before this instant predate the Stack Auth → Hexclave
// rebrand and are the only ones who benefit from the announcement. Anyone
// signing up after this already lands on a Hexclave-branded experience and
// has no "Stack Auth" mental model to update — no point telling them.
const REBRAND_CUTOFF = new Date("2026-05-27T00:00:00.000Z");

/**
 * One-time informational modal announcing the Stack Auth → Hexclave rebrand.
 *
 * Only renders for a logged-in user who signed up before {@link REBRAND_CUTOFF}.
 * On any dismissal (confirm button, close button, overlay click, or Escape)
 * writes `STORAGE_KEY` to localStorage so the modal never re-appears for that
 * browser.
 */
export function HexclaveRebrandModal() {
  // `or: "return-null"` keeps this from triggering the sign-in redirect when
  // it's rendered above the auth boundary — we simply opt out for guests.
  const user = useUser({ or: "return-null" });
  const isPreRebrandUser = user != null && user.signedUpAt < REBRAND_CUTOFF;
  const [open, setOpen] = useState(false);

  // Read localStorage after hydration to avoid SSR mismatch — render closed
  // on the server and only open if we know the user hasn't dismissed it.
  useEffect(() => {
    if (!isPreRebrandUser) return;
    try {
      const dismissed = localStorage.getItem(STORAGE_KEY);
      if (dismissed !== "true") {
        setOpen(true);
      }
    } catch {
      // localStorage can throw in private-mode / sandboxed iframes; treat
      // unavailable storage as "already dismissed" so we don't spam users
      // who can't persist the dismissal anyway.
    }
  }, [isPreRebrandUser]);

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // see above — best-effort write
    }
    setOpen(false);
  };

  if (!isPreRebrandUser) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) dismiss();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <RebrandIllustration />
          <DialogTitle className="text-center text-xl pt-2">
            Stack Auth is now Hexclave
          </DialogTitle>
          <DialogDescription className="text-center">
            We&apos;re rebranding! Same product, same team, new home at{" "}
            <a
              href="https://app.hexclave.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline underline-offset-2 hover:text-foreground"
            >
              app.hexclave.com
            </a>
            . For more info on how to update your project, read our{" "}
            <a
              href={MIGRATION_DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline underline-offset-2 hover:text-foreground"
            >
              migration guide
            </a>
            .
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="sm:justify-center pt-6">
          <Button onClick={dismiss} className="min-w-32">
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Stack Auth mark (faded) → arrow → Hexclave benzene mark. Both logos are
 * served from `/public` so they match the canonical brand assets.
 */
function RebrandIllustration() {
  return (
    <div
      className="flex justify-center items-center gap-4 pb-2"
      aria-hidden="true"
    >
      {/* Stack Auth: served light & dark variants depending on theme */}
      <Image
        src="/logo.svg"
        alt=""
        width={48}
        height={48}
        aria-hidden
        className="h-12 w-auto opacity-50 block dark:hidden"
      />
      <Image
        src="/logo-bright.svg"
        alt=""
        width={48}
        height={48}
        aria-hidden
        className="h-12 w-auto opacity-60 hidden dark:block"
      />

      {/* Arrow — bridge between the two marks */}
      <svg
        width="40"
        height="14"
        viewBox="0 0 40 14"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="text-muted-foreground"
      >
        <path
          d="M2 7 L34 7"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M28 1 L34 7 L28 13"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>

      {/* Hexclave benzene mark — gradient + glow filter, theme-agnostic */}
      <Image
        src="/hexclave-icon.svg"
        alt=""
        width={56}
        height={56}
        aria-hidden
        className="h-14 w-14"
      />
    </div>
  );
}
