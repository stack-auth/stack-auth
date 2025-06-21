import { Button } from "@stackframe/stack-ui";
import { useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";
import { Section } from "../section";

export function SignOutSection(props?: { mockMode?: boolean }) {
  const { t } = useTranslation();
  const user = useUser({ or: props?.mockMode ? "return-null" : "throw" });

  const handleSignOut = async () => {
    if (props?.mockMode) {
      // Mock mode - just show an alert or do nothing
      alert("Mock mode: Sign out clicked");
      return;
    }
    if (user) {
      await user.signOut();
    }
  };

  return (
    <Section
      title={t("Sign out")}
      description={t("End your current session")}
    >
      <div>
        <Button
          variant='secondary'
          onClick={handleSignOut}
        >
          {t("Sign out")}
        </Button>
      </div>
    </Section>
  );
}
