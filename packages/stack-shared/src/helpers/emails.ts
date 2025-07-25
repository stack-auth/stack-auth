export const previewTemplateSource = `
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

export const DEFAULT_EMAIL_TEMPLATES = {
  "e7d009ce-8d47-4528-b245-5bf119f2ffa3": {
    "displayName": "Email Verification",
    "tsxSource": "import { type } from \"arktype\"\nimport { Button, Section, Hr } from \"@react-email/components\";\nimport { Subject, NotificationCategory } from \"@stackframe/emails\";\n\nexport const schema = type({\n  userDisplayName: \"string\",\n  projectDisplayName: \"string\",\n  emailVerificationLink: \"string\"\n})\n\nexport function EmailTemplate({ \n  userDisplayName, \n  projectDisplayName, \n  emailVerificationLink \n}: typeof schema.infer) \n{\n  return (\n    <>\n      <Subject value={`Verify your email at ${projectDisplayName}`} />\n      <NotificationCategory value=\"Transactional\" />\n      <div className=\"bg-white text-[#242424] font-sans text-base font-normal tracking-[0.15008px] leading-[1.5] m-0 py-8 w-full min-h-full\">\n        <Section className=\"bg-white\">\n          <h3 className=\"text-black font-sans font-bold text-[20px] text-center py-4 px-6 m-0\">\n            Verify your email at {projectDisplayName}\n          </h3>\n          <p className=\"text-[#474849] font-sans font-normal text-[14px] text-center pt-2 px-6 pb-4 m-0\">\n            Hi{userDisplayName ? (\", \" + userDisplayName) : ''}! Please click on the following button to verify your email.\n          </p>\n          <div className=\"text-center py-3 px-6\">\n            <Button\n              href={emailVerificationLink}\n              target=\"_blank\"\n              className=\"text-black font-sans font-bold text-[14px] inline-block bg-[#f0f0f0] rounded-[4px] py-3 px-5 no-underline border-0\"\n            >\n              Verify my email\n            </Button>\n          </div>\n          <div className=\"py-4 px-6\">\n            <Hr />\n          </div>\n          <p className=\"text-[#474849] font-sans font-normal text-[12px] text-center pt-1 px-6 pb-6 m-0\">\n            If you were not expecting this email, you can safely ignore it. \n          </p>\n        </Section>\n      </div>\n    </>\n  )\n}\n"
  },
  "a70fb3a4-56c1-4e42-af25-49d25603abd0": {
    "displayName": "Password Reset",
    "tsxSource": "import { type } from \"arktype\"\nimport { Button, Section, Hr } from \"@react-email/components\"\nimport { Subject, NotificationCategory } from \"@stackframe/emails\"\n\nexport const schema = type({\n  userDisplayName: \"string\",\n  projectDisplayName: \"string\",\n  passwordResetLink: \"string\"\n})\n\nexport function EmailTemplate({ userDisplayName, projectDisplayName, passwordResetLink }: typeof schema.infer) {\n  return (\n    <>\n      <Subject value={\"Reset your password at \" + projectDisplayName} />\n      <NotificationCategory value=\"Transactional\" />\n      <div className=\"bg-white text-[#242424] font-sans text-base font-normal tracking-tight leading-relaxed py-8 w-full min-h-full\">\n        <Section>\n          <h3 className=\"text-black bg-transparent font-sans font-bold text-[20px] text-center py-4 px-6 m-0\">\n            Reset your password at {projectDisplayName}\n          </h3>\n\n          <p className=\"text-[#474849] bg-transparent text-sm font-sans font-normal text-center pt-2 pb-4 px-6 m-0\">\n            Hi{userDisplayName ? (\", \" + userDisplayName) : \"\"}! Please click on the following button to start the password reset process.\n          </p>\n\n          <div className=\"bg-transparent text-center px-6 py-3\">\n            <Button\n              href={passwordResetLink}\n              className=\"text-black text-sm font-sans font-bold bg-[#f0f0f0] rounded-[4px] inline-block py-3 px-5 no-underline border-none\"\n              target=\"_blank\"\n            >\n              Reset my password\n            </Button>\n          </div>\n\n          <div className=\"px-6 py-4\">\n            <Hr />\n          </div>\n\n          <p className=\"text-[#474849] bg-transparent text-xs font-sans font-normal text-center pt-1 pb-6 px-6 m-0\">\n            If you were not expecting this email, you can safely ignore it.\n          </p>\n        </Section>\n      </div>\n    </>\n  )\n}\n"
  },
  "822687fe-8d0a-4467-a0d1-416b6e639478": {
    "displayName": "Magic Link/OTP",
    "tsxSource": "import React from 'react';\nimport { type } from 'arktype';\nimport { Section, Hr } from '@react-email/components';\nimport { Subject, NotificationCategory } from '@stackframe/emails';\n\nexport const schema = type({\n  userDisplayName: 'string',\n  projectDisplayName: 'string',\n  magicLink: 'string',\n  otp: 'string',\n});\n\nexport function EmailTemplate({ userDisplayName, projectDisplayName, magicLink, otp }: typeof schema.infer) {\n  return (\n    <>\n      <Subject value={\"Sign in to \" + projectDisplayName + \": Your code is \" + otp} />\n      <NotificationCategory value=\"Transactional\" />\n      <div className=\"bg-white text-[#242424] font-sans text-base font-normal tracking-[0.15008px] leading-6 m-0 py-8 w-full min-h-full\">\n        <Section className=\"mx-auto bg-white\">\n          <h3 className=\"text-black bg-transparent font-sans font-bold text-xl text-center px-6 py-4 m-0\">\n            Sign in to {projectDisplayName}\n          </h3>\n          <p className=\"text-[#474849] bg-transparent text-sm font-sans font-normal text-center px-6 py-4 m-0\">\n            Hi{userDisplayName ? \", \" + userDisplayName : \"\"}! This is your one-time-password for signing in:\n          </p>\n          <p className=\"text-black bg-transparent text-2xl font-mono font-bold text-center px-6 py-4 m-0\">\n            {otp}\n          </p>\n          <p className=\"text-black bg-transparent text-sm font-sans font-normal text-center px-6 py-4 m-0\">\n            Or you can click on{' '}\n            <a\n              key={20}\n              href={magicLink}\n              target=\"_blank\"\n              rel=\"noopener noreferrer\"\n              className=\"text-blue-600 underline\"\n            >\n              this link\n            </a>{' '}\n            to sign in\n          </p>\n          <Hr className=\"px-6 py-4 bg-transparent\" />\n          <p className=\"text-[#474849] bg-transparent text-xs font-sans font-normal text-center px-6 pt-1 pb-6 m-0\">\n            If you were not expecting this email, you can safely ignore it.\n          </p>\n        </Section>\n      </div>\n    </>\n  );\n}\n"
  },
  "066dd73c-36da-4fd0-b6d6-ebf87683f8bc": {
    "displayName": "Team Invitation",
    "tsxSource": "import { type } from \"arktype\";\nimport { Button, Section, Hr } from \"@react-email/components\";\nimport { Subject, NotificationCategory } from \"@stackframe/emails\";\n\n\nexport const schema = type({\n  userDisplayName: \"string\",\n  teamDisplayName: \"string\",\n  teamInvitationLink: \"string\"\n});\n\nexport function EmailTemplate({ userDisplayName, teamDisplayName, teamInvitationLink }: typeof schema.infer) {\n  return (\n    <>\n      <Subject value={\"You have been invited to join \" + teamDisplayName} />\n      <NotificationCategory value=\"Transactional\" />\n      <div className=\"bg-white text-[#242424] font-sans text-base font-normal tracking-[0.15008px] leading-[1.5] m-0 py-8 w-full min-h-full\">\n        <Section className=\"mx-auto max-w-lg bg-white\">\n          <h3 className=\"text-black bg-transparent font-sans font-bold text-xl text-center px-6 pt-8 m-0\">\n            You are invited to {teamDisplayName}\n          </h3>\n          <p className=\"text-[#474849] bg-transparent text-sm font-sans font-normal text-center px-6 pt-2 pb-4 m-0\">\n            Hi{userDisplayName ? \", \" + userDisplayName : \"\"}! Please click the button below to join the team {teamDisplayName}\n          </p>\n          <div className=\"bg-transparent text-center px-6 py-3\">\n            <Button\n              href={teamInvitationLink}\n              target=\"_blank\"\n              className=\"text-black text-sm font-sans font-bold bg-[#f0f0f0] rounded-md inline-block px-5 py-3 no-underline border-0\"\n            >\n              Join team\n            </Button>\n          </div>\n          <div className=\"px-6 py-4 bg-transparent\">\n            <Hr />\n          </div>\n          <p className=\"text-[#474849] bg-transparent text-xs font-sans font-normal text-center px-6 pb-6 pt-1 m-0\">\n            If you were not expecting this email, you can safely ignore it.\n          </p>\n        </Section>\n      </div>\n    </>\n  );\n}\n"
  },
  "e84de395-2076-4831-9c19-8e9a96a868e4": {
    "displayName": "Sign In Invitation",
    "tsxSource": "import { type } from \"arktype\"\nimport { Button, Section, Hr } from \"@react-email/components\";\nimport { Subject, NotificationCategory } from \"@stackframe/emails\";\n\nexport const schema = type({\n  userDisplayName: \"string\",\n  projectDisplayName: \"string\",\n  signInInvitationLink: \"string\",\n  teamDisplayName: \"string\"\n})\n\nexport function EmailTemplate({\n  userDisplayName,\n  projectDisplayName,\n  signInInvitationLink,\n  teamDisplayName\n}: typeof schema.infer) {\n  return (\n    <>\n      <Subject\n        value={\"You have been invited to sign in to \" + projectDisplayName}\n      />\n      <NotificationCategory value=\"Transactional\" />\n\n      <div className=\"bg-white text-gray-900 font-sans text-base font-normal leading-normal w-full min-h-full m-0 py-8\">\n        <Section>\n          <h3 className=\"text-black bg-transparent font-sans font-bold text-xl text-center pt-8 px-6 m-0\">\n            You are invited to sign in to {teamDisplayName}\n          </h3>\n\n          <p className=\"text-gray-700 bg-transparent text-sm font-sans font-normal text-center pt-2 pb-4 px-6 m-0\">\n            Hi\n            {userDisplayName ? \", \" + userDisplayName : \"\"}! Please click on the following\n            link to sign in to your account\n          </p>\n\n          <div className=\"bg-transparent text-center px-6 py-3\">\n            <Button\n              href={signInInvitationLink}\n              className=\"text-black text-sm font-sans font-bold bg-gray-200 rounded-md inline-block py-3 px-5 no-underline border-none\"\n              target=\"_blank\"\n            >\n              Sign in\n            </Button>\n          </div>\n\n          <div className=\"px-6 py-4 bg-transparent\">\n            <Hr />\n          </div>\n\n          <p className=\"text-gray-700 bg-transparent text-xs font-sans font-normal text-center pt-1 pb-6 px-6 m-0\">\n            If you were not expecting this email, you can safely ignore it.\n          </p>\n        </Section>\n      </div>\n    </>\n  )\n}\n"
  }
};
