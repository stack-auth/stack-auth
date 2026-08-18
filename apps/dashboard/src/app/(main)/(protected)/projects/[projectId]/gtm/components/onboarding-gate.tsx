"use client";

import { DesignAlert, DesignButton, DesignDialog, DesignInput } from "@/components/design-components";
import { Textarea } from "@/components/ui";
import { useAdminApp } from "../../use-admin-app";
import {
  completeGtmOnboarding,
  completeGtmOnboardingIntake,
  getGtmOnboarding,
  getGtmOnboardingCompletionStatus,
  GtmApiError,
  type GtmCompletedOnboardingCompletionStatus,
  type GtmCompletedOnboardingStatus,
  type GtmOnboardingDetails,
} from "@/lib/gtm/gtm-api";
import { useGtmData } from "@/lib/gtm/gtm-data";
import { validateGtmOnboardingInput } from "@/lib/gtm/gtm-onboarding";
import { ArrowRightIcon, CheckCircleIcon, GearIcon, GlobeHemisphereWestIcon, PhoneIcon, TrendUpIcon } from "@phosphor-icons/react";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { urlString } from "@hexclave/shared/dist/utils/urls";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { GtmStoryCard, StoryReveal, storyCanvasVariants, type GtmStoryChapter } from "./story-card";

/** White pill CTA, matching the story card's primary action. */
const storyPrimaryButtonClass = "rounded-full bg-white px-5 text-slate-950 transition-colors duration-150 hover:bg-white/90 hover:transition-none dark:bg-white dark:text-slate-950 dark:hover:bg-white/90";

/** Glass field styling so inputs stay legible on top of the saturated canvas. */
const storyFieldClass = "!border-white/25 !bg-black/20 !text-white !ring-white/10 placeholder:!text-white/60 focus-visible:!ring-white/70 dark:!border-white/25 dark:!bg-black/20 dark:!text-white dark:!ring-white/10 dark:placeholder:!text-white/60 dark:focus-visible:!ring-white/70";

type GateState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "needs-intake" }
  | { status: "complete", onboarding: GtmCompletedOnboardingStatus | null };
type IntakeStep = "story" | "details";
type OnboardingDialogProps =
  | { mode: "onboarding", onDone: () => void }
  | {
    mode: "edit",
    details: GtmOnboardingDetails,
    onDone: (onboarding: GtmCompletedOnboardingStatus) => void,
    onCancel: () => void,
  };

type StoryCard = GtmStoryChapter & {
  title: string,
  body: string,
  icon: typeof GlobeHemisphereWestIcon,
};

const storyCards: readonly StoryCard[] = [
  {
    key: "always-on",
    eyebrow: "Always on",
    caption: "Your growth teammate never clocks out",
    title: "Your AI growth teammate never clocks out.",
    body: "It continuously studies how your site is found, what visitors do next, and where promising paths start to leak.",
    icon: GlobeHemisphereWestIcon,
    accent: "#67e8f9",
    wash: "radial-gradient(120% 100% at 12% 2%, #22d3ee 0%, transparent 55%), radial-gradient(110% 120% at 94% 20%, #4f46e5 0%, transparent 58%), radial-gradient(130% 110% at 45% 105%, #0f766e 0%, transparent 62%), #1b2a63",
  },
  {
    key: "next-move",
    eyebrow: "Signal, not noise",
    caption: "It keeps finding the next move",
    title: "While you focus, it keeps finding the next move.",
    body: "Your dashboard turns those signals into focused opportunities—from content and conversion work to the experiments worth considering next.",
    icon: TrendUpIcon,
    accent: "#fcd34d",
    wash: "radial-gradient(110% 95% at 10% 0%, #fbbf24 0%, transparent 52%), radial-gradient(120% 110% at 95% 22%, #ea580c 0%, transparent 58%), radial-gradient(130% 120% at 30% 108%, #059669 0%, transparent 60%), #7c2d12",
  },
  {
    key: "your-team",
    eyebrow: "With your team",
    caption: "You stay in control",
    title: "You stay in control.",
    body: "This is not an unattended feed. Our growth team reviews the context, helps set priorities, and stays in touch as your project moves.",
    icon: PhoneIcon,
    accent: "#a7f3d0",
    wash: "radial-gradient(115% 95% at 16% 0%, #34d399 0%, transparent 52%), radial-gradient(120% 110% at 96% 24%, #2563eb 0%, transparent 58%), radial-gradient(130% 120% at 40% 108%, #4c1d95 0%, transparent 60%), #064e3b",
  },
];

