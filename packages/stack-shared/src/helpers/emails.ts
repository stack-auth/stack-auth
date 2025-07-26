export const previewTemplateSource = `
  export const variablesSchema = v => v;
  export function EmailTemplate() {
    return (
      <div>
      <h2 className="mb-4 text-2xl font-bold">
        Header text
      </h2>
      <p className="mb-4">
        Body text content with some additional information.
        </p>
      </div>
    );
  }
`;

export const emptyEmailTheme = `import { Html, Tailwind, Body } from '@react-email/components';
export function EmailTheme({ children }: { children: React.ReactNode }) {
  return (
    <Html>
      <Tailwind>
        <Body>
          {children}
        </Body>
      </Tailwind>
    </Html>
  );
}`;

export const LightEmailTheme = `import { Html, Head, Tailwind, Body, Container } from '@react-email/components';

export function EmailTheme({ children }: { children: React.ReactNode }) {
  return (
    <Html>
      <Head />
      <Tailwind>
        <Body className="bg-[#fafbfb] font-sans text-base">
          <Container className="bg-white p-[45px] rounded-lg">
            {children}
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}`;


const DarkEmailTheme = `import { Html, Head, Tailwind, Body, Container } from '@react-email/components';

export function EmailTheme({ children }: { children: React.ReactNode }) {
  return (
    <Html>
      <Head />
      <Tailwind>
        <Body className="bg-[#323232] font-sans text-white">
          <Container className="bg-black p-[45px] rounded-lg">
            {children}
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}`;


export const DEFAULT_EMAIL_THEME_ID = "1df07ae6-abf3-4a40-83a5-a1a2cbe336ac";

export const DEFAULT_EMAIL_THEMES = {
  [DEFAULT_EMAIL_THEME_ID]: {
    displayName: 'Default Light',
    tsxSource: LightEmailTheme,
  },
  "a0172b5d-cff0-463b-83bb-85124697373a": {
    displayName: 'Default Dark',
    tsxSource: DarkEmailTheme,
  },
};

const EMAIL_TEMPLATE_EMAIL_VERIFICATION_ID = "e7d009ce-8d47-4528-b245-5bf119f2ffa3";
const EMAIL_TEMPLATE_PASSWORD_RESET_ID = "a70fb3a4-56c1-4e42-af25-49d25603abd0";
const EMAIL_TEMPLATE_MAGIC_LINK_ID = "822687fe-8d0a-4467-a0d1-416b6e639478";
const EMAIL_TEMPLATE_TEAM_INVITATION_ID = "e84de395-2076-4831-9c19-8e9a96a868e4";
const EMAIL_TEMPLATE_SIGN_IN_INVITATION_ID = "066dd73c-36da-4fd0-b6d6-ebf87683f8bc";

