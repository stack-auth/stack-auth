import { Team } from "../../..";
import { PageLayout } from "../page-layout";
import { LeaveTeamSection } from "./leave-team-section";
import { TeamApiKeysSection } from "./team-api-keys-section";
import { TeamDisplayNameSection } from "./team-display-name-section";
import { TeamMemberInvitationSection } from "./team-member-invitation-section";
import { TeamMemberListSection } from "./team-member-list-section";
import { TeamProfileImageSection } from "./team-profile-image-section";
import { TeamUserProfileSection } from "./team-profile-user-section";


export function TeamPage(props: { team: Team }) {
  return (
    <PageLayout>
      <TeamUserProfileSection key={`user-profile-${props.team.id}`} team={props.team} />
      <TeamProfileImageSection key={`profile-image-${props.team.id}`} team={props.team} />
      <TeamDisplayNameSection key={`display-name-${props.team.id}`} team={props.team} />
      <TeamMemberListSection key={`member-list-${props.team.id}`} team={props.team} />
      <TeamMemberInvitationSection key={`member-invitation-${props.team.id}`} team={props.team} />
      <TeamApiKeysSection key={`api-keys-${props.team.id}`} team={props.team} />
      <LeaveTeamSection key={`leave-team-${props.team.id}`} team={props.team} />
    </PageLayout>
  );
}
