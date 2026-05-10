import { Script, Topic, Tutorial } from './types';
import { generateText, isTextGenerationConfigured } from './providers/text';
import { nowIso, simpleId } from './storage';

interface ProfessionalShot {
  title: string;
  voiceover: string;
  visualPrompt?: string;
}

interface ProfessionalScriptDraft {
  title: string;
  hook: string;
  shots: ProfessionalShot[];
  cta: string;
}

type GenerateScriptsProgress = {
  stage: 'requesting-model' | 'validating-result' | 'completed';
  detail: string;
  previewText?: string;
  streamText?: string;
  persist?: boolean;
  attempt?: number;
  maxAttempts?: number;
  elapsedMs?: number;
};

type GenerateScriptsOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: GenerateScriptsProgress) => void | Promise<void>;
};

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  throw new Error(typeof signal.reason === 'string' ? signal.reason : '用户已停止脚本生成');
}

const LOW_VALUE_PATTERNS = [
  /^#+\s*/,
  /^[-*]\s*$/,
  /^目录$/,
  /^table of contents$/i,
  /^第?\d+\s*页$/,
  /^page\s*\d+$/i
];

const DIRECTOR_NOTE_PATTERNS = [
  /先把使用边界说清楚，后面的操作才不会混乱[。！]?/g,
  /这里要讲清楚[^。！？]*[。！]?/g,
  /这一段要保留[^。！？]*[。！]?/g,
  /让观众知道为什么要这么做，而不是只看到一个操作结果[。！]?/g,
  /这一点要提前确认，否则流程看起来已经完成，实际结果还可能需要人工校验[。！]?/g,
  /镜头需人工确认后再进入视频制作[。；;，,]*/g
];

const LOW_VALUE_SCRIPT_PATTERNS = [
  /这一步做完，后面的流程才能顺着接上[。！]?/g,
  /如果这一步没提前确认，落地时通常还得返工或人工补一次[。！]?/g,
  /先把适用场景交代清楚，后面的步骤才更容易看懂[。！]?/g,
  /按这套流程做更稳/g,
  /先确认这几个步骤/g,
  /根据文档自动生成讲解视频脚本/g,
  /这条视频讲清楚/g,
  /先把问题说清，再按文档拆步骤，最后提醒容易出错的地方[。！]?/g,
  /先看它解决的核心问题[：:]?/g,
  /建议从最小的一组素材开始[，,]?/g,
  /跑通以后，再把步骤、提示词和检查项沉淀成自己的固定模板[。！]?/g
];

const LOW_VALUE_TITLE_PATTERNS = [
  /按这套流程做更稳/,
  /先确认这几个步骤/,
  /自动生成讲解视频脚本/,
  /^步骤\s*\d+$/,
  /^镜头\s*\d+$/
];

const BROKEN_SHOT_PATTERNS = [
  /^\d+[.、．)\]]\s*/,
  /^(个工具|个信号|个问题|个场景|个模型|个案例)/,
  /^类[：:]/,
  /^第[一二三四五六七八九十\d]+$/,
  /^[：:，,、]/,
  /^https?:\/\//
];

function cleanLine(value: string) {
  return value
    .replace(/\r/g, '')
    .replace(/\t/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[-*•]\s*/, '')
    .trim();
}

function sentenceLength(value: string) {
  return value.replace(/\s/g, '').length;
}

function splitRawLines(raw: string) {
  return raw
    .split(/\n+/)
    .map(cleanLine)
    .filter((line) => line && sentenceLength(line) >= 8)
    .filter((line) => !LOW_VALUE_PATTERNS.some((pattern) => pattern.test(line)));
}

function splitSentences(raw: string) {
  return raw
    .replace(/\r/g, '\n')
    .split(/(?<=[。！？!?；;])\s*|\n+/)
    .map(cleanLine)
    .filter((line) => sentenceLength(line) >= 10)
    .filter((line) => !LOW_VALUE_PATTERNS.some((pattern) => pattern.test(line)));
}

function dedupeLines(lines: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of lines) {
    const key = line.slice(0, 42);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(line);
  }
  return result;
}

