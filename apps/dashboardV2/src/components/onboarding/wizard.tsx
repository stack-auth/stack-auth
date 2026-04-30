import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "@tanstack/react-router"
import { useUser } from "@stackframe/tanstack-start"
import { ALL_APPS  } from "@stackframe/stack-shared/dist/apps/apps-config"
import { toast } from "sonner"
import { ArrowLeftIcon, CheckIcon, XIcon } from "@phosphor-icons/react"

import { BasicsStep } from "./steps/basics"
import { AppsStep } from "./steps/apps"
import {  AuthStep } from "./steps/auth"
import { EmailThemeStep } from "./steps/email-theme"
import { OnboardingPrefetcher } from "./prefetch"
import { PaymentsStep } from "./steps/payments"
import { FinishStep } from "./steps/finish"
import type {AuthState} from "./steps/auth";
import type {AppId} from "@stackframe/stack-shared/dist/apps/apps-config";
import type { AdminOwnedProject } from "@stackframe/tanstack-start"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

export type StepId =
  | "basics"
  | "apps"
  | "auth"
  | "email_theme"
  | "payments"
  | "finish"

const REQUIRED_APPS: Array<AppId> = ["authentication", "emails"]
const PRIMARY_APPS: Array<AppId> = ["authentication", "emails", "payments", "analytics"]
const ALL_APP_IDS = Object.keys(ALL_APPS) as Array<AppId>

