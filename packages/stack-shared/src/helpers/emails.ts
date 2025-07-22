const LightEmailTheme = `import { Html, Tailwind, Body } from '@react-email/components';
function EmailTheme({ children }: { children: React.ReactNode }) {
  return (
    <Html>
      <Tailwind>
        <Body>
          <div className="bg-white text-slate-800 p-4 rounded-lg max-w-[600px] mx-auto leading-relaxed">
            {children}
          </div>
        </Body>
      </Tailwind>
    </Html>
  );
}`;


const DarkEmailTheme = `import { Html, Tailwind, Body } from '@react-email/components';
function EmailTheme({ children }: { children: React.ReactNode }) {
  return (
    <Html>
      <Tailwind>
        <Body>
          <div className="bg-slate-900 text-slate-100 p-4 rounded-lg max-w-[600px] mx-auto leading-relaxed">
            {children}
          </div>
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
    displayName: "Email Verification",
    description: "Will be sent to the user when they sign-up with email/password",
    variables: ["projectDisplayName"],
    subject: "Welcome to {{ projectDisplayName }}",
    tsxSource: "export function EmailTemplate({ projectDisplayName }) {\n  return <div>Email Verification for { projectDisplayName }</div>; \n}",
  },
  // "a70fb3a4-56c1-4e42-af25-49d25603abd0": {

  // },
  // "822687fe-8d0a-4467-a0d1-416b6e639478": {

  // },
  // "066dd73c-36da-4fd0-b6d6-ebf87683f8bc": {

  // },
  // "e84de395-2076-4831-9c19-8e9a96a868e4": {

  // },
};
