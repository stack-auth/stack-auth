import { afterEach, describe, expect, it, vi } from "vitest";
import { startProgress, withProgress } from "./progress.js";

function createStream(isTTY: boolean) {
  const chunks: string[] = [];
  return {
    chunks,
    stream: {
      isTTY,
      write(chunk: string) {
        chunks.push(chunk);
      },
    },
  };
}

describe("startProgress", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders and clears an animated line in interactive terminals", () => {
    vi.useFakeTimers();
    const { chunks, stream } = createStream(true);
    const progress = startProgress("Loading config", { stream });

    vi.advanceTimersByTime(80);
    progress.update("Pushing config");
    progress.stop();

    expect(chunks.join("")).toContain("⠋ Loading config");
    expect(chunks.join("")).toContain("⠙ Loading config");
    expect(chunks.join("")).toContain("Pushing config");
    expect(chunks.at(-1)).toBe("\r\x1b[2K");
  });

  it("writes durable phase lines when stderr is redirected", () => {
    const { chunks, stream } = createStream(false);
    const progress = startProgress("Loading config", { prefix: "[Hexclave] ", stream });

    progress.update("Pushing config");
    progress.stop("Config pushed");

    expect(chunks).toEqual([
      "[Hexclave] Loading config...\n",
      "[Hexclave] Pushing config...\n",
      "[Hexclave] Config pushed\n",
    ]);
  });

  it("stops idempotently", () => {
    const { chunks, stream } = createStream(false);
    const progress = startProgress("Working", { stream });

    progress.stop("Done");
    progress.stop("Done again");

    expect(chunks).toEqual(["Working...\n", "Done\n"]);
  });
});

describe("withProgress", () => {
  it("clears progress when the operation rejects", async () => {
    const { chunks, stream } = createStream(true);
    const error = new Error("nope");

    await expect(withProgress("Working", async () => {
      throw error;
    }, { stream })).rejects.toBe(error);

    expect(chunks.at(-1)).toBe("\r\x1b[2K");
  });
});
