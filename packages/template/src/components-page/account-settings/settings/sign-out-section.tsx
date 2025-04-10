import { Button } from "@stackframe/stack-ui";
import { useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";
import { Section } from "../section";

export function SignOutSection() {
  const { t } = useTranslation();
  const user = useUser({ or: "throw" });

  return (
    <Section
      title={t("Sign out")}
      description={t("End your current session")}
    >
      <div>
        <Button
          variant='secondary'
          onClick={() => user.signOut()}
        >
          {t("Sign out")}
        </Button>
      </div>
    </Section>
  );
}
