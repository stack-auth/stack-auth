import { DraftThemeMode } from "@/generated/prisma/client";
import { PrismaClientTransaction } from "@/prisma-client";

export async function getEmailDraft(prisma: PrismaClientTransaction, tenancyId: string, draftId: string) {
  const draft = await prisma.emailDraft.findUnique({
    where: {
      tenancyId_id: {
        tenancyId,
        id: draftId
      }
    },
  });
  return draft;
}

export const templateThemeIdToThemeMode = (themeId: string | false | undefined): DraftThemeMode => {
  if (themeId === undefined) {
    return DraftThemeMode.PROJECT_DEFAULT;
  }
  if (themeId === false) {
    return DraftThemeMode.NONE;
  }
  return DraftThemeMode.CUSTOM;
};

export const themeModeToTemplateThemeId = (themeMode: DraftThemeMode, themeId: string | null): string | false | undefined => {
  if (themeMode === DraftThemeMode.PROJECT_DEFAULT) {
    return undefined;
  }
  if (themeMode === DraftThemeMode.NONE) {
    return false;
  }
  return themeId === null ? undefined : themeId;
};
