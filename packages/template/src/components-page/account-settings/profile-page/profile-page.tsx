import { ProfileImageEditor } from "../../../components/profile-image-editor";
import { useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";
import { EditableText } from "../editable-text";
import { PageLayout } from "../page-layout";
import { Section } from "../section";

export function ProfilePage() {
  const { t } = useTranslation();
  const user = useUser({ or: 'redirect' });

  return (
    <PageLayout>
      <Section
        title={t("User name")}
        description={t("This is a display name and is not used for authentication")}
      >
        <EditableText
          value={user.displayName || ''}
          onSave={async (newDisplayName) => {
            await user.update({ displayName: newDisplayName });
          }}/>
      </Section>

      <Section
        title={t("Profile image")}
        description={t("Upload your own image as your avatar")}
      >
        <ProfileImageEditor
          user={user}
          onProfileImageUrlChange={async (profileImageUrl) => {
            await user.update({ profileImageUrl });
          }}
        />
      </Section>
    </PageLayout>
  );
}
