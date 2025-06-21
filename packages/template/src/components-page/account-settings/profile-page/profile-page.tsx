import { ProfileImageEditor } from "../../../components/profile-image-editor";
import { useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";
import { EditableText } from "../editable-text";
import { PageLayout } from "../page-layout";
import { Section } from "../section";

export function ProfilePage(props?: {
  mockUser?: {
    displayName?: string,
    profileImageUrl?: string,
  },
}) {
  const { t } = useTranslation();
  const userFromHook = useUser({ or: props?.mockUser ? 'return-null' : 'redirect' });

  // Use mock data if provided, otherwise use real user
  const user = props?.mockUser ? {
    displayName: props.mockUser.displayName || 'John Doe',
    profileImageUrl: props.mockUser.profileImageUrl || null,
    update: async () => {
      // Mock update - do nothing in demo mode
      console.log('Mock update called');
    }
  } : userFromHook;

  if (!user) {
    return null; // This shouldn't happen in practice
  }

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
          user={user as any}
          onProfileImageUrlChange={async (profileImageUrl: string | null) => {
            await user.update({ profileImageUrl });
          }}
        />
      </Section>
    </PageLayout>
  );
}