export const DEFAULT_EMAIL_TEMPLATES = {
  [EMAIL_TEMPLATE_EMAIL_VERIFICATION_ID]: {
    "displayName": "Email Verification",
    "tsxSource": "import { type } from \"arktype\"\nimport { Button, Section, Hr } from \"@react-email/components\";\nimport { Subject, NotificationCategory, Props } from \"@stackframe/emails\";\n\nexport const variablesSchema = type({\n  emailVerificationLink: \"string\"\n})\n\nexport function EmailTemplate({ user, project, variables }: Props<typeof variablesSchema.infer>) {\n  return (\n    <>\n      <Subject value={`Verify your email at ${project.displayName}`} />\n      <NotificationCategory value=\"Transactional\" />\n      <div className=\"bg-white text-[#242424] font-sans text-base font-normal tracking-[0.15008px] leading-[1.5] m-0 py-8 w-full min-h-full\">\n        <Section className=\"bg-white\">\n          <h3 className=\"text-black font-sans font-bold text-[20px] text-center py-4 px-6 m-0\">\n            Verify your email at {project.displayName}\n          </h3>\n          <p className=\"text-[#474849] font-sans font-normal text-[14px] text-center pt-2 px-6 pb-4 m-0\">\n            Hi{user.displayName ? (\", \" + user.displayName) : ''}! Please click on the following button to verify your email.\n          </p>\n          <div className=\"text-center py-3 px-6\">\n            <Button\n              href={variables.emailVerificationLink}\n              target=\"_blank\"\n              className=\"text-black font-sans font-bold text-[14px] inline-block bg-[#f0f0f0] rounded-[4px] py-3 px-5 no-underline border-0\"\n            >\n              Verify my email\n            </Button>\n          </div>\n          <div className=\"py-4 px-6\">\n            <Hr />\n          </div>\n          <p className=\"text-[#474849] font-sans font-normal text-[12px] text-center pt-1 px-6 pb-6 m-0\">\n            If you were not expecting this email, you can safely ignore it. \n          </p>\n        </Section>\n      </div>\n    </>\n  )\n}\n\nEmailTemplate.PreviewVariables = {\n  emailVerificationLink: \"<email verification link>\"\n} satisfies typeof variablesSchema.infer"
  },
  [EMAIL_TEMPLATE_PASSWORD_RESET_ID]: {
    "displayName": "Password Reset",
    "tsxSource": "import { type } from \"arktype\"\nimport { Button, Section, Hr } from \"@react-email/components\"\nimport { Subject, NotificationCategory, Props} from \"@stackframe/emails\"\n\nexport const variablesSchema = type({\n  passwordResetLink: \"string\"\n})\n\nexport function EmailTemplate({ user, project, variables }: Props<typeof variablesSchema.infer>) {\n  return (\n    <>\n      <Subject value={\"Reset your password at \" + project.displayName} />\n      <NotificationCategory value=\"Transactional\" />\n      <div className=\"bg-white text-[#242424] font-sans text-base font-normal tracking-tight leading-relaxed py-8 w-full min-h-full\">\n        <Section>\n          <h3 className=\"text-black bg-transparent font-sans font-bold text-[20px] text-center py-4 px-6 m-0\">\n            Reset your password at {project.displayName}\n          </h3>\n\n          <p className=\"text-[#474849] bg-transparent text-sm font-sans font-normal text-center pt-2 pb-4 px-6 m-0\">\n            Hi{user.displayName ? (\", \" + user.displayName) : \"\"}! Please click on the following button to start the password reset process.\n          </p>\n\n          <div className=\"bg-transparent text-center px-6 py-3\">\n            <Button\n              href={variables.passwordResetLink}\n              className=\"text-black text-sm font-sans font-bold bg-[#f0f0f0] rounded-[4px] inline-block py-3 px-5 no-underline border-none\"\n              target=\"_blank\"\n            >\n              Reset my password\n            </Button>\n          </div>\n\n          <div className=\"px-6 py-4\">\n            <Hr />\n          </div>\n\n          <p className=\"text-[#474849] bg-transparent text-xs font-sans font-normal text-center pt-1 pb-6 px-6 m-0\">\n            If you were not expecting this email, you can safely ignore it.\n          </p>\n        </Section>\n      </div>\n    </>\n  )\n}\n\nEmailTemplate.PreviewVariables = {\n   passwordResetLink: \"<password reset link>\"\n} satisfies typeof variablesSchema.infer"
  },
  [EMAIL_TEMPLATE_MAGIC_LINK_ID]: {
    "displayName": "Magic Link/OTP",
    "tsxSource": "import { type } from 'arktype';\nimport { Section, Hr } from '@react-email/components';\nimport { Subject, NotificationCategory, Props } from '@stackframe/emails';\n\nexport const variablesSchema = type({\n  magicLink: 'string',\n  otp: 'string',\n});\n\nexport function EmailTemplate({ user, project, variables }: Props<typeof variablesSchema.infer>) {\n  return (\n    <>\n      <Subject value={\"Sign in to \" + project.displayName + \": Your code is \" + variables.otp} />\n      <NotificationCategory value=\"Transactional\" />\n      <div className=\"bg-white text-[#242424] font-sans text-base font-normal tracking-[0.15008px] leading-6 m-0 py-8 w-full min-h-full\">\n        <Section className=\"mx-auto bg-white\">\n          <h3 className=\"text-black bg-transparent font-sans font-bold text-xl text-center px-6 py-4 m-0\">\n            Sign in to {project.displayName}\n          </h3>\n          <p className=\"text-[#474849] bg-transparent text-sm font-sans font-normal text-center px-6 py-4 m-0\">\n            Hi{user.displayName ? \", \" + user.displayName : \"\"}! This is your one-time-password for signing in:\n          </p>\n          <p className=\"text-black bg-transparent text-2xl font-mono font-bold text-center px-6 py-4 m-0\">\n            {variables.otp}\n          </p>\n          <p className=\"text-black bg-transparent text-sm font-sans font-normal text-center px-6 py-4 m-0\">\n            Or you can click on{' '}\n            <a\n              key={20}\n              href={variables.magicLink}\n              target=\"_blank\"\n              rel=\"noopener noreferrer\"\n              className=\"text-blue-600 underline\"\n            >\n              this link\n            </a>{' '}\n            to sign in\n          </p>\n          <Hr className=\"px-6 py-4 bg-transparent\" />\n          <p className=\"text-[#474849] bg-transparent text-xs font-sans font-normal text-center px-6 pt-1 pb-6 m-0\">\n            If you were not expecting this email, you can safely ignore it.\n          </p>\n        </Section>\n      </div>\n    </>\n  );\n}\n\nEmailTemplate.PreviewVariables = {\n  magicLink: \"<magic link>\",\n  otp: \"3SLSWZ\"\n} satisfies typeof variablesSchema.infer"
  },
  [EMAIL_TEMPLATE_TEAM_INVITATION_ID]: {
    "displayName": "Team Invitation",
    "tsxSource": "import { type } from \"arktype\";\nimport { Button, Section, Hr } from \"@react-email/components\";\nimport { Subject, NotificationCategory, Props } from \"@stackframe/emails\";\n\n\nexport const variablesSchema = type({\n  teamDisplayName: \"string\",\n  teamInvitationLink: \"string\"\n});\n\nexport function EmailTemplate({ user, variables }: Props<typeof variablesSchema.infer>) {\n  return (\n    <>\n      <Subject value={\"You have been invited to join \" + variables.teamDisplayName} />\n      <NotificationCategory value=\"Transactional\" />\n      <div className=\"bg-white text-[#242424] font-sans text-base font-normal tracking-[0.15008px] leading-[1.5] m-0 py-8 w-full min-h-full\">\n        <Section className=\"mx-auto max-w-lg bg-white\">\n          <h3 className=\"text-black bg-transparent font-sans font-bold text-xl text-center px-6 pt-8 m-0\">\n            You are invited to {variables.teamDisplayName}\n          </h3>\n          <p className=\"text-[#474849] bg-transparent text-sm font-sans font-normal text-center px-6 pt-2 pb-4 m-0\">\n            Hi{user.displayName ? \", \" + user.displayName : \"\"}! Please click the button below to join the team {variables.teamDisplayName}\n          </p>\n          <div className=\"bg-transparent text-center px-6 py-3\">\n            <Button\n              href={variables.teamInvitationLink}\n              target=\"_blank\"\n              className=\"text-black text-sm font-sans font-bold bg-[#f0f0f0] rounded-md inline-block px-5 py-3 no-underline border-0\"\n            >\n              Join team\n            </Button>\n          </div>\n          <div className=\"px-6 py-4 bg-transparent\">\n            <Hr />\n          </div>\n          <p className=\"text-[#474849] bg-transparent text-xs font-sans font-normal text-center px-6 pb-6 pt-1 m-0\">\n            If you were not expecting this email, you can safely ignore it.\n          </p>\n        </Section>\n      </div>\n    </>\n  );\n}\n\nEmailTemplate.PreviewVariables = {\n  teamDisplayName: \"My Team\",\n  teamInvitationLink: \"<team invitation link>\"\n} satisfies typeof variablesSchema.infer "
  },
  [EMAIL_TEMPLATE_SIGN_IN_INVITATION_ID]: {
    "displayName": "Sign In Invitation",
    "tsxSource": "import { type } from \"arktype\"\nimport { Button, Section, Hr } from \"@react-email/components\";\nimport { Subject, NotificationCategory, Props } from \"@stackframe/emails\";\n\nexport const variablesSchema = type({\n  signInInvitationLink: \"string\",\n  teamDisplayName: \"string\"\n})\n\nexport function EmailTemplate({ user, project, variables }: Props<typeof variablesSchema.infer>) {\n  return (\n    <>\n      <Subject\n        value={\"You have been invited to sign in to \" + project.displayName}\n      />\n      <NotificationCategory value=\"Transactional\" />\n\n      <div className=\"bg-white text-gray-900 font-sans text-base font-normal leading-normal w-full min-h-full m-0 py-8\">\n        <Section>\n          <h3 className=\"text-black bg-transparent font-sans font-bold text-xl text-center pt-8 px-6 m-0\">\n            You are invited to sign in to {variables.teamDisplayName}\n          </h3>\n\n          <p className=\"text-gray-700 bg-transparent text-sm font-sans font-normal text-center pt-2 pb-4 px-6 m-0\">\n            Hi\n            {user.displayName ? \", \" + user.displayName : \"\"}! Please click on the following\n            link to sign in to your account\n          </p>\n\n          <div className=\"bg-transparent text-center px-6 py-3\">\n            <Button\n              href={variables.signInInvitationLink}\n              className=\"text-black text-sm font-sans font-bold bg-gray-200 rounded-md inline-block py-3 px-5 no-underline border-none\"\n              target=\"_blank\"\n            >\n              Sign in\n            </Button>\n          </div>\n\n          <div className=\"px-6 py-4 bg-transparent\">\n            <Hr />\n          </div>\n\n          <p className=\"text-gray-700 bg-transparent text-xs font-sans font-normal text-center pt-1 pb-6 px-6 m-0\">\n            If you were not expecting this email, you can safely ignore it.\n          </p>\n        </Section>\n      </div>\n    </>\n  )\n}\n\nEmailTemplate.PreviewVariables = {\n  signInInvitationLink: \"<sign in invitation link>\",\n  teamDisplayName: \"My Team\"\n} satisfies typeof variablesSchema.infer"
  }
};

export const DEFAULT_TEMPLATE_IDS = {
  email_verification: EMAIL_TEMPLATE_EMAIL_VERIFICATION_ID,
  password_reset: EMAIL_TEMPLATE_PASSWORD_RESET_ID,
  magic_link: EMAIL_TEMPLATE_MAGIC_LINK_ID,
  team_invitation: EMAIL_TEMPLATE_TEAM_INVITATION_ID,
  sign_in_invitation: EMAIL_TEMPLATE_SIGN_IN_INVITATION_ID,
} as const;
