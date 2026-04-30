import { useCallback, useEffect, useMemo, useState } from "react"

export type UseFaviconOptions = {
  size?: number,
}

function safeHostname(input: string): string | null {
  if (!input) return null
  try {
    const url = new URL(input.includes("://") ? input : `https://${input}`)
    return url.hostname || null
  } catch {
    return null
  }
}

function buildSources(hostname: string, size: number): Array<string> {
  return [
    `https://www.google.com/s2/favicons?domain=${hostname}&sz=${size}`,
    `https://icons.duckduckgo.com/ip3/${hostname}.ico`,
  ]
}

export function useFavicon(url: string | null | undefined, opts: UseFaviconOptions = {}) {
  const { size = 64 } = opts
  const hostname = useMemo(() => safeHostname(url ?? ""), [url])
  const sources = useMemo(
    () => (hostname ? buildSources(hostname, size) : []),
    [hostname, size],
  )

  const [index, setIndex] = useState(0)
  useEffect(() => {
    setIndex(0)
  }, [hostname, size])

  const onError = useCallback(() => {
    setIndex((i) => Math.min(i + 1, sources.length))
  }, [sources.length])

  return {
    hostname,
    src: index < sources.length ? sources[index] : null,
    onError,
  }
}
