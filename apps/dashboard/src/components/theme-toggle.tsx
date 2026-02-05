import { Button } from "@/components/ui";
import { MoonIcon, SunIcon } from "@phosphor-icons/react";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { useTheme } from "next-themes";
import { useRef } from "react";

type ViewTransitionWithReady = {
  ready: Promise<void>,
};

type DocumentWithViewTransition = globalThis.Document & {
  startViewTransition?: (callback: () => void) => ViewTransitionWithReady,
};

export default function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
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
    const button = buttonRef.current;

    if (!documentWithTransition.startViewTransition || prefersReducedMotion || !button) {
      setTheme(nextTheme);
      return;
    }

    const rect = button.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const maxRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );

    const transition = documentWithTransition.startViewTransition(() => {
      setTheme(nextTheme);
    });

    runAsynchronously(async () => {
      await transition.ready;
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${maxRadius}px at ${x}px ${y}px)`
          ],
        },
        {
          duration: 450,
          easing: "ease-in-out",
          pseudoElement: "::view-transition-new(root)",
        }
      );
    });
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className="w-8 h-8 hover:bg-muted/50"
      onClick={handleToggle}
      ref={buttonRef}
      disabled={!isReady}
      aria-label="Toggle theme"
    >
      <SunIcon className="hidden dark:block w-4 h-4" />
      <MoonIcon className="block dark:hidden w-4 h-4" />
    </Button>
  );
}
