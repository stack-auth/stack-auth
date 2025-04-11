import { Button, Typography } from "@stackframe/stack-ui";
import { useState } from "react";
import { Team } from "../../..";
import { useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";
import { Section } from "../section";

export function LeaveTeamSection(props: { team: Team }) {
  const { t } = useTranslation();
  const user = useUser({ or: 'redirect' });
  const [leaving, setLeaving] = useState(false);

  return (
    <Section
      title={t("Leave Team")}
      description={t("leave this team and remove your team profile")}
    >
      {!leaving ? (
        <div>
          <Button
            variant='secondary'
            onClick={() => setLeaving(true)}
          >
            {t("Leave team")}
          </Button>
        </div>
      ) : (
        <div className='flex flex-col gap-2'>
          <Typography variant='destructive'>
            {t("Are you sure you want to leave the team?")}
          </Typography>
          <div className='flex gap-2'>
            <Button
              variant='destructive'
              onClick={async () => {
                await user.leaveTeam(props.team);
                window.location.reload();
              }}
            >
              {t("Leave")}
            </Button>
            <Button
              variant='secondary'
              onClick={() => setLeaving(false)}
            >
              {t("Cancel")}
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}