const detailsChapter = (isEditing: boolean): GtmStoryChapter => ({
  key: "details",
  eyebrow: isEditing ? "Project intake" : "A quick handoff",
  // Never repeat the canvas headline here — the caption is a second line of
  // information, not an echo of the slide.
  caption: isEditing ? "Contact and context for the GTM team" : "Where you are and how to reach you",
  accent: "#93c5fd",
  wash: "radial-gradient(110% 95% at 14% 0%, #3b82f6 0%, transparent 50%), radial-gradient(120% 110% at 96% 26%, #4338ca 0%, transparent 58%), radial-gradient(130% 120% at 42% 108%, #0891b2 0%, transparent 60%), #1e3a8a",
});

const successChapter: GtmStoryChapter = {
  key: "ready",
  eyebrow: "Ready",
  caption: "Your growth teammate is live",
  accent: "#6ee7b7",
  wash: "radial-gradient(110% 95% at 14% 0%, #14b8a6 0%, transparent 52%), radial-gradient(120% 110% at 96% 26%, #4338ca 0%, transparent 58%), radial-gradient(130% 120% at 45% 108%, #0f766e 0%, transparent 60%), #0f766e",
};

function userFacingError(error: unknown): string {
  if (error instanceof GtmApiError) return error.message;
  return "We couldn't save your details. Check your connection and try again.";
}

function editableDomain(domain: string | null): string {
  return domain == null ? "" : urlString`https://${domain}`;
}

