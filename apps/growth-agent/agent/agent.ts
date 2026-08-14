import { defineAgent } from "eve";
import { getGrowthModelConfig } from "#lib/model.ts";

// Model selection: eve's default routing — a gateway model id string, served
// through the Vercel AI Gateway using the Vercel project's own identity (no
// API key to manage). This was an explicit decision (2026-08-04): we considered
// routing through OpenRouter to consolidate billing with the backend's model
// matrix, but that requires the extra `@openrouter/ai-sdk-provider` dependency
// (ai@7 ships no OpenAI-compatible provider factory), and the user chose to
// stay on eve's default instead. If OpenRouter is ever wanted later, add that
// dependency (supply-chain-audited, exact-pinned) and pass a LanguageModel
// instance from `createOpenRouter({ apiKey })` here.
//
// Both the model id and the gateway provider order are resolved in #lib/model.ts so the declared
// subagents (which inherit nothing from this agent) move with the root instead of drifting onto a
// stale hardcoded id. `HEXCLAVE_GROWTH_MODEL` and `HEXCLAVE_GROWTH_PROVIDER_ORDER` override each
// per deployment without a code change; see that file for why the provider order matters so much.
export default defineAgent({
  ...getGrowthModelConfig(),
});
