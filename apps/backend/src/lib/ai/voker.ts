import { VokerClient } from "@voker/voker";

let _vokerClient: VokerClient | null = null;

export function getVokerClient(): VokerClient {
  if (!_vokerClient) {
    _vokerClient = new VokerClient();
  }
  return _vokerClient;
}

/**
 * Build an OpenAI-compatible chat completion response dict from the final
 * streamed/generated text. Voker's event API requires `output` to be a dict
 * matching the provider response schema — a plain string causes a 500.
 */
export function buildChatCompletionOutput(text: string, modelId: string): Record<string, unknown> {
  return {
    id: `chatcmpl-${crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [{
      index: 0,
      message: { role: "assistant", content: text },
      finish_reason: "stop",
    }],
  };
}
