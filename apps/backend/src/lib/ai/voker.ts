import * as ai from "ai";
import { wrapAiSdk } from "@voker/voker/ai/provider-aisdk";
import { VokerClient } from "@voker/voker";

let _wrappedAi: ReturnType<typeof wrapAiSdk> | null = null;
function getWrappedAi() {
  if (!_wrappedAi) {
    _wrappedAi = wrapAiSdk(ai);
  }
  return _wrappedAi;
}

export function vokerGenerateText(
  ...args: Parameters<ReturnType<typeof wrapAiSdk>["generateText"]>
) {
  return getWrappedAi().generateText(...args);
}

let _vokerClient: VokerClient | null = null;

export function getVokerClient(): VokerClient {
  if (!_vokerClient) {
    _vokerClient = new VokerClient();
  }
  return _vokerClient;
}
