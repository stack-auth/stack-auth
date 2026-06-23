import * as ai from "ai";
import { wrapAiSdk } from "@voker/voker/ai/provider-aisdk";
import { VokerClient } from "@voker/voker";

const wrappedAi = wrapAiSdk(ai);

export const vokerGenerateText = wrappedAi.generateText;

export const vokerClient = new VokerClient();
