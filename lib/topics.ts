import { generateText, isTextGenerationConfigured } from './providers/text';
import { nowIso, simpleId } from './storage';
import { Topic, Tutorial } from './types';

type TopicDraft = {
  title?: string;
  angle?: Topic['angle'];
  hookType?: string;
  painPoint?: string;
  audience?: string;
};

const ALLOWED_ANGLES: Topic['angle'][] = ['痛点型', '方法论型', '工具实操型', '避坑型', '进阶优化型'];

function cleanLine(value: unknown) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function clip(value: string, maxLength: number) {
  const text = cleanLine(value);
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength);
}

function extractJsonObject(raw: string) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced || raw;
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Topic response did not contain a JSON object');
  }
  return JSON.parse(source.slice(start, end + 1)) as TopicDraft;
}

function buildTopicError(message: string) {
  return new Error(`AI 选题生成失败：${message}`);
}

function normalizeTopicDraft(tutorial: Tutorial, raw: TopicDraft): Topic {
  const title = clip(cleanLine(raw.title), 30);
  const angle = ALLOWED_ANGLES.includes(raw.angle as Topic['angle']) ? raw.angle as Topic['angle'] : null;
  const hookType = clip(cleanLine(raw.hookType), 16);
  const painPoint = clip(cleanLine(raw.painPoint), 40);
  const audience = clip(cleanLine(raw.audience), 20);

  if (!title || !angle || !hookType || !painPoint || !audience) {
    throw buildTopicError('模型返回内容缺少必要字段或格式不合法。');
  }

  return {
    id: simpleId('topic'),
    tutorialId: tutorial.id,
    title,
    angle,
    hookType,
    painPoint,
    audience,
    platformFit: ['document'],
    viralScore: Math.max(70, tutorial.shortVideoScore || 70),
    createdAt: nowIso()
  };
}

export async function generateTopics(tutorial: Tutorial): Promise<Topic[]> {
  if (!await isTextGenerationConfigured()) {
    throw buildTopicError('未配置 OPENAI_API_KEY，已停止选题生成。');
  }

  const systemPrompt = [
    '你是中文教程内容的视频选题总监。',
    '你的任务不是给出 5 个模板化角度，而是基于完整教程内容，挑出最值得拍成一条讲解视频的主选题。',
    '只输出 JSON，不要 Markdown，不要解释。',
    `angle 只能从以下五个值里选一个：${ALLOWED_ANGLES.join('、')}。`,
    'hookType 用简短中文描述开头方式，例如“痛点开头”“步骤开头”“警告开头”“结果开头”“框架开头”。',
    'title 必须像一条真正要拍的视频标题，而不是课程目录名。',
    'painPoint 要写这条视频真正要解决的核心痛点。',
    'audience 要写最适合看这条视频的人群。',
    '不要生成多个选题，不要列方案，不要输出数组。',
    '输出格式：{"title":"...","angle":"...","hookType":"...","painPoint":"...","audience":"..."}'
  ].join('\n');

  const userPrompt = JSON.stringify({
    tutorial: {
      title: tutorial.title,
      summary: tutorial.summary,
      targetAudience: tutorial.targetAudience,
      scenarios: tutorial.scenarios,
      tools: tutorial.tools,
      methods: tutorial.methods,
      steps: tutorial.steps,
      risks: tutorial.risks,
      rawContent: tutorial.rawContent
    }
  }, null, 2);

  try {
    const generated = await generateText({
      systemPrompt,
      userPrompt,
      temperature: 0.35,
      maxTokens: Number(process.env.OPENAI_TOPIC_MAX_TOKENS || process.env.MINIMAX_TOPIC_MAX_TOKENS || 1800),
      timeoutMs: Number(process.env.OPENAI_TOPIC_TIMEOUT_MS || process.env.MINIMAX_TOPIC_TIMEOUT_MS || 1_800_000),
      maxRetries: Number(process.env.OPENAI_TOPIC_MAX_RETRIES || process.env.MINIMAX_TOPIC_MAX_RETRIES || 2)
    });
    if (!generated?.text) {
      throw buildTopicError('模型未返回可用文本。');
    }
    return [normalizeTopicDraft(tutorial, extractJsonObject(generated.text))];
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('AI 选题生成失败：')) {
      throw error;
    }
    throw buildTopicError(error instanceof Error ? error.message : String(error));
  }
}
