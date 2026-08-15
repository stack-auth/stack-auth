"use client";

import {
  DesignAlert,
  DesignBadge,
  DesignButton,
  DesignCard,
  DesignDialog,
  DesignInput,
  DesignSelectorDropdown,
} from "@/components/design-components";
import {
  approveTvDisplayOrThrow,
  fetchTvDisplaysOrThrow,
  revokeTvDisplayOrThrow,
  TvProfileRequestError,
  updateTvDisplayOrThrow,
} from "@/lib/hexclave-app-internals";
import {
  TV_DISPLAY_PAIRING_CODE_PATTERN,
  type TvDisplayResource,
  type TvProfileResource,
} from "@hexclave/shared/dist/interface/admin-tv-mode";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { BroadcastIcon, LinkBreakIcon, MonitorIcon, PlusIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";

const DISPLAY_REFRESH_INTERVAL_MS = 5_000;

type ActionNotice = {
  variant: "success" | "error" | "info",
  title: string,
  description: string,
};

function errorIncludes(error: unknown, text: string): boolean {
  if (error instanceof AggregateError) {
    return error.errors.some((nestedError: unknown) => errorIncludes(nestedError, text));
  }
  return error instanceof Error && error.message.includes(text);
}

export function getPairingFailureNotice(error: unknown): ActionNotice {
  if (errorIncludes(error, "Rate limited") || errorIncludes(error, "tv_display_pairing_rate_limited")) {
    return {
      variant: "error",
      title: "Pairing Temporarily Paused",
      description: "Too many pairing attempts were received. Wait a few minutes, then use the latest code shown on the display.",
    };
  }
  if (
    errorIncludes(error, "tv_display_pairing_code_invalid")
    || (error instanceof TvProfileRequestError && error.status === 400)
  ) {
    return {
      variant: "error",
      title: "Pairing Code Wasn’t Accepted",
      description: "Enter the latest code shown on the display. Pairing codes expire after 10 minutes and can only be used once.",
    };
  }
  if (errorIncludes(error, "tv_display_profile_not_found") || (error instanceof TvProfileRequestError && error.status === 404)) {
    return {
      variant: "error",
      title: "Profile Is No Longer Available",
      description: "Choose another TV profile, then try pairing the display again.",
    };
  }
  return {
    variant: "error",
    title: "Display Couldn’t Be Paired",
    description: "The pairing request couldn’t be completed. Check the connection and try again with the latest display code.",
  };
}

function getManagementFailureNotice(action: "save" | "unpair"): ActionNotice {
  return action === "save"
    ? {
      variant: "error",
      title: "Assignment Couldn’t Be Saved",
      description: "The current assignment is unchanged. Check the selected profile and try again.",
    }
    : {
      variant: "error",
      title: "Display Couldn’t Be Unpaired",
      description: "The display remains connected. Check the connection and try again.",
    };
}

function stateLabel(state: TvDisplayResource["state"]): string {
  if (state === "never-connected") return "Waiting for Display";
  return state[0].toUpperCase() + state.slice(1);
}

export function TvDisplayManagement({ adminApp, profiles }: { adminApp: object, profiles: TvProfileResource[] }) {
  const [displays, setDisplays] = useState<TvDisplayResource[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pairingCode, setPairingCode] = useState("");
  const [displayName, setDisplayName] = useState("Office Display");
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? "company-pulse");
  const [acknowledgeExact, setAcknowledgeExact] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [pairingNotice, setPairingNotice] = useState<ActionNotice | null>(null);
  const pairingInFlight = useRef(false);
  const refreshInFlight = useRef(false);
  const hiddenDisplayIds = useRef(new Set<string>());
  const pendingPairing = useRef<{ displayName: string, existingDisplayIds: Set<string> } | null>(null);

  const refresh = useCallback(async () => {
    const next = await fetchTvDisplaysOrThrow(adminApp);
    const visible = next.filter((display) => !hiddenDisplayIds.current.has(display.id));
    const pending = pendingPairing.current;
    if (pending != null && visible.some((display) => (
      display.displayName === pending.displayName && !pending.existingDisplayIds.has(display.id)
    ))) {
      pendingPairing.current = null;
      setPairingNotice({
        variant: "success",
        title: "Display Paired",
        description: `${pending.displayName} is connected and ready for TV Mode.`,
      });
    }
    setDisplays(visible);
    setLoadFailed(false);
  }, [adminApp]);

  useEffect(() => {
    const refreshSafely = async () => {
      if (refreshInFlight.current) return;
      refreshInFlight.current = true;
      try {
        await refresh();
      } catch {
        setLoadFailed(true);
      } finally {
        refreshInFlight.current = false;
      }
    };
    runAsynchronously(refreshSafely());
    const interval = window.setInterval(() => runAsynchronously(refreshSafely()), DISPLAY_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const selectedProfile = profiles.find((profile) => profile.id === profileId);
  const normalizedPairingCode = pairingCode.replaceAll("-", "");
  const pair = async () => {
    if (pairingInFlight.current) return;
    pairingInFlight.current = true;
    setPairing(true);
    setPairingNotice({
      variant: "info",
      title: "Pairing Display",
      description: "The request is being approved. Keep the pairing screen open while the display connects.",
    });
    const nextDisplayName = displayName.trim();
    try {
      await approveTvDisplayOrThrow(adminApp, {
        pairingCode,
        profileId,
        displayName: nextDisplayName,
        acknowledgeExactFinancials: acknowledgeExact,
      });
      pendingPairing.current = {
        displayName: nextDisplayName,
        existingDisplayIds: new Set(displays?.map((display) => display.id) ?? []),
      };
      setPairingCode("");
      setAcknowledgeExact(false);
      setPairingNotice({
        variant: "success",
        title: "Pairing Approved",
        description: "The display is connecting now and will appear below automatically.",
      });
      try {
        await refresh();
      } catch {
        setLoadFailed(true);
      }
    } catch (error) {
      pendingPairing.current = null;
      setPairingNotice(getPairingFailureNotice(error));
    } finally {
      pairingInFlight.current = false;
      setPairing(false);
    }
  };

  const hideDisplay = useCallback((displayId: string) => {
    hiddenDisplayIds.current.add(displayId);
    setDisplays((current) => current?.filter((display) => display.id !== displayId) ?? null);
  }, []);

  const profileOptions = profiles.map((profile) => ({
    value: profile.id,
    label: profile.configuration.displayName,
  }));

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Paired Displays</h2>
        <p className="mt-1 text-sm text-muted-foreground">Connect a TV once, then manage its project profile without signing into the display.</p>
      </div>
      {loadFailed ? <DesignAlert variant="error" title="Displays Couldn’t Be Loaded" description="Trying again automatically. Existing display assignments are unchanged." /> : null}
      <DesignCard gradient="default" glassmorphic>
        <div className="space-y-4 p-1">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-500"><PlusIcon className="h-5 w-5" weight="bold" /></div>
            <div><p className="font-medium text-foreground">Pair a New Display</p><p className="text-sm text-muted-foreground">Enter the secure code shown on the TV Mode display.</p></div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <DesignInput aria-label="Pairing code" value={pairingCode} onChange={(event) => setPairingCode(event.target.value.toUpperCase())} placeholder="ABCD-EFGH" size="lg" className="font-mono uppercase tracking-widest" />
            <DesignInput aria-label="Display name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Office Display" size="lg" />
            <div>
              <label htmlFor="new-tv-display-profile" className="sr-only">TV profile</label>
              <DesignSelectorDropdown triggerId="new-tv-display-profile" value={profileId} onValueChange={(value) => {
              setProfileId(value);
              setAcknowledgeExact(false);
              }} options={profileOptions} size="lg" />
            </div>
          </div>
          {selectedProfile?.configuration.financialVisibility === "exact" ? (
            <label className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3 text-sm text-foreground">
              <input type="checkbox" checked={acknowledgeExact} onChange={(event) => setAcknowledgeExact(event.target.checked)} className="mt-0.5" />
              <span>I understand that this physical display will show exact financial values visible to people nearby.</span>
            </label>
          ) : null}
          {pairingNotice == null ? null : <DesignAlert {...pairingNotice} glassmorphic />}
          <DesignButton type="button" size="lg" loading={pairing} disabled={!TV_DISPLAY_PAIRING_CODE_PATTERN.test(normalizedPairingCode) || displayName.trim().length === 0 || (selectedProfile?.configuration.financialVisibility === "exact" && !acknowledgeExact)} onClick={pair} className="gap-2 rounded-xl">
            <BroadcastIcon className="h-4 w-4" weight="fill" /> Pair Display
          </DesignButton>
        </div>
      </DesignCard>

      {displays == null && !loadFailed ? <DesignCard gradient="default" glassmorphic><p className="text-sm text-muted-foreground">Loading paired displays…</p></DesignCard> : null}
      {displays?.length === 0 ? <DesignCard gradient="default" glassmorphic><p className="text-sm text-muted-foreground">No displays are paired with this project yet.</p></DesignCard> : null}
      {displays?.map((display) => (
        <DisplayRow
          key={`${display.id}:${display.displayName}:${display.profileId}:${display.exactFinancialsAcknowledged}`}
          adminApp={adminApp}
          display={display}
          profiles={profiles}
          onChanged={refresh}
          onRemoved={hideDisplay}
        />
      ))}
    </section>
  );
}

function DisplayRow({ adminApp, display, profiles, onChanged, onRemoved }: {
  adminApp: object,
  display: TvDisplayResource,
  profiles: TvProfileResource[],
  onChanged: () => Promise<void>,
  onRemoved: (displayId: string) => void,
}) {
  const [name, setName] = useState(display.displayName);
  const [profileId, setProfileId] = useState(display.profileId);
  const [acknowledgeExact, setAcknowledgeExact] = useState(display.exactFinancialsAcknowledged);
  const [savedAssignment, setSavedAssignment] = useState({
    name: display.displayName,
    profileId: display.profileId,
    acknowledgeExact: display.exactFinancialsAcknowledged,
  });
  const [notice, setNotice] = useState<ActionNotice | null>(null);
  const [unpairOpen, setUnpairOpen] = useState(false);
  const [unpairNotice, setUnpairNotice] = useState<ActionNotice | null>(null);
  const profile = profiles.find((candidate) => candidate.id === profileId);
  const normalizedName = name.trim();
  const hasChanges = normalizedName !== savedAssignment.name
    || profileId !== savedAssignment.profileId
    || acknowledgeExact !== savedAssignment.acknowledgeExact;
  const canSave = hasChanges
    && normalizedName.length > 0
    && profile != null
    && (profile.configuration.financialVisibility !== "exact" || acknowledgeExact);
  const save = async () => {
    setNotice(null);
    try {
      await updateTvDisplayOrThrow(adminApp, display.id, {
        displayName: normalizedName,
        profileId,
        acknowledgeExactFinancials: acknowledgeExact,
      });
      setName(normalizedName);
      setSavedAssignment({ name: normalizedName, profileId, acknowledgeExact });
      setNotice({
        variant: "success",
        title: "Assignment Updated",
        description: "The display will use the new name and profile on its next refresh.",
      });
      await onChanged();
    } catch {
      setNotice(getManagementFailureNotice("save"));
    }
  };
  const revoke = async () => {
    setUnpairNotice(null);
    try {
      await revokeTvDisplayOrThrow(adminApp, display.id);
      onRemoved(display.id);
      setUnpairOpen(false);
    } catch {
      setUnpairNotice(getManagementFailureNotice("unpair"));
    }
  };
  const profileOptions = [
    ...(profile == null ? [{ value: display.profileId, label: "Profile Unavailable — Choose a New Profile", disabled: true }] : []),
    ...profiles.map((candidate) => ({ value: candidate.id, label: candidate.configuration.displayName })),
  ];
  return (
    <DesignCard gradient="default" glassmorphic>
      <div className="space-y-4 p-1">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-foreground/[0.05] text-muted-foreground"><MonitorIcon className="h-5 w-5" weight="fill" /></div>
            <div><p className="font-medium text-foreground">{display.displayName}</p><p className="text-xs text-muted-foreground">{display.lastSeenAt == null ? "Not connected yet" : `Last seen ${new Date(display.lastSeenAt).toLocaleString()}`}</p></div>
          </div>
          <DesignBadge label={stateLabel(display.state)} color={display.state === "online" ? "green" : display.state === "revoked" ? "red" : "blue"} size="sm" />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <DesignInput aria-label={`Display name for ${display.displayName}`} value={name} onChange={(event) => {
            setName(event.target.value);
            setNotice(null);
          }} size="lg" />
          <div>
            <label htmlFor={`tv-display-profile-${display.id}`} className="sr-only">Profile for {display.displayName}</label>
            <DesignSelectorDropdown triggerId={`tv-display-profile-${display.id}`} value={profileId} onValueChange={(value) => {
              setProfileId(value);
              setAcknowledgeExact(false);
              setNotice(null);
            }} options={profileOptions} size="lg" />
          </div>
        </div>
        {profile?.configuration.financialVisibility === "exact" && !acknowledgeExact ? (
          <label className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3 text-sm text-foreground">
            <input type="checkbox" checked={acknowledgeExact} onChange={(event) => {
              setAcknowledgeExact(event.target.checked);
              setNotice(null);
            }} className="mt-0.5" />
            <span>Allow this physical display to show exact financial values.</span>
          </label>
        ) : null}
        {notice == null ? null : <DesignAlert {...notice} glassmorphic />}
        <div className="flex gap-2">
          <DesignButton type="button" size="lg" variant={hasChanges ? "default" : "secondary"} disabled={!canSave} onClick={save} className="rounded-xl">
            {hasChanges ? "Save Assignment" : "Assignment Saved"}
          </DesignButton>
          <DesignButton type="button" size="lg" variant="outline" onClick={() => setUnpairOpen(true)} className="gap-2 rounded-xl border-red-500/20 text-red-500 hover:bg-red-500/[0.06]">
            <LinkBreakIcon className="h-4 w-4" /> Unpair
          </DesignButton>
        </div>
        <DesignDialog
          open={unpairOpen}
          onOpenChange={setUnpairOpen}
          icon={LinkBreakIcon}
          title="Unpair Display?"
          description={`${display.displayName} will immediately lose access to TV Mode and require a new pairing code to reconnect.`}
          size="sm"
          footer={(
            <>
              <DesignButton type="button" variant="outline" onClick={() => setUnpairOpen(false)}>Keep Display</DesignButton>
              <DesignButton type="button" variant="destructive" onClick={revoke}>Unpair Display</DesignButton>
            </>
          )}
        >
          {unpairNotice == null ? null : <DesignAlert {...unpairNotice} glassmorphic />}
        </DesignDialog>
      </div>
    </DesignCard>
  );
}
