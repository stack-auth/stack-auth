import { Team } from "../../..";
import { ProfileImageEditor } from "../../../components/profile-image-editor";
import { useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";
import { Section } from "../section";

export function TeamProfileImageSection(props: { team: Team }) {
  const { t } = useTranslation();
  const user = useUser({ or: 'redirect' });
  const updateTeamPermission = user.usePermission(props.team, '$update_team');

  if (!updateTeamPermission) {
    return null;
  }

  return (
    <Section
      title={t("Team profile image")}
      description={t("Upload an image for your team")}
    >
      <ProfileImageEditor
        user={props.team}
        onProfileImageUrlChange={async (profileImageUrl) => {
          await props.team.update({ profileImageUrl });
        }}
      />
    </Section>
  );
}
