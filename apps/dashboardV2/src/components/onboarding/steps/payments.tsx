import {
  ArrowsClockwiseIcon,
  ChartBarIcon,
  ShieldCheckIcon,
  WebhooksLogoIcon,
} from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { usePaymentsStep } from "@/hooks/onboarding/use-payments-step"

const COUNTRIES = [
  { value: "US", label: "United States" },
  { value: "OTHER", label: "Other" },
]

type PaymentsStepProps = {
  submitting: boolean,
  onConnect: () => void,
  onLater: () => void,
}

export function PaymentsStep({ submitting, onConnect, onLater }: PaymentsStepProps) {
  const { country, setCountry, isUS } = usePaymentsStep()

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
          Step 5
        </p>
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          Set up payments
        </h2>
        <p className="text-sm text-muted-foreground">
          Connect a bank account to start accepting payments. You can also skip
          this for now and configure later.
        </p>
      </div>

      <div className="mx-auto w-full max-w-md rounded-xl bg-card p-6 ring-1 ring-foreground/10">
        <h3 className="text-center font-heading text-lg font-semibold tracking-tight">
          Built-in Billing
        </h3>

        <ul className="mt-6 flex flex-col gap-3 rounded-lg bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
          <li className="flex items-center gap-2.5">
            <WebhooksLogoIcon className="size-3.5 shrink-0 text-foreground/50" />
            No webhooks or syncing required
          </li>
          <li className="flex items-center gap-2.5">
            <ArrowsClockwiseIcon className="size-3.5 shrink-0 text-foreground/50" />
            One-time and recurring payments
          </li>
          <li className="flex items-center gap-2.5">
            <ChartBarIcon className="size-3.5 shrink-0 text-foreground/50" />
            Usage-based billing support
          </li>
        </ul>

        <div className="mt-6 space-y-2">
          <p className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
            Country of residence
          </p>
          <Select
            value={country}
            onValueChange={(v) => {
              if (typeof v === "string") setCountry(v)
            }}
          >
            <SelectTrigger className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COUNTRIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center justify-center gap-1.5 pt-1 text-[10px] text-muted-foreground">
            <ShieldCheckIcon className="size-3 shrink-0" />
            Powered by Stripe
          </div>
          {!isUS && (
            <p className="pt-1 text-center text-[11px] text-amber-600 dark:text-amber-400">
              Payments is currently only available in the United States.
            </p>
          )}
        </div>

        <div className="mt-6 flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onLater}
            disabled={submitting}
          >
            Do later
          </Button>
          <Button
            size="sm"
            onClick={onConnect}
            disabled={submitting || !isUS}
          >
            {submitting ? <Spinner className="size-3.5" /> : null}
            Connect
          </Button>
        </div>
      </div>
    </div>
  )
}
