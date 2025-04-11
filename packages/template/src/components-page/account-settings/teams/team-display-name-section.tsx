import { Team } from "../../..";
import { useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";
import { EditableText } from "../editable-text";
import { Section } from "../section";

export function TeamDisplayNameSection(props: { team: Team }) {
  const { t } = useTranslation();
  const user = useUser({ or: 'redirect' });
  const updateTeamPermission = user.usePermission(props.team, '$update_team');

  if (!updateTeamPermission) {
    return null;
  }

  return (
    <Section
      title={t("Team display name")}
      description={t("Change the display name of your team")}
    >
      <EditableText
        value={props.team.displayName}
        onSave={async (newDisplayName) => await props.team.update({ displayName: newDisplayName })}
      />
    </Section>
  );
}