function OnboardingDialog(props: OnboardingDialogProps) {
  const app = useAdminApp();
  const prefersReducedMotion = useReducedMotion();
  const isEditing = props.mode === "edit";
  const [step, setStep] = useState<IntakeStep>(isEditing ? "details" : "story");
  const [storyIndex, setStoryIndex] = useState(0);
  const [domain, setDomain] = useState(() => props.mode === "edit" ? editableDomain(props.details.domain) : "");
  const [phone, setPhone] = useState(() => props.mode === "edit" ? props.details.phone : "");
  const [notes, setNotes] = useState(() => props.mode === "edit" ? props.details.notes : "");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<GtmCompletedOnboardingCompletionStatus | null>(null);

  const story = storyCards[storyIndex] ?? throwErr(`The GTM story index ${storyIndex} is outside the ${storyCards.length} story cards; moveStory clamps it, so this means an unclamped setter was added.`);
  const StoryIcon = story.icon;

  // The rail doubles as the step model: story cards, then the intake, then the
  // terminal success card. Editing skips straight to the intake, and a
  // single-chapter rail renders as a plain (non-interactive) indicator.
  const chapters: readonly GtmStoryChapter[] = isEditing
    ? [detailsChapter(true)]
    : [...storyCards, detailsChapter(false)];
  const detailsIndex = isEditing ? 0 : storyCards.length;
  const activeIndex = submitted != null
    ? chapters.length - 1
    : step === "details" ? detailsIndex : storyIndex;
  // Only the story cards are freely reachable from the rail: jumping into the
  // intake would skip the explanation, and the success card is terminal.
  const selectChapter = !isEditing && submitted == null && step === "story"
    ? (index: number) => {
      if (index < storyCards.length) setStoryIndex(index);
    }
    : undefined;

  const submit = async () => {
    setError(null);
    const validationError = validateGtmOnboardingInput({ domain, phone, notes });
    if (validationError != null) {
      setError(validationError);
      return;
    }
    try {
      if (props.mode === "edit") {
        const onboarding = await completeGtmOnboarding(app, { domain, phone, notes });
        props.onDone(onboarding);
      } else {
        setSubmitted(await completeGtmOnboardingIntake(app, { domain, phone, notes }));
      }
    } catch (submissionError) {
      setError(userFacingError(submissionError));
    }
  };

  const moveStory = (direction: number) => {
    setStoryIndex((current) => Math.min(Math.max(current + direction, 0), storyCards.length - 1));
  };

  const close = () => {
    if (props.mode === "edit") {
      props.onCancel();
    }
  };

  return (
    <DesignDialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      size="md"
      title={isEditing ? "Edit GTM details" : "Set up GTM"}
      headerClassName="sr-only"
      hideTopCloseButton
      noBodyPadding
      // The card *is* the dialog surface here, so the shell is stripped back to a
      // transparent, unbordered container and the story card supplies the radius,
      // background and shadow.
      className="max-h-[min(100dvh-2rem,44rem)] max-w-[32rem] overflow-visible border-0 bg-transparent p-0 ring-0 shadow-[0_40px_90px_-25px_rgba(0,0,0,0.75)] dark:bg-transparent dark:ring-0"
      bodyClassName="overflow-y-auto overscroll-contain rounded-2xl"
      contentProps={isEditing ? undefined : {
        onEscapeKeyDown: (event) => event.preventDefault(),
        onPointerDownOutside: (event) => event.preventDefault(),
      }}
    >
      <GtmStoryCard
        chapters={chapters}
        activeIndex={activeIndex}
        activeChapter={submitted != null ? successChapter : undefined}
        fitContent={step === "details"}
        onSelect={selectChapter}
        onClose={isEditing ? close : undefined}
      >
        {/* `wait`, not `popLayout`: slides differ in height (the intake form is far
            taller than a story card), and popping one out of flow snaps its
            internal `mt-auto` layout before it has finished fading. The wash and
            caption bar keep animating underneath, so the short handover still
            reads as one continuous card rather than a cut. */}
        <AnimatePresence initial={false} mode="wait">
          {submitted != null ? (
            <motion.div
              key="submitted"
              variants={storyCanvasVariants}
              initial={prefersReducedMotion ? false : "hidden"}
              animate="visible"
              exit="exit"
              className="flex min-h-full flex-1 flex-col"
            >
              <StoryReveal>
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/25 backdrop-blur-sm">
                  <CheckCircleIcon className="h-6 w-6 text-emerald-100" weight="fill" />
                </div>
              </StoryReveal>
              <div className="mt-auto pt-8">
                <StoryReveal>
                  <h2 className="max-w-sm text-balance text-[34px] font-bold leading-[1.08] tracking-[-0.02em]">
                    Your always-on growth teammate is ready.
                  </h2>
                </StoryReveal>
                <StoryReveal>
                  <p className="mt-4 max-w-sm text-[15px] leading-[1.6] text-white/85">
                    Our team will review the details you shared, then contact you to align on the first opportunities worth pursuing.
                  </p>
                </StoryReveal>
              </div>
              <StoryReveal className="mt-8 flex justify-end">
                {/* `submitted` is only ever set on the intake path, so this screen is unreachable in edit mode
                    (editing resolves through onDone(onboarding) straight after saving). The union can't express
                    that, so narrow explicitly rather than passing the ambiguous handler to onClick. */}
                <DesignButton
                  variant="secondary"
                  onClick={() => props.mode === "edit"
                    ? throwErr("The GTM intake success screen was rendered in edit mode, which should be impossible because `submitted` is only set on the intake path.")
                    : props.onDone()}
                  className={storyPrimaryButtonClass}
                >
                  Open GTM
                  <ArrowRightIcon className="ml-2 h-4 w-4" weight="bold" />
                </DesignButton>
              </StoryReveal>
            </motion.div>
          ) : step === "story" ? (
            <motion.div
              key={`story-${story.key}`}
              variants={storyCanvasVariants}
              initial={prefersReducedMotion ? false : "hidden"}
              animate="visible"
              exit="exit"
              className="flex min-h-full flex-1 flex-col"
            >
              <StoryReveal>
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25 backdrop-blur-sm">
                  <StoryIcon className="h-6 w-6" style={{ color: story.accent }} weight="bold" />
                </div>
              </StoryReveal>
              <div className="mt-auto pt-8">
                <StoryReveal>
                  <p className="text-[11px] font-semibold uppercase leading-none tracking-[0.16em] text-white/75">How GTM works</p>
                </StoryReveal>
                <StoryReveal>
                  <h2 className="mt-3.5 max-w-sm text-balance text-[34px] font-bold leading-[1.08] tracking-[-0.02em]">{story.title}</h2>
                </StoryReveal>
                <StoryReveal>
                  <p className="mt-4 max-w-sm text-[15px] leading-[1.6] text-white/85">{story.body}</p>
                </StoryReveal>
              </div>
              <StoryReveal className="mt-8 flex items-center justify-between gap-3">
                <DesignButton
                  variant="plain"
                  onClick={() => moveStory(-1)}
                  disabled={storyIndex === 0}
                  className="text-white transition-colors duration-150 hover:bg-white/10 hover:text-white hover:transition-none"
                >
                  Back
                </DesignButton>
                {storyIndex === storyCards.length - 1 ? (
                  <DesignButton variant="secondary" onClick={() => setStep("details")} className={storyPrimaryButtonClass}>
                    Add project details
                    <ArrowRightIcon className="ml-2 h-4 w-4" weight="bold" />
                  </DesignButton>
                ) : (
                  <DesignButton variant="secondary" onClick={() => moveStory(1)} className={storyPrimaryButtonClass}>
                    Next
                    <ArrowRightIcon className="ml-2 h-4 w-4" weight="bold" />
                  </DesignButton>
                )}
              </StoryReveal>
            </motion.div>
          ) : (
            <motion.form
              key="details"
              variants={storyCanvasVariants}
              initial={prefersReducedMotion ? false : "hidden"}
              animate="visible"
              exit="exit"
              onSubmit={(event) => event.preventDefault()}
              className="flex min-h-full flex-1 flex-col"
            >
              <StoryReveal>
                <h2 className="max-w-sm text-balance text-[26px] font-bold leading-[1.12] tracking-[-0.02em]">
                  {isEditing ? "Update your project details." : "Give your growth teammate the context to get started."}
                </h2>
              </StoryReveal>
              <StoryReveal>
                <p className="mt-3 max-w-sm text-[14px] leading-[1.55] text-white/80">
                  {isEditing
                    ? "Keep the contact information and project context shared with our GTM team up to date."
                    : "We use this only to prepare the first conversation and the signals it should start watching."}
                </p>
              </StoryReveal>
              <StoryReveal className="mt-6 space-y-4">
                <label className="block space-y-2" htmlFor="gtm-onboarding-domain">
                  <span className="text-sm font-medium text-white">Website domain <span className="font-normal text-white/65">Optional</span></span>
                  <DesignInput
                    id="gtm-onboarding-domain"
                    value={domain}
                    onChange={(event) => setDomain(event.target.value)}
                    placeholder="https://yourdomain.com"
                    autoComplete="url"
                    inputMode="url"
                    className={storyFieldClass}
                  />
                </label>
                <label className="block space-y-2" htmlFor="gtm-onboarding-phone">
                  <span className="text-sm font-medium text-white">Phone number</span>
                  <DesignInput
                    id="gtm-onboarding-phone"
                    type="tel"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    placeholder="+1 415 555 0100"
                    autoComplete="tel"
                    required
                    className={storyFieldClass}
                  />
                </label>
                <label className="block space-y-2" htmlFor="gtm-onboarding-notes">
                  <span className="text-sm font-medium text-white">Anything we should know? <span className="font-normal text-white/65">Optional</span></span>
                  <Textarea
                    id="gtm-onboarding-notes"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Goals, current channels, important launches, or where you want help."
                    maxLength={2000}
                    className={`min-h-20 ${storyFieldClass}`}
                  />
                </label>
              </StoryReveal>
              <StoryReveal className="mt-auto pt-6">
                {error != null && <DesignAlert variant="error" title="We need one more detail" description={error} />}
                <div className="mt-4 flex items-center justify-between gap-3">
                  <DesignButton
                    variant="plain"
                    type="button"
                    onClick={isEditing ? close : () => setStep("story")}
                    className="text-white transition-colors duration-150 hover:bg-white/10 hover:text-white hover:transition-none"
                  >
                    {isEditing ? "Cancel" : "Back"}
                  </DesignButton>
                  <DesignButton type="submit" onClick={submit} className={storyPrimaryButtonClass}>
                    {isEditing ? "Save changes" : "Send details"}
                    {!isEditing && <ArrowRightIcon className="ml-2 h-4 w-4" weight="bold" />}
                  </DesignButton>
                </div>
              </StoryReveal>
            </motion.form>
          )}
        </AnimatePresence>
      </GtmStoryCard>
    </DesignDialog>
  );
}

