import { Tool } from "ai";
import { type Tenancy } from "../tenancies";
import { emailTemplateAdapter } from "./email-template-adapter";
import { emailThemeAdapter } from "./email-theme-adapter";
import { emailDraftAdapter } from "./email-draft-adapter";

export type ChatAdapterContext = {
  tenancy: Tenancy,
  threadId: string,
}

type ChatAdapter = {
  systemPrompt: string,
  tools: Record<string, Tool>,
}

type ContextType = "email-theme" | "email-template" | "email-draft";

const CHAT_ADAPTERS: Record<ContextType, (context: ChatAdapterContext) => ChatAdapter> = {
  "email-theme": emailThemeAdapter,
  "email-template": emailTemplateAdapter,
  "email-draft": emailDraftAdapter,
};

export function getChatAdapter(contextType: ContextType, tenancy: Tenancy, threadId: string): ChatAdapter {
  const adapter = CHAT_ADAPTERS[contextType];
  return adapter({ tenancy, threadId });
}
