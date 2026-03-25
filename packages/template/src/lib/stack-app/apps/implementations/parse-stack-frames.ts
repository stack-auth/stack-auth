export type ParsedStackFrame = {
  function_name: string | null,
  filename: string | null,
  lineno: number | null,
  colno: number | null,
};

const MAX_STACK_FRAMES = 50;
const CHROME_FRAME_RE = /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/;
const FIREFOX_FRAME_RE = /^(.*)@(.+?):(\d+):(\d+)$/;

export function parseStackFrames(stack: string): ParsedStackFrame[] {
  const lines = stack.split("\n");
  const frames: ParsedStackFrame[] = [];
  for (const line of lines) {
    const match = CHROME_FRAME_RE.exec(line) || FIREFOX_FRAME_RE.exec(line);
    if (match) {
      frames.push({
        function_name: (match[1] as string | undefined)?.trim() || null,
        filename: match[2] || null,
        lineno: match[3] ? parseInt(match[3], 10) : null,
        colno: match[4] ? parseInt(match[4], 10) : null,
      });
    }
    if (frames.length >= MAX_STACK_FRAMES) break;
  }
  return frames;
}
