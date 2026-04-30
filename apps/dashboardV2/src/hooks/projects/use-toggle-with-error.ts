import { useState } from "react"
import { toast } from "sonner"

export function useToggleWithError({
  checked,
  onChange,
  fallback,
}: {
  checked: boolean,
  onChange: (next: boolean) => Promise<void>,
  fallback: string,
}) {
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
        toast.error(errorMessage(err, fallback))
      },
    )
  }

  return { display, handle }
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}
