function normalizeInlineText(value: unknown) {
  return typeof value === 'string'
    ? value
      .replace(/\s+/g, ' ')
      .replace(/```(?:json)?/gi, '')
      .trim()
    : '';
}

function trimOuterPunctuation(value: string) {
  return value
    .replace(/^[“”"'‘’`《【(\[]+/, '')
    .replace(/[“”"'‘’`》】)\]]+$/, '')
    .trim();
}

function compactDisplayLabel(value: string, maxLength = 16) {
  const cleaned = trimOuterPunctuation(normalizeInlineText(value));
  if (!cleaned) return '';
  const trimmed = cleaned.replace(/[。.!?！？；;:]+$/, '').trim();
  return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength - 1)}…`;
}

function isUsefulDisplayTerm(value: string) {
  const text = compactDisplayLabel(value, 32);
  if (!text) return false;
  if (text.length < 2 || text.length > 18) return false;
  if (/^[0-9]+$/.test(text)) return false;
  if (/^(和|与|或|但|而且|因为|所以|如果|然后|适合|需要|让用户|让观众|核心|关键|重点|本质|目标|前提)$/.test(text)) return false;
  if (/[…]{1,}/.test(text)) return false;
  if (/^[，,。.!?！？；;:\/｜|]+$/.test(text)) return false;
  return true;
}

function scoreDisplayTerm(value: string) {
  let score = 0;
  const text = compactDisplayLabel(value, 32);
  if (!text) return -999;

  if (text.length >= 3 && text.length <= 6) score += 5;
  else if (text.length === 2) score += 3;
  else if (text.length <= 8) score += 4;
  else if (text.length <= 12) score += 2;
  else score -= 2;

  if (/品牌|团队|CEO|认知|人格|轮廓|方法|路径|对象|前提|案例|入口|流程|结果|标准|指标|风险|工具|总结|综述|结论|步骤|清单|模块|场景|任务/.test(text)) score += 2;
  if (/需要|适合|让|形成|建立|替代|替换|看见|看到|理解|感受|第一次|第一种|第二种|第三种|第四种|模式|看完/.test(text)) score -= 4;
  if (/本人|它|这个|这些|那些/.test(text)) score -= 3;
  if (/[…]{1,}|[。.!?！？；;:\/｜|]/.test(text)) score -= 8;
  if (/^[一二三四五六七八九十\d]+$/.test(text)) score -= 6;

  return score;
}

function isGoodHeadline(text: string) {
  if (!isUsefulDisplayTerm(text)) return false;
  if (/需要|适合|让|形成|建立|替代|替换|看见|看到|理解|感受|看完|带着|包含|指向|围绕|写出来|没有问题|都没有问题/.test(text)) return false;
  if ((text.includes('是') && text.length > 6) || /^第[一二三四五六七八九十\d]+/.test(text)) return false;
  return true;
}

function stripOrdinalPrefix(value: string) {
  return value
    .replace(/^第[一二三四五六七八九十\d]+/, '')
    .replace(/^(?:种|类|步|个|章|节|部分|层|页|块|条|段|次)/, '')
    .replace(/^模式[一二三四五六七八九十\d]+/, '模式');
}

function trimActionPrefix(value: string) {
  return value
    .replace(/^(?:第一次|首次|先|先行|先把|先做|先要|尽量|最好|建议|可以|应该|必须|请先|最终|最后)+/, '')
    .replace(/^(?:建立|形成|理解|感受|看到|看见|替代|替换|传递|呈现|推动|推进|支撑|打开|获得|完成|实现|减少|避免|证明|区分|落地|输出|连接|陪伴|使用|选择|进入|展开|收束|变化|变成|做成)/, '');
}

function stripMeasurePrefix(value: string) {
  return value.replace(/^[一二三四五六七八九十\d]+(?:支|份|个|组|类|段|页|条|张|篇|部|本|台|项|种|次)/, '');
}

function looksLikeSentenceFragment(value: string) {
  return /需要|适合|让|核心|关键|重点|本质|不是|而是|第一|第二|第三|第四|第五|模式|形成|带着|包含|指向|围绕|建立|看见|看到|理解|感受|看完|是|没有|失败|常见|问题/.test(value);
}

function simplifySentenceFragment(value: string) {
  const compact = compactDisplayLabel(value, 64);
  if (!compact) return [];
  if (compact.length <= 12 && !/[，,。.!?！？；;:\/｜|]/.test(compact) && !looksLikeSentenceFragment(compact)) {
    return [compact];
  }

  const candidates = new Set<string>();
  const add = (item: string) => {
    const label = compactDisplayLabel(item, 18);
    if (isUsefulDisplayTerm(label)) candidates.add(label);
  };

  const keywordHints = [
    '品牌理念',
    '传播层',
    '真实场景',
    '抽象词',
    '口号',
    '信任',
    '认知',
    '人格',
    '案例',
    '流程',
    '步骤',
    '方法',
    '路径',
    '标准',
    '指标',
    '风险',
    '工具',
    '结果',
    '结论',
    '综述',
    '清单',
    '模块',
    '对象',
    '场景',
    '任务'
  ];
  for (const hint of keywordHints) {
    if (compact.includes(hint)) add(hint);
  }
  if (compact.includes('相信')) {
    add('信任');
  }

  const needMatch = compact.match(/^(.+?)需要(?:它|这个|这件事|这个东西)?来(.+)$/);
  if (needMatch) {
    add(trimActionPrefix(stripOrdinalPrefix(needMatch[1])));
    add(trimActionPrefix(needMatch[2]));
  }

  const leadVerbMatch = compact.match(/^(?:形成|建立|打造|构成|变成|成为|呈现|提供|输出|避免|替代|替换|依赖|借助|依托|保留|强调)(.+)$/);
  if (leadVerbMatch) {
    add(trimActionPrefix(stripOrdinalPrefix(leadVerbMatch[1])));
  }

  const fitMatch = compact.match(/^适合(.+)$/);
  if (fitMatch) {
    add(trimActionPrefix(stripOrdinalPrefix(fitMatch[1])));
  }

  const showMatch = compact.match(/^让(?:用户|观众|老板|团队)?(?:先)?(?:看见|看到|理解|感受到)(.+)$/);
  if (showMatch) {
    add(trimActionPrefix(stripOrdinalPrefix(showMatch[1])));
  }

  const watchMatch = compact.match(/^(.+?)看完之后$/);
  if (watchMatch) {
    add(trimActionPrefix(stripOrdinalPrefix(stripMeasurePrefix(watchMatch[1]))));
  }

  const coreMatch = compact.match(/^(?:核心|关键|重点|本质|目的|要点)(?:是|在于)?(.+)$/);
  if (coreMatch) {
    add(trimActionPrefix(stripOrdinalPrefix(coreMatch[1])));
  }

  const contrastMatch = compact.match(/^不是(.+?)(?:，|,)?而是(.+)$/);
  if (contrastMatch) {
    add(trimActionPrefix(stripOrdinalPrefix(contrastMatch[1])));
    add(trimActionPrefix(stripOrdinalPrefix(contrastMatch[2])));
  }

  const caseMatch = compact.match(/^(.+?)是(.+)$/);
  if (caseMatch) {
    add(trimActionPrefix(stripOrdinalPrefix(caseMatch[1])));
    add(trimActionPrefix(stripOrdinalPrefix(caseMatch[2])));
  }

  const carryMatch = compact.match(/^(.+?)带着(.+)$/);
  if (carryMatch) {
    add(trimActionPrefix(stripOrdinalPrefix(carryMatch[1])));
    add(trimActionPrefix(stripOrdinalPrefix(carryMatch[2])));
  }

  const containMatch = compact.match(/^(.+?)包含(.+)$/);
  if (containMatch) {
    add(trimActionPrefix(stripOrdinalPrefix(containMatch[1])));
    add(trimActionPrefix(stripOrdinalPrefix(containMatch[2])));
  }

  const modeMatch = compact.match(/^(?:第[一二三四五六七八九十\d]+(?:种|类|步|个|章|节|部分|层|页|块|条|段)?|模式[一二三四五六七八九十\d]+)(?:模式|方案|方法|路径|场景|任务|定位|入口|综述)?(?:是|定位|任务|入口|方法|综述)?(.+)$/);
  if (modeMatch) {
    add(trimActionPrefix(stripOrdinalPrefix(modeMatch[1])));
  }

  const colonIndex = compact.indexOf('：');
  if (colonIndex !== -1) {
    add(trimActionPrefix(stripOrdinalPrefix(compact.slice(colonIndex + 1))));
  }

  const lastDeIndex = compact.lastIndexOf('的');
  if (lastDeIndex > 0 && compact.length > 8) {
    add(trimActionPrefix(stripOrdinalPrefix(compact.slice(lastDeIndex + 1))));
  }

  if (/案例/.test(compact) && compact.length > 8) {
    add('案例');
  }

  if (!candidates.size) {
    add(trimActionPrefix(stripOrdinalPrefix(compact)));
  }

  return Array.from(candidates);
}

export function extractDisplayModules(value: unknown, limit = 5, maxChars = 12) {
  const normalized = normalizeInlineText(value);
  if (!normalized) return [];

  const coreMatch = normalized.match(/(?:核心模块|核心信息|核心内容|核心要点|主模块|模块|核心卡片|模块列表)[:：]\s*([^。！？!?]+)/)?.[1];
  const source = coreMatch || normalized;

  const segments = source
    .split(/[\/｜|、,，;；\n]/)
    .flatMap((item) => simplifySentenceFragment(item))
    .map((item) => compactDisplayLabel(item, maxChars))
    .filter(isUsefulDisplayTerm);

  const ranked = Array.from(new Set(segments)).sort((a, b) => {
    const scoreDiff = scoreDisplayTerm(b) - scoreDisplayTerm(a);
    if (scoreDiff) return scoreDiff;
    return a.length - b.length;
  });
  return ranked.slice(0, limit);
}

export function pickDisplayLabel(candidates: unknown[], maxChars = 18) {
  for (const candidate of candidates) {
    const labels = extractDisplayModules(candidate, 3, maxChars);
    if (labels.length) return labels[0];
    const text = compactDisplayLabel(typeof candidate === 'string' ? candidate : '', maxChars);
    if (isUsefulDisplayTerm(text)) return text;
  }
  return '';
}

export function pickDisplayHeadline(candidates: unknown[], maxChars = 18) {
  for (const candidate of candidates) {
    const text = compactDisplayLabel(typeof candidate === 'string' ? candidate : '', maxChars);
    if (isGoodHeadline(text)) return text;
    const labels = extractDisplayModules(candidate, 3, maxChars);
    for (const label of labels) {
      if (isGoodHeadline(label)) return label;
    }
  }
  return '';
}

export function pickDisplayLabels(candidates: unknown[], limit = 5, maxChars = 12) {
  const collected = candidates.flatMap((candidate) => extractDisplayModules(candidate, limit, maxChars));
  return Array.from(new Set(collected)).slice(0, limit);
}
