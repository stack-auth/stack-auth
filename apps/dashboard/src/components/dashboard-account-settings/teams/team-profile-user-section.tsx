'use client';

import { Team, useUser } from "@hexclave/next";
import { EditableText } from "../editable-text";
import { Section } from "../section";

export function TeamUserProfileSection(props: { team: Team }) {
  const user = useUser({ or: 'redirect' });
  const profile = user.useTeamProfile(props.team);

  return (
    <Section
      title="Team user name"
      description="Overwrite your user display name in this team"
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
