import { pickDisplayHeadline, pickDisplayLabel, pickDisplayLabels } from './display-labels';
import { sanitizeSceneText } from './narration';
import type { VideoScene } from './types';

export type StoryboardDisplayIssue = {
  sceneId: string;
  order: number;
  field: 'headline' | 'subtitle' | 'emphasis' | 'cards' | 'keywords';
  value: string;
  reason: string;
};

export type StoryboardDisplayCheckResult = {
  scenes: VideoScene[];
  issues: StoryboardDisplayIssue[];
  repaired: boolean;
  passed: boolean;
};

function normalizeDisplayText(value?: string | null) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[“”"']/g, '')
    .replace(/[.…]+$/g, '')
    .trim();
}

function splitDisplayCandidates(value?: string | null) {
  return normalizeDisplayText(value)
    .replace(/([。！？!?；;：:，、,])/g, '$1\n')
    .split('\n')
    .map((item) => item.replace(/[。！？!?；;：:，、,]+$/g, '').trim())
    .filter(Boolean);
}

const compactSingleCharLabels = new Set(['人', '景', '事']);

function isWeakDisplayLabel(value?: string | null) {
  const text = normalizeDisplayText(value)
    .replace(/^第[一二三四五六七八九十]+个问题[，,：:\s]*(是)?/, '')
    .replace(/^(这个|这份|这些|文档里的|文档里|文档给出的|文档强调|当前原文|最终|需要注意)[，,：:\s]*/, '')
    .replace(/^是/, '')
    .trim();

  return !text
    || /^(问题|个问题|这个任务|这个品牌|文档|例子|种模式|模式|任务|内容|方式|表达|输出|需要注意|最终判断|核心方法很简单|关键在于|就是三个字|三个字)$/.test(text)
    || /^(它|这个|这类|这些|文档|比如|因为|而|但|如果|很多|对这个案例来说)/.test(text)
    || /^(在|把|让|给|替|向|从|对|要|会|能|可|像|被).{1,4}$/.test(text)
    || /^(看起来|看起来像|更像|这更像|表面上|老板像|在负责|在管理公司|上复杂系统)$/.test(text)
    || /^在日常运营里/.test(text)
    || /^[户景事]\S{4,}/.test(text)
    || (/[「“]/.test(text) && !/[」”]/.test(text))
    || /[支类种条句段项]$/.test(text)
    || /[的了都在把让用及和跟与或、，：:；;]$/.test(text)
    || (/(?:不|没|会|能|要|再|还|就|也|来|去|给|向|与|和|或|但|而)$/.test(text) && text.length <= 6)
    || (/[A-Za-z]$/.test(text) && !/(AI|IP|CEO|OiiOii|Lovart|Logo)$/i.test(text));
}

function isUsefulDisplayLabel(value?: string | null) {
  const text = normalizeDisplayText(value);
  if (!text) return false;
  if (compactSingleCharLabels.has(text)) return true;
  return text.length >= 2 && !isWeakDisplayLabel(text);
}

