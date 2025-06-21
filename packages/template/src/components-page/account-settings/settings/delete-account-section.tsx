import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, Button, Typography } from "@stackframe/stack-ui";
import { useState } from "react";
import { useStackApp, useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";
import { Section } from "../section";

export function DeleteAccountSection(props?: { mockMode?: boolean }) {
  const { t } = useTranslation();
  const user = useUser({ or: props?.mockMode ? 'return-null' : 'redirect' });
  const app = useStackApp();
  const project = app.useProject();
  const [deleting, setDeleting] = useState(false);

  // In mock mode, always show the delete section
  const showDeleteSection = props?.mockMode || project.config.clientUserDeletionEnabled;

  if (!showDeleteSection) {
    return null;
  }

  const handleDeleteAccount = async () => {
    if (props?.mockMode) {
      // Mock mode - just show an alert
      alert("Mock mode: Account deletion clicked");
      setDeleting(false);
      return;
    }

    if (user) {
      await user.delete();
      await app.redirectToHome();
    }
  };

  return (
    <Section
      title={t("Delete Account")}
      description={t("Permanently remove your account and all associated data")}
    >
      <div className='stack-scope flex flex-col items-stretch'>
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="item-1">
            <AccordionTrigger>{t("Danger zone")}</AccordionTrigger>
            <AccordionContent>
              {!deleting ? (
                <div>
                  <Button
                    variant='destructive'
                    onClick={() => setDeleting(true)}
                  >
                    {t("Delete account")}
                  </Button>
                </div>
              ) : (
                <div className='flex flex-col gap-2'>
                  <Typography variant='destructive'>
                    {t("Are you sure you want to delete your account? This action is IRREVERSIBLE and will delete ALL associated data.")}
                  </Typography>
                  <div className='flex gap-2'>
                    <Button
                      variant='destructive'
                      onClick={handleDeleteAccount}
                    >
                      {t("Delete Account")}
                    </Button>
                    <Button
                      variant='secondary'
                      onClick={() => setDeleting(false)}
                    >
                      {t("Cancel")}
                    </Button>
                  </div>
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </Section>
  );
}
