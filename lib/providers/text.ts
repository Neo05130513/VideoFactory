import { generateTextWithOpenAI, isOpenAITextConfigured, type OpenAITextOptions } from './openai';
import { generateTextWithMiniMax, isMiniMaxTextConfigured } from './minimax';
import { getAiSettings } from '@/lib/ai-settings';

type TextGenerationOptions = OpenAITextOptions;

type TextGenerationProvider = 'openai' | 'minimax';

async function configuredProvider(): Promise<TextGenerationProvider> {
  const settings = await getAiSettings();
  return settings.textGenerationProvider === 'minimax' ? 'minimax' : 'openai';
}

export async function getTextGenerationProviderName() {
  return (await configuredProvider()) === 'minimax' ? 'MiniMax' : 'OpenAI';
}

export async function isTextGenerationConfigured() {
  if ((await configuredProvider()) === 'minimax') return isMiniMaxTextConfigured();
  return isOpenAITextConfigured();
}

export async function generateText(options: TextGenerationOptions) {
  if ((await configuredProvider()) === 'minimax') {
    return generateTextWithMiniMax(options);
  }
  return generateTextWithOpenAI(options);
}
