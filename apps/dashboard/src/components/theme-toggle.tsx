import { MoonIcon, SunIcon } from "@phosphor-icons/react";
import { Button } from "@stackframe/stack-ui";
import { useTheme } from "next-themes";

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      className="w-8 h-8 hover:bg-muted/50"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
    >
      <SunIcon className="hidden dark:block w-4 h-4" />
      <MoonIcon className="block dark:hidden w-4 h-4" />
    </Button>
  );
}
