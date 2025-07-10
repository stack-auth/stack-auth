const LightEmailTheme = `function EmailTheme({ children }: { children: React.ReactNode }) {
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


const DarkEmailTheme = `function EmailTheme({ children }: { children: React.ReactNode }) {
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

export const EMAIL_THEMES = {
  'default-light': LightEmailTheme,
  'default-dark': DarkEmailTheme,
} as const;
