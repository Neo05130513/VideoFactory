import type { Script, Tutorial, VideoShotType, VideoVisualType } from './types';

export interface ScriptShotBreakdownItem {
  order: number;
  shotType: VideoShotType;
  title: string;
  voiceover: string;
  subtitle: string;
  visualPrompt: string;
  visualType: VideoVisualType;
  durationSec: number;
}

const LOW_SIGNAL_LINE_PATTERNS = [
  /^补充说明\s*\d*[：:\s]*$/i,
  /^说明\s*\d*[：:\s]*$/i,
  /^注意事项?[：:\s]*$/i,
  /^画面[：:\s]*$/i,
  /^镜头[：:\s]*$/i,
  /^场景[：:\s]*$/i,
  /^字幕[：:\s]*$/i,
  /^旁白[：:\s]*$/i,
  /^步骤[：:\s]*$/i,
  /^第[一二三四五六七八九十\d]+步[：:\s]*$/i,
  /^(例如|比如|等等|待补充|略|同上)$/i
] as const;

function cleanLine(value: string) {
  return value
    .replace(/\s+/g, ' ')
    .replace(/^[-*•]\s*/, '')
    .trim();
}

function stripDirectorNotes(value: string) {
  return cleanLine(value)
    .replace(/先把使用边界说清楚，后面的操作才不会混乱[。！]?/g, '')
    .replace(/先把适用场景交代清楚，后面的步骤才更容易看懂[。！]?/g, '')
    .replace(/先把[^。！？]*说清楚[。！]?/g, '')
    .replace(/后面的[^。！？]*才[^。！？]*[。！]?/g, '')
    .replace(/这里要讲清楚[^。！？]*[。！]?/g, '')
    .replace(/这一段要保留[^。！？]*[。！]?/g, '')
    .replace(/这一段主要是为了[^。！？]*[。！]?/g, '')
    .replace(/让观众知道为什么要这么做，而不是只看到一个操作结果[。！]?/g, '')
    .replace(/这一点要提前确认，否则流程看起来已经完成，实际结果还可能需要人工校验[。！]?/g, '')
    .replace(/如果这一步没提前确认，落地时通常还得返工或人工补一次[。！]?/g, '')
    .replace(/这一步做完，后面的流程才能顺着接上[。！]?/g, '')
    .replace(/画面可以先[^。！？]*[。！]?/g, '')
    .replace(/这里可以用[^。！？]*[。！]?/g, '')
    .replace(/这一句如果太长可以[^。！？]*[。！]?/g, '')
    .replace(/[，,；;]{2,}/g, '，')
    .replace(/。{2,}/g, '。')
    .replace(/[，,；;]\s*[。！？]$/g, '。')
    .replace(/^[，,；;。！？\s]+/, '')
    .replace(/[，,；;。\s]+$/g, '')
    .trim();
}

function isLowSignalLine(value: string) {
  const text = stripDirectorNotes(value);
  if (!text) return true;
  if (LOW_SIGNAL_LINE_PATTERNS.some((pattern) => pattern.test(text))) return true;
  if (/^[：:，,、；;。\-—]+$/.test(text)) return true;
  if (/[：:]$/.test(text)) return true;
  if (text.length <= 3 && !/[0-9a-zA-Z]/.test(text)) return true;
  return false;
}

function splitLongSentence(sentence: string, maxChars = 92) {
  const normalized = stripDirectorNotes(sentence);
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const phrases = normalized
    .split(/[，、]/)
    .map((item) => stripDirectorNotes(item))
    .filter(Boolean);
  if (phrases.length <= 1) return normalized.match(new RegExp(`.{1,${maxChars}}`, 'g')) || [normalized];

  const chunks: string[] = [];
  let current = '';
  for (const phrase of phrases) {
    const next = current ? `${current}，${phrase}` : phrase;
    if (current && next.length > maxChars && current.length >= 36) {
      chunks.push(current);
      current = phrase;
      continue;
    }
    current = next;
  }
  if (current) chunks.push(current);
  return chunks;
}

function mergeShortTail(chunks: string[], maxChars = 108) {
  const merged = [...chunks];
  const tail = merged[merged.length - 1];
  const previous = merged[merged.length - 2];
  if (tail && previous && tail.length < 45 && previous.length + tail.length + 1 <= maxChars) {
    merged.splice(merged.length - 2, 2, `${previous}。${tail}`);
  }
  return merged;
}

