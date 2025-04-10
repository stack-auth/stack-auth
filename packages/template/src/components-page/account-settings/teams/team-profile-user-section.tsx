import { Team } from "../../..";
import { useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";
import { EditableText } from "../editable-text";
import { Section } from "../section";

export function TeamUserProfileSection(props: { team: Team }) {
  const { t } = useTranslation();
  const user = useUser({ or: 'redirect' });
  const profile = user.useTeamProfile(props.team);

  return (
    <Section
      title={t("Team user name")}
      description={t("Overwrite your user display name in this team")}
    >
      <EditableText
        value={profile.displayName || ''}
        onSave={async (newDisplayName) => {
          await profile.update({ displayName: newDisplayName });
        }}
      />
    </Section>
  );
}
