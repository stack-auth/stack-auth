import type { IssueFrame } from "./issues-data";

/**
 * How a stack trace is laid out for reading.
 *
 * Frames arrive from the backend parser **oldest-first** (the outermost caller
 * is index 0). A reader almost always wants the opposite — the throw site is
 * the thing they came for — so the display order is reversed by default and the
 * original order is available behind a toggle for anyone reading a stack as a
 * call sequence.
 */

export type StackFrameOrder = "innermost-first" | "outermost-first";

export const DEFAULT_STACK_FRAME_ORDER: StackFrameOrder = "innermost-first";

export function orderStackFrames(
  frames: readonly IssueFrame[],
  order: StackFrameOrder,
): IssueFrame[] {
  return order === "innermost-first" ? [...frames].reverse() : [...frames];
}

export type StackFrameGroup =
  | { kind: "frame", frame: IssueFrame, index: number }
  | {
    kind: "collapsed",
    frames: readonly IssueFrame[],
    /** Index of the first frame in the run, in the passed-in ordering. */
    startIndex: number,
    /**
     * True when the whole stack is library code. Collapsing every frame would
     * render an empty card with a "⋯ 12 frames" toggle and nothing else, which
     * looks like a loading bug — so in that one case the group starts open.
     */
    defaultExpanded: boolean,
  };

const MIN_COLLAPSIBLE_RUN = 2;

/**
 * Collapses consecutive non-`in_app` runs.
 *
 * A run of exactly one frame is NOT collapsed: replacing a single readable
 * `node_modules/react-dom/...` line with "⋯ 1 frame from node_modules" costs
 * the same vertical space and hides strictly more.
 */
export function groupStackFrames(frames: readonly IssueFrame[]): StackFrameGroup[] {
  const everyFrameIsLibrary = frames.length > 0 && frames.every((frame) => !frame.in_app);
  const groups: StackFrameGroup[] = [];
  let index = 0;
  while (index < frames.length) {
    const frame = frames[index] ?? throwMissingFrame(index);
    if (frame.in_app) {
      groups.push({ kind: "frame", frame, index });
      index += 1;
      continue;
    }
    let runEnd = index;
    while (runEnd < frames.length && (frames[runEnd] ?? throwMissingFrame(runEnd)).in_app === false) {
      runEnd += 1;
    }
    const run = frames.slice(index, runEnd);
    if (run.length < MIN_COLLAPSIBLE_RUN) {
      groups.push({ kind: "frame", frame, index });
    } else {
      groups.push({
        kind: "collapsed",
        frames: run,
        startIndex: index,
        defaultExpanded: everyFrameIsLibrary,
      });
    }
    index = runEnd;
  }
  return groups;
}

function throwMissingFrame(index: number): never {
  throw new Error(`Stack frame ${index} is missing, which a bounded loop cannot produce`);
}

/**
 * The label for a collapsed run. Names the shared origin when every frame in
 * the run agrees on one (`node_modules`, a CDN host), since "12 frames from
 * node_modules" is actionable in a way that "12 hidden frames" is not.
 */
export function collapsedFramesLabel(frames: readonly IssueFrame[]): string {
  const count = frames.length;
  const origins = new Set(frames.map(frameOrigin).filter((origin): origin is string => origin != null));
  const noun = count === 1 ? "frame" : "frames";
  if (origins.size === 1) {
    const [origin] = [...origins];
    return `${count} ${noun} from ${origin}`;
  }
  return `${count} library ${noun}`;
}

function frameOrigin(frame: IssueFrame): string | null {
  const path = frame.abs_path ?? frame.filename;
  if (path == null || path === "") return null;
  if (path.includes("node_modules")) return "node_modules";
  if (path.startsWith("node:") || path.startsWith("internal/")) return "node internals";
  const originMatch = /^[a-z]+:\/\/([^/]+)/i.exec(path);
  return originMatch?.[1] ?? null;
}

/** The bold half of a frame row: the function, or the file when unnamed. */
export function frameFunctionLabel(frame: IssueFrame): string {
  const fn = frame.function?.trim();
  if (fn != null && fn !== "") return fn;
  return "<anonymous>";
}

/** `src/checkout.ts:42:11` — the location half. Never empty. */
export function frameLocationLabel(frame: IssueFrame): string {
  const path = frame.module ?? frame.filename ?? frame.abs_path;
  if (path == null || path === "") return "unknown location";
  if (frame.lineno == null) return path;
  return frame.colno == null ? `${path}:${frame.lineno}` : `${path}:${frame.lineno}:${frame.colno}`;
}
