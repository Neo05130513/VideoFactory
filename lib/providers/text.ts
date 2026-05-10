import { generateTextWithOpenAI, isOpenAITextConfigured, type OpenAITextOptions } from './openai';
import { generateTextWithMiniMax, isMiniMaxTextConfigured } from './minimax';

type TextGenerationOptions = OpenAITextOptions;

type TextGenerationProvider = 'openai' | 'minimax';

function configuredProvider(): TextGenerationProvider {
  const value = (process.env.TEXT_GENERATION_PROVIDER || process.env.AI_TEXT_PROVIDER || 'openai').toLowerCase();
  return value === 'minimax' ? 'minimax' : 'openai';
}

export function getTextGenerationProviderName() {
  return configuredProvider() === 'minimax' ? 'MiniMax' : 'OpenAI';
}

export async function isTextGenerationConfigured() {
  if (configuredProvider() === 'minimax') return isMiniMaxTextConfigured();
  return isOpenAITextConfigured();
}

export async function generateText(options: TextGenerationOptions) {
  if (configuredProvider() === 'minimax') {
    return generateTextWithMiniMax(options);
  }
  return generateTextWithOpenAI(options);
}
