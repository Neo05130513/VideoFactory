import { generateText, isTextGenerationConfigured } from './providers/text';
import { simpleId } from './storage';
import type {
  Script,
  Topic,
  Tutorial,
  VideoProject,
  VideoScene,
  VideoSceneLayout,
  VideoShotType,
  VideoVisualType
} from './types';

const ALLOWED_LAYOUTS: VideoSceneLayout[] = [
  'hero',
  'contrast',
  'network',
  'process',
  'chart',
  'matrix',
  'checklist',
  'cta',
  'cause',
  'timeline',
  'mistake',
  'pyramid',
  'spotlight',
  'quote',
  'toolchain',
  'radar',
  'mosaic'
];

const ALLOWED_SHOT_TYPES: VideoShotType[] = ['title', 'pain', 'step', 'result', 'cta'];
const ALLOWED_VISUAL_TYPES: VideoVisualType[] = ['slide', 'screen', 'image', 'caption'];
const ALLOWED_TRANSITIONS: NonNullable<VideoScene['transition']>[] = ['push', 'zoom', 'flash', 'wipe', 'fade'];
const STORYBOARD_RECOMMENDED_ACTIONS = ['accept', 'rewrite_display', 'regenerate_storyboard'] as const;

type PlannedScene = {
  shotType?: VideoShotType;
  layout?: VideoSceneLayout;
  visualType?: VideoVisualType;
  durationSec?: number;
  voiceover?: string;
  subtitle?: string;
  headline?: string;
  emphasis?: string;
  visualPrompt?: string;
  keywords?: string[];
  cards?: string[];
  chartData?: number[];
  transition?: VideoScene['transition'];
};

type PlannedStoryboard = {
  videoTitle?: string;
  targetDurationSec?: number;
  scenes?: PlannedScene[];
};

type DisplayRewriteScene = {
  order?: number;
  headline?: string;
  subtitle?: string;
  emphasis?: string;
  cards?: string[];
  keywords?: string[];
};

type DisplayRewriteResult = {
  scenes?: DisplayRewriteScene[];
};

type StoryboardRecommendedAction = typeof STORYBOARD_RECOMMENDED_ACTIONS[number];

type StoryboardQuality = {
  score: number;
  issues: string[];
  reasons: string[];
  recommendedAction: StoryboardRecommendedAction;
  model?: string;
  endpoint?: string;
};

type StoryboardAttemptResult = {
  scenes: VideoScene[];
  quality: StoryboardQuality;
  rawText: string;
  model?: string;
  endpoint?: string;
  reviewDirectedRewriteCount: number;
};

function clipText(value: unknown, fallback: string, maxChars: number) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return (text || fallback).slice(0, maxChars);
}

