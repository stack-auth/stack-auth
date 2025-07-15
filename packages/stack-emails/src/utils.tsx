import { Body, Head, Html, Preview } from "@react-email/components";
import { render } from "@react-email/render";
import { typedFromEntries } from "@stackframe/stack-shared/dist/utils/objects";
import * as Handlebars from 'handlebars/dist/handlebars.js';
import { EditorBlockSchema, TEditorConfiguration } from "./editor/documents/editor/core";
import { Reader } from "./editor/email-builder/index";
import { emailVerificationTemplate } from "./templates/email-verification";
import { magicLinkTemplate } from "./templates/magic-link";
import { magicLinkTemplateOld } from "./templates/magic-link-old";
import { passwordResetTemplate } from "./templates/password-reset";
import { signInInvitationTemplate } from "./templates/sign-in-invitation";
import { teamInvitationTemplate } from "./templates/team-invitation";


const userVars = [
  { name: 'userDisplayName', label: 'User Display Name', defined: false, example: 'John Doe' },
] as const;

const projectVars = [
  { name: 'projectDisplayName', label: 'Project Name', defined: true, example: '{{ projectDisplayName }}' },
];

export type EmailTemplateVariable = {
  name: string,
  label: string,
  defined: boolean,
  example: string,
};

export type EmailTemplateMetadata = {
  label: string,
  description: string,
  defaultContent: { 1: TEditorConfiguration, 2: TEditorConfiguration },
  defaultSubject: string,
  variables: EmailTemplateVariable[],
};

export const EMAIL_TEMPLATES_METADATA = {
  'email_verification': {
    label: "Email Verification",
    description: "Will be sent to the user when they sign-up with email/password",
    defaultContent: { 1: emailVerificationTemplate, 2: emailVerificationTemplate },
    defaultSubject: "Verify your email at {{ projectDisplayName }}",
    variables: [
      ...userVars,
      ...projectVars,
      { name: 'emailVerificationLink', label: 'Email Verification Link', defined: true, example: '<email verification link>' },
    ],
  },
  'password_reset': {
    label: "Password Reset",
    description: "Will be sent to the user when they request to reset their password (forgot password)",
    defaultContent: { 1: passwordResetTemplate, 2: passwordResetTemplate },
    defaultSubject: "Reset your password at {{ projectDisplayName }}",
    variables: [
      ...userVars,
      ...projectVars,
      { name: 'passwordResetLink', label: 'Reset Password Link', defined: true, example: '<reset password link>' },
    ],
  },
  'magic_link': {
    label: "Magic Link/OTP",
    description: "Will be sent to the user when they try to sign-up with magic link",
    defaultContent: { 1: magicLinkTemplateOld, 2: magicLinkTemplate },
    defaultSubject: "Sign in to {{ projectDisplayName }}: Your code is {{ otp }}",
    variables: [
      ...userVars,
      ...projectVars,
      { name: 'magicLink', label: 'Magic Link', defined: true, example: '<magic link>' },
      { name: 'otp', label: 'OTP', defined: true, example: '3SLSWZ' },
    ],
  },
  'team_invitation': {
    label: "Team Invitation",
    description: "Will be sent to the user when they are invited to a team",
    defaultContent: { 1: teamInvitationTemplate, 2: teamInvitationTemplate },
    defaultSubject: "You have been invited to join {{ teamDisplayName }}",
    variables: [
      ...userVars,
      ...projectVars,
      { name: 'teamDisplayName', label: 'Team Display Name', defined: true, example: 'My Team' },
      { name: 'teamInvitationLink', label: 'Team Invitation Link', defined: true, example: '<team invitation link>' },
    ],
  },
  'sign_in_invitation': {
    label: "Sign In Invitation",
    description: "Will be sent to the user when they are invited to sign in",
    defaultContent: { 1: signInInvitationTemplate, 2: signInInvitationTemplate },
    defaultSubject: "You have been invited to sign in to {{ projectDisplayName }}",
    variables: [
      ...userVars,
      ...projectVars,
      { name: 'signInInvitationLink', label: 'Sign In Invitation Link', defined: true, example: '<sign in invitation link>' },
    ],
  }
} as const satisfies Record<string, EmailTemplateMetadata>;

export function validateEmailTemplateContent(content: any): content is TEditorConfiguration {
  try {
    for (const key of Object.keys(content)) {
      const block = content[key];
      EditorBlockSchema.parse(block);
    }
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

type NestedObject = { [key: string]: any };

export function objectStringMap<T extends NestedObject>(obj: T, func: (s: string) => string): T {
  function mapStrings(obj: NestedObject): NestedObject {
    const result: NestedObject = Array.isArray(obj) ? [] : {};

    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const value = obj[key];

        if (typeof value === 'string') {
          result[key] = func(value);
        } else if (typeof value === 'object' && value !== null) {
          result[key] = mapStrings(value);
        } else {
          result[key] = value;
        }
      }
    }

    return result;
  }

  return mapStrings(obj) as T;
}

function renderString(str: string, variables: Record<string, string | null>) {
  try {
    return Handlebars.compile(str, { noEscape: true })(variables);
  } catch (e) {
    return str;
  }
}

export function convertEmailTemplateMetadataExampleValues(
  metadata: EmailTemplateMetadata,
  projectDisplayName: string,
): EmailTemplateMetadata {
  const variables = metadata.variables.map((variable) => {
    return {
      ...variable,
      example: renderString(variable.example, { projectDisplayName }),
    };
  });
  return {
    ...metadata,
    variables,
  };
}

export function convertEmailTemplateVariables(
  content: TEditorConfiguration,
  variables: EmailTemplateVariable[],
): TEditorConfiguration {
  const vars = typedFromEntries(variables.map((variable) => [variable.name, variable.example]));
  return objectStringMap(content, (str) => {
    return renderString(str, vars);
  });
}

export function convertEmailSubjectVariables(
  subject: string,
  variables: EmailTemplateVariable[],
): string {
  const vars = typedFromEntries(variables.map((variable) => [variable.name, variable.example]));
  return renderString(subject, vars);
}

export function renderEmailTemplate(
  subject: string,
  content: TEditorConfiguration,
  variables: Record<string, string | null>,
) {
  const mergedTemplate = objectStringMap(content, (str) => {
    return renderString(str, variables);
  });
  const mergedSubject = renderString(subject, variables);

  const component = (
    <Html>
      <Head></Head>
      <Preview>{mergedSubject}</Preview>
      <Body>
        <Reader document={mergedTemplate} rootBlockId='root' />
      </Body>
    </Html>
  );
  const html = render(component);
  const text = render(component, { plainText: true });

  return { html, text, subject: mergedSubject };
}
