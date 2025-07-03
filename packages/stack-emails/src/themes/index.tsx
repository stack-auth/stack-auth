type EmailThemeProps = {
  children: React.ReactNode,
}

export function LightEmailTheme({ children }: EmailThemeProps) {
  return (
    <div className="bg-white text-slate-800 p-4 rounded-lg max-w-[600px] mx-auto leading-relaxed">
      {children}
    </div>
  );
}

export function DarkEmailTheme({ children }: EmailThemeProps) {
  return (
    <div className="bg-slate-900 text-slate-100 p-4 rounded-lg max-w-[600px] mx-auto leading-relaxed">
      {children}
    </div>
  );
}