export function ProjectOnboardingWizard() {
  const user = useUser({ or: "redirect", projectIdMustMatch: "internal" })
  const navigate = useNavigate()

  const [step, setStep] = useState<StepId>("basics")
  const [submitting, setSubmitting] = useState(false)
  const [createdProject, setCreatedProject] = useState<AdminOwnedProject | null>(null)

  // basics
  const [displayName, setDisplayName] = useState("")
  const teams = user.useTeams()
  const [teamId, setTeamId] = useState<string | null>(() => teams[0]?.id ?? null)
  useEffect(() => {
    if (teamId == null && teams.length > 0) {
      setTeamId(teams[0].id)
    }
  }, [teamId, teams])

  // apps
  const [selectedApps, setSelectedApps] = useState<Set<AppId>>(
    () => new Set<AppId>(PRIMARY_APPS),
  )

  // auth
  const [authState, setAuthState] = useState<AuthState>(() => ({
    credential: true,
    magicLink: true,
    passkey: false,
    google: true,
    github: true,
    microsoft: false,
  }))

  // email theme
  const [selectedThemeId, setSelectedThemeId] = useState<string | null>(null)

  const includePayments = selectedApps.has("payments")

  const steps = useMemo<Array<{ id: StepId, label: string }>>(() => {
    const base: Array<{ id: StepId, label: string }> = [
      { id: "basics", label: "Project" },
      { id: "apps", label: "Apps" },
      { id: "auth", label: "Auth" },
      { id: "email_theme", label: "Email Theme" },
    ]
    if (includePayments) base.push({ id: "payments", label: "Payments" })
    base.push({ id: "finish", label: "Finish" })
    return base
  }, [includePayments])

  const stepIndex = steps.findIndex((s) => s.id === step)

  const goBack = () => {
    if (stepIndex <= 0) return
    const prev = steps[stepIndex - 1]
    setStep(prev.id)
  }

  // ----- Step actions -----

  const handleCreateProject = async () => {
    const trimmed = displayName.trim()
    if (trimmed.length < 2) {
      toast.error("Project name must be at least 2 characters.")
      return
    }
    if (!teamId) {
      toast.error("Please select a team.")
      return
    }
    if (createdProject) {
      // Project already exists from a prior pass; just advance.
      setStep("apps")
      return
    }
    setSubmitting(true)
    try {
      const created = await user.createProject({
        displayName: trimmed,
        teamId,
        onboardingStatus: "config_choice",
      })
      setCreatedProject(created)
      setStep("apps")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create project.")
    } finally {
      setSubmitting(false)
    }
  }

  const handleAppsContinue = async () => {
    if (!createdProject) return
    setSubmitting(true)
    try {
      // Required apps are always on.
      const effective = new Set(selectedApps)
      for (const r of REQUIRED_APPS) effective.add(r)

      const update: Record<string, boolean> = {}
      for (const appId of ALL_APP_IDS) {
        update[`apps.installed.${appId}.enabled`] = effective.has(appId)
      }
      await createdProject.updateConfig(update)
      await createdProject.update({ onboardingStatus: "auth_setup" })
      setSelectedApps(effective)
      setStep("auth")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save apps.")
    } finally {
      setSubmitting(false)
    }
  }

  const handleAuthContinue = async () => {
    if (!createdProject) return
    const anyEnabled =
      authState.credential ||
      authState.magicLink ||
      authState.passkey ||
      authState.google ||
      authState.github ||
      authState.microsoft
    if (!anyEnabled) {
      toast.error("Enable at least one sign-in method.")
      return
    }
    setSubmitting(true)
    try {
      await createdProject.updateConfig({
        "auth.password.allowSignIn": authState.credential,
        "auth.otp.allowSignIn": authState.magicLink,
        "auth.passkey.allowSignIn": authState.passkey,
      })
      await createdProject.updateConfig({
        "auth.oauth.providers.google": authState.google
          ? { type: "google", isShared: true, allowSignIn: true, allowConnectedAccounts: true }
          : null,
        "auth.oauth.providers.github": authState.github
          ? { type: "github", isShared: true, allowSignIn: true, allowConnectedAccounts: true }
          : null,
        "auth.oauth.providers.microsoft": authState.microsoft
          ? { type: "microsoft", isShared: true, allowSignIn: true, allowConnectedAccounts: true }
          : null,
      })
      await createdProject.update({ onboardingStatus: "email_theme_setup" })
      setStep("email_theme")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save sign-in methods.")
    } finally {
      setSubmitting(false)
    }
  }

  const handleEmailThemeContinue = async () => {
    if (!createdProject) return
    setSubmitting(true)
    try {
      if (selectedThemeId) {
        await createdProject.updateConfig({
          "emails.selectedThemeId": selectedThemeId,
        })
      }
      if (includePayments) {
        await createdProject.update({ onboardingStatus: "payments_setup" })
        setStep("payments")
      } else {
        await createdProject.update({ onboardingStatus: "welcome" })
        setStep("finish")
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save theme.")
    } finally {
      setSubmitting(false)
    }
  }

  const handlePaymentsConnect = async () => {
    if (!createdProject) return
    setSubmitting(true)
    try {
      const setup = await createdProject.app.setupPayments()
      const url = new URL(setup.url)
      if (url.protocol !== "https:") {
        throw new Error("Payments setup URL must use HTTPS.")
      }
      window.location.href = url.toString()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start payments setup.")
      setSubmitting(false)
    }
  }

  const handlePaymentsLater = async () => {
    if (!createdProject) return
    setSubmitting(true)
    try {
      await createdProject.update({ onboardingStatus: "welcome" })
      setStep("finish")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to skip payments.")
    } finally {
      setSubmitting(false)
    }
  }

  const handleFinish = async () => {
    if (!createdProject) return
    setSubmitting(true)
    try {
      await createdProject.update({ onboardingStatus: "completed" })
      await navigate({
        to: "/projects/$projectId",
        params: { projectId: createdProject.id },
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to finish onboarding.")
      setSubmitting(false)
    }
  }

  // ----- Continue button per step -----

  const continueAction: { label: string, onClick: () => void } | null = (() => {
    switch (step) {
      case "basics":
        return { label: "Continue", onClick: () => void handleCreateProject() }
      case "apps":
        return { label: "Continue", onClick: () => void handleAppsContinue() }
      case "auth":
        return { label: "Continue", onClick: () => void handleAuthContinue() }
      case "email_theme":
        return {
          label: "Continue",
          onClick: () => void handleEmailThemeContinue(),
        }
      case "payments":
      case "finish":
        return null
    }
  })()

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <h1 className="font-heading text-base font-semibold tracking-tight">
            New project
          </h1>
          <Link
            to="/projects"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <XIcon className="size-3.5" />
            Cancel
          </Link>
        </div>
      </header>

      <div className="mx-auto w-full max-w-5xl px-6 pt-6">
        <Stepper steps={steps} currentIndex={stepIndex} />
      </div>

      {createdProject && <OnboardingPrefetcher project={createdProject} />}

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        {step === "basics" && (
          <BasicsStep
            displayName={displayName}
            setDisplayName={setDisplayName}
            teamId={teamId}
            setTeamId={setTeamId}
          />
        )}
        {step === "apps" && createdProject && (
          <AppsStep
            project={createdProject}
            selected={selectedApps}
            setSelected={setSelectedApps}
          />
        )}
        {step === "auth" && createdProject && (
          <AuthStep
            project={createdProject}
            displayName={displayName}
            value={authState}
            onChange={setAuthState}
          />
        )}
        {step === "email_theme" && createdProject && (
          <EmailThemeStep
            project={createdProject}
            selectedThemeId={selectedThemeId}
            setSelectedThemeId={setSelectedThemeId}
          />
        )}
        {step === "payments" && createdProject && (
          <PaymentsStep
            submitting={submitting}
            onConnect={handlePaymentsConnect}
            onLater={handlePaymentsLater}
          />
        )}
        {step === "finish" && createdProject && (
          <FinishStep
            project={createdProject}
            displayName={displayName}
            selectedApps={selectedApps}
            submitting={submitting}
            onFinish={handleFinish}
          />
        )}
      </main>

      {continueAction && (
        <footer className="border-t">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-4">
            {stepIndex <= 0 ? (
              <span />
            ) : (
              <Button variant="ghost" size="sm" onClick={goBack} disabled={submitting}>
                <ArrowLeftIcon />
                Back
              </Button>
            )}
            <Button
              size="sm"
              onClick={continueAction.onClick}
              disabled={submitting}
            >
              {submitting ? <Spinner className="size-3.5" /> : null}
              {continueAction.label}
            </Button>
          </div>
        </footer>
      )}
    </div>
  )
}

function Stepper({
  steps,
  currentIndex,
}: {
  steps: Array<{ id: StepId, label: string }>,
  currentIndex: number,
}) {
  return (
    <ol className="flex items-center gap-2">
      {steps.map((s, idx) => {
        const isComplete = idx < currentIndex
        const isActive = idx === currentIndex
        return (
          <li key={s.id} className="flex flex-1 items-center gap-2">
            <div
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium tabular-nums transition-colors",
                isComplete && "border-primary bg-primary text-primary-foreground",
                isActive && "border-primary text-primary",
                !isComplete && !isActive && "border-border text-muted-foreground",
              )}
            >
              {isComplete ? <CheckIcon className="size-3" /> : idx + 1}
            </div>
            <span
              className={cn(
                "hidden truncate font-mono text-[10px] tracking-wider uppercase sm:inline",
                isActive ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {s.label}
            </span>
            {idx < steps.length - 1 && (
              <div
                className={cn(
                  "h-px flex-1 transition-colors",
                  isComplete ? "bg-primary" : "bg-border",
                )}
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}
