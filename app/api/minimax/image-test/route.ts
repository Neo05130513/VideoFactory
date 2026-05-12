import { NextResponse } from 'next/server';
import { generateImageWithMiniMax, isMiniMaxConfigured } from '@/lib/providers/minimax';
import { generatedRelativePath } from '@/lib/runtime/paths';
import { simpleId } from '@/lib/storage';

export async function POST(request: Request) {
  try {
    if (!await isMiniMaxConfigured()) {
      return NextResponse.json({ error: 'MINIMAX_API_KEY is not configured' }, { status: 400 });
    }

    const body = await request.json();
    const prompt = body.prompt as string | undefined;

    if (!prompt?.trim()) {
      return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
    }

    const testId = simpleId('minimax_test');
    const outputRelativePath = generatedRelativePath('minimax-tests', `${testId}.png`);

    const result = await generateImageWithMiniMax({
      prompt: prompt.trim(),
      outputRelativePath,
      width: 1080,
      height: 1920
    });

    const origin = new URL(request.url).origin;
    const publicPath = (result as { publicPath?: string }).publicPath || '';
    const imageUrl = publicPath ? new URL(publicPath, origin).toString() : null;

    return NextResponse.json({
      id: testId,
      prompt: prompt.trim(),
      image: result,
      imageUrl,
      endpoint: (result as { endpoint?: string }).endpoint || null
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'MiniMax image test failed' },
      { status: 500 }
    );
  }
}
