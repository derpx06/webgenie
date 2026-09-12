import { HumanMessage } from '@langchain/core/messages';
import { getLlmCapabilities, speechToTextModelStore, type ProviderConfig } from '@extension/storage';
import { t } from '@extension/i18n';
import { createChatModel } from '../agent/helper';
import { invokeLLM } from '../agent/agents/base';

const TRANSCRIPTION_PROMPT = [
  'Transcribe the speech in this audio exactly.',
  '- Output only the transcribed text, with no commentary or formatting.',
  '- Keep the casing and punctuation as spoken.',
  '- If there is no speech, output nothing.',
].join('\n');

/** Transcribes recorded audio with the configured speech-to-text model. Any provider marked audio-capable works. */
export async function transcribeAudio(
  providers: Record<string, ProviderConfig>,
  base64Audio: string,
  mimeType = 'audio/webm',
): Promise<string> {
  const config = await speechToTextModelStore.getSpeechToTextModel();
  const provider = config?.provider ? providers[config.provider] : undefined;
  if (!config?.modelName || !provider || !getLlmCapabilities(provider.type ?? config.provider, config.modelName).audioInput) {
    throw new Error(t('chat_stt_model_notFound'));
  }

  const model = createChatModel(provider, {
    provider: config.provider,
    modelName: config.modelName,
    parameters: { temperature: 0.1, topP: 0.8 },
    reasoningEffort: 'minimal',
  });
  const message = new HumanMessage({
    content: [
      { type: 'text', text: TRANSCRIPTION_PROMPT },
      { type: 'media', data: base64Audio, mimeType },
    ],
  });
  const response = await invokeLLM(model, [message], { component: 'SpeechToText', model: config.modelName });
  return response.text.trim();
}
