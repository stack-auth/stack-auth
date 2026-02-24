import { Button } from "@/components/ui";
import { MoonIcon, SunIcon } from "@phosphor-icons/react";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { useTheme } from "next-themes";

type ViewTransitionWithReady = {
  ready: Promise<void>,
};

type DocumentWithViewTransition = globalThis.Document & {
  startViewTransition?: (callback: () => void) => ViewTransitionWithReady,
};

const TRANSITION_DURATION_MS = 600;

export default function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isReady = resolvedTheme === "dark" || resolvedTheme === "light";

  const handleToggle = () => {
    if (!isReady) {
      return;
    }

    const nextTheme = resolvedTheme === "dark" ? "light" : "dark";

    if (typeof document === "undefined") {
      setTheme(nextTheme);
      return;
    }

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const documentWithTransition: DocumentWithViewTransition = document;

    if (!documentWithTransition.startViewTransition || prefersReducedMotion) {
      setTheme(nextTheme);
      return;
    }

    // Temporarily kill component-level CSS transitions so colors flip instantly.
    document.documentElement.classList.add("vt-disable-transitions");

    const transition = documentWithTransition.startViewTransition(() => {
      setTheme(nextTheme);
    });

    runAsynchronously(async () => {
      await transition.ready;

      // --- Old view: shrinks away into the distance ---
      document.documentElement.animate(
        {
          transform: ["scale(1)", "scale(0.82)"],
          opacity: [1, 0],
          filter: ["blur(0px)", "blur(4px)"],
        },
        {
          duration: TRANSITION_DURATION_MS * 0.45,
          easing: "cubic-bezier(0.4, 0, 1, 1)",
          pseudoElement: "::view-transition-old(root)",
          fill: "forwards",
        },
      );

      // --- New view: rushes in from zoomed-in, lands with a soft bounce ---
      document.documentElement.animate(
        [
          { transform: "scale(1.18)", opacity: 0, filter: "blur(4px)", offset: 0 },
          { transform: "scale(0.994)", opacity: 1, filter: "blur(0px)", offset: 0.6 },
          { transform: "scale(1.003)", opacity: 1, filter: "blur(0px)", offset: 0.82 },
          { transform: "scale(1)", opacity: 1, filter: "blur(0px)", offset: 1 },
        ],
        {
          duration: TRANSITION_DURATION_MS,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          pseudoElement: "::view-transition-new(root)",
        },
      );

      // Re-enable component CSS transitions
      setTimeout(() => {
        document.documentElement.classList.remove("vt-disable-transitions");
      }, TRANSITION_DURATION_MS);
    });
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className="w-8 h-8 hover:bg-muted/50"
      onClick={handleToggle}
      disabled={!isReady}
      aria-label="Toggle theme"
    >
      <SunIcon className="hidden dark:block w-4 h-4" />
      <MoonIcon className="block dark:hidden w-4 h-4" />
    </Button>
  );
}
