'use client';

import { Typography } from "@stackframe/stack-ui";
import { Team, useUser } from "../../..";
import { useTranslation } from "../../../lib/translations";
import { Section } from "../section";
import { PaymentsPanel } from "../payments/payments-panel";

export function TeamPaymentsSection(props: { team: Team }) {
  const { t } = useTranslation();
  const user = useUser({ or: "redirect" });

  const isTeamAdmin = !!user.usePermission(props.team, "team_admin");

  if (isTeamAdmin) {
    return (
      <PaymentsPanel
        customer={props.team}
        customerType="team"
      />
    );
  }

  return (
    <Section
      title={t("Team payments")}
      description={t("Manage the default payment method for this team.")}
    >
      <Typography variant="secondary" type="footnote">
        {t("You need team admin permissions to manage team billing.")}
      </Typography>
    </Section>
  );
}
