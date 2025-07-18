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
    displayName: 'default-light',
    tsxSource: LightEmailTheme,
  },
  "a0172b5d-cff0-463b-83bb-85124697373a": {
    displayName: 'default-dark',
    tsxSource: DarkEmailTheme,
  },
};

