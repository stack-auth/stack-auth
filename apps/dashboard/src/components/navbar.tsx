'use client';

import { UserButton } from "@stackframe/stack";
import { Button, Typography } from "@stackframe/stack-ui";
import { useTheme } from "next-themes";
import { FeedbackDialog } from "./feedback-dialog";
import { Link } from "./link";
import { Logo } from "./logo";

export function Navbar({ ...props }) {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <header
      className={`sticky top-0 z-30 flex items-center justify-between border-b backdrop-blur-md bg-white/20 dark:bg-black/20 px-4 shrink-0 ${props.className || ""}`}
      style={{ height: `50px` }}
    >
      <div className="flex items-center justify-center">
        <Logo full height={24} href="/projects" className="h-6" />
      </div>
      <div className="flex items-center">
        <div className="flex gap-4 mr-8 items-center">
          <FeedbackDialog
            trigger={<Button variant="outline" size='sm'>Feedback</Button>}
          />
          <Link href="https://docs.stack-auth.com/">
            <Typography type='label'>Docs</Typography>
          </Link>
        </div>
        <UserButton colorModeToggle={() => setTheme(resolvedTheme === 'light' ? 'dark' : 'light')}/>
      </div>
    </header>
  );
}
