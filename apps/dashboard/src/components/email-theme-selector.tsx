import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@stackframe/stack-ui";

type EmailThemeSelectorProps = {
  selectedThemeId: string | undefined | false,
  onThemeChange: (themeId: string | undefined | false) => void,
  className?: string,
}

function themeIdToSelectString(themeId: string | undefined | false): string {
  return JSON.stringify(themeId ?? null);
}
function selectStringToThemeId(value: string): string | undefined | false {
  return JSON.parse(value) ?? undefined;
}

export function EmailThemeSelector({ selectedThemeId, onThemeChange, className }: EmailThemeSelectorProps) {
  const stackAdminApp = useAdminApp();
  const themes = stackAdminApp.useEmailThemes();
  return (
    <Select
      value={themeIdToSelectString(selectedThemeId)}
      onValueChange={(value) => onThemeChange(selectStringToThemeId(value))}
    >
      <SelectTrigger className={className}>
        <SelectValue placeholder="No theme" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={"false"}>No theme</SelectItem>
        <SelectItem value={"null"}>Project theme</SelectItem>
        {themes.map((theme) => (
          <SelectItem key={theme.id} value={JSON.stringify(theme.id)}>
            {theme.displayName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