function clip(value: string, maxLength: number) {
  const text = cleanLine(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function stripDirectorNotes(value: string) {
  let cleaned = cleanLine(value);
  for (const pattern of DIRECTOR_NOTE_PATTERNS) cleaned = cleaned.replace(pattern, '');
  for (const pattern of LOW_VALUE_SCRIPT_PATTERNS) cleaned = cleaned.replace(pattern, '');
  return cleaned
    .replace(/[，,；;]{2,}/g, '，')
    .replace(/。{2,}/g, '。')
    .replace(/[，,；;]\s*[。！？]$/g, '。')
    .replace(/^[，,；;。！？\s]+/, '')
    .replace(/[，,；;。\s]+$/g, '')
    .trim();
}

function findFirstJsonObjectEnd(source: string, start: number) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function extractJsonObject(raw: string) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced || raw;
  const start = source.indexOf('{');
  if (start === -1) {
    throw new Error('Script response did not contain a JSON object');
  }
  const end = findFirstJsonObjectEnd(source, start);
  if (end === -1 || end <= start) {
    throw new Error('Script response did not contain a complete JSON object');
  }
  return JSON.parse(source.slice(start, end + 1));
}

function containsAny(value: string, keywords: string[]) {
  return keywords.some((keyword) => value.toLowerCase().includes(keyword.toLowerCase()));
}

function hasLowValueLanguage(value: string) {
  const text = cleanLine(value);
  return LOW_VALUE_SCRIPT_PATTERNS.some((pattern) => pattern.test(text));
}

function isWeakTitle(value: string) {
  const text = cleanLine(value);
  return !text || LOW_VALUE_TITLE_PATTERNS.some((pattern) => pattern.test(text));
}

function looksBrokenShotText(value: string) {
  const text = cleanLine(value);
  return !text || BROKEN_SHOT_PATTERNS.some((pattern) => pattern.test(text));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function topicKeywords(topic: Topic, tutorial: Tutorial) {
  return dedupeLines([
    topic.title,
    topic.painPoint,
    topic.angle,
    topic.hookType,
    ...tutorial.tools,
    ...tutorial.methods,
    ...tutorial.scenarios,
    ...tutorial.targetAudience
  ].flatMap((item) => cleanLine(item).split(/[，,、：: /]+/)))
    .filter((item) => item.length >= 2)
    .slice(0, 18);
}

function estimateScriptProfile(tutorial: Tutorial) {
  const rawLength = sentenceLength(tutorial.rawContent);
  const stepCount = Math.max(tutorial.steps.length, splitRawLines(tutorial.rawContent).filter((line) => /步骤|流程|操作|点击|选择|输入|上传|导入|生成|设置|检查|确认/.test(line)).length);
  const evidenceLimit = clamp(Math.ceil(rawLength / 120) + stepCount, 8, 32);
  const targetScriptChars = clamp(Math.round(rawLength * 0.82) + stepCount * 90, 900, 5200);
  const estimatedSeconds = clamp(Math.round(targetScriptChars / 4.2), 75, 760);
  return {
    evidenceLimit,
    targetScriptChars,
    duration: formatDuration(estimatedSeconds),
    style: `文档讲解脚本，根据原文约 ${rawLength} 字、${stepCount} 个步骤自动生成，重点保证逻辑完整和内容覆盖。`
  };
}

function formatDuration(seconds: number) {
  if (seconds < 120) return `约 ${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `约 ${minutes} 分 ${rest} 秒` : `约 ${minutes} 分钟`;
}

function extractEvidence(topic: Topic, tutorial: Tutorial, limit: number) {
  const keywords = topicKeywords(topic, tutorial);
  const lines = dedupeLines([...splitRawLines(tutorial.rawContent), ...splitSentences(tutorial.rawContent)])
    .filter((line) => cleanLine(line) !== cleanLine(tutorial.title))
    .filter((line) => !isMetadataLine(line, tutorial));
  const scored = lines.map((line, index) => {
    let score = 0;
    if (containsAny(line, keywords)) score += 8;
    if (/^\d+[.、]/.test(line) || /^第[一二三四五六七八九十]+/.test(line)) score += 6;
    if (containsAny(line, ['步骤', '方法', '流程', '操作', '生成', '设置', '选择', '输入', '导入', '输出'])) score += 5;
    if (containsAny(line, ['注意', '不要', '不能', '避免', '风险', '问题', '失败'])) score += 4;
    if (sentenceLength(line) >= 18 && sentenceLength(line) <= 140) score += 3;
    if (index < 20) score += 1;
    return { line, score, index };
  });

  const selected = scored
    .filter((item) => item.score >= 3)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.line);

  const fallback = lines.slice(0, limit);
  return dedupeLines(selected.length >= 3 ? selected : fallback).slice(0, limit);
}

function isMetadataLine(value: string, tutorial: Tutorial) {
  const text = cleanLine(value);
  const title = normalizeTitleSeed(tutorial.title);
  if (!text) return true;
  if (/知兔AI|来源[:：]|整理|^标题[:：]/.test(text)) return true;
  return normalizeTitleSeed(text) === title;
}

function meaningfulSummary(tutorial: Tutorial, evidence: string[]) {
  const summary = cleanLine(tutorial.summary);
  if (summary && !isMetadataLine(summary, tutorial) && normalizeTitleSeed(summary) !== normalizeTitleSeed(tutorial.title)) {
    return summary;
  }
  return evidence.find((item) => !isMetadataLine(item, tutorial)) || '';
}

function problemStatement(tutorial: Tutorial, evidence: string[], subject: string, outcome: string) {
  const candidates = [
    ...tutorial.keyQuotes,
    ...tutorial.risks,
    ...evidence,
    tutorial.summary
  ]
    .map(cleanLine)
    .filter((item) => item && !isMetadataLine(item, tutorial))
    .filter((item) => /困境|问题|痛点|无法|低效|散落|难|不会|麻烦|耗时|容易/.test(item))
    .filter((item) => !/[：:]$/.test(item));

  const direct = candidates.find((item) => sentenceLength(item) >= 14 && sentenceLength(item) <= 120);
  if (direct) return direct;

  if (outcome) return `把《${subject}》这件事从零散操作变成一套能复现的${outcome}`;
  return `把《${subject}》里的关键流程讲清楚，让用户照着步骤就能复现`;
}

function describeStepVoiceover(text: string) {
  const clean = cleanProfessionalLine(text);
  return clip(clean, 170);
}

function riskTitle(value: string) {
  return clip(cleanProfessionalLine(value)
    .replace(/^此时[，,：:\s]*/, '')
    .replace(/^这里要特别说明一个大家未来很可能会遇到的情况[。；;，,：:\s]*/, '')
    .split(/[。；;]/)[0], 24) || '需要提前检查的限制';
}

function describeRiskVoiceover(value: string) {
  return clip(cleanProfessionalLine(value), 170);
}

function normalizeStepTitle(value: string, index: number) {
  return cleanLine(value)
    .replace(/^\d+[.、]\s*/, '')
    .replace(/^第[一二三四五六七八九十\d]+步[：:\s]*/, '')
    .replace(/^步骤[一二三四五六七八九十\d]+[：:\s]*/, '')
    .replace(/^[，,。:：、\s]+/, '')
    || `步骤 ${index + 1}`;
}

function buildShotTitle(value: string, fallback: string) {
  const candidate = clip(cleanProfessionalLine(value)
    .replace(/^\d+[.、．)\]]\s*/, '')
    .replace(/^第[一二三四五六七八九十\d]+步[：:\s]*/, '')
    .replace(/^步骤[一二三四五六七八九十\d]+[：:\s]*/, '')
    .split(/[。；;]/)[0], 24);
  return !looksBrokenShotText(candidate) ? candidate : fallback;
}

function findSupportingEvidence(step: string, evidence: string[]) {
  const seed = normalizeTitleSeed(step)
    .replace(/^[一二三四五六七八九十\d]+[.、]\s*/, '')
    .slice(0, 18);
  if (!seed) return '';
  return evidence.find((item) => item.includes(seed) && sentenceLength(item) >= 28) || '';
}

function buildStepShot(step: string, evidence: string[], index: number): ProfessionalShot | null {
  const normalized = cleanProfessionalLine(normalizeStepTitle(step, index));
  if (!normalized || looksBrokenShotText(normalized)) return null;
  const support = cleanProfessionalLine(findSupportingEvidence(normalized, evidence));
  const voiceoverSource = sentenceLength(support) >= 28 ? support : normalized;
  const voiceover = clip(cleanProfessionalLine(voiceoverSource), 170);
  if (sentenceLength(voiceover) < 26) return null;
  const titleSeed = normalized.split(/[：:。；;]/)[0] || normalized;
  const title = buildShotTitle(titleSeed, `镜头 ${index + 1}`);
  if (looksBrokenShotText(title)) return null;
  return {
    title,
    voiceover,
    visualPrompt: `流程节点画面，高亮当前动作：${clip(voiceover, 70)}`
  };
}

function isWeakShot(shot: ProfessionalShot) {
  const title = cleanProfessionalLine(shot.title || '');
  const voiceover = cleanProfessionalLine(shot.voiceover || '');
  const visualPrompt = cleanLine(shot.visualPrompt || '');
  if (isWeakTitle(title) || looksBrokenShotText(title) || looksBrokenShotText(voiceover)) return true;
  if (sentenceLength(voiceover) < 26) return true;
  if (title === voiceover && sentenceLength(voiceover) < 60) return true;
  if (hasLowValueLanguage(`${title} ${voiceover} ${visualPrompt}`)) return true;
  return false;
}

function buildSteps(tutorial: Tutorial, evidence: string[]) {
  const parsedSteps = tutorial.steps.map((step, index) => {
    const title = normalizeStepTitle(step.title, index);
    const detail = cleanLine(step.detail || '');
    return detail && detail !== title ? `${title}：${detail}` : title;
  }).filter(isUsefulStepLine);

  if (parsedSteps.length >= 3) return dedupeStepLines(parsedSteps).slice(0, 10);

  return dedupeStepLines(evidence
    .filter((line) => containsAny(line, ['步骤', '方法', '流程', '操作', '生成', '设置', '选择', '输入', '导入', '输出']) || /^\d+[.、]/.test(line))
    .map((line, index) => normalizeStepTitle(line, index))
    .filter(isUsefulStepLine))
    .slice(0, 10);
}

function isUsefulStepLine(value: string) {
  const text = cleanLine(value);
  if (sentenceLength(text) < 6) return false;
  if (/^(个字段|字段，|点击确定|来源[:：])/.test(text)) return false;
  if (/^第?\d+\s*页/.test(text)) return false;
  return true;
}

function dedupeStepLines(lines: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of lines) {
    const normalized = cleanLine(line)
      .replace(/^第[一二三四五六七八九十\d]+步[：:\s]*/, '')
      .replace(/^\d+[.、]\s*/, '')
      .replace(/^(先打地基|实时跟进|打造高效入口|配置自动化)[，,：:\s]*/, '')
      .replace(/[，,。；;：:].*$/, '')
      .slice(0, 22);
    if ([...seen].some((key) => key.includes(normalized) || normalized.includes(key))) continue;
    seen.add(normalized);
    result.push(line);
  }
  return result;
}

function isRealRiskLine(value: string) {
  const text = cleanLine(value);
  if (sentenceLength(text) < 10) return false;
  if (/点击确定|奇妙的事情发生了|自动跳转|多了一列/.test(text)) return false;
  return /不能|不要|避免|风险|失败|校验|特别说明|必须|注意.*(不是|不能|不要|必须|情况|限制|英文)/.test(text);
}

function usefulKeyQuotes(tutorial: Tutorial) {
  return tutorial.keyQuotes
    .map(cleanLine)
    .filter((item) => item && item !== tutorial.title)
    .filter((item) => !/知兔AI|来源[:：]|整理|^\d+[.、]/.test(item))
    .filter((item, index, arr) => arr.findIndex((candidate) => normalizeTitleSeed(candidate) === normalizeTitleSeed(item)) === index)
    .slice(0, 3);
}

function buildHook(topic: Topic, tutorial: Tutorial, evidence: string[]) {
  const subject = titleSubject(tutorial, evidence);
  const outcome = titleOutcome(tutorial, evidence);
  const firstEvidence = problemStatement(tutorial, evidence, subject, outcome);
  const summary = meaningfulSummary(tutorial, evidence);
  const leading = clip(firstEvidence, 46);
  if (summary && !hasLowValueLanguage(summary)) {
    return cleanProfessionalLine(`${leading}。真正需要盯住的，是${clip(summary, 90)}。`);
  }
  return cleanProfessionalLine(`${leading}。下面按原文把关键步骤、限制条件和判断标准依次拆开。`);
}

function cleanProfessionalLine(value: string) {
  return stripDirectorNotes(cleanLine(value)
    .replace(/^第\s*\d+\s*步[：:\s]*/g, '')
    .replace(/^步骤\s*\d+[：:\s]*/g, '')
    .replace(/^关键点\s*\d+[：:\s]*/g, '')
    .replace(/^关键字幕[：:\s]*/g, '')
    .replace(/^最后收束[：:\s]*/g, '')
    .replace(/^补充说明\s*\d*[：:\s]*/g, '')
    .trim());
}

function normalizeTitleSeed(value: string) {
  return cleanLine(value)
    .replace(/\.(docx|txt|md|html)$/i, '')
    .replace(/\s+-\s*知兔AI$/i, '')
    .replace(/知兔AI/g, '')
    .replace(/^如何用AI/, '')
    .replace(/^如何/, '')
    .replace(/^用[^，,、]{1,12}搞定/, '')
    .replace(/[？?。！!]+$/g, '')
    .replace(/^[：:，,、\s]+/, '')
    .trim();
}

function titleSubject(tutorial: Tutorial, evidence: string[]) {
  const titleSeed = normalizeTitleSeed(tutorial.title);
  if (titleSeed.length >= 6) return clip(titleSeed, 28);

  const sourceCandidates = [
    tutorial.summary,
    ...tutorial.steps.map((step) => [step.title, step.detail].filter(Boolean).join('：')),
    ...evidence
  ]
    .map(normalizeTitleSeed)
    .filter((item) => item.length >= 4)
    .filter((item) => !/^第[一二三四五六七八九十\d]+/.test(item));

  const actionCandidate = sourceCandidates.find((item) => /生成|制作|搭建|创建|配置|设计|分析|整理|输出|上传|导入/.test(item));
  return clip(actionCandidate || sourceCandidates[0] || '把文档内容做成讲解视频', 26);
}

function titleOutcome(tutorial: Tutorial, evidence: string[]) {
  const titleText = cleanLine(tutorial.title);
  if (/客情|客户/.test(titleText)) return '客户管理流程';
  if (/爆款内容|内容拆解/.test(titleText)) return '爆款内容拆解表';
  if (/项目管理|任务管理|进度/.test(titleText)) return '项目管理看板';
  if (/证书|发放/.test(titleText)) return '证书批量发放流程';
  if (/写文案|文案/.test(titleText)) return '文案生成流程';
  if (/教案/.test(titleText)) return '完整教案';
  if (/试卷|题目|选择题|填空题|判断题|简答题/.test(titleText)) return '可用试卷';
  if (/PPT|演示|汇报|答辩/.test(titleText)) return '演示材料';
  if (/客服|售后|助手|智能体/.test(titleText)) return '智能助手';
  if (/音乐|歌曲|歌词/.test(titleText)) return '音乐作品';
  if (/绘本|故事|图片|海报/.test(titleText)) return '创意内容';

  const pool = [
    tutorial.title,
    tutorial.summary,
    ...tutorial.steps.map((step) => `${step.title} ${step.detail}`),
    ...evidence
  ].map(cleanLine);

  if (pool.some((item) => /客情|客户/.test(item))) return '客户管理流程';
  if (pool.some((item) => /爆款内容|内容拆解/.test(item))) return '爆款内容拆解表';
  if (pool.some((item) => /项目管理|任务管理|进度/.test(item))) return '项目管理看板';
  if (pool.some((item) => /证书|发放/.test(item))) return '证书批量发放流程';
  if (pool.some((item) => /写文案|文案/.test(item))) return '文案生成流程';
  if (pool.some((item) => /教案/.test(item))) return '完整教案';
  if (pool.some((item) => /试卷|题目|选择题|填空题|判断题|简答题/.test(item))) return '可用试卷';
  if (pool.some((item) => /PPT|演示|汇报|答辩/.test(item))) return '演示材料';
  if (pool.some((item) => /客服|售后|助手|智能体/.test(item))) return '智能助手';
  if (pool.some((item) => /报表|数据|表格|分析/.test(item))) return '分析报表';
  if (pool.some((item) => /音乐|歌曲|歌词/.test(item))) return '音乐作品';
  if (pool.some((item) => /绘本|故事|图片|海报/.test(item))) return '创意内容';
  return '';
}

function titleAction(tutorial: Tutorial, evidence: string[]) {
  const text = [tutorial.rawContent, tutorial.summary, ...evidence].join('\n');
  if (tutorial.steps.length >= 3) return `${tutorial.steps.length}步`;
  if (/上传|导入|文件|文档/.test(text)) return '上传文档后';
  if (/搭建|创建|配置|节点|工作流/.test(text)) return '搭好流程后';
  if (/提示词|指令|输入/.test(text)) return '写对提示词后';
  if (/分析|总结|提取|整理/.test(text)) return '整理内容后';
  return '';
}

function buildScriptTitle(topic: Topic, tutorial: Tutorial, evidence: string[]) {
  const subject = clip(titleSubject(tutorial, evidence), 18);
  const topicTitle = clip(normalizeTitleSeed(topic.title), 18);
  const tutorialTitle = clip(normalizeTitleSeed(tutorial.title), 18);
  const steps = buildSteps(tutorial, evidence);
  const firstStep = steps[0] ? clip(normalizeTitleSeed(steps[0]), 10) : '';
  const firstRisk = tutorial.risks[0] ? clip(normalizeTitleSeed(tutorial.risks[0]), 10) : '';

  const candidates = [
    tutorialTitle,
    subject && firstRisk ? `${subject}：${firstRisk}` : '',
    subject && firstStep ? `${subject}：${firstStep}` : '',
    subject,
    topicTitle
  ].map((item) => clip(item, 20)).filter((item) => item.length >= 6);

  return candidates.find((item) => !isWeakTitle(item)) || tutorialTitle || topicTitle || subject || '文档讲解脚本';
}

function buildBody(topic: Topic, tutorial: Tutorial, profile: ReturnType<typeof estimateScriptProfile>) {
  const evidence = extractEvidence(topic, tutorial, profile.evidenceLimit);
  const steps = buildSteps(tutorial, evidence);
  const subject = titleSubject(tutorial, evidence);
  const outcome = titleOutcome(tutorial, evidence);
  const lines: string[] = [];

  const firstProblem = problemStatement(tutorial, evidence, subject, outcome);
  lines.push(`1. 先交代目标：这条内容要解决的是“${clip(firstProblem, 72)}”。观众需要先知道为什么要做《${clip(subject, 24)}》，以及做完之后能得到什么${outcome ? `，也就是${outcome}` : ''}。`);

  const contextParts = [
    tutorial.tools.length ? `会用到${tutorial.tools.slice(0, 4).join('、')}` : '',
    tutorial.methods.length ? `核心方法是${tutorial.methods.slice(0, 3).join('、')}` : '',
    tutorial.scenarios.length ? `主要适用于${tutorial.scenarios.slice(0, 3).join('、')}` : '',
    tutorial.targetAudience.length ? `面向${tutorial.targetAudience.slice(0, 3).join('、')}` : ''
  ].filter(Boolean);
  if (contextParts.length) {
    lines.push(`2. 再说明准备条件：${contextParts.join('；')}。这一镜头的作用是让观众明确工具、场景和使用边界，不要一上来就直接跳操作。`);
  }

  const coreSteps = steps.length ? steps : evidence.slice(0, 8).map((item, index) => `关键点 ${index + 1}：${item}`);
  coreSteps.slice(0, 18).forEach((step, index) => {
    const order = lines.length + 1;
    const normalized = normalizeStepTitle(step, index);
    const focus = /注意|不要|不能|风险|失败|校验|确认/.test(normalized)
      ? '这一镜头要强调限制条件和检查动作。'
      : /点击|选择|输入|上传|导入|设置|配置|打开|保存/.test(normalized)
        ? '这一镜头要把具体操作顺序讲清楚。'
        : '这一镜头要讲清楚它在整体流程中的作用。';
    lines.push(`${order}. 第${index + 1}步：${clip(normalized, 105)}。${focus}`);
  });

  const riskLines = (tutorial.risks.length ? tutorial.risks : evidence).filter(isRealRiskLine);
  riskLines.slice(0, 2).forEach((risk) => {
    const order = lines.length + 1;
    lines.push(`${order}. 风险提醒：${clip(risk, 110)}。这一镜头放在结尾前，提醒用户哪些地方必须检查，避免只照着步骤做却忽略限制。`);
  });

  const quotes = usefulKeyQuotes(tutorial);
  if (quotes.length) {
    const order = lines.length + 1;
    lines.push(`${order}. 关键字幕：${quotes.map((item) => `“${clip(item, 42)}”`).join('、')}。这些句子适合放在画面上，帮助观众记住最核心的信息。`);
  }

  return lines.join('\n');
}

function naturalCta(topic: Topic, tutorial: Tutorial, evidence: string[]) {
  const subject = titleSubject(tutorial, evidence);
  const outcome = titleOutcome(tutorial, evidence);
  const target = outcome || clip(subject, 24);
  return `如果你接下来要实操《${clip(subject, 24)}》，先拿一组最小样本把${target}跑通，再回头补齐参数、检查项和异常处理。`;
}

function buildDirectorPrompt(topic: Topic, tutorial: Tutorial, evidence: string[], profile: ReturnType<typeof estimateScriptProfile>) {
  const subject = titleSubject(tutorial, evidence);
  const outcome = titleOutcome(tutorial, evidence);
  const summary = meaningfulSummary(tutorial, evidence);
  const steps = buildSteps(tutorial, evidence);
  const hookProblem = problemStatement(tutorial, evidence, subject, outcome);
  const remotionLayouts = dedupeLines([
    'hero: 开场问题、收益、主张',
    'process: 操作链路、节点推进、逐步展开',
    'contrast: 前后对比、错误与正确、方案差异',
    'timeline: 时间顺序、阶段推进、里程碑',
    'matrix: 分类、条件、维度比较',
    'checklist: 检查项、条件确认、落地清单',
    'mistake: 易错点、风险提醒、反例拆解',
    'network: 关系图、信息流、依赖关系',
    'cause: 原因、机制、因果结构',
    'pyramid: 分层结构、结论到依据',
    'chart: 只有原文确实出现数据、趋势、比例时才使用',
    'cta: 只用于结尾行动引导'
  ]);
  const visualModes = [
    '流程推进',
    '局部高亮',
    '节点逐个出现',
    '参数卡片切换',
    '对比翻牌',
    '关系连线',
    '时间线推进',
    '清单勾选',
    '风险警示闪现',
    '结果状态变化'
  ];
  const sourceBlocks = [
    `文档标题：${tutorial.title}`,
    summary ? `文档摘要：${summary}` : '',
    `内容主题：${subject}`,
    outcome ? `期望产出：${outcome}` : '',
    `核心问题：${hookProblem}`,
    tutorial.tools.length ? `工具：${tutorial.tools.join('、')}` : '',
    tutorial.methods.length ? `方法：${tutorial.methods.join('、')}` : '',
    tutorial.targetAudience.length ? `受众：${tutorial.targetAudience.join('、')}` : '',
    tutorial.scenarios.length ? `场景：${tutorial.scenarios.join('、')}` : '',
    steps.length ? `解析到的步骤：\n${steps.slice(0, 16).map((step, index) => `${index + 1}. ${step}`).join('\n')}` : '',
    evidence.length ? `原文依据：\n${evidence.slice(0, 18).map((item, index) => `${index + 1}. ${item}`).join('\n')}` : '',
    tutorial.risks.length ? `风险/注意：\n${tutorial.risks.slice(0, 8).map((item, index) => `${index + 1}. ${item}`).join('\n')}` : '',
    `期望时长：${profile.duration}`,
    `建议动画表达：${visualModes.join('、')}`,
    `Remotion 画面版式参考：\n${remotionLayouts.join('\n')}`
  ].filter(Boolean).join('\n\n');

  const systemPrompt = [
    '你是中文知识视频的总编导，不是摘要器，不是普通文案助手。',
    '你的任务是把输入文档改写成可直接进入 Remotion 分镜流程的专业讲解脚本。',
    '最高优先级：完整理解原文，尽可能保留有效信息，而不是为了更容易生成视频就把内容写空。',
    '',
    '在输出前，你必须先在内部完成这套固定工作流，然后再一次性输出 JSON：',
    '步骤 A：重建文档要解决的问题、适用对象、前置条件、最终产出。',
    '步骤 B：梳理原文里的事实、步骤、参数、限制、风险、判断标准，决定哪些信息必须保留。',
    '步骤 C：把内容组织成讲解视频的叙事顺序，通常按“问题/收益 -> 背景或边界 -> 原理或结构 -> 关键步骤 -> 限制与风险 -> 判断结果 -> 下一步行动”推进。',
    '步骤 D：把信息拆成镜头，每个镜头只承载一个明确任务；如果信息密度高，就增加镜头数量，不要把多个重点塞进同一屏。',
    '步骤 E：为每个镜头设计适合 Remotion 的动态画面表达，信息必须分步出现，不允许一开始整屏把所有内容全部展示出来。',
    '步骤 F：输出前自检，确认没有编造、没有漏掉关键限制、没有机械串场、没有把屏幕文字和旁白写成重复朗读。',
    '',
    '脚本规则：',
    '1. 只输出 JSON，不要 Markdown，不要解释，不要展示你的思考过程。',
    '2. 严格依据输入文档，不要编造文档里没有的功能、效果、结论、平台能力或数据。',
    '3. 不要为了压缩时长删掉关键条件、参数、限制、风险、检查动作和判断标准。',
    '4. 每个镜头的 voiceover 都必须像专业讲解视频旁白，负责解释、连接、判断，不能照本宣读屏幕文字。',
    '5. 屏幕文字必须短、准、可动画呈现；subtitle 和 visualPrompt 只能提炼重点，不能等于完整旁白。',
    '6. 镜头标题要短、明确、能概括画面任务，不要写“步骤一”“关键点”“补充说明”“最后收束”等机械标签。',
    '6.1 标题必须像编辑在写选题，长度尽量控制在 8 到 18 个汉字，优先短标题，不要写“按这套流程做更稳”“先确认这几个步骤”“根据文档自动生成讲解视频脚本”这类空泛题目。',
    '7. hook 直接点出问题、任务或认知差距，不要写空泛开场，不要写“今天这条视频”“接下来让我们看一下”这类口水话。',
    '8. shots 只放主体镜头，不要把开场和结尾重复塞进 shots。',
    '9. cta 只面向观众的下一步实践，不要面向视频制作人员，不要出现“确认镜头”“生成视频”“成片”之类内部流程话术。',
    '10. 镜头数量根据内容密度决定。短文不少于 8 个，中等文档通常 12 到 20 个，长文可以 20 到 36 个；宁可多镜头，也不要大段压缩。',
    '11. 每个 voiceover 控制在 60 到 220 个汉字；信息真的很多就拆镜头，不要缩水成空泛总结。',
    '12. 中间镜头按因果、结构、步骤和限制推进，避免连续几个镜头都在说同一件事，也避免重复同一句话术。',
    '13. 风险提醒只能写真实的限制、校验、失败条件、适用边界，没有就不要硬造。',
    '14. 明确禁用这些低质句式：“这一步做完，后面的流程才能顺着接上”“先把适用场景交代清楚，后面的步骤才更容易看懂”“如果这一步没提前确认，落地时通常还得返工或人工补一次”。',
    '',
    'Remotion 动态画面规则：',
    '1. visualPrompt 必须明确说明画面怎么动，至少包含“先出现什么、再展开什么、重点高亮什么、最后如何收束或切换”。',
    '2. 画面默认采用动画讲解风格、信息图风格、动态演示风格，不要把一个镜头做成静态 PPT 页面或整页文字海报。',
    '3. 可以使用流程推进、局部放大、节点逐个出现、对比卡翻转、连线建立、时间线推进、清单勾选、风险标记闪现、参数卡片切换等表达。',
    '4. visualPrompt 必须服务 Remotion 画面结构，比如流程图、字段卡、关系图、对比卡、检查清单、时间线、矩阵、原因链、金字塔结构等。',
    '5. 同一条脚本的镜头画面要有变化，不要每个镜头都用同一种版式或同一种静态信息卡。',
    '6. 禁止写“画面展示旁白全文”“整屏显示全部步骤”“全文逐字出现”之类无效描述。',
    '7. 不要让 visualPrompt 只是重复 voiceover，要让画面和旁白互补。',
    '',
    '输出格式必须严格为：{"title":"...","hook":"...","shots":[{"title":"...","voiceover":"...","visualPrompt":"..."}],"cta":"..."}',
    '其中每个 shot 的 visualPrompt 都必须写出动态呈现顺序，且天然适配 Remotion 动画分镜。'
  ].join('\n');

  const userPrompt = [
    '请基于下面资料生成“适合 Remotion 动态讲解视频”的专业分镜脚本。',
    '生成要求：',
    '1. 先按固定工作流在内部捋清原文，再输出结果。',
    '2. 优先保证内容覆盖和准确性，不要为了省镜头把内容写空。',
    '3. 旁白必须重写成讲解，不是朗读屏幕字。',
    '4. 每个镜头只表达一个明确目标，画面通过动画逐步展开，不要一屏堆满。',
    '5. visualPrompt 必须具体到 Remotion 可执行的动态表现，不要只写抽象风格词。',
    '6. 如果原文信息多，就拆更多镜头，把内容展开讲清楚。',
    '7. 尽量把原文里的步骤、限制、风险、参数、判断条件都体现在镜头里。',
    '',
    sourceBlocks
  ].join('\n');

  return { systemPrompt, userPrompt };
}

function normalizeProfessionalDraft(raw: unknown, fallbackTitle: string): ProfessionalScriptDraft | null {
  const value = raw as Partial<ProfessionalScriptDraft> | null;
  if (!value || typeof value !== 'object' || !Array.isArray(value.shots)) return null;
  const shots = value.shots
    .map((shot) => ({
      title: cleanProfessionalLine(String((shot as ProfessionalShot).title || '')),
      voiceover: cleanProfessionalLine(String((shot as ProfessionalShot).voiceover || '')),
      visualPrompt: cleanLine(String((shot as ProfessionalShot).visualPrompt || ''))
    }))
    .filter((shot) => sentenceLength(shot.title) >= 2 && sentenceLength(shot.voiceover) >= 18)
    .filter((shot) => !/关键字幕|最后收束|补充说明|关键点|第\d+步/.test(`${shot.title}${shot.voiceover}`))
    .filter((shot) => !isWeakShot(shot))
    .slice(0, 36);

  if (shots.length < 6) return null;
  const title = clip(cleanProfessionalLine(String(value.title || fallbackTitle)), 20) || fallbackTitle;
  const hook = cleanProfessionalLine(String(value.hook || shots[0].voiceover));
  const cta = cleanProfessionalLine(String(value.cta || ''));
  if (isWeakTitle(title) || hasLowValueLanguage(`${title} ${hook} ${cta}`) || sentenceLength(hook) < 32) return null;
  return {
    title,
    hook,
    shots,
    cta
  };
}

function draftToBody(draft: ProfessionalScriptDraft) {
  return draft.shots.map((shot) => `${shot.title}：${shot.voiceover}`).join('\n');
}

function buildAIScriptError(message: string) {
  return new Error(`AI 脚本生成失败：${message}`);
}

async function generateProfessionalDraft(topic: Topic, tutorial: Tutorial, evidence: string[], profile: ReturnType<typeof estimateScriptProfile>, options?: GenerateScriptsOptions) {
  throwIfAborted(options?.signal);
  const fallbackTitle = buildScriptTitle(topic, tutorial, evidence);
  if (!await isTextGenerationConfigured()) {
    throw buildAIScriptError('未配置 OPENAI_API_KEY，已停止脚本生成。');
  }

  try {
    const { systemPrompt, userPrompt } = buildDirectorPrompt(topic, tutorial, evidence, profile);
    const generated = await generateText({
      systemPrompt,
      userPrompt,
      temperature: 0.28,
      maxTokens: 8000,
      stream: true,
      timeoutMs: Number(process.env.OPENAI_SCRIPT_TIMEOUT_MS || process.env.MINIMAX_SCRIPT_TIMEOUT_MS || 1_800_000),
      maxRetries: Number(process.env.OPENAI_SCRIPT_MAX_RETRIES || process.env.MINIMAX_SCRIPT_MAX_RETRIES || 2),
      signal: options?.signal,
      onStatus: (status) => options?.onProgress?.({
        stage: status.phase === 'completed' ? 'validating-result' : 'requesting-model',
        detail: status.detail,
        previewText: status.previewText,
        streamText: status.streamText,
        persist: status.phase !== 'streaming',
        attempt: status.attempt,
        maxAttempts: status.maxAttempts,
        elapsedMs: status.elapsedMs
      })
    });
    if (!generated?.text) {
      throw buildAIScriptError('模型未返回可用文本。');
    }
    await options?.onProgress?.({
      stage: 'validating-result',
      detail: 'AI 已返回文本，正在校验脚本结构。',
      previewText: generated.text.slice(0, 160)
    });
    const parsed = extractJsonObject(generated.text);
    const normalized = normalizeProfessionalDraft(parsed, fallbackTitle);
    if (!normalized) {
      throw buildAIScriptError('模型返回内容未通过脚本结构校验。');
    }
    const result = {
      ...normalized,
      cta: /确认.*镜头|生成视频|成片出来|结尾行动|最后收束/.test(normalized.cta)
        ? naturalCta(topic, tutorial, evidence)
        : normalized.cta || naturalCta(topic, tutorial, evidence)
    };
    await options?.onProgress?.({
      stage: 'completed',
      detail: `脚本生成完成：${result.title}`,
      previewText: `${result.title}｜${result.hook}`
    });
    return result;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('AI 脚本生成失败：')) {
      throw error;
    }
    throw buildAIScriptError(error instanceof Error ? error.message : String(error));
  }
}

export async function generateScripts(topic: Topic, tutorial: Tutorial, options?: GenerateScriptsOptions): Promise<Script[]> {
  throwIfAborted(options?.signal);
  const profile = estimateScriptProfile(tutorial);
  const evidence = extractEvidence(topic, tutorial, profile.evidenceLimit);
  const draft = await generateProfessionalDraft(topic, tutorial, evidence, profile, options);
  const body = draftToBody(draft);

  return [{
    id: simpleId('script'),
    topicId: topic.id,
    tutorialId: tutorial.id,
    platform: 'document',
    duration: profile.duration,
    title: draft.title,
    hook: draft.hook,
    body,
    cta: draft.cta,
    style: `${profile.style}；由固定分镜工作流提示词生成，强调内容覆盖、动态画面设计与 Remotion 适配。`,
    createdAt: nowIso(),
    version: 1,
    sourceScriptId: undefined
  }];
}