function compactDisplayLabel(value?: string | null, maxLength = 12) {
  let text = normalizeDisplayText(value)
    .replace(/^第[一二三四五六七八九十]+个问题[，,：:\s]*(是)?/, '')
    .replace(/^第[一二三四五六七八九十]+种(模式)?[，,：:\s]*(是)?/, '')
    .replace(/^种(模式)?[，,：:\s]*(是)?/, '')
    .replace(/^(这个品牌的|这个任务的|这个品牌|这个任务|这份资料的|文档里的|文档里|文档给出的|文档强调|当前原文|最终判断|最终|需要注意)[，,：:\s]*/, '')
    .replace(/^(这节内容讲的是|这类内容尤其适合)/, '')
    .replace(/^(这里|这类内容|很多品牌|很多|如果|因为|所以|但是|而是|同时|另外|其实|问题是|需要|可以|就是|它可以|它要|它会)/, '')
    .replace(/^(第一|第二|第三|第四|第五|第六)(?:[步点]|[：:、\s]+)/, '')
    .replace(/^(一是|二是|三是|四是|五是|六是)[：:、\s]*/, '')
    .replace(/^(让|通过|完成|实现|用(?!户))/, '')
    .replace(/^是/, '')
    .replace(/什么样的/g, '')
    .trim();

  if (!text) return '';
  const semantic = pickDisplayLabel([text], maxLength);
  if (semantic && semantic.length <= maxLength && !isWeakDisplayLabel(semantic)) {
    text = semantic;
  }

  const quoted = text.match(/[「“]([^」”]{2,18})[」”]/);
  if (quoted?.[1]) text = quoted[1];
  const clauses = splitDisplayCandidates(text);
  if (clauses.length > 1) {
    text = clauses.find((item) => item.length <= maxLength && isUsefulDisplayLabel(item))
      || clauses.find((item) => isUsefulDisplayLabel(item))
      || clauses[0];
  }

  if (text.length > maxLength && text.includes('，')) {
    text = text.split('，').find((item) => item.length >= 2 && item.length <= maxLength) || text;
  }
  if (text.length > maxLength && text.includes('、')) {
    text = text.split('、').find((item) => item.length >= 2 && item.length <= maxLength) || text;
  }
  if (text.length > maxLength && text.includes('就')) {
    text = text.split('就').slice(-1)[0]?.trim() || text;
  }
  if (text.length > maxLength && text.includes('再')) {
    text = text.split('再').slice(-1)[0]?.trim() || text;
  }
  if (text.length > maxLength && text.includes('的')) {
    const tail = text.split('的').slice(-2).join('的');
    if (tail.length >= 2 && tail.length <= maxLength) text = tail;
  }
  if (text.length > maxLength) {
    text = text
      .replace(/更生动地/g, '生动')
      .replace(/品牌宣传视频/g, '品牌片')
      .replace(/品牌理念/g, '理念')
      .replace(/企业文化/g, '文化')
      .replace(/使命愿景/g, '愿景')
      .replace(/用户熟悉的/g, '熟悉')
      .replace(/提升认知度和好感度/g, '提升好感');
  }

  if (text.length > maxLength) return '';
  return text;
}

