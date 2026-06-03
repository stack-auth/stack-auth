'use client';

import { Button } from "@/components/ui/button";
import { useUser } from "@hexclave/next";
import { Section } from "../section";

export function SignOutSection(props?: { mockMode?: boolean }) {
  const user = useUser({ or: props?.mockMode ? "return-null" : "throw" });

  const handleSignOut = async () => {
    if (props?.mockMode) {
      alert("Mock mode: Sign out clicked");
      return;
    }
    if (user) {
      await user.signOut();
    }
  };

  return (
    <Section
      title="Sign out"
      description="End your current session"
    >
      <Button
        variant='outline'
        onClick={handleSignOut}
        className="border-black/[0.08] dark:border-white/[0.08] hover:bg-zinc-50 dark:hover:bg-zinc-900 rounded-xl px-4 py-2 w-full md:w-auto transition-colors duration-150"
      >
        Sign out
      </Button>
    </Section>
  );
}
