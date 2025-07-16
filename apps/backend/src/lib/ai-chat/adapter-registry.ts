import { Tool } from "ai";
import { type Tenancy } from "../tenancies";
import { emailTemplateAdapter } from "./email-template-adapter";
import { emailThemeAdapter } from "./email-theme-adapter";

export type ChatAdapterContext = {
  tenancy: Tenancy,
  threadId: string,
}

type ChatAdapter = {
  systemPrompt: string,
  tools: Record<string, Tool>,
}

type ContextType = "email-theme" | "email-template";

const CHAT_ADAPTERS: Record<ContextType, (context: ChatAdapterContext) => ChatAdapter> = {
  "email-theme": emailThemeAdapter,
  "email-template": emailTemplateAdapter,
};

export function getChatAdapter(contextType: string, tenancy: Tenancy, threadId: string): ChatAdapter | null {
  if (!Object.keys(CHAT_ADAPTERS).includes(contextType)) {
    return null;
  }
  const adapter = CHAT_ADAPTERS[contextType as ContextType];
  return adapter({ tenancy, threadId });
}