export function GtmOnboardingGate(props: { children: (settingsAction: ReactNode) => ReactNode }) {
  const app = useAdminApp();
  const { data } = useGtmData();
  const [state, setState] = useState<GateState>({ status: "loading" });
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState(false);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const completionStatus = await getGtmOnboardingCompletionStatus(app);
      setState(completionStatus.completed
        ? { status: "complete", onboarding: null }
        : { status: "needs-intake" });
    } catch {
      setState({ status: "error" });
    }
  }, [app]);

  const openEditing = async () => {
    setEditError(false);
    try {
      const onboarding = await getGtmOnboarding(app);
      if (!onboarding.completed) {
        setState({ status: "needs-intake" });
        return;
      }
      setState({ status: "complete", onboarding });
      setEditing(true);
    } catch {
      setEditError(true);
    }
  };

  useEffect(() => {
    runAsynchronously(load());
  }, [load]);

  const overviewIsLoaded = data.status === "loaded";
  const settingsAction = state.status === "complete" ? (
    <DesignButton
      variant="plain"
      size="icon"
      aria-label="Edit GTM details"
      title="Edit GTM details"
      onClick={openEditing}
    >
      <GearIcon className="h-4 w-4" />
    </DesignButton>
  ) : null;

  return (
    <>
      {props.children(settingsAction)}
      {overviewIsLoaded && state.status === "needs-intake" && (
        <OnboardingDialog
          mode="onboarding"
          onDone={() => setState({ status: "complete", onboarding: null })}
        />
      )}
      {state.status === "complete" && state.onboarding != null && editing && (
        <OnboardingDialog
          mode="edit"
          details={state.onboarding.details}
          onCancel={() => setEditing(false)}
          onDone={(onboarding) => {
            setState({ status: "complete", onboarding });
            setEditing(false);
          }}
        />
      )}
      {overviewIsLoaded && state.status === "error" && (
        <DesignDialog open onOpenChange={() => undefined} title="GTM setup couldn’t be loaded" hideTopCloseButton>
          <DesignAlert variant="error" title="Your project intake is unavailable" description="Try again to share your project details with the GTM team." />
          <div className="mt-4 flex justify-end"><DesignButton onClick={load}>Try again</DesignButton></div>
        </DesignDialog>
      )}
      {editError && (
        <DesignDialog open onOpenChange={(open) => setEditError(open)} title="GTM details couldn’t be loaded">
          <DesignAlert variant="error" title="Your project details are unavailable" description="Close this message and try opening the settings again." />
        </DesignDialog>
      )}
    </>
  );
}
