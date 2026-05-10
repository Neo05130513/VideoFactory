import { NextResponse } from 'next/server';
import { generateImageWithOpenAI, isOpenAIImageConfigured } from '@/lib/providers/openai';
import { generatedRelativePath } from '@/lib/runtime/paths';
import { simpleId } from '@/lib/storage';

export async function POST(request: Request) {
  try {
    if (!isOpenAIImageConfigured()) {
      return NextResponse.json({ error: 'OPENAI_API_KEY is not configured' }, { status: 400 });
    }

    const body = await request.json();
    const prompt = body.prompt as string | undefined;

    if (!prompt?.trim()) {
      return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
    }

    const testId = simpleId('openai_image_test');
    const outputRelativePath = generatedRelativePath('openai-tests', `${testId}.png`);

    const result = await generateImageWithOpenAI({
      prompt: prompt.trim(),
      outputRelativePath,
      width: 1080,
      height: 1920
    });

    const origin = new URL(request.url).origin;
    const publicPath = (result as { publicPath?: string } | null)?.publicPath || '';
    const imageUrl = publicPath ? new URL(publicPath, origin).toString() : null;

    return NextResponse.json({
      id: testId,
      prompt: prompt.trim(),
      image: result,
      imageUrl,
      endpoint: (result as { endpoint?: string } | null)?.endpoint || null
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'OpenAI image test failed' },
      { status: 500 }
    );
  }
}
