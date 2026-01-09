'use client';

import { useState } from "react";
import { Team, TeamSwitcher } from "../../..";
import { useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";
import { PageLayout } from "../page-layout";
import { PaymentsPanel } from "./payments-panel";

export function PaymentsPage(props: { mockMode?: boolean }) {
  const { t } = useTranslation();
  const user = useUser({ or: props.mockMode ? "return-null" : "redirect" });
  const teams = user?.useTeams() ?? [];
  const hasTeams = teams.length > 0;
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const customer = selectedTeam ?? user;
  const customerType = selectedTeam ? "team" : "user";

  if (props.mockMode) {
    return (
      <PageLayout>
        <PaymentsPanel
          mockMode
        />
      </PageLayout>
    );
  }

  if (!customer) {
    return null;
  }


  return (
    <PageLayout>
      {hasTeams ? (
        <TeamSwitcher
          team={selectedTeam ?? undefined}
          allowNull
          nullLabel={t("Personal")}
          onChange={async (team) => {
            setSelectedTeam(team);
          }}
        />
      ) : null}
      <PaymentsPanel
        customer={customer}
        customerType={customerType}
      />
    </PageLayout>
  );
}
