import { useState } from "react"
import { toast } from "sonner"

export function useAuthMethodRow({
  checked,
  label,
  onChange,
}: {
  checked: boolean,
  label: string,
  onChange: (next: boolean) => Promise<void>,
}) {
  // Optimistic UI: while the network request is in flight we show the
  // requested state. On error, we revert and surface a toast.
  const [pending, setPending] = useState<boolean | null>(null)
  const display = pending ?? checked

  const handle = (next: boolean) => {
    setPending(next)
    onChange(next).then(
      () => {
        setPending(null)
      },
      (err: unknown) => {
        setPending(null)
        toast.error(errorMessage(err, `Failed to update ${label}.`))
      },
    )
  }

  return { display, handle }
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}
