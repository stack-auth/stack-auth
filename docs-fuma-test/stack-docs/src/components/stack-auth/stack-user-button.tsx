import { UserButton } from "@stackframe/stack";
import { StackContainer } from "../mdx";


export function StackUserButton() {
  return (
    <StackContainer color="amber" size="small">
    <UserButton 
      showUserInfo={true}
      mockUser={{
        displayName: "John Doe",
        primaryEmail: "john.doe@example.com",
        profileImageUrl: undefined,
      }}
    />
    </StackContainer>
  )
}
