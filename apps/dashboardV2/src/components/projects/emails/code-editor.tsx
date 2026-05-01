import { autocompletion, closeBrackets, completionKeymap } from "@codemirror/autocomplete"
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import { javascript } from "@codemirror/lang-javascript"
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language"
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search"
import { EditorState } from "@codemirror/state"
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view"
import { useEffect, useMemo, useRef } from "react"

import { cn } from "@/lib/utils"

type CodeEditorProps = {
  value: string,
  onChange: (value: string) => void,
  readOnly?: boolean,
  ariaLabel: string,
  className?: string,
}

export function CodeEditor({
  value,
  onChange,
  readOnly = false,
  ariaLabel,
  className,
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const initialValueRef = useRef(value)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const extensions = useMemo(() => [
    lineNumbers(),
    foldGutter(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    rectangularSelection(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    javascript({ jsx: true, typescript: true }),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({
      "aria-label": ariaLabel,
      spellcheck: "false",
    }),
    keymap.of([
      indentWithTab,
      ...defaultKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      ...searchKeymap,
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString())
      }
    }),
    EditorView.theme({
      "&": {
        height: "100%",
        minHeight: "0",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--input)",
        backgroundColor: "color-mix(in oklab, var(--input) 20%, transparent)",
        color: "var(--foreground)",
        fontSize: "11px",
      },
      "&.cm-focused": {
        borderColor: "var(--ring)",
        outline: "2px solid color-mix(in oklab, var(--ring) 30%, transparent)",
        outlineOffset: "0",
      },
      ".cm-scroller": {
        height: "100%",
        minHeight: "0",
        overflow: "auto",
        fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)",
        lineHeight: "1.55",
      },
      ".cm-content": {
        minHeight: "100%",
        padding: "8px 0",
      },
      ".cm-line": {
        padding: "0 10px",
      },
      ".cm-gutters": {
        borderRight: "1px solid var(--border)",
        backgroundColor: "color-mix(in oklab, var(--muted) 38%, transparent)",
        color: "var(--muted-foreground)",
      },
      ".cm-activeLine, .cm-activeLineGutter": {
        backgroundColor: "color-mix(in oklab, var(--accent) 44%, transparent)",
      },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
        backgroundColor: "color-mix(in oklab, var(--ring) 32%, transparent)",
      },
      ".cm-tooltip": {
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        backgroundColor: "var(--popover)",
        color: "var(--popover-foreground)",
      },
      ".cm-tooltip-autocomplete ul li[aria-selected]": {
        backgroundColor: "var(--accent)",
        color: "var(--accent-foreground)",
      },
    }),
  ], [ariaLabel, readOnly])

  useEffect(() => {
    const parent = containerRef.current
    if (parent == null) return

    const view = new EditorView({
      state: EditorState.create({
        doc: initialValueRef.current,
        extensions,
      }),
      parent,
    })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [extensions])

  useEffect(() => {
    const view = viewRef.current
    if (view == null) return

    const currentValue = view.state.doc.toString()
    if (currentValue === value) return

    view.dispatch({
      changes: {
        from: 0,
        to: currentValue.length,
        insert: value,
      },
    })
  }, [value])

  return (
    <div
      ref={containerRef}
      className={cn("min-h-0 flex-1 overflow-hidden rounded-md", className)}
    />
  )
}
