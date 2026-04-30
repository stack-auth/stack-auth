import { createFileRoute } from "@tanstack/react-router"

import { ProjectOnboardingWizard } from "@/components/onboarding/wizard"

export const Route = createFileRoute("/_app/projects/new")({
  component: NewProjectPage,
})

function NewProjectPage() {
  return <ProjectOnboardingWizard />
}
