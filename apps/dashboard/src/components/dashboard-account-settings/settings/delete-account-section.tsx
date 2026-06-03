'use client';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useStackApp, useUser } from "@hexclave/next";
import { Section } from "../section";

export function DeleteAccountSection(props?: { mockMode?: boolean }) {
  const user = useUser({ or: props?.mockMode ? 'return-null' : 'redirect' });
  const app = useStackApp();
  const project = app.useProject();
  const [deleting, setDeleting] = useState(false);

  const showDeleteSection = props?.mockMode || project.config.clientUserDeletionEnabled;

  if (!showDeleteSection) {
    return null;
  }

  const handleDeleteAccount = async () => {
    if (props?.mockMode) {
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
      title="Delete Account"
      description="Permanently remove your account and all associated data"
    >
      <div className="w-full md:w-[350px]">
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="danger-zone" className="border-b-0">
            <AccordionTrigger className="text-red-500 hover:text-red-600 font-semibold py-2">
              Danger zone
            </AccordionTrigger>
            <AccordionContent className="pt-2">
              {!deleting ? (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-muted-foreground leading-normal mb-2">
                    Once you delete your account, there is no going back. Please be certain.
                  </p>
                  <Button
                    variant="destructive"
                    onClick={() => setDeleting(true)}
                    className="rounded-xl w-full"
                  >
                    Delete account
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <p className="text-xs font-semibold text-red-500 leading-relaxed">
                    Are you sure you want to delete your account? This action is IRREVERSIBLE and will delete ALL associated data.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="destructive"
                      onClick={handleDeleteAccount}
                      className="rounded-xl flex-1 text-xs"
                    >
                      Yes, delete account
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setDeleting(false)}
                      className="border-black/[0.08] dark:border-white/[0.08] hover:bg-zinc-50 dark:hover:bg-zinc-900 rounded-xl flex-1 text-xs"
                    >
                      Cancel
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