function normalizeInlineText(value: unknown) {
  return typeof value === 'string'
    ? value
      .replace(/\s+/g, ' ')
      .replace(/```(?:json)?/gi, '')
      .trim()
    : '';
}

function cleanDisplayText(value: unknown, maxChars: number) {
  return normalizeInlineText(value)
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .slice(0, maxChars)
    .trim();
}

function dedupeStrings(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanStringArray(value: unknown, maxItems: number, maxChars: number) {
  if (!Array.isArray(value)) return [];
  return dedupeStrings(
    value
      .map((item) => cleanDisplayText(item, maxChars))
      .filter(Boolean)
  ).slice(0, maxItems);
}

function cleanNumbers(value: unknown, maxItems: number) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item))
    .slice(0, maxItems);
}

function clampDuration(value: unknown, fallback = 4) {
  const duration = Number(value);
  if (!Number.isFinite(duration)) return fallback;
  return Math.max(2.5, Number(duration.toFixed(1)));
}

function clampScore(value: unknown) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function firstSentence(value: string, maxChars: number) {
  const normalized = normalizeInlineText(value);
  const first = normalized.split(/[。！？；\n]/)[0] || normalized;
  return first.slice(0, maxChars).trim();
}

function extractJsonCandidate(raw: string) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  return fenced || raw;
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function extractJsonObject<T>(raw: string): T {
  const source = extractJsonCandidate(raw);
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('AI response did not contain a JSON object');
  }
  return JSON.parse(source.slice(start, end + 1)) as T;
}

async function extractJsonObjectWithAIRepair<T>(params: {
  raw: string;
  responseKind: string;
  requiredShape: string;
}) {
  try {
    return extractJsonObject<T>(params.raw);
  } catch (parseError) {
    const repaired = await generateText({
      systemPrompt: [
        '你是 JSON 结构修复器。',
        '你只能把输入修成唯一一个合法 JSON 对象，不要输出 Markdown，不要解释。',
        '不要改写原意，不要新增新的 scene 内容；只修复 JSON 结构、括号、逗号、引号、数组包裹，以及明显写错但能从 schema 判断的字段名。',
        '如果字段名明显写成 duration 而 schema 要求 durationSec，你可以只做这种结构级纠正。',
        '输入里的 rawResponse 可能很长，你也要完整读完后再修，不要为了省时间只修开头。',
        '输出必须是合法 JSON。'
      ].join('\n'),
      userPrompt: JSON.stringify({
        responseKind: params.responseKind,
        requiredShape: params.requiredShape,
        rawResponse: extractJsonCandidate(params.raw)
      }, null, 2),
      temperature: 0,
      maxTokens: Number(process.env.OPENAI_STORYBOARD_JSON_REPAIR_MAX_TOKENS || process.env.MINIMAX_STORYBOARD_JSON_REPAIR_MAX_TOKENS || 6000),
      timeoutMs: Number(process.env.OPENAI_STORYBOARD_JSON_REPAIR_TIMEOUT_MS || process.env.MINIMAX_STORYBOARD_JSON_REPAIR_TIMEOUT_MS || 86_400_000),
      maxRetries: Number(process.env.OPENAI_STORYBOARD_JSON_REPAIR_MAX_RETRIES || process.env.MINIMAX_STORYBOARD_JSON_REPAIR_MAX_RETRIES || 1)
    });

    if (!repaired) {
      throw parseError;
    }

    try {
      return extractJsonObject<T>(repaired.text);
    } catch (repairError) {
      throw new Error(
        `AI ${params.responseKind} JSON repair failed: parse=${describeError(parseError)}; repair=${describeError(repairError)}`
      );
    }
  }
}

function inferVisualType(layout: VideoSceneLayout): VideoVisualType {
  if (layout === 'chart' || layout === 'radar') return 'image';
  if (layout === 'network' || layout === 'process' || layout === 'timeline' || layout === 'toolchain') return 'screen';
  if (layout === 'contrast' || layout === 'cause' || layout === 'mistake' || layout === 'checklist' || layout === 'quote') return 'caption';
  return 'slide';
}

function defaultLayout(shotType: VideoShotType): VideoSceneLayout {
  if (shotType === 'title') return 'hero';
  if (shotType === 'pain') return 'contrast';
  if (shotType === 'result') return 'checklist';
  if (shotType === 'cta') return 'cta';
  return 'process';
}

function cleanTransition(value: unknown, fallback: NonNullable<VideoScene['transition']> = 'fade') {
  return ALLOWED_TRANSITIONS.includes(value as NonNullable<VideoScene['transition']>)
    ? value as NonNullable<VideoScene['transition']>
    : fallback;
}

function normalizeScene(projectId: string, scene: PlannedScene, index: number): VideoScene | null {
  const shotType = ALLOWED_SHOT_TYPES.includes(scene.shotType as VideoShotType)
    ? scene.shotType as VideoShotType
    : index === 0 ? 'title' : 'step';
  const layout = ALLOWED_LAYOUTS.includes(scene.layout as VideoSceneLayout)
    ? scene.layout as VideoSceneLayout
    : defaultLayout(shotType);
  const visualType = ALLOWED_VISUAL_TYPES.includes(scene.visualType as VideoVisualType)
    ? scene.visualType as VideoVisualType
    : inferVisualType(layout);
  const voiceoverFallback = [
    cleanDisplayText(scene.subtitle, 80),
    cleanDisplayText(scene.headline, 80),
    cleanDisplayText(scene.emphasis, 80)
  ].filter(Boolean).join(' ');
  const voiceover = clipText(scene.voiceover, voiceoverFallback, 1200);
  if (!voiceover) return null;

  const fallbackHeadline = firstSentence(
    cleanDisplayText(scene.subtitle, 26)
      || cleanDisplayText(scene.headline, 18)
      || voiceover,
    18
  );
  const headline = cleanDisplayText(scene.headline, 18) || fallbackHeadline;
  const cardLimit = layout === 'mosaic'
    ? 6
    : layout === 'toolchain' || layout === 'timeline' || layout === 'process' || layout === 'checklist'
      ? 5
      : 4;
  const cards = cleanStringArray(scene.cards, cardLimit, 12);
  const keywords = cleanStringArray(scene.keywords, 6, 10);
  const emphasis = cleanDisplayText(scene.emphasis, 12) || cleanDisplayText(keywords[0], 12) || undefined;

  let subtitle = cleanDisplayText(scene.subtitle, 26)
    || cleanDisplayText(scene.emphasis, 26)
    || cleanDisplayText(cards[0], 26)
    || cleanDisplayText(keywords[0], 26);
  if (!subtitle) {
    subtitle = firstSentence(voiceover, 26);
  }
  if (subtitle === headline) {
    subtitle = cleanDisplayText(cards[0], 26)
      || cleanDisplayText(keywords[0], 26)
      || firstSentence(voiceover.slice(headline.length), 26)
      || subtitle;
  }

  return {
    id: simpleId('video_scene'),
    projectId,
    order: index + 1,
    shotType,
    visualType,
    visualPrompt: clipText(scene.visualPrompt, `使用 ${layout} 版式呈现：${headline || subtitle}`, 500),
    voiceover,
    subtitle,
    durationSec: clampDuration(scene.durationSec, Math.max(3, Math.ceil(voiceover.length / 18))),
    layout,
    headline,
    emphasis,
    keywords,
    cards,
    chartData: cleanNumbers(scene.chartData, 6),
    transition: cleanTransition(scene.transition)
  };
}

function sceneLayoutText(scene: VideoScene) {
  return [
    scene.layout || '',
    scene.shotType,
    scene.visualType,
    scene.headline || '',
    scene.subtitle || '',
    scene.emphasis || '',
    scene.visualPrompt || '',
    scene.voiceover || '',
    ...(scene.cards || []),
    ...(scene.keywords || [])
  ].join(' ');
}

function layoutTransition(layout: VideoSceneLayout): NonNullable<VideoScene['transition']> {
  if (layout === 'timeline' || layout === 'toolchain' || layout === 'process') return 'push';
  if (layout === 'spotlight' || layout === 'quote' || layout === 'network') return 'zoom';
  if (layout === 'radar' || layout === 'mistake') return 'flash';
  if (layout === 'hero' || layout === 'cta') return 'fade';
  return 'wipe';
}

function addLayoutCandidate(target: VideoSceneLayout[], layout: VideoSceneLayout) {
  if (!target.includes(layout)) target.push(layout);
}

function layoutAlternativesForScene(scene: VideoScene): VideoSceneLayout[] {
  const text = sceneLayoutText(scene);
  const candidates: VideoSceneLayout[] = [];
  if (scene.shotType === 'title') return ['hero'];
  if (scene.shotType === 'cta') return ['cta'];

  if (/工具|豆包|千问|即梦|Lovart|OiiOii|剪映|海螺|可灵|工具链|分工|协作|链路/.test(text)) {
    addLayoutCandidate(candidates, 'toolchain');
    addLayoutCandidate(candidates, 'timeline');
    addLayoutCandidate(candidates, 'process');
    addLayoutCandidate(candidates, 'network');
  }
  if (/案例|例子|品牌|人物|客户|故事|引用|原文|“|”|「|」/.test(text)) {
    addLayoutCandidate(candidates, 'quote');
    addLayoutCandidate(candidates, 'spotlight');
    addLayoutCandidate(candidates, 'mosaic');
  }
  if (/标准|指标|评分|评估|风险|成熟度|判断|质量|边界|门槛/.test(text)) {
    addLayoutCandidate(candidates, 'radar');
    addLayoutCandidate(candidates, 'checklist');
    addLayoutCandidate(candidates, 'matrix');
  }
  if (/核心|关键|主张|概念|价值|定位|本质|结论|一句话/.test(text)) {
    addLayoutCandidate(candidates, 'spotlight');
    addLayoutCandidate(candidates, 'pyramid');
    addLayoutCandidate(candidates, 'matrix');
  }
  if (/多个|几类|几种|并列|分类|标签|要点|模块|元素|集合|组合/.test(text)) {
    addLayoutCandidate(candidates, 'mosaic');
    addLayoutCandidate(candidates, 'matrix');
    addLayoutCandidate(candidates, 'checklist');
  }

  if (scene.shotType === 'pain') {
    addLayoutCandidate(candidates, 'contrast');
    addLayoutCandidate(candidates, 'cause');
    addLayoutCandidate(candidates, 'mistake');
    addLayoutCandidate(candidates, 'radar');
  } else if (scene.shotType === 'result') {
    addLayoutCandidate(candidates, 'chart');
    addLayoutCandidate(candidates, 'radar');
    addLayoutCandidate(candidates, 'checklist');
    addLayoutCandidate(candidates, 'spotlight');
  } else {
    ['timeline', 'toolchain', 'spotlight', 'network', 'mosaic', 'matrix', 'checklist', 'pyramid', 'quote', 'process'].forEach((layout) => {
      addLayoutCandidate(candidates, layout as VideoSceneLayout);
    });
  }

  return candidates.filter((layout) => layout !== scene.layout);
}

function diversifyLongVideoLayouts(scenes: VideoScene[]) {
  if (scenes.length < 7) return scenes;
  const nextScenes = scenes.map((scene) => ({ ...scene }));

  for (let index = 1; index < nextScenes.length - 1; index += 1) {
    const scene = nextScenes[index];
    if (scene.shotType === 'title' || scene.shotType === 'cta') continue;

    const prev = nextScenes[index - 1]?.layout;
    const prev2 = nextScenes[index - 2]?.layout;
    const next = nextScenes[index + 1]?.layout;
    const repeatedNow = scene.layout === prev || (nextScenes.length >= 10 && scene.layout === prev2);
    const repeatedAhead = nextScenes.length >= 12 && scene.layout === next && index % 3 === 1;
    if (!repeatedNow && !repeatedAhead) continue;

    const replacement = layoutAlternativesForScene(scene).find((layout) => layout !== prev && layout !== prev2 && layout !== next);
    if (!replacement) continue;

    nextScenes[index] = {
      ...scene,
      layout: replacement,
      visualType: inferVisualType(replacement),
      transition: layoutTransition(replacement),
      visualPrompt: clipText(`${scene.visualPrompt}。长视频防重复调度：本镜头改用 ${replacement} 版式，只展示核心结构，不堆叠旁白全文。`, scene.visualPrompt, 500)
    };
  }

  return nextScenes;
}

function ensureStoryboardShape(project: VideoProject, planned: PlannedStoryboard) {
  const scenes = Array.isArray(planned.scenes) ? planned.scenes : [];
  const normalized = scenes
    .map((scene, index) => normalizeScene(project.id, scene, index))
    .filter((scene): scene is VideoScene => Boolean(scene));

  if (normalized.length < 4) {
    throw new Error('AI storyboard returned too few valid scenes');
  }

  normalized[0] = {
    ...normalized[0],
    shotType: 'title',
    layout: 'hero',
    visualType: 'slide',
    order: 1
  };

  const lastIndex = normalized.length - 1;
  normalized[lastIndex] = {
    ...normalized[lastIndex],
    shotType: 'cta',
    layout: 'cta',
    visualType: 'slide',
    order: normalized.length
  };

  const diversified = diversifyLongVideoLayouts(normalized);

  return diversified.map((scene, index) => ({
    ...scene,
    order: index + 1
  }));
}

function syncPlannedStoryboard(planned: PlannedStoryboard, scenes: VideoScene[]): PlannedStoryboard {
  return {
    ...planned,
    targetDurationSec: summarizeStoryboardDurationSec(scenes),
    scenes: scenes.map((scene) => ({
      shotType: scene.shotType,
      layout: scene.layout,
      visualType: scene.visualType,
      durationSec: scene.durationSec,
      voiceover: scene.voiceover,
      subtitle: scene.subtitle,
      headline: scene.headline,
      emphasis: scene.emphasis,
      visualPrompt: scene.visualPrompt,
      keywords: scene.keywords,
      cards: scene.cards,
      chartData: scene.chartData,
      transition: scene.transition
    }))
  };
}

function buildFullScriptText(script: Script) {
  return [script.hook, script.body, script.cta]
    .map((section) => typeof section === 'string' ? section.trim() : '')
    .filter(Boolean)
    .join('\n\n');
}

function summarizeStoryboardDurationSec(scenes?: Array<{ durationSec?: number }>) {
  if (!Array.isArray(scenes)) return undefined;
  const totalDurationSec = scenes.reduce((total, scene) => {
    const durationSec = Number(scene.durationSec);
    return Number.isFinite(durationSec) && durationSec > 0
      ? total + durationSec
      : total;
  }, 0);
  return totalDurationSec > 0
    ? Number(totalDurationSec.toFixed(1))
    : undefined;
}

function buildTutorialSourceText(tutorial: Tutorial) {
  if (tutorial.rawContent?.trim()) {
    return tutorial.rawContent;
  }

  return [
    `标题：${tutorial.title}`,
    tutorial.summary ? `摘要：${tutorial.summary}` : '',
    Array.isArray(tutorial.steps) && tutorial.steps.length ? `步骤：\n${tutorial.steps.join('\n')}` : '',
    Array.isArray(tutorial.methods) && tutorial.methods.length ? `方法：${tutorial.methods.join('\n')}` : '',
    Array.isArray(tutorial.risks) && tutorial.risks.length ? `风险：${tutorial.risks.join('\n')}` : ''
  ].filter(Boolean).join('\n\n');
}

function buildScriptPromptPayload(script: Script) {
  const fullText = buildFullScriptText(script);
  return {
    title: script.title,
    duration: script.duration,
    style: script.style,
    fullText,
    fullTextCharCount: fullText.replace(/\s+/g, '').length,
    readingRules: [
      '先完整通读 fullText，再规划或评审。',
      '保持原始段落和换行，把它当成连续原文；不要把 hook/body/cta、标题、时长当成切段指令。',
      'scene 切分、scene 数量和整片时长都由模型读完整文后自行决定，不要从元数据先推一个目标长度。',
      'script.duration 只是已有脚本元数据，不是 storyboard 的目标总时长，也不是压缩指令。'
    ],
    metadataRules: [
      '正文事实以 fullText 为准，style 和其他元信息只作为弱参考。',
      'tutorial/sourceText/rawContent 只用于补充背景理解，不得替代 fullText 已经明确承诺的具体案例、对象、步骤和顺序。',
      '不要把 style 里关于“自动生成”“多少步骤”“工作流”等流程说明当成正文事实。',
      '如果元信息与 fullText 冲突，一律以 fullText 的实际内容为准。'
    ]
  };
}

function buildPlannerPrompt(project: VideoProject, script: Script, topic: Topic, tutorial: Tutorial) {
  return JSON.stringify({
    project: {
      title: project.title,
      template: project.template,
      aspectRatio: project.aspectRatio,
      visualPreset: project.visualPreset
    },
    script: buildScriptPromptPayload(script),
    topic: {
      title: topic.title,
      angle: topic.angle,
      painPoint: topic.painPoint,
      audience: topic.audience
    },
    planningPreferences: {
      qualityFirst: true,
      waitAsLongAsNeeded: true,
      treatScriptAsContinuousSource: true,
      doNotPreSegmentScript: true,
      letContentDensityDetermineSceneCount: true,
      letContentDensityDetermineTotalDuration: true,
      treatTargetDurationSecAsDerivedSummary: true,
      doNotInferPreferredLengthFromMetadata: true,
      keepFullTextCoverageFromStartToEnd: true,
      treatTutorialAsBackgroundNotOverride: true,
      preserveConcreteExamples: true,
      preserveConcreteSteps: true,
      preserveConcretePrompts: true,
      preferAudienceAlignedVisualTone: true
    },
    tutorial: {
      title: tutorial.title,
      summary: tutorial.summary,
      tools: tutorial.tools,
      methods: tutorial.methods,
      steps: tutorial.steps,
      risks: tutorial.risks,
      sourceText: buildTutorialSourceText(tutorial),
      rawContent: tutorial.rawContent || undefined
    }
  }, null, 2);
}

function formatReviewFeedback(review?: Pick<StoryboardQuality, 'issues' | 'reasons'>) {
  if (!review) return '';
  const parts = [
    review.issues?.length ? `问题：${review.issues.join('；')}` : '',
    review.reasons?.length ? `原因：${review.reasons.join('；')}` : ''
  ].filter(Boolean);
  return parts.join('。');
}

function buildDisplayRewritePrompt(params: {
  project: VideoProject;
  script: Script;
  planned: PlannedStoryboard;
}) {
  return JSON.stringify({
    project: {
      title: params.project.title,
      template: params.project.template,
      aspectRatio: params.project.aspectRatio,
      visualPreset: params.project.visualPreset
    },
    script: buildScriptPromptPayload(params.script),
    rewritePreferences: {
      qualityFirst: true,
      waitAsLongAsNeeded: true,
      treatScriptAsContinuousSource: true,
      letContentDensityStayInControl: true,
      keepConcreteExamplesVisible: true,
      alignVisualToneWithAudience: true
    },
    storyboard: {
      videoTitle: params.planned.videoTitle,
      targetDurationSec: summarizeStoryboardDurationSec(params.planned.scenes),
      scenes: (params.planned.scenes || []).map((scene, index) => ({
        order: index + 1,
        shotType: scene.shotType,
        layout: scene.layout,
        visualType: scene.visualType,
        durationSec: scene.durationSec,
        voiceover: scene.voiceover,
        headline: scene.headline,
        subtitle: scene.subtitle,
        emphasis: scene.emphasis,
        cards: scene.cards,
        keywords: scene.keywords,
        visualPrompt: scene.visualPrompt
      }))
    }
  }, null, 2);
}

function buildReviewPrompt(params: {
  project: VideoProject;
  script: Script;
  planned: PlannedStoryboard;
  scenes: VideoScene[];
}) {
  return JSON.stringify({
    project: {
      title: params.project.title,
      template: params.project.template,
      aspectRatio: params.project.aspectRatio,
      visualPreset: params.project.visualPreset
    },
    script: buildScriptPromptPayload(params.script),
    reviewPreferences: {
      qualityFirst: true,
      waitAsLongAsNeeded: true,
      treatScriptAsContinuousSource: true,
      letContentDensityJudgeSceneCountAndDuration: true,
      treatTargetDurationSecAsDerivedSummary: true,
      requireConcreteExamplesForTutorialContent: true,
      requireAudienceAlignedVisualTone: true
    },
    storyboard: {
      videoTitle: params.planned.videoTitle,
      targetDurationSec: summarizeStoryboardDurationSec(params.scenes),
      sceneCount: params.scenes.length,
      scenes: params.scenes.map((scene) => ({
        order: scene.order,
        shotType: scene.shotType,
        layout: scene.layout,
        visualType: scene.visualType,
        durationSec: scene.durationSec,
        headline: scene.headline,
        subtitle: scene.subtitle,
        emphasis: scene.emphasis,
        cards: scene.cards,
        keywords: scene.keywords,
        voiceover: scene.voiceover,
        visualPrompt: scene.visualPrompt
      }))
    }
  }, null, 2);
}

function mergeDisplayRewrite(planned: PlannedStoryboard, rewrite: DisplayRewriteResult) {
  const scenes = Array.isArray(planned.scenes) ? planned.scenes : [];
  const rewritten = Array.isArray(rewrite.scenes) ? rewrite.scenes : [];
  const byOrder = new Map<number, DisplayRewriteScene>();

  for (const scene of rewritten) {
    if (!Number.isFinite(scene.order)) continue;
    byOrder.set(Number(scene.order), scene);
  }

  const nextScenes = scenes.map((scene, index) => {
    const next = byOrder.get(index + 1);
    if (!next) return scene;
    return {
      ...scene,
      headline: next.headline ?? scene.headline,
      subtitle: next.subtitle ?? scene.subtitle,
      emphasis: next.emphasis ?? scene.emphasis,
      cards: Array.isArray(next.cards) ? next.cards : scene.cards,
      keywords: Array.isArray(next.keywords) ? next.keywords : scene.keywords
    };
  });

  return {
    ...planned,
    targetDurationSec: summarizeStoryboardDurationSec(nextScenes),
    scenes: nextScenes
  };
}

function normalizeReviewResult(raw: Partial<StoryboardQuality>) {
  const issues = cleanStringArray(raw.issues, 8, 80);
  const reasons = cleanStringArray(raw.reasons, 8, 140);
  const recommendedAction = STORYBOARD_RECOMMENDED_ACTIONS.includes(raw.recommendedAction as StoryboardRecommendedAction)
    ? raw.recommendedAction as StoryboardRecommendedAction
    : issues.length
      ? 'rewrite_display'
      : 'accept';

  return {
    score: clampScore(raw.score),
    issues,
    reasons,
    recommendedAction
  };
}

async function rewriteStoryboardDisplayLayer(params: {
  project: VideoProject;
  script: Script;
  planned: PlannedStoryboard;
  review?: Pick<StoryboardQuality, 'issues' | 'reasons'>;
}) {
  const sceneCount = Array.isArray(params.planned.scenes) ? params.planned.scenes.length : 0;
  if (!sceneCount) return params.planned;

  const feedback = formatReviewFeedback(params.review);
  const systemPrompt = [
    '你是中文科技感信息图短视频的展示层总编。',
    '质量优先，延迟不是问题。',
    '你这次负责整片 display layer 的最终重写，要自己通读完整脚本和完整 storyboard，再决定每个镜头怎么写。',
    'script.fullText 是唯一的原始脚本正文，请按原始段落连续阅读，不要自己先把段落切碎再理解。',
    '即使原文很长、等待很久，也要先完整读完再改，不要为了赶时间只抓局部句子。',
    '忽略 script.style 或其他元信息里关于“自动生成”“多少步骤”“工作流”的流程描述，不要把这些元数据当正文事实。',
    '如果内容是教程型、实操型、案例型，展示层要尽量保住具体例子、具体步骤名、具体动作名，不要全部抽象成方法论名词。',
    '如果受众是老板、企业管理者、销售或 B 端团队，视觉语气要更商务、更克制、更可信；减少花哨比喻、游戏感和过强霓虹冲击。',
    '不要依赖本地 heuristics，不要等待本地先拆 scene 再告诉你改哪一段；你自己对整片负责。',
    '你只重写 headline、subtitle、emphasis、cards、keywords，不要改 voiceover、镜头顺序、shotType、layout、visualType、durationSec、visualPrompt。',
    '只输出 JSON，不要 Markdown，不要解释。',
    '你必须输出每个镜头的完整展示层字段，即使某个字段维持原样，也要在对应 scene 里给出。',
    '目标：把整片展示层改成成熟成片的信息板语言，而不是口播残句或解释句。',
    '展示层必须和旁白解耦。voiceover 负责解释与连接；headline、subtitle、cards、keywords 负责观众一眼看懂的画面信息。',
    '你要以整片视角处理节奏、重复、镜头职责和展示层一致性，但不能改变镜头主题、对象、因果方向、步骤顺序和 CTA 指向。',
    '不得新增原脚本没有的新主题、新对象、新案例、新收益，也不得把具体场景改写成抽象方法论。',
    'cards、keywords、headline 可以复用原 voiceover 的核心名词，但不能把同一条判断句原样换行搬上屏幕。共享关键词可以，整句复述不行。',
    'headline 优先判断句、结果句、对比句、动作标题；subtitle 优先标准、路径、结果、后果、标签；cards 和 keywords 必须是短标签或节点词。',
    '如果 headline、subtitle、cards 使用了数量词，例如“两步”“三个关键点”“五步法”，那么展示层里的数量、步骤名和实际内容必须严格对齐，不能写成两步却展示三步，也不能写五步却只给四项。',
    '如果你暂时无法完整呈现数量词对应的全部内容，就不要保留这个数量词；宁可改成“提示词骨架”“关键流程”“核心环节”，也不要数量错位。',
    '不要把旁白整句搬上屏幕。不要保留“很多老板一听到…、来看几个…、问自己两个问题、总结一下今天的内容、今天回去就做一件事”这类口播 framing。',
    '不要输出半句残句、未闭合短语、代词悬空句、逗号拼接长句。',
    'CTA 镜头要写成明确行动项，不要只是口播式号召。',
    '如果上轮终审指出了问题，你必须以整片视角修正这些问题，而不是只做局部同义替换。',
    '长度要求：headline <= 18 个汉字，subtitle <= 26 个汉字，emphasis <= 12 个汉字，cards 最多 4 个且每项 <= 12 个汉字，keywords 最多 6 个且每项 <= 10 个汉字。',
    '输出格式：{"scenes":[{"order":1,"headline":"...","subtitle":"...","emphasis":"...","cards":["..."],"keywords":["..."]}]}. 每个 scene 都要带 order 和完整展示层字段。',
    feedback ? `上轮终审反馈：${feedback}` : ''
  ].filter(Boolean).join('\n');

  const generated = await generateText({
    systemPrompt,
    userPrompt: buildDisplayRewritePrompt({
      project: params.project,
      script: params.script,
      planned: params.planned
    }),
    temperature: 0.12,
    maxTokens: Number(process.env.OPENAI_STORYBOARD_REWRITE_MAX_TOKENS || process.env.MINIMAX_STORYBOARD_REWRITE_MAX_TOKENS || 5000),
    timeoutMs: Number(process.env.OPENAI_STORYBOARD_REWRITE_TIMEOUT_MS || process.env.MINIMAX_STORYBOARD_REWRITE_TIMEOUT_MS || 86_400_000),
    maxRetries: Number(process.env.OPENAI_STORYBOARD_REWRITE_MAX_RETRIES || process.env.MINIMAX_STORYBOARD_REWRITE_MAX_RETRIES || 2)
  });

  if (!generated) {
    throw new Error('AI storyboard display rewrite returned no content');
  }

  const rewritten = await extractJsonObjectWithAIRepair<DisplayRewriteResult>({
    raw: generated.text,
    responseKind: 'storyboard display rewrite',
    requiredShape: '顶层对象必须是 {"scenes":[{"order":1,"headline":"...","subtitle":"...","emphasis":"...","cards":["..."],"keywords":["..."]}]}。每个 scene 都必须带 order。'
  });
  return mergeDisplayRewrite(params.planned, rewritten);
}

async function reviewStoryboardWithAI(params: {
  project: VideoProject;
  script: Script;
  planned: PlannedStoryboard;
  scenes: VideoScene[];
}) {
  const systemPrompt = [
    '你是中文科技感信息图短视频的最终评审导演。',
    '质量优先，延迟不是问题。',
    '你必须独立审整片，不要模仿本地规则分，也不要等待本地 heuristics 替你做判断。',
    '你要把脚本和 storyboard 当成最终成片来审，看的是整片质量，而不是单个字段是否勉强合法。',
    'script.fullText 是唯一的原始脚本正文，请按原始段落连续阅读，不要先自行切段再做判断。',
    '即使等待很久，也要完整看完原文和整片 storyboard，再给结论。',
    '忽略 script.style 或其他元信息里关于“自动生成”“多少步骤”“工作流”的流程描述，不要把这些元数据当正文事实。',
    '只输出 JSON，不要 Markdown，不要解释。',
    '不要把 template 名里的 short 或其他命名理解成必须压到某个时长；评审时不要拿任何外部时长目标去卡 storyboard。',
    '真正要看的是：scene 数量、scene 时长和总时长是否由全文内容密度自然长出来，是否给最重要的判断、案例、步骤和行动路径留下了足够承载空间。',
    'storyboard.targetDurationSec 只是根据最终 scene.durationSec 汇总出来的结果摘要，不是外部输入目标；不要因为它短或长就先入为主，先看内容是否讲清楚。',
    '如果内容是教程型、实操型、案例型，至少要保住一个足够具体的例子、一个足够具体的操作片段或一个足够具体的提示词/步骤结构；如果这些都缺失，应明确降分。',
    '如果受众是老板、企业管理者、销售或 B 端团队，请检查视觉语言是否足够商务、克制、可信；如果过于花哨、游戏化或炫技，也应作为问题指出。',
    '如果展示层用了数量词、步骤数、方法数，请检查数量与实际内容是否一一对应；不对应时应明确指出。',
    '如果数量词本身来自元数据噪声而非正文内容，不要把它当成缺陷来源；先判断正文里是否真的承诺了这个数量。',
    '请重点评审：内容覆盖是否完整；镜头拆分和顺序是否合理；display layer 是否专业、是否仍在复述旁白；scene 之间是否形成完整节奏；CTA 是否明确；scene 数量与总时长是否确实由内容自己决定；是否存在明显跑题、半句残句、信息缺口、展示层拥挤或镜头职责错位。',
    '如果 display layer 与 voiceover 共享核心关键词或核心名词，但画面层承担了不同的信息组织，不要误判为简单复述；只有整句判断或整句解释被直接搬上屏幕时，才算复述旁白。',
    'issues 只列最关键的问题标签；reasons 要给出简短证据，尽量点出 scene 编号或具体现象。',
    'recommendedAction 只能是 accept、rewrite_display、regenerate_storyboard 三选一。',
    '如果结构、镜头职责、内容覆盖或整片路径有根本问题，recommendedAction 必须是 regenerate_storyboard。',
    '如果结构基本成立，但主要问题集中在展示层表达、屏幕文案、画面信息组织，recommendedAction 必须是 rewrite_display。',
    '如果已经可以直接进入后续流程，recommendedAction 才能是 accept。',
    '不要为了凑高分而放宽标准，也不要为了显得严格而机械挑刺；请给出你真正的整片判断。',
    '输出格式：{"score":93,"issues":["..."],"reasons":["scene 3 ..."],"recommendedAction":"accept"}。'
  ].join('\n');

  const generated = await generateText({
    systemPrompt,
    userPrompt: buildReviewPrompt(params),
    temperature: 0.05,
    maxTokens: Number(process.env.OPENAI_STORYBOARD_REVIEW_MAX_TOKENS || process.env.MINIMAX_STORYBOARD_REVIEW_MAX_TOKENS || 3000),
    timeoutMs: Number(process.env.OPENAI_STORYBOARD_REVIEW_TIMEOUT_MS || process.env.MINIMAX_STORYBOARD_REVIEW_TIMEOUT_MS || 86_400_000),
    maxRetries: Number(process.env.OPENAI_STORYBOARD_REVIEW_MAX_RETRIES || process.env.MINIMAX_STORYBOARD_REVIEW_MAX_RETRIES || 2)
  });

  if (!generated) {
    throw new Error('AI storyboard review returned no content');
  }

  const review = normalizeReviewResult(await extractJsonObjectWithAIRepair<Partial<StoryboardQuality>>({
    raw: generated.text,
    responseKind: 'storyboard review',
    requiredShape: '顶层对象必须是 {"score":93,"issues":["..."],"reasons":["..."],"recommendedAction":"accept"}。recommendedAction 只能是 accept、rewrite_display、regenerate_storyboard。'
  }));
  return {
    ...review,
    model: generated.model,
    endpoint: generated.endpoint
  };
}

async function generateStoryboardAttempt(params: {
  project: VideoProject;
  script: Script;
  topic: Topic;
  tutorial: Tutorial;
  retryReview?: Pick<StoryboardQuality, 'issues' | 'reasons'>;
}) {
  const priorReview = formatReviewFeedback(params.retryReview);
  const systemPrompt = [
    '你是中文科技感信息图解说视频的分镜导演。',
    '质量优先，延迟不是问题。',
    '只输出 JSON，不要 Markdown，不要解释。',
    '你必须基于完整输入文章和脚本，直接规划整条视频的完整结构化分镜。',
    'script.fullText 是唯一的原始脚本正文，请按原始段落连续阅读，不要自己先把它拆成小块再理解。',
    '即使原文很长、等待很久，也要先完整理解全文，再决定镜头结构、scene 数量和每个镜头承载的信息量。',
    '在输出前，请从头到尾回查 fullText 的主要承诺是否都被 scene 承载；尤其不要漏掉后半段的限制、边界、不适用场景、最后提醒和最终 CTA。',
    '忽略 script.style 或其他元信息里关于“自动生成”“多少步骤”“工作流”的流程描述，不要把这些元数据当正文事实。',
    'script.fullText 决定这次 storyboard 的具体案例、对象、步骤和顺序；tutorial 只辅助你理解背景与术语，不要把 fullText 没明确写出的新案例、新演示对象或新步骤强行写进 scene。',
    '如果内容是教程型、实操型、案例型，你必须主动挑出最能代表方法价值的具体例子、具体步骤或具体操作片段，并给它足够清晰的 scene 承载。',
    '如果受众是老板、企业管理者、销售或 B 端团队，视觉语言优先商务、克制、可信、结构清晰，而不是炫技或娱乐化。',
    '不要让本地规则替你决定内容质量、scene 切分或镜头职责；你要自己读完整内容后规划整片。',
    `layout 只能使用：${ALLOWED_LAYOUTS.join(', ')}。`,
    `shotType 只能使用：${ALLOWED_SHOT_TYPES.join(', ')}。`,
    `visualType 只能使用：${ALLOWED_VISUAL_TYPES.join(', ')}。`,
    '不要把 project.template 名里的 short 或其他命名理解成必须更短；scene 数量和总时长只能由全文内容密度决定。',
    '如果全文需要更多镜头、更长总时长才能讲清楚，就直接这么做；质量优先，不要为了更短而牺牲关键案例、关键步骤、关键示例或关键风险提醒。',
    'targetDurationSec 不是外部给定目标；它只是你在完成整片规划后，根据最终每个 scene 的 durationSec 汇总出的结果摘要。先规划 scenes，再总结 total duration。',
    '不要按文章长短分段处理，不要假设输入已经被人工切片；你需要自己理解完整内容后直接规划整片分镜。',
    '镜头数量必须根据内容密度决定，不要压缩内容；一个知识点可以拆多个镜头。每个 scene 的 durationSec 也要由该镜头承载的信息量自然决定。',
    '无论如何都不要返回少于 4 个镜头的 storyboard。',
    '每个 scene 都必须提供非空的 shotType、layout、visualType、durationSec、transition、voiceover、headline、subtitle、visualPrompt。',
    '如果任何 scene 缺少这些必要字段，或者 voiceover/headline/subtitle 为空，就不要输出，先补齐再给 JSON。',
    'voiceover 要完整覆盖内容重点，不要因为文章长就删掉关键前提、步骤、限制、风险和具体示例。',
    '如果是教程型、实操型、案例型内容，至少要保住一个足够具体的例子或操作片段，不能只剩抽象名词。',
    '如果脚本里存在明确的“几个问题”“几步法”“几个场景”“几个坑”“几个特质”，请让 scene 中的数量与实际展开严格对齐。',
    '如果 fullText 明确承诺了“两类场景”“三步法”“三个不适用场景”这类结构，必须完整覆盖，不要只展开前半段。',
    '如果你无法完整展开某个数量词承诺，就不要硬写这个数量词；先保证具体内容与逻辑完整。',
    '展示层和旁白层必须解耦：voiceover 负责解释、连接、判断；headline、subtitle、cards、emphasis 负责给观众一眼看懂的展示内容。',
    '展示层可以共享同一组核心名词，但不要让 headline、subtitle、cards 直接复述 voiceover 的完整句子。共享关键词可以，整句重说不行。',
    '禁止把 voiceover 改写后整句搬上屏幕。屏幕文案优先使用短标题、步骤标签、对比标签、节点名、结果词、指标词。',
    'headline 优先写成成片标题：结论句、对比句、判断句；不要写成口播开场。',
    'headline、subtitle、cards、emphasis 都要优先写成信息板文案，而不是人口播时会说的话。',
    'subtitle、cards、emphasis 优先用完整短词或完整短句，不要留下半句口播、残缺修饰语，也不要以功能词收尾。',
    '避免使用强口播开头：比如“很多老板一听到…”“来看几个…”“有一种典型的…”“按照这个路径走下来…”“今天回去就做一件事…”。',
    '避免使用代词残句或未闭合短语：比如“它优化掉”“这个问题值不值得”“那三个出现频率最高的”。',
    'cards 更像节点卡或标签，不像句子。优先使用 2 到 8 个字的名词短语、判断词、结果词、步骤词。',
    '尽量不要在 cards、keywords 里输出逗号拼接、并列长句、解释性短句。一个 card 只表达一个节点。',
    '每个镜头都要先想观众会看到什么卡片、图形、标签，再想旁白如何补解释；展示层即使静音也要看得出大意。',
    'headline 最多 18 个汉字，subtitle 最多 26 个汉字；普通版式 cards 最多 4 个，timeline/process/toolchain/checklist 最多 5 个，mosaic 最多 6 个；每个 card 尽量控制在 12 个汉字内，避免屏幕拥挤。',
    'chartData 只在 chart 或 radar 版式需要时给 5 到 6 个数字；如果输入里有增减、对比、趋势、阶段变化、前后差异，优先使用 chart；如果输入里有标准、指标、风险、成熟度、判断条件，优先使用 radar。',
    'transition 必须从 push、zoom、flash、wipe、fade 中选择，每个镜头都给。',
    '优先使用 hero、contrast、cause、timeline、network、chart、matrix、mistake、pyramid、checklist、spotlight、quote、toolchain、radar、mosaic、cta 的多样组合，同类版式不要连续重复太多。',
    'layout 选择要按内容语义决定：spotlight 用于核心概念或主张聚焦，quote 用于案例/人物/品牌/原文引语，toolchain 用于工具分工和多工具流程，radar 用于标准/指标/风险评估，mosaic 用于多个并列点或信息密集但没有强顺序的内容。',
    '如果全片超过 8 个 scene，必须把视觉节奏做成长视频结构：开场聚焦、背景/问题、方法展开、案例或证据、结果判断、行动收束；任意连续 5 个 scene 内不要只反复使用 1 到 2 种 layout。',
    '如果是步骤说明，不要把多个动作全部塞进一个 process 镜头，而要拆成多个短镜头，让信息逐步揭示。',
    '如果是观点递进，优先使用排比式多镜头推进，而不是一整段文字。',
    '如果是界面操作、提示词配置、表单填写、流程搭建，优先使用 screen 或 process，并在 visualPrompt 里写清楚动态动作。',
    '如果是结论、效果、差异、阶段性提升，优先使用 chart、contrast、result，不要只用 caption 大段写字。',
    '每个镜头的 visualPrompt 都要明确进入、展开、强调、收束四个阶段，禁止一上来整屏显示全部内容。',
    'visualPrompt 不能只写“依次弹出、高亮、定格”这类空泛动作；必须写出具体的画面主体、构图、信息层级、动效路径和最终停留状态。',
    '如果题材偏 B 端/老板/企业管理，visualPrompt 优先仪表盘、流程图、会议室屏幕、经营面板、文档批注、卡片对比等商务画面语汇，少用夸张情绪化特效。',
    '所有输出必须是合法 JSON。任何字符串字段，尤其 visualPrompt，不能包含未转义的英文双引号。',
    '最后一个 scene 必须承载 fullText 结尾的明确行动号召；不要把中间步骤、编辑动作或演示过程误放到 CTA 位置。',
    '输出前请自检每个镜头：1）headline/subtitle/cards 是否脱离 voiceover 也能看懂；2）是否有口播腔、半句残句、逗号拼接；3）是否像成熟成片里的信息板标题。如果不满足，先改写再输出。',
    priorReview ? `上一轮终审反馈：${priorReview}。这次必须解决这些问题。` : '',
    '输出格式：{"videoTitle":"...","targetDurationSec":35,"scenes":[{"shotType":"title","layout":"hero","visualType":"slide","durationSec":4,"transition":"fade","voiceover":"...","headline":"...","subtitle":"...","emphasis":"...","cards":["..."],"keywords":["..."],"chartData":[1,2,3,4,5],"visualPrompt":"..."}]}。',
  ].filter(Boolean).join('\n');

  const generated = await generateText({
    systemPrompt,
    userPrompt: buildPlannerPrompt(params.project, params.script, params.topic, params.tutorial),
    temperature: params.retryReview ? 0.42 : 0.35,
    maxTokens: Number(process.env.OPENAI_STORYBOARD_MAX_TOKENS || process.env.MINIMAX_STORYBOARD_MAX_TOKENS || 12000),
    timeoutMs: Number(process.env.OPENAI_STORYBOARD_TIMEOUT_MS || process.env.MINIMAX_STORYBOARD_TIMEOUT_MS || 86_400_000),
    maxRetries: Number(process.env.OPENAI_STORYBOARD_MAX_RETRIES || process.env.MINIMAX_STORYBOARD_MAX_RETRIES || 2)
  });

  if (!generated) {
    throw new Error('AI storyboard generation returned no content');
  }

  let planned = await extractJsonObjectWithAIRepair<PlannedStoryboard>({
    raw: generated.text,
    responseKind: 'storyboard planner',
    requiredShape: '顶层对象必须是 {"videoTitle":"...","scenes":[...]}，并建议附带 {"targetDurationSec":35} 作为根据最终 scene.durationSec 汇总出的结果摘要。至少 4 个 scene。每个 scene 必须包含非空的 shotType、layout、visualType、durationSec、transition、voiceover、headline、subtitle、visualPrompt；并优先使用 emphasis、cards、keywords、chartData。'
  });
  planned = await rewriteStoryboardDisplayLayer({
    project: params.project,
    script: params.script,
    planned,
    review: params.retryReview
  });

  let scenes = ensureStoryboardShape(params.project, planned);
  planned = syncPlannedStoryboard(planned, scenes);
  let quality = await reviewStoryboardWithAI({
    project: params.project,
    script: params.script,
    planned,
    scenes
  });

  const maxDisplayReviewRetries = Math.max(0, Number(process.env.OPENAI_STORYBOARD_MAX_DISPLAY_REVIEW_RETRIES || process.env.MINIMAX_STORYBOARD_MAX_DISPLAY_REVIEW_RETRIES || 2));
  let reviewDirectedRewriteCount = 0;

  while (
    quality.recommendedAction === 'rewrite_display'
    && reviewDirectedRewriteCount < maxDisplayReviewRetries
  ) {
    reviewDirectedRewriteCount += 1;
    planned = await rewriteStoryboardDisplayLayer({
      project: params.project,
      script: params.script,
      planned,
      review: quality
    });
    scenes = ensureStoryboardShape(params.project, planned);
    planned = syncPlannedStoryboard(planned, scenes);
    quality = await reviewStoryboardWithAI({
      project: params.project,
      script: params.script,
      planned,
      scenes
    });
  }

  return {
    scenes,
    quality,
    rawText: generated.text,
    model: quality.model || generated.model,
    endpoint: quality.endpoint || generated.endpoint,
    reviewDirectedRewriteCount
  } satisfies StoryboardAttemptResult;
}

export async function planStoryboardWithAI(params: {
  project: VideoProject;
  script: Script;
  topic: Topic;
  tutorial: Tutorial;
}) {
  if (!await isTextGenerationConfigured()) return null;

  const maxGenerationAttempts = Math.max(1, Number(process.env.OPENAI_STORYBOARD_MAX_GENERATION_ATTEMPTS || process.env.MINIMAX_STORYBOARD_MAX_GENERATION_ATTEMPTS || 2));
  let generationRetryCount = 0;
  let retryReview: Pick<StoryboardQuality, 'issues' | 'reasons'> | undefined;
  let result: StoryboardAttemptResult | null = null;

  while (generationRetryCount < maxGenerationAttempts) {
    result = await generateStoryboardAttempt({
      ...params,
      retryReview
    });

    if (result.quality.recommendedAction !== 'regenerate_storyboard') {
      break;
    }

    retryReview = result.quality;
    generationRetryCount += 1;
  }

  if (!result) return null;

  return {
    scenes: result.scenes,
    rawText: result.rawText,
    model: result.model,
    endpoint: result.endpoint,
    quality: result.quality,
    retried: generationRetryCount > 0 || result.reviewDirectedRewriteCount > 0
  };
}
