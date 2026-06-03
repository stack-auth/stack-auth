'use client';

import { Team, useUser } from "@hexclave/next";
import { EditableText } from "../editable-text";
import { Section } from "../section";

export function TeamDisplayNameSection(props: { team: Team }) {
  const user = useUser({ or: 'redirect' });
  const updateTeamPermission = user.usePermission(props.team, '$update_team');

  if (!updateTeamPermission) {
    return null;
  }

  return (
    <Section
      title="Team display name"
      description="Change the display name of your team"
    >
      <EditableText
        value={props.team.displayName}
        onSave={async (newDisplayName) => await props.team.update({ displayName: newDisplayName })}
      />
    </Section>
  );
}
