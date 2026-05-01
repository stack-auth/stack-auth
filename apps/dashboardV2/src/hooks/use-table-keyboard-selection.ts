import { useEffect } from "react"

type UseTableKeyboardSelectionArgs<TItem> = {
  items: ReadonlyArray<TItem>
  getItemKey: (item: TItem) => string
  selectedItemKey: string | null
  onSelectItemKey: (key: string) => void
  disabled?: boolean
}

export function useTableKeyboardSelection<TItem>({
  items,
  getItemKey,
  selectedItemKey,
  onSelectItemKey,
  disabled = false,
}: UseTableKeyboardSelectionArgs<TItem>) {
  useEffect(() => {
    if (disabled) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isTextEntryTarget(event.target)
      ) {
        return
      }

      if (event.key === "j" || event.key === "n") {
        event.preventDefault()
        selectItem(1, items, selectedItemKey, getItemKey, onSelectItemKey)
      } else if (event.key === "k") {
        event.preventDefault()
        selectItem(-1, items, selectedItemKey, getItemKey, onSelectItemKey)
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [disabled, getItemKey, items, onSelectItemKey, selectedItemKey])
}

function selectItem<TItem>(
  direction: 1 | -1,
  items: ReadonlyArray<TItem>,
  selectedItemKey: string | null,
  getItemKey: (item: TItem) => string,
  onSelectItemKey: (key: string) => void
) {
  if (items.length === 0) return

  const selectedIndex =
    selectedItemKey == null
      ? -1
      : items.findIndex((item) => getItemKey(item) === selectedItemKey)
  const nextIndex =
    selectedIndex === -1
      ? direction === 1
        ? 0
        : items.length - 1
      : selectedIndex + direction

  if (nextIndex < 0 || nextIndex >= items.length) return
  onSelectItemKey(getItemKey(items[nextIndex]))
}

function isTextEntryTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true

  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.closest("[role='textbox']") != null
  )
}
