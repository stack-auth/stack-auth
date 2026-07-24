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
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { urlString } from "@hexclave/shared/dist/utils/urls";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

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

type StoryCard = {
  title: string,
  body: string,
  icon: typeof GlobeHemisphereWestIcon,
  accent: string,
  wash: string,
};

const storyCards: readonly StoryCard[] = [
  {
    title: "Start with the signal",
    body: "We study how your site is being found, what visitors do next, and where a promising path starts to leak.",
    icon: GlobeHemisphereWestIcon,
    accent: "#67e8f9",
    wash: "radial-gradient(120% 90% at 15% 0%, #0e7490 0%, transparent 56%), radial-gradient(120% 120% at 95% 100%, #312e81 0%, transparent 62%), #101827",
  },
  {
    title: "Turn it into a plan",
    body: "Your dashboard becomes a focused set of opportunities, from content and conversion work to the experiments worth considering next.",
    icon: TrendUpIcon,
    accent: "#fcd34d",
    wash: "radial-gradient(120% 90% at 10% 0%, #b45309 0%, transparent 55%), radial-gradient(130% 110% at 100% 25%, #7c2d12 0%, transparent 60%), #2a1720",
  },
  {
    title: "Work with people who care",
    body: "This is not an unattended feed. Our growth team reviews the context, helps set priorities, and stays in touch as your project moves.",
    icon: PhoneIcon,
    accent: "#a7f3d0",
    wash: "radial-gradient(120% 90% at 15% 0%, #047857 0%, transparent 55%), radial-gradient(130% 110% at 100% 20%, #1d4ed8 0%, transparent 65%), #10271f",
  },
];

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

  const story = storyCards[storyIndex] ?? storyCards[0];
  const StoryIcon = story.icon;

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
      hideTopCloseButton={!isEditing}
      noBodyPadding
      className="h-[min(100dvh-2rem,36rem)] max-w-[32rem] border-white/10 bg-[#141417] shadow-none dark:bg-[#141417]"
      bodyClassName="flex-1 overflow-y-auto overscroll-contain"
      contentProps={isEditing ? undefined : {
        onEscapeKeyDown: (event) => event.preventDefault(),
        onPointerDownOutside: (event) => event.preventDefault(),
      }}
    >
      <div className="relative min-h-full bg-[#141417] text-white">
        <AnimatePresence initial={false} mode="wait">
          {submitted != null ? (
            <motion.div
              key="submitted"
              initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={prefersReducedMotion ? undefined : { opacity: 0, scale: 0.98 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="flex min-h-full flex-col justify-between p-6"
              style={{ background: "radial-gradient(110% 85% at 10% 0%, #0f766e 0%, transparent 55%), radial-gradient(120% 100% at 100% 100%, #4338ca 0%, transparent 64%), #131824" }}
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/12 ring-1 ring-white/25">
                <CheckCircleIcon className="h-6 w-6 text-emerald-200" weight="fill" />
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-100/80">You are set up</p>
                <h2 className="mt-3 max-w-sm text-balance text-3xl font-semibold leading-tight tracking-tight">We’ll be in touch to Growmaxx your project.</h2>
                <p className="mt-4 max-w-sm text-sm leading-6 text-white/78">
                  Our team will review the details you shared, then contact you to align on the first opportunities worth pursuing.
                </p>
              </div>
              <DesignButton variant="secondary" size="lg" onClick={props.onDone} className="w-full bg-white text-slate-950 hover:bg-white/90">
                Open GTM
                <ArrowRightIcon className="ml-2 h-4 w-4" weight="bold" />
              </DesignButton>
            </motion.div>
          ) : step === "story" ? (
            <motion.div
              key={`story-${storyIndex}`}
              initial={prefersReducedMotion ? false : { opacity: 0, x: 22, scale: 0.985 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={prefersReducedMotion ? undefined : { opacity: 0, x: -22, scale: 0.985 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.28, ease: [0.16, 1, 0.3, 1] }}
              className="flex min-h-full flex-col p-6"
              style={{ background: story.wash }}
            >
              <div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/70">GTM, with your team</span>
                  <div className="flex gap-1" aria-label={`Step ${storyIndex + 1} of ${storyCards.length}`}>
                    {storyCards.map((card, index) => (
                      <button
                        key={card.title}
                        type="button"
                        aria-label={`Read: ${card.title}`}
                        aria-current={index === storyIndex ? "step" : undefined}
                        onClick={() => setStoryIndex(index)}
                        className={`h-1 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${index === storyIndex ? "w-6 bg-white" : "w-2 bg-white/35"}`}
                      />
                    ))}
                  </div>
                </div>
                <div className="mt-10 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/12 ring-1 ring-white/25">
                  <StoryIcon className="h-6 w-6" style={{ color: story.accent }} weight="bold" />
                </div>
              </div>
              <div className="mt-10">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: story.accent }}>How GTM works</p>
                <h2 className="mt-3 max-w-sm text-balance text-3xl font-semibold leading-tight tracking-tight">{story.title}</h2>
                <p className="mt-4 max-w-sm text-sm leading-6 text-white/80">{story.body}</p>
              </div>
              <div className="mt-auto flex items-center justify-between gap-3 pt-8">
                <DesignButton variant="plain" onClick={() => moveStory(-1)} disabled={storyIndex === 0} className="text-white hover:bg-white/10 hover:text-white">
                  Back
                </DesignButton>
                {storyIndex === storyCards.length - 1 ? (
                  <DesignButton variant="secondary" onClick={() => setStep("details")} className="bg-white text-slate-950 hover:bg-white/90">
                    Add project details
                    <ArrowRightIcon className="ml-2 h-4 w-4" weight="bold" />
                  </DesignButton>
                ) : (
                  <DesignButton variant="secondary" onClick={() => moveStory(1)} className="bg-white text-slate-950 hover:bg-white/90">
                    Next
                    <ArrowRightIcon className="ml-2 h-4 w-4" weight="bold" />
                  </DesignButton>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.form
              key="details"
              initial={prefersReducedMotion ? false : { opacity: 0, x: 22 }}
              animate={{ opacity: 1, x: 0 }}
              exit={prefersReducedMotion ? undefined : { opacity: 0, x: -22 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] }}
              onSubmit={(event) => event.preventDefault()}
              className="flex min-h-full flex-col bg-[#17171b] p-6"
            >
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
                  {isEditing ? "Project intake" : "A quick handoff"}
                </p>
                <h2 className="mt-3 max-w-sm text-balance text-3xl font-semibold leading-tight tracking-tight">
                  {isEditing ? "Update your project details." : "Give us the context to get started."}
                </h2>
                <p className="mt-3 max-w-sm text-sm leading-6 text-white/70">
                  {isEditing
                    ? "Keep the contact information and project context shared with our GTM team up to date."
                    : "We use this only to prepare the first conversation about your project."}
                </p>
              </div>
              <div className="mt-6 space-y-4">
                <label className="block space-y-2" htmlFor="gtm-onboarding-domain">
                  <span className="text-sm font-medium text-white">Website domain <span className="font-normal text-white/60">Optional</span></span>
                  <DesignInput
                    id="gtm-onboarding-domain"
                    value={domain}
                    onChange={(event) => setDomain(event.target.value)}
                    placeholder="https://yourdomain.com"
                    autoComplete="url"
                    inputMode="url"
                    className="!border-white/20 !bg-white/10 !text-white !ring-white/10 placeholder:!text-white/65 focus-visible:!ring-white/70 dark:!border-white/20 dark:!bg-white/10 dark:!text-white dark:!ring-white/10 dark:placeholder:!text-white/65 dark:focus-visible:!ring-white/70"
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
                    className="!border-white/20 !bg-white/10 !text-white !ring-white/10 placeholder:!text-white/65 focus-visible:!ring-white/70 dark:!border-white/20 dark:!bg-white/10 dark:!text-white dark:!ring-white/10 dark:placeholder:!text-white/65 dark:focus-visible:!ring-white/70"
                  />
                </label>
                <label className="block space-y-2" htmlFor="gtm-onboarding-notes">
                  <span className="text-sm font-medium text-white">Anything we should know? <span className="font-normal text-white/60">Optional</span></span>
                  <Textarea
                    id="gtm-onboarding-notes"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Goals, current channels, important launches, or where you want help."
                    maxLength={2000}
                    className="min-h-20 !border-white/20 !bg-white/10 !text-white !ring-white/10 placeholder:!text-white/65 focus-visible:!ring-white/70 dark:!border-white/20 dark:!bg-white/10 dark:!text-white dark:!ring-white/10 dark:placeholder:!text-white/65 dark:focus-visible:!ring-white/70"
                  />
                </label>
              </div>
              <div className="mt-6">
                {error != null && <DesignAlert variant="error" title="We need one more detail" description={error} />}
                <div className="mt-4 flex items-center justify-between gap-3">
                  <DesignButton
                    variant="plain"
                    type="button"
                    onClick={isEditing ? close : () => setStep("story")}
                    className="text-white hover:bg-white/10 hover:text-white"
                  >
                    {isEditing ? "Cancel" : "Back"}
                  </DesignButton>
                  <DesignButton type="submit" onClick={submit} className="bg-white text-slate-950 hover:bg-white/90">
                    {isEditing ? "Save changes" : "Send details"}
                    {!isEditing && <ArrowRightIcon className="ml-2 h-4 w-4" weight="bold" />}
                  </DesignButton>
                </div>
              </div>
            </motion.form>
          )}
        </AnimatePresence>
      </div>
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