function uniqueDisplayLabels(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeDisplayText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function pruneRedundantLabels(values: string[]) {
  return values.filter((value) => !values.some((other) =>
    other !== value
    && other.length >= value.length + 2
    && value.length <= 5
    && other.includes(value)
  ));
}

function getCardLimit(scene: Pick<VideoScene, 'layout'>) {
  return scene.layout === 'mosaic'
    ? 6
    : scene.layout === 'process' || scene.layout === 'timeline' || scene.layout === 'checklist' || scene.layout === 'toolchain'
      ? 5
      : 4;
}

function ctaQuestionLabel(text: string) {
  const normalized = normalizeDisplayText(text);
  const exact = normalized.match(/(\d+个[^，。；]*问题)/)?.[1];
  if (exact) return exact.replace(/最常被客户和员工反复问到的/, '').replace(/最常被反复问到的/, '').trim();
  if (/高频问题/.test(normalized)) return '高频问题';
  return '';
}

function ctaActionCards(scene: VideoScene) {
  const voiceover = normalizeDisplayText(scene.voiceover);
  const cards: string[] = [];
  const add = (value: string) => {
    const label = compactDisplayLabel(value, 12);
    if (label && !isWeakDisplayLabel(label) && !cards.includes(label)) cards.push(label);
  };

  const questionLabel = ctaQuestionLabel(voiceover);
  if (questionLabel) add(questionLabel);
  if (/标准答案/.test(voiceover)) add('标准答案');
  if (/不能乱答的边界/.test(voiceover)) add('答复边界');
  else if (/边界/.test(voiceover)) add('边界规则');
  if (/客户和员工/.test(voiceover)) add('客户员工共用');
  else if (/客户/.test(voiceover) && /员工/.test(voiceover)) add('客户与员工');
  if (/从今天开始/.test(voiceover)) add('今天开始');
  if (/先列出|先整理|先盘点/.test(voiceover)) add('先做盘点');

  for (const item of scene.cards || []) add(item);
  for (const item of scene.keywords || []) add(item);

  return pruneRedundantLabels(cards).slice(0, getCardLimit(scene));
}

function deriveCtaDisplay(scene: VideoScene) {
  const actionCards = ctaActionCards(scene);
  const questionLabel = actionCards.find((item) => /问题/.test(item)) || ctaQuestionLabel(scene.voiceover);
  const headline = questionLabel
    ? `先整理${questionLabel}`
    : /边界/.test(scene.voiceover)
      ? '先把答复边界写清楚'
      : '今天先做这一步';
  const cards = actionCards.length ? actionCards : ['今天开始', '标准答案', '答复边界'];
  const emphasis = /从今天开始|今天/.test(scene.voiceover) ? '今天开始' : '先做这一步';
  const subtitle = cards
    .filter((item) => item !== headline)
    .slice(0, 3)
    .join(' / ') || '先盘点，再写清标准';

  return {
    headline: compactDisplayLabel(headline, 18) || '今天先做这一步',
    subtitle,
    emphasis: compactDisplayLabel(emphasis, 12) || '今天开始',
    cards,
    keywords: pruneRedundantLabels(uniqueDisplayLabels([
      ...cards.map((item) => compactDisplayLabel(item, 10)),
      compactDisplayLabel(headline, 10),
      compactDisplayLabel(emphasis, 10)
    ])).filter(isUsefulDisplayLabel).slice(0, 6)
  };
}

function deriveDisplayCards(scene: VideoScene) {
  if (scene.shotType === 'cta' || scene.layout === 'cta') {
    return deriveCtaDisplay(scene).cards;
  }
  const cardLimit = getCardLimit(scene);
  const semanticLabels = pickDisplayLabels([
    scene.voiceover,
    scene.subtitle,
    scene.visualPrompt,
    scene.emphasis,
    ...(scene.cards || []),
    ...(scene.keywords || [])
  ], cardLimit + 3, 12);

  const candidates = [
    ...semanticLabels,
    ...(scene.cards || []),
    ...(scene.keywords || []),
    ...splitDisplayCandidates(scene.voiceover),
    ...splitDisplayCandidates(scene.subtitle),
    scene.emphasis || ''
  ];

  return pruneRedundantLabels(uniqueDisplayLabels(
    candidates
      .map((item) => compactDisplayLabel(item, 12))
      .filter(isUsefulDisplayLabel)
  )).slice(0, cardLimit);
}

function deriveDisplayHeadline(scene: VideoScene, cards: string[]) {
  if (scene.shotType === 'cta' || scene.layout === 'cta') {
    return deriveCtaDisplay(scene).headline;
  }
  const semantic = pickDisplayHeadline([
    scene.headline,
    scene.subtitle,
    scene.emphasis,
    cards.find(Boolean),
    scene.voiceover
  ], 18);
  if (semantic && !isWeakDisplayLabel(semantic)) return compactDisplayLabel(semantic, 18);

  const current = compactDisplayLabel(scene.headline, 18);
  if (current.length >= 4 && !isWeakDisplayLabel(current)) return current;

  const subtitle = compactDisplayLabel(scene.subtitle, 18);
  if (subtitle.length >= 4 && !isWeakDisplayLabel(subtitle)) return subtitle;

  const voiceover = pickDisplayHeadline(splitDisplayCandidates(scene.voiceover), 18)
    || compactDisplayLabel(splitDisplayCandidates(scene.voiceover)[0], 18);

  return voiceover || cards[0] || '核心结构';
}

function deriveDisplaySubtitle(scene: VideoScene, headline: string, cards: string[]) {
  if (scene.shotType === 'cta' || scene.layout === 'cta') {
    return deriveCtaDisplay(scene).subtitle;
  }
  const joinedCards = cards.filter((item) => item !== headline).slice(0, 3).join(' / ');
  if (joinedCards) return joinedCards;

  const semantic = pickDisplayLabel([
    scene.subtitle,
    scene.emphasis,
    scene.keywords?.find((item) => item !== headline),
    splitDisplayCandidates(scene.voiceover).find((item) => item !== headline)
  ], 24);
  const current = compactDisplayLabel(semantic || scene.subtitle, 24);
  if (current && current !== headline && !isWeakDisplayLabel(current)) return current;

  return compactDisplayLabel(scene.emphasis, 24) || headline;
}

function buildVisualPrompt(scene: VideoScene, headline: string, subtitle: string, cards: string[]) {
  const summary = cards.length
    ? `核心模块：${cards.join(' / ')}`
    : `核心信息：${compactDisplayLabel(scene.voiceover, 42) || subtitle || headline}`;
  const layoutLabel = scene.layout ? `版式：${scene.layout}。` : '';
  return `业务信息图页面《${headline || subtitle || '核心结构'}》。${layoutLabel}${summary}。画面围绕当前旁白做结构化表达，避免口播整句上屏和无关装饰。`;
}

function displaySnapshot(scene: VideoScene) {
  return JSON.stringify({
    headline: scene.headline || '',
    subtitle: scene.subtitle || '',
    emphasis: scene.emphasis || '',
    cards: scene.cards || [],
    keywords: scene.keywords || [],
    visualPrompt: scene.visualPrompt || ''
  });
}

function inspectDisplayValue(
  scene: VideoScene,
  field: StoryboardDisplayIssue['field'],
  value: string | undefined | null,
  issues: StoryboardDisplayIssue[]
) {
  const label = compactDisplayLabel(value, field === 'subtitle' ? 24 : field === 'headline' ? 18 : 12);
  if (!label) return;
  if (isWeakDisplayLabel(label)) {
    issues.push({
      sceneId: scene.id,
      order: scene.order,
      field,
      value: label,
      reason: 'weak_or_truncated_label'
    });
  }
}

function collectSceneDisplayIssues(scene: VideoScene) {
  const issues: StoryboardDisplayIssue[] = [];
  inspectDisplayValue(scene, 'headline', scene.headline, issues);
  inspectDisplayValue(scene, 'subtitle', scene.subtitle, issues);
  inspectDisplayValue(scene, 'emphasis', scene.emphasis, issues);
  for (const card of scene.cards || []) inspectDisplayValue(scene, 'cards', card, issues);
  for (const keyword of scene.keywords || []) inspectDisplayValue(scene, 'keywords', keyword, issues);
  return issues;
}

export function enhanceSceneDisplayLayer(scene: VideoScene): VideoScene {
  const cleanScene = sanitizeSceneText(scene);
  const cards = deriveDisplayCards(cleanScene);
  const headline = deriveDisplayHeadline(cleanScene, cards);
  const subtitle = deriveDisplaySubtitle(cleanScene, headline, cards);
  const ctaDisplay = cleanScene.shotType === 'cta' || cleanScene.layout === 'cta'
    ? deriveCtaDisplay(cleanScene)
    : null;
  const emphasis = ctaDisplay?.emphasis
    || compactDisplayLabel(cleanScene.emphasis, 12)
    || cards.find((item) => item !== headline)
    || compactDisplayLabel(cleanScene.keywords?.[0], 12)
    || undefined;
  const keywords = ctaDisplay?.keywords || pruneRedundantLabels(uniqueDisplayLabels([
    ...(cleanScene.keywords || []).map((item) => compactDisplayLabel(item, 10)),
    ...cards.map((item) => compactDisplayLabel(item, 10)),
    compactDisplayLabel(headline, 10)
  ])).filter(isUsefulDisplayLabel).slice(0, 6);

  return {
    ...cleanScene,
    headline,
    subtitle,
    emphasis: emphasis && !isWeakDisplayLabel(emphasis) ? emphasis : undefined,
    cards,
    keywords,
    visualPrompt: buildVisualPrompt(cleanScene, headline, subtitle, cards)
  };
}

export function repairStoryboardDisplayLayer(scenes: VideoScene[]): StoryboardDisplayCheckResult {
  const repairedScenes = scenes.map((scene) => enhanceSceneDisplayLayer(scene));
  const issues = repairedScenes.flatMap((scene) => collectSceneDisplayIssues(scene));
  const repaired = repairedScenes.some((scene, index) => displaySnapshot(scene) !== displaySnapshot(scenes[index]));

  return {
    scenes: repairedScenes,
    issues,
    repaired,
    passed: issues.length === 0
  };
}

export function summarizeStoryboardDisplayIssues(issues: StoryboardDisplayIssue[], limit = 5) {
  return issues
    .slice(0, limit)
    .map((issue) => `scene ${issue.order} ${issue.field}: ${issue.value}`)
    .join(' | ');
}
