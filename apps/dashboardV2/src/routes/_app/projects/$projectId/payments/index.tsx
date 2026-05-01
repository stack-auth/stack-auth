import { useState } from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  ArrowSquareOutIcon,
  CheckIcon,
  CopyIcon,
  CreditCardIcon,
  GearIcon,
  PackageIcon,
  PlugIcon,
  ReceiptIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react"

import { useAdminApp } from "@/lib/stack/admin-app"
import { useStripeAccountInfoQuery } from "@/lib/stack/react-query"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { ProjectPageMain } from "@/components/console/project-page"

export const Route = createFileRoute("/_app/projects/$projectId/payments/")({
  component: OverviewPage,
})

type StripeAccount = {
  account_id: string,
  charges_enabled: boolean,
  details_submitted: boolean,
  payouts_enabled: boolean,
}

function OverviewPage() {
  const adminApp = useAdminApp()
  const stripeAccountQuery = useStripeAccountInfoQuery(adminApp)
  const account = (stripeAccountQuery.data ?? null)

  return (
    <ProjectPageMain className="space-y-6">
      <AccountStatusCard account={account} loading={stripeAccountQuery.isPending} />
      <QuickLinks isStripeConnected={account != null} />
    </ProjectPageMain>
  )
}

function AccountStatusCard({
  account,
  loading,
}: {
  account: StripeAccount | null,
  loading: boolean,
}) {
  const adminApp = useAdminApp()

  const setupMutation = useMutation({
    mutationFn: () => adminApp.setupPayments(),
    onSuccess: ({ url }) => {
      window.location.href = url
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to start Stripe onboarding.")
    },
  })

  return (
    <section className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-4 border-b px-5 py-4">
        <div className="space-y-0.5">
          <h2 className="font-heading text-sm font-semibold">Stripe account</h2>
          <p className="text-xs text-muted-foreground">
            Connect a Stripe account to charge customers and receive payouts.
          </p>
        </div>
        {loading ? (
          <Skeleton className="h-5 w-16" />
        ) : account == null ? null : (
          <Badge variant={account.charges_enabled ? "default" : "secondary"}>
            {account.charges_enabled ? "Active" : "Pending"}
          </Badge>
        )}
      </div>

      <div className="px-5 py-5">
        {loading ? (
          <AccountSkeleton />
        ) : account == null ? (
          <Empty className="border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <PlugIcon />
              </EmptyMedia>
              <EmptyTitle>Stripe not connected</EmptyTitle>
              <EmptyDescription>
                Link a Stripe account to start accepting payments. We will redirect you to Stripe to complete onboarding.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                size="lg"
                onClick={async () => {
                  await setupMutation.mutateAsync()
                }}
                disabled={setupMutation.isPending}
              >
                <PlugIcon />
                {setupMutation.isPending ? "Redirecting…" : "Connect Stripe"}
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="space-y-5">
            {!account.details_submitted && (
              <Alert>
                <AlertTitle>Onboarding incomplete</AlertTitle>
                <AlertDescription className="flex items-center justify-between gap-3">
                  <span>
                    Stripe still needs additional details before you can charge customers.
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await setupMutation.mutateAsync()
                    }}
                    disabled={setupMutation.isPending}
                  >
                    Complete onboarding
                    <ArrowSquareOutIcon />
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
              <span className="self-center font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                Account ID
              </span>
              <CopyableId value={account.account_id} />
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <StatusChip label="Charges" enabled={account.charges_enabled} />
              <StatusChip label="Details submitted" enabled={account.details_submitted} />
              <StatusChip label="Payouts" enabled={account.payouts_enabled} />
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function AccountSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-7 w-64" />
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    </div>
  )
}

function StatusChip({ label, enabled }: { label: string, enabled: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2">
      <span
        aria-hidden
        className={"size-2 rounded-full " + (enabled ? "bg-success" : "bg-destructive")}
      />
      <span className="text-xs">{label}</span>
      <span className="ms-auto font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
        {enabled ? "On" : "Off"}
      </span>
    </div>
  )
}

function QuickLinks({ isStripeConnected }: { isStripeConnected: boolean }) {
  const { projectId } = Route.useParams()
  const items = [
    {
      to: "/projects/$projectId/payments/products" as const,
      label: "Products & items",
      description: "Define what you sell and what each plan grants.",
      Icon: PackageIcon,
    },
    {
      to: "/projects/$projectId/payments/customers" as const,
      label: "Customers",
      description: "Grant products and adjust item quantities for individual customers.",
      Icon: UsersThreeIcon,
    },
    {
      to: "/projects/$projectId/payments/transactions" as const,
      label: "Transactions",
      description: "Recent purchases, renewals and refunds across the project.",
      Icon: ReceiptIcon,
    },
    {
      to: "/projects/$projectId/payments/settings" as const,
      label: "Settings",
      description: "Test mode, payment methods, and global controls.",
      Icon: GearIcon,
    },
  ]

  return (
    <section className="rounded-lg border bg-card">
      <div className="border-b px-5 py-4">
        <h2 className="font-heading text-sm font-semibold">Continue setup</h2>
        <p className="text-xs text-muted-foreground">
          {isStripeConnected
            ? "Configure your products, then start accepting payments."
            : "These pages are available after Stripe onboarding completes."}
        </p>
      </div>
      <ul className="divide-y">
        {items.map((item) => (
          <li key={item.to}>
            <Link
              to={item.to}
              params={{ projectId }}
              className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/40 hover:transition-none"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground group-hover:text-foreground">
                <item.Icon />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{item.label}</span>
                <span className="block text-xs text-muted-foreground">{item.description}</span>
              </span>
              <ArrowSquareOutIcon className="size-4 shrink-0 text-muted-foreground/60 group-hover:text-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function CopyableId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="flex min-w-0 items-center gap-2">
      <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
        {value}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={copied ? "Copied" : "Copy"}
        onClick={() => {
          void onCopy()
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </div>
  )
}

void CreditCardIcon