function splitNarrativeChunks(value: string) {
  const normalized = stripDirectorNotes(value);
  if (!normalized) return [];

  const units = normalized
    .split(/[。！？；]/)
    .map((sentence) => stripDirectorNotes(sentence))
    .filter((sentence) => sentence && !isLowSignalLine(sentence))
    .flatMap((sentence) => splitLongSentence(sentence));

  const chunks: string[] = [];
  let current = '';
  for (const unit of units) {
    const next = current ? `${current}。${unit}` : unit;
    if (current && next.length > 92 && current.length >= 46) {
      chunks.push(current);
      current = unit;
      continue;
    }
    current = next;
  }
  if (current) chunks.push(current);

  return mergeShortTail(chunks)
    .map((item) => stripDirectorNotes(item))
    .filter((item) => !isLowSignalLine(item));
}

function clip(value: string, maxLength: number) {
  const text = stripDirectorNotes(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}...`;
}

function estimateDuration(text: string) {
  const normalized = stripDirectorNotes(text).replace(/\s+/g, '');
  if (!normalized) return 2;

  const contentLength = normalized.replace(/[，。！？；：、,.!?;:()（）【】[\]\-—"'“”‘’]/g, '').length;
  const sentenceCount = Math.max(1, normalized.split(/[。！？；]/).filter(Boolean).length);
  const commaPauseCount = (normalized.match(/[，、：]/g) || []).length;
  const stopPauseCount = (normalized.match(/[。！？；]/g) || []).length;

  const base =
    contentLength <= 6 ? 1.8 :
    contentLength <= 12 ? 2.3 :
    2.2 + contentLength / 7.5;
  const pauseAllowance = commaPauseCount * 0.16 + stopPauseCount * 0.28 + Math.max(0, sentenceCount - 1) * 0.18;

  return Number(Math.max(1.8, Math.min(8.5, base + pauseAllowance)).toFixed(1));
}

function shotTitle(line: string, order: number) {
  return cleanLine(line)
    .replace(/^\d+[.、]\s*/, '')
    .replace(/^第[一二三四五六七八九十\d]+步[：:\s]*/, '')
    .replace(/^步骤[一二三四五六七八九十\d]+[：:\s]*/, '')
    .replace(/^[一二三四五六七八九十]+、\s*/, '')
    .replace(/^补充说明\s*\d+[：:\s]*/, '')
    .split(/[。；;]/)[0]
    .replace(/[。；;]$/, '')
    .slice(0, 34) || `镜头 ${order}`;
}

function splitBodyLines(script: Script, tutorial?: Tutorial) {
  const bodyLines = script.body
    .split(/\n+/)
    .map(cleanLine)
    .filter((line) => line && !/^总结一下/.test(line))
    .filter((line) => !/^补充说明\s*\d+$/.test(line))
    .filter((line) => !isLowSignalLine(line));

  const structured = bodyLines.filter((line) => (
    /^\d+[.、]/.test(line) ||
    /^[一二三四五六七八九十]+、/.test(line) ||
    /^.{2,36}[:：]\s*.+$/.test(line)
  ));
  const expandedStructured = (structured.length >= 4 ? structured : bodyLines)
    .flatMap((line) => {
      const parsed = parseBodyShot(line, 1);
      if (!parsed) return [];

      const chunks = splitNarrativeChunks(parsed.voiceover);
      if (chunks.length >= 2 && parsed.voiceover.length >= 70) {
        return chunks.map((chunk) => `${parsed.title}：${chunk}`);
      }
      return line;
    })
    .filter((line) => !isLowSignalLine(line))
    .slice(0, 28);

  if (structured.length >= 4) return expandedStructured;

  if (tutorial?.steps.length) {
    const stepLines = tutorial.steps
      .map((step) => cleanLine([step.title, step.detail].filter(Boolean).join('：')))
      .filter((line) => !isLowSignalLine(line));
    return [...expandedStructured, ...stepLines]
      .filter((line) => !isLowSignalLine(line))
      .slice(0, 28);
  }

  return expandedStructured;
}

function parseBodyShot(line: string, fallbackOrder: number) {
  const withoutOrder = cleanLine(line)
    .replace(/^\d+[.、]\s*/, '')
    .replace(/^第[一二三四五六七八九十\d]+步[：:\s]*/, '')
    .replace(/^步骤[一二三四五六七八九十\d]+[：:\s]*/, '');
  const match = withoutOrder.match(/^(.{2,36}?)[：:]\s*(.+)$/);
  if (!match) {
    const voiceover = stripDirectorNotes(withoutOrder);
    if (isLowSignalLine(voiceover)) return null;
    return { title: withoutOrder, voiceover };
  }
  const title = cleanLine(match[1]) || `镜头 ${fallbackOrder}`;
  const voiceover = stripDirectorNotes(match[2]) || stripDirectorNotes(withoutOrder);
  if (isLowSignalLine(voiceover)) return null;
  return { title: isLowSignalLine(title) ? voiceover : title, voiceover };
}

function inferBodyShotType(text: string, index: number, total: number): VideoShotType {
  const normalized = cleanLine(text);
  const painPattern = /为什么|问题|痛点|卡住|失败|出错|误区|陷阱|不要|别再|常见错误|风险|难点|空白|浪费|冲突|对比|差距|原因/;
  const resultPattern = /结果|效果|提升|增长|收益|更快|更稳|更省|减少|降低|优化|完成|实现|最终|所以|因此|回报|改善|更适合|复用/;
  const ctaPattern = /现在就|记得|建议你|可以先|马上|下一步|去试|去做|收藏|转发|点赞/;

  if (painPattern.test(normalized)) return 'pain';
  if (ctaPattern.test(normalized) && index >= total - 2) return 'result';
  if (resultPattern.test(normalized) && index >= Math.max(1, total - 3)) return 'result';
  if (index === 0 && /为什么|问题|误区|不要|别再/.test(normalized)) return 'pain';
  if (index === total - 1 && /总结|最后|最终|所以|因此|结果|效果/.test(normalized)) return 'result';
  return 'step';
}

function inferVisualType(text: string, shotType: VideoShotType): VideoVisualType {
  if (shotType === 'title' || shotType === 'cta') return 'slide';
  if (shotType === 'pain') return 'caption';
  if (shotType === 'result') return /数据|提升|增长|趋势|效率|比例|结果/.test(text) ? 'image' : 'caption';
  if (/步骤|流程|点击|选择|输入|上传|导入|生成|设置|操作|检查|确认/.test(text)) return 'screen';
  if (/数据|结果|提升|效率|对比|风险|问题|原因|趋势|网络|关系|结构/.test(text)) return 'image';
  return 'caption';
}

function inferVisualPrompt(text: string, title: string, shotType: VideoShotType) {
  if (shotType === 'title') return `开场标题画面，突出主题：${title}`;
  if (shotType === 'cta') return `结尾总结画面，突出下一步行动：${title}`;
  if (shotType === 'pain') return `问题拆解画面，用对比、警示标记和冲突结构呈现：${clip(text, 90)}`;
  if (shotType === 'result') return `结果展示画面，用数据、收益变化或完成态反馈呈现：${clip(text, 90)}`;
  if (/步骤|流程|点击|选择|输入|上传|导入|生成|设置|操作|检查|确认/.test(text)) {
    return `操作流程画面，分层展示：${clip(text, 90)}`;
  }
  if (/风险|注意|避免|不要|失败|问题/.test(text)) {
    return `风险提醒画面，用警示信息和要点卡片呈现：${clip(text, 90)}`;
  }
  return `讲解信息卡画面，围绕"${title}"展示关键概念和辅助图形。`;
}

export function buildScriptShotBreakdown(script: Script, tutorial?: Tutorial): ScriptShotBreakdownItem[] {
  const shots: ScriptShotBreakdownItem[] = [];
  const pushShot = (shotType: VideoShotType, title: string, voiceover: string) => {
    const order = shots.length + 1;
    const text = stripDirectorNotes(voiceover).replace(/^\d+[.、]\s*/, '');
    if (isLowSignalLine(text)) return;
    const nextTitle = shotTitle(title || text, order);
    shots.push({
      order,
      shotType,
      title: nextTitle,
      voiceover: text,
      subtitle: clip(text, 34),
      visualPrompt: inferVisualPrompt(text, nextTitle, shotType),
      visualType: inferVisualType(text, shotType),
      durationSec: estimateDuration(text)
    });
  };

  if (script.hook) pushShot('title', script.title, script.hook);
  const bodyLines = splitBodyLines(script, tutorial);
  bodyLines.forEach((line, index) => {
    const parsed = parseBodyShot(line, shots.length + 1);
    if (!parsed) return;
    const shotType = inferBodyShotType(parsed.voiceover, index, bodyLines.length);
    pushShot(shotType, parsed.title, parsed.voiceover);
  });
  if (script.cta) pushShot('cta', '总结与下一步', script.cta);

  return shots;
}
