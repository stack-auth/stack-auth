import { Button } from "~/components/ui";

import { useUser } from "@hexclave/react";
import { getOutlineButtonClassName, useDesign } from "../design-context";
import { Section } from "../section";

export function SignOutSection(props?: { mockMode?: boolean }) {
  const design = useDesign();
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
        className={getOutlineButtonClassName(design, "px-4 py-2 w-full md:w-auto text-red-500 hover:text-red-600 focus-visible:text-red-600 transition-colors duration-150")}
      >
        Sign out
      </Button>
    </Section>
  );
}
