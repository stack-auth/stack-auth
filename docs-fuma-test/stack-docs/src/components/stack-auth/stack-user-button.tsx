import { UserButton } from '@stackframe/stack';
import { StackContainer } from '../mdx';

const mockUser = {
  displayName: "John Doe",
  primaryEmail: "john.doe@example.com",
  profileImageUrl: undefined,
};

export function StackUserButton() {
  return (
    <StackContainer color="blue" size="small">
      <UserButton mockUser={mockUser} />
    </StackContainer>
  );
}
