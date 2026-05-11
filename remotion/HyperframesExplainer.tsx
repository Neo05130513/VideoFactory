import React from 'react';
import {
  AbsoluteFill,
  Audio,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig
} from 'remotion';
import type { RemotionSceneInput, RemotionVideoInput } from './types';
import { voiceoverVolume } from './audio';

const FPS = 30;

type HyperPalette = {
  bg: string;
  bg2: string;
  panel: string;
  panelStrong: string;
  stroke: string;
  text: string;
  muted: string;
  accent: string;
  accent2: string;
  accent3: string;
  good: string;
  warn: string;
};

const palettes: Record<string, HyperPalette> = {
  'clarity-blue': {
    bg: '#030712',
    bg2: '#082f49',
    panel: 'rgba(15, 23, 42, 0.78)',
    panelStrong: 'rgba(2, 6, 23, 0.92)',
    stroke: 'rgba(125, 211, 252, 0.28)',
    text: '#f8fafc',
    muted: '#b6c7dd',
    accent: '#38bdf8',
    accent2: '#a78bfa',
    accent3: '#22d3ee',
    good: '#34d399',
    warn: '#fbbf24'
  },
  'midnight-cyan': {
    bg: '#021316',
    bg2: '#064e3b',
    panel: 'rgba(8, 47, 73, 0.72)',
    panelStrong: 'rgba(3, 18, 24, 0.94)',
    stroke: 'rgba(45, 212, 191, 0.28)',
    text: '#f0fdfa',
    muted: '#a8d5dc',
    accent: '#2dd4bf',
    accent2: '#60a5fa',
    accent3: '#67e8f9',
    good: '#86efac',
    warn: '#fde047'
  },
  'sunset-amber': {
    bg: '#160c10',
    bg2: '#7c2d12',
    panel: 'rgba(67, 20, 7, 0.66)',
    panelStrong: 'rgba(27, 10, 16, 0.93)',
    stroke: 'rgba(251, 146, 60, 0.28)',
    text: '#fff7ed',
    muted: '#f5caa8',
    accent: '#fb923c',
    accent2: '#f472b6',
    accent3: '#facc15',
    good: '#86efac',
    warn: '#fde68a'
  }
};

const shotMeta: Record<RemotionSceneInput['shotType'], { label: string; tag: string; icon: string }> = {
  title: { label: 'Hyperframe 01', tag: 'Open', icon: '✦' },
  pain: { label: 'Hyperframe 02', tag: 'Problem', icon: '!' },
  step: { label: 'Hyperframe 03', tag: 'System', icon: '↳' },
  result: { label: 'Hyperframe 04', tag: 'Proof', icon: '✓' },
  cta: { label: 'Hyperframe 05', tag: 'Action', icon: '→' }
};

function sceneFrames(scene: RemotionSceneInput) {
  return Math.max(1, Math.ceil(scene.durationSec * FPS));
}

function getSceneStart(scenes: RemotionSceneInput[], index: number) {
  return scenes.slice(0, index).reduce((total, scene) => total + sceneFrames(scene), 0);
}

export function getHyperframesDurationInFrames(input: RemotionVideoInput) {
  return Math.max(FPS * 5, input.scenes.reduce((total, scene) => total + sceneFrames(scene), 0));
}

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function enterProgress(frame: number, fps: number) {
  return clamp(spring({ frame, fps, config: { damping: 20, stiffness: 86, mass: 0.85 } }), 0, 1.08);
}

function exitProgress(frame: number, duration: number) {
  return clamp(interpolate(frame, [duration - 15, duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  }));
}

function sceneProgress(frame: number, duration: number) {
  return clamp(frame / Math.max(1, duration));
}

function chapterBumperDurations(scene: RemotionSceneInput) {
  const durationInFrames = sceneFrames(scene);
  return {
    holdFrames: Math.max(10, Math.round(Math.min(durationInFrames * 0.06, FPS * 0.5))),
    fadeFrames: Math.max(8, Math.round(Math.min(durationInFrames * 0.04, FPS * 0.28)))
  };
}

function cascadeReveal(
  progress: number,
  scene: RemotionSceneInput,
  index: number,
  options: { start?: number; end?: number; step?: number; latestEnd?: number } = {}
) {
  const startBase = options.start ?? 0.08;
  const endBase = options.end ?? 0.28;
  const durationScale = scene.durationSec <= 7.6
    ? 0.74
    : scene.durationSec <= 8.1
      ? 0.82
      : scene.durationSec <= 8.8
        ? 0.9
        : 1;
  const step = Math.min(options.step ?? 0.1, (options.step ?? 0.1) * durationScale);
  const start = Math.max(0.04, startBase * durationScale + index * step);
  const span = Math.max(0.13, (endBase - startBase) * Math.max(0.72, durationScale));
  const end = Math.min(options.latestEnd ?? 0.58, start + span);
  return clamp(interpolate(progress, [start, end], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  }));
}

function compactText(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function splitLines(text: string, maxChars: number, maxLines: number) {
  const value = compactText(text);
  if (!value) return [''];
  return (value.match(new RegExp(`.{1,${maxChars}}`, 'g')) || [value]).slice(0, maxLines);
}

function cleanDisplayLabel(text: string, maxChars = 12) {
  const value = compactText(text)
    .replace(/^content-hash:.*/i, '')
    .replace(/[“”"']/g, '')
    .replace(/[.…]+$/g, '')
    .replace(/^第[一二三四五六七八九十]+个问题[，,：:\s]*(是)?/, '')
    .replace(/^第[一二三四五六七八九十]+种(模式)?[，,：:\s]*(是)?/, '')
    .replace(/^种(模式)?[，,：:\s]*(是)?/, '')
    .replace(/^(这个品牌的|这个任务的|这个品牌|这个任务|这份资料的|文档里的|文档里|文档给出的|文档强调|当前原文|最终判断|最终|需要注意)[，,：:\s]*/, '')
    .replace(/^(这节内容讲的是|这类内容尤其适合)/, '')
    .replace(/^(这里|这类内容|很多品牌|很多|如果|因为|所以|但是|而是|同时|另外|其实|问题是|需要|可以|就是|它可以|它要|它会)/, '')
    .replace(/^(第一|第二|第三|第四|第五|第六)(?:[步点]|[：:、\s]+)/, '')
    .replace(/^(一是|二是|三是|四是|五是|六是)[：:、\s]*/, '')
    .replace(/^(把|让|通过|完成|实现|用(?!户))/, '')
    .replace(/^是/, '')
    .replace(/什么样的/g, '')
    .replace(/更生动地/g, '生动')
    .replace(/品牌宣传视频/g, '品牌片')
    .replace(/品牌理念/g, '理念')
    .trim();
  const quoted = value.match(/[「“]([^」”]{2,18})[」”]/);
  if (quoted?.[1]) return cleanDisplayLabel(quoted[1], maxChars);
  if (!value || /^(AI|IP|业务|内容|方式|表达|问题)$/.test(value)) return '';
  const parts = value.split(/[，、。！？；;:：]/).map((item) => item.trim()).filter(Boolean);
  const bestPart = parts.find((item) => item.length >= 2 && item.length <= maxChars) || parts[0] || value;
  return bestPart.length <= maxChars ? bestPart : bestPart.slice(0, maxChars);
}

const displaySingleCharLabels = new Set(['人', '景', '事']);

function isUsefulDisplayItem(value: string) {
  if (displaySingleCharLabels.has(value)) return true;
  return value.length >= 2
    && !/^(问题|个问题|文档|例子|种模式|模式|任务|内容|方式|表达|输出|需要注意|最终判断|核心方法很简单|关键在于|就是三个字|三个字)$/.test(value)
    && !/^(它|这个|这类|这些|文档|比如|因为|而|但|如果|很多|对这个案例来说)/.test(value)
    && !/^在日常运营里/.test(value)
    && !/^[户景事]\S{4,}/.test(value)
    && !(/[「“]/.test(value) && !/[」”]/.test(value))
    && !/[支类种条句段项]$/.test(value)
    && !/[的了都在把让用及和跟与或、，：:；;]$/.test(value)
    && !(/[A-Za-z]$/.test(value) && !/(AI|IP|CEO|OiiOii|Lovart|Logo)$/i.test(value));
}

function sceneItems(scene: RemotionSceneInput, count = 5) {
  const primaryValues = [
    ...(scene.cards || []),
    scene.emphasis || '',
    scene.headline || '',
    ...(scene.keywords || [])
  ].map((item) => cleanDisplayLabel(item, 14)).filter(isUsefulDisplayItem);
  const unique = Array.from(new Set(primaryValues));
  if (unique.length) return unique.slice(0, count);

  const fallbackValues = splitLines(scene.visualPrompt || scene.headline || scene.emphasis || '', 12, count)
    .map((item) => cleanDisplayLabel(item, 12))
    .filter(isUsefulDisplayItem);
  if (fallbackValues.length) return Array.from(new Set(fallbackValues)).slice(0, count);
  return displayFallbackItems.slice(0, count);
}

const displayFallbackItems = ['输入资料', '结构拆解', '视觉表达', '节奏控制', '成片输出', '验证反馈'];

function displayItems(scene: RemotionSceneInput, count = 5) {
  const merged = [...sceneItems(scene, count), ...displayFallbackItems];
  return Array.from(new Set(merged)).slice(0, count);
}

function displaySummary(scene: RemotionSceneInput) {
  const cards = displayItems(scene, 3).filter((item) => item !== cleanDisplayLabel(scene.headline || '', 14));
  return cards.join(' / ') || cleanDisplayLabel(scene.emphasis || scene.headline || '', 24) || '';
}

function displayHeadline(scene: RemotionSceneInput, maxChars = 18) {
  const items = displayItems(scene, 1);
  return cleanDisplayLabel(scene.headline || scene.emphasis || items[0] || '', maxChars) || items[0] || '核心结构';
}

function labelFontSize(text: string, base: number) {
  if (text.length >= 12) return base - 7;
  if (text.length >= 9) return base - 4;
  return base;
}

function chartValues(scene: RemotionSceneInput, count = 5) {
  const source = scene.chartData?.length ? scene.chartData : [28, 46, 68, 82, 94];
  const values = source.slice(0, count).map((item) => clamp(Number(item) || 0, 8, 100));
  while (values.length < count) values.push(values[values.length - 1] || 42);
  return values;
}

function activeSubtitle(scene: RemotionSceneInput, frame: number) {
  const cue = scene.subtitleCues?.find((item) => frame >= item.startSec * FPS && frame <= item.endSec * FPS);
  return cue?.text || scene.subtitle;
}

function sceneSearchText(scene: RemotionSceneInput) {
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

function containsAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

function longVideoChapterName(sceneIndex: number, sceneCount: number, shotType: RemotionSceneInput['shotType']) {
  if (shotType === 'title') return '开场聚焦';
  if (shotType === 'cta') return '行动收束';
  const ratio = (sceneIndex + 1) / Math.max(1, sceneCount);
  if (ratio < 0.22) return '背景铺垫';
  if (ratio < 0.44) return '问题拆解';
  if (ratio < 0.68) return '方法展开';
  if (ratio < 0.88) return '证据判断';
  return '结论收束';
}

function longVideoChapterIndex(sceneIndex: number, sceneCount: number, shotType: RemotionSceneInput['shotType']) {
  if (shotType === 'title') return 0;
  if (shotType === 'cta') return 5;
  const ratio = (sceneIndex + 1) / Math.max(1, sceneCount);
  if (ratio < 0.22) return 1;
  if (ratio < 0.44) return 2;
  if (ratio < 0.68) return 3;
  if (ratio < 0.88) return 4;
  return 5;
}

function isChapterBoundary(sceneIndex: number, sceneCount: number, scene: RemotionSceneInput, scenes: RemotionSceneInput[]) {
  if (sceneCount < 9 || sceneIndex <= 0 || scene.shotType === 'title' || scene.shotType === 'cta') return false;
  const previous = scenes[sceneIndex - 1];
  if (!previous) return false;
  return longVideoChapterIndex(sceneIndex, sceneCount, scene.shotType) !== longVideoChapterIndex(sceneIndex - 1, sceneCount, previous.shotType);
}

function frameVariant(sceneIndex: number, mode: SceneMode) {
  const seed = modeDisplayName(mode).length + sceneIndex * 2;
  return seed % 3;
}

function useLayout() {
  const { width, height } = useVideoConfig();
  const isWide = width > height;
  return {
    isWide,
    stagePadX: isWide ? 92 : 58,
    stagePadY: isWide ? 58 : 84,
    headlineSize: isWide ? 66 : 62,
    bodySize: isWide ? 29 : 31
  };
}

function Background({ palette, progress, sceneIndex, sceneCount, mode }: { palette: HyperPalette; progress: number; sceneIndex: number; sceneCount: number; mode: SceneMode }) {
  const drift = interpolate(progress, [0, 1], [-38, 42]);
  const points = [
    [18, 14, 86, 18],
    [72, 12, 20, 72],
    [36, 78, 82, 30],
    [12, 42, 68, 82]
  ][sceneIndex % 4];
  const gridSize = sceneCount >= 10 ? (sceneIndex % 2 ? 62 : 82) : 70;
  const modeGlow = mode === 'radar' || mode === 'mistake'
    ? palette.warn
    : mode === 'quote' || mode === 'spotlight'
      ? palette.accent2
      : palette.accent3;
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at ${points[0]}% ${points[1]}%, ${palette.accent}34 0%, transparent 28%), radial-gradient(circle at ${points[2]}% ${points[3]}%, ${palette.accent2}2a 0%, transparent 30%), linear-gradient(${132 + (sceneIndex % 5) * 8}deg, ${palette.bg} 0%, ${palette.bg2} 100%)` }}>
      <div style={{ position: 'absolute', inset: 0, opacity: sceneCount >= 10 ? 0.14 : 0.18, backgroundImage: `linear-gradient(${palette.stroke} 1px, transparent 1px), linear-gradient(90deg, ${palette.stroke} 1px, transparent 1px)`, backgroundSize: `${gridSize}px ${gridSize}px`, transform: `translate(${drift}px, ${-drift * 0.5}px)` }} />
      <div style={{ position: 'absolute', width: 620, height: 620, borderRadius: 999, right: sceneIndex % 2 ? -110 : -190, bottom: sceneIndex % 3 ? -210 : -150, background: `radial-gradient(circle, ${modeGlow}2e 0%, transparent 66%)`, filter: 'blur(2px)' }} />
      <div style={{ position: 'absolute', width: 420, height: 420, borderRadius: 999, left: sceneIndex % 2 ? -150 : -80, top: sceneIndex % 3 ? 330 : 470, background: `radial-gradient(circle, ${palette.accent2}22 0%, transparent 68%)` }} />
    </AbsoluteFill>
  );
}

function WindowChrome({ palette, title, children }: { palette: HyperPalette; title: string; children: React.ReactNode }) {
  return (
    <div style={{ width: '100%', height: '100%', borderRadius: 34, overflow: 'hidden', border: `1px solid ${palette.stroke}`, background: palette.panelStrong, boxShadow: `0 34px 120px rgba(0,0,0,0.35), 0 0 80px ${palette.accent}1c` }}>
      <div style={{ height: 62, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', borderBottom: `1px solid ${palette.stroke}`, background: 'rgba(255,255,255,0.045)' }}>
        <div style={{ display: 'flex', gap: 9 }}>
          {['#fb7185', '#fbbf24', '#34d399'].map((color) => <div key={color} style={{ width: 13, height: 13, borderRadius: 999, background: color }} />)}
        </div>
        <div style={{ color: palette.muted, fontSize: 19, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 850 }}>{title}</div>
        <div style={{ width: 58, height: 22, borderRadius: 999, background: `${palette.accent}22`, border: `1px solid ${palette.stroke}` }} />
      </div>
      <div style={{ position: 'relative', height: 'calc(100% - 62px)' }}>{children}</div>
    </div>
  );
}

function Header({ input, scene, sceneIndex, sceneCount, palette, enter }: { input: RemotionVideoInput; scene: RemotionSceneInput; sceneIndex: number; sceneCount: number; palette: HyperPalette; enter: number }) {
  const layout = useLayout();
  const meta = shotMeta[scene.shotType];
  const chapter = longVideoChapterName(sceneIndex, sceneCount, scene.shotType);
  return (
    <div style={{ position: 'absolute', left: layout.stagePadX, right: layout.stagePadX, top: layout.stagePadY, display: 'flex', alignItems: 'center', justifyContent: 'space-between', opacity: enter, transform: `translateY(${(1 - enter) * -20}px)` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 48, height: 48, borderRadius: 18, display: 'grid', placeItems: 'center', background: `linear-gradient(135deg, ${palette.accent}, ${palette.accent2})`, color: '#020617', fontSize: 26, fontWeight: 950 }}>{meta.icon}</div>
        <div>
          <div style={{ color: palette.text, fontSize: layout.isWide ? 24 : 26, fontWeight: 940 }}>{meta.label}</div>
          <div style={{ color: palette.muted, fontSize: layout.isWide ? 15 : 17, letterSpacing: '0.16em', textTransform: 'uppercase' }}>{meta.tag} / {String(sceneIndex + 1).padStart(2, '0')} of {String(sceneCount).padStart(2, '0')}</div>
        </div>
      </div>
      <div style={{ display: 'grid', justifyItems: 'end', gap: 8 }}>
        <div style={{ color: palette.muted, fontSize: layout.isWide ? 18 : 20, maxWidth: layout.isWide ? 520 : 340, textAlign: 'right', lineHeight: 1.35 }}>{input.project.title}</div>
        {sceneCount >= 7 ? <div style={{ padding: '6px 13px', borderRadius: 999, color: palette.text, background: `${palette.accent}1f`, border: `1px solid ${palette.stroke}`, fontSize: layout.isWide ? 16 : 18, fontWeight: 850 }}>{chapter}</div> : null}
      </div>
    </div>
  );
}

function StoryRail({ sceneIndex, sceneCount, palette, enter, mode }: { sceneIndex: number; sceneCount: number; palette: HyperPalette; enter: number; mode: SceneMode }) {
  const layout = useLayout();
  if (sceneCount < 7) return null;
  const slots = Math.min(14, sceneCount);
  const currentSlot = Math.round((sceneIndex / Math.max(1, sceneCount - 1)) * (slots - 1));
  return (
    <div style={{ position: 'absolute', right: layout.isWide ? 38 : 18, top: layout.isWide ? 154 : 300, bottom: layout.isWide ? 174 : 276, width: layout.isWide ? 34 : 30, display: 'grid', gridTemplateRows: `repeat(${slots}, 1fr)`, alignItems: 'center', justifyItems: 'center', opacity: enter * 0.88 }}>
      {Array.from({ length: slots }).map((_, index) => {
        const active = index === currentSlot;
        const passed = index < currentSlot;
        return (
          <div key={index} style={{ width: active ? 18 : 8, height: active ? 18 : 8, borderRadius: 999, background: active ? palette.accent : passed ? `${palette.good}a8` : `${palette.text}22`, border: active ? `2px solid ${palette.text}` : `1px solid ${palette.stroke}`, boxShadow: active ? `0 0 24px ${palette.accent}88` : 'none' }} />
        );
      })}
      <div style={{ position: 'absolute', right: layout.isWide ? 32 : 28, top: '50%', transform: 'translateY(-50%) rotate(-90deg)', transformOrigin: 'right center', color: palette.muted, fontSize: layout.isWide ? 12 : 13, letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 850, whiteSpace: 'nowrap' }}>{modeDisplayName(mode)}</div>
    </div>
  );
}

function ChapterBumperOverlay({ scene, sceneIndex, sceneCount, palette, frame, enter, mode }: { scene: RemotionSceneInput; sceneIndex: number; sceneCount: number; palette: HyperPalette; frame: number; enter: number; mode: SceneMode }) {
  const layout = useLayout();
  const chapterIndex = longVideoChapterIndex(sceneIndex, sceneCount, scene.shotType);
  const chapterName = longVideoChapterName(sceneIndex, sceneCount, scene.shotType);
  const { holdFrames, fadeFrames } = chapterBumperDurations(scene);
  const fadeOut = clamp(interpolate(frame, [holdFrames, holdFrames + fadeFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
  if (fadeOut <= 0.01) return null;
  const title = splitLines(displayHeadline(scene), layout.isWide ? 18 : 12, 2);
  const accent = mode === 'radar' || mode === 'mistake' ? palette.warn : mode === 'quote' ? palette.accent2 : palette.accent;
  return (
    <AbsoluteFill style={{ background: `linear-gradient(135deg, rgba(2,6,23,${0.72 * fadeOut}), rgba(2,6,23,${0.54 * fadeOut}))`, opacity: enter * fadeOut }}>
      <div style={{ position: 'absolute', left: layout.stagePadX, right: layout.stagePadX, top: layout.isWide ? 128 : 188, bottom: layout.isWide ? 112 : 170, borderRadius: 38, border: `1px solid ${accent}80`, background: `linear-gradient(145deg, ${accent}1f, rgba(15,23,42,0.88))`, overflow: 'hidden', boxShadow: `0 40px 130px rgba(0,0,0,0.38), 0 0 80px ${accent}24` }}>
        <div style={{ position: 'absolute', left: layout.isWide ? 58 : 42, top: layout.isWide ? 54 : 60, color: accent, fontSize: layout.isWide ? 25 : 27, letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 950 }}>Chapter {String(chapterIndex).padStart(2, '0')}</div>
        <div style={{ position: 'absolute', left: layout.isWide ? 58 : 42, top: layout.isWide ? 112 : 122, color: palette.text, fontSize: layout.isWide ? 80 : 70, lineHeight: 1, fontWeight: 990 }}>{chapterName}</div>
        <div style={{ position: 'absolute', left: layout.isWide ? 58 : 42, right: layout.isWide ? 560 : 42, bottom: layout.isWide ? 62 : 74, color: palette.muted, fontSize: layout.isWide ? 34 : 36, lineHeight: 1.18, fontWeight: 850 }}>
          {title.map((line, index) => <div key={`${line}-${index}`}>{line}</div>)}
        </div>
        <div style={{ position: 'absolute', right: layout.isWide ? 58 : 42, bottom: layout.isWide ? 62 : 56, width: layout.isWide ? 410 : 300, display: 'grid', gap: 13 }}>
          {displayItems(scene, 3).map((item, index) => (
            <div key={`${item}-${index}`} style={{ padding: layout.isWide ? '15px 20px' : '17px 20px', borderRadius: 22, background: index === 0 ? `${accent}30` : 'rgba(255,255,255,0.06)', border: `1px solid ${index === 0 ? accent : palette.stroke}`, color: palette.text, fontSize: labelFontSize(item, layout.isWide ? 24 : 26), lineHeight: 1.1, fontWeight: 900, transform: `translateX(${(1 - enter) * 28}px)` }}>
              {item}
            </div>
          ))}
        </div>
        <div style={{ position: 'absolute', right: -90, top: -90, width: 330, height: 330, borderRadius: 999, border: `48px solid ${accent}18` }} />
        <div style={{ position: 'absolute', left: layout.isWide ? 58 : 42, right: layout.isWide ? 58 : 42, bottom: layout.isWide ? 34 : 34, height: 5, borderRadius: 999, background: palette.stroke }}>
          <div style={{ width: `${Math.min(100, (frame / Math.max(1, holdFrames + fadeFrames)) * 100)}%`, height: '100%', borderRadius: 999, background: `linear-gradient(90deg, ${accent}, ${palette.good})` }} />
        </div>
      </div>
    </AbsoluteFill>
  );
}

function HeroFrame({ scene, palette, enter, progress }: { scene: RemotionSceneInput; palette: HyperPalette; enter: number; progress: number }) {
  const layout = useLayout();
  const lines = splitLines(displayHeadline(scene), layout.isWide ? 16 : 11, 3);
  const cards = displayItems(scene, 3);
  return (
    <div style={{ position: 'absolute', left: layout.stagePadX, right: layout.stagePadX, top: layout.isWide ? 142 : 190, bottom: layout.isWide ? 112 : 178, opacity: enter }}>
      <WindowChrome palette={palette} title="hyperframe.canvas">
        <div style={{ position: 'absolute', left: layout.isWide ? 58 : 34, top: layout.isWide ? 54 : 66, right: layout.isWide ? 660 : 34 }}>
          <div style={{ color: palette.accent, fontSize: layout.isWide ? 24 : 25, fontWeight: 950, letterSpacing: '0.12em', textTransform: 'uppercase' }}>AI-directed visual system</div>
          <div style={{ marginTop: 22, color: palette.text, fontSize: layout.headlineSize, lineHeight: 1.02, fontWeight: 980 }}>
            {lines.map((line, index) => <div key={`${line}-${index}`}>{line}</div>)}
          </div>
          <div style={{ marginTop: 26, color: palette.muted, fontSize: layout.bodySize, lineHeight: 1.42 }}>{splitLines(displaySummary(scene), layout.isWide ? 22 : 16, 2).join(' / ')}</div>
        </div>
        <div style={{ position: 'absolute', right: layout.isWide ? 54 : 42, bottom: layout.isWide ? 54 : 62, width: layout.isWide ? 540 : 420, display: 'grid', gap: 18 }}>
          {cards.map((card, index) => {
            const reveal = cascadeReveal(progress, scene, index, { start: 0.12, end: 0.34, step: 0.14, latestEnd: 0.52 });
            return (
              <div key={`${card}-${index}`} style={{ padding: '20px 24px', borderRadius: 24, border: `1px solid ${index === 0 ? palette.accent : palette.stroke}`, background: index === 0 ? `linear-gradient(135deg, ${palette.accent}38, ${palette.accent2}24)` : palette.panel, color: palette.text, fontSize: layout.isWide ? 28 : 30, fontWeight: 900, transform: `translateX(${(1 - reveal) * 34}px)`, opacity: reveal }}>
                <span style={{ color: index === 0 ? palette.accent : palette.muted, marginRight: 14 }}>0{index + 1}</span>{card}
              </div>
            );
          })}
        </div>
      </WindowChrome>
    </div>
  );
}

function WorkflowFrame({ scene, palette, enter, progress, variant }: { scene: RemotionSceneInput; palette: HyperPalette; enter: number; progress: number; variant: number }) {
  const layout = useLayout();
  const items = displayItems(scene, 5);
  const reverse = layout.isWide && variant === 1;
  const panelTitle = ['sequence.builder', 'operation.map', 'motion.flow'][variant] || 'sequence.builder';
  return (
    <div style={{ position: 'absolute', left: layout.stagePadX, right: layout.stagePadX, top: layout.isWide ? 148 : 198, bottom: layout.isWide ? 110 : 178, opacity: enter }}>
      <WindowChrome palette={palette} title={panelTitle}>
        <div style={{ position: 'absolute', inset: layout.isWide ? '52px 54px' : '58px 38px', display: layout.isWide ? 'grid' : 'flex', gridTemplateColumns: layout.isWide ? reverse ? '0.9fr 1.1fr' : '1.1fr 0.9fr' : undefined, flexDirection: layout.isWide ? undefined : 'column', gap: 34 }}>
          <div style={{ display: 'grid', gap: 18, order: reverse ? 2 : 1 }}>
            {items.map((item, index) => {
              const reveal = cascadeReveal(progress, scene, index, { start: 0.08, end: 0.26, step: 0.11, latestEnd: 0.5 });
              return (
                <div key={`${item}-${index}`} style={{ display: 'grid', gridTemplateColumns: '62px 1fr', gap: 16, alignItems: 'center', transform: `translateY(${(1 - reveal) * 24}px)`, opacity: reveal }}>
                  <div style={{ width: 62, height: 62, borderRadius: 22, display: 'grid', placeItems: 'center', background: index === 0 ? palette.accent : `${palette.accent}22`, color: index === 0 ? '#020617' : palette.accent, border: `1px solid ${palette.stroke}`, fontSize: 24, fontWeight: 950 }}>{index + 1}</div>
                  <div style={{ padding: '18px 22px', borderRadius: 24, background: palette.panel, border: `1px solid ${palette.stroke}`, color: palette.text, fontSize: layout.isWide ? 28 : 31, fontWeight: 900 }}>{item}</div>
                </div>
              );
            })}
          </div>
          <div style={{ position: 'relative', minHeight: layout.isWide ? undefined : 380, borderRadius: 30, background: variant === 2 ? `${palette.accent2}13` : 'rgba(255,255,255,0.05)', border: `1px solid ${palette.stroke}`, overflow: 'hidden', order: reverse ? 1 : 2 }}>
            <div style={{ position: 'absolute', inset: 28, borderRadius: 26, background: `linear-gradient(160deg, ${palette.accent}1f, ${palette.accent2}1c)` }} />
            {[0, 1, 2, 3].map((item) => (
              <div key={item} style={{ position: 'absolute', left: variant === 2 ? 52 + (item % 2) * 96 : 52 + item * 34, right: variant === 2 ? 52 + ((item + 1) % 2) * 86 : 52 + (3 - item) * 26, top: 62 + item * 74, height: 48, borderRadius: 18, background: item % 2 ? `${palette.good}44` : `${palette.accent}38`, transform: `scaleX(${clamp(progress * 1.4 - item * 0.18)})`, transformOrigin: 'left center' }} />
            ))}
            <div style={{ position: 'absolute', left: `${18 + progress * 56}%`, top: '52%', width: 26, height: 26, borderRadius: 999, background: palette.warn, boxShadow: `0 0 28px ${palette.warn}` }} />
          </div>
        </div>
      </WindowChrome>
    </div>
  );
}

function DataFrame({ scene, palette, enter, progress, variant }: { scene: RemotionSceneInput; palette: HyperPalette; enter: number; progress: number; variant: number }) {
  const layout = useLayout();
  const values = chartValues(scene, layout.isWide ? 6 : 5);
  const items = displayItems(scene, values.length);
  if (variant === 1) {
    const points = values.map((value, index) => `${(index / Math.max(1, values.length - 1)) * 100},${100 - value}`).join(' ');
    return (
      <div style={{ position: 'absolute', left: layout.stagePadX, right: layout.stagePadX, top: layout.isWide ? 150 : 202, bottom: layout.isWide ? 112 : 178, opacity: enter }}>
        <WindowChrome palette={palette} title="signal.curve">
          <div style={{ position: 'absolute', inset: layout.isWide ? '54px 58px' : '58px 42px', display: 'grid', gridTemplateRows: layout.isWide ? '0.46fr 0.54fr' : '0.42fr 0.58fr', gap: 24 }}>
            <div style={{ display: 'grid', gridTemplateColumns: layout.isWide ? '0.9fr 1.1fr' : '1fr', gap: 24, alignItems: 'center' }}>
              <div>
                <div style={{ color: palette.accent, fontSize: 24, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 950 }}>Evidence curve</div>
                <div style={{ marginTop: 18, color: palette.text, fontSize: layout.isWide ? 58 : 50, lineHeight: 1.05, fontWeight: 990 }}>{splitLines(displayHeadline(scene), layout.isWide ? 16 : 12, 2).map((line, index) => <div key={`${line}-${index}`}>{line}</div>)}</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 14 }}>
                {values.slice(0, 3).map((value, index) => (
                  <div key={`${value}-${index}`} style={{ borderRadius: 24, padding: '20px 18px', background: index === 0 ? `${palette.accent}24` : palette.panel, border: `1px solid ${index === 0 ? palette.accent : palette.stroke}` }}>
                    <div style={{ color: index === 0 ? palette.accent : palette.muted, fontSize: 16, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 900 }}>Metric {index + 1}</div>
                    <div style={{ marginTop: 10, color: palette.text, fontSize: layout.isWide ? 40 : 38, lineHeight: 1, fontWeight: 990 }}>{Math.round(value * progress)}</div>
                    <div style={{ marginTop: 10, color: palette.muted, fontSize: 17, fontWeight: 800 }}>{items[index]}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ position: 'relative', borderRadius: 28, background: palette.panelStrong, border: `1px solid ${palette.stroke}`, overflow: 'hidden' }}>
              <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0 }}>
                {[25, 50, 75].map((y) => <line key={y} x1="0" y1={y} x2="100" y2={y} stroke={palette.stroke} strokeWidth="0.35" />)}
                <polyline points={points} fill="none" stroke={palette.accent} strokeWidth="2" strokeDasharray="180" strokeDashoffset={String(180 - progress * 180)} />
                {values.map((value, index) => (
                  <circle key={index} cx={(index / Math.max(1, values.length - 1)) * 100} cy={100 - value} r={1.9 + progress * 1.2} fill={index % 2 ? palette.good : palette.accent2} />
                ))}
              </svg>
            </div>
          </div>
        </WindowChrome>
      </div>
    );
  }
  return (
    <div style={{ position: 'absolute', left: layout.stagePadX, right: layout.stagePadX, top: layout.isWide ? 150 : 202, bottom: layout.isWide ? 112 : 178, opacity: enter }}>
      <WindowChrome palette={palette} title="insight.dashboard">
        <div style={{ position: 'absolute', inset: layout.isWide ? '56px 58px' : '64px 42px', display: 'grid', gridTemplateColumns: layout.isWide ? '0.9fr 1.1fr' : '1fr', gap: 32 }}>
          <div style={{ display: 'grid', alignContent: 'center', gap: 24 }}>
            <div style={{ color: palette.accent, fontSize: 24, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 950 }}>Signal score</div>
            <div style={{ color: palette.text, fontSize: layout.isWide ? 86 : 92, lineHeight: 0.95, fontWeight: 990 }}>{Math.round(Math.max(...values))}<span style={{ color: palette.accent, fontSize: 42 }}>%</span></div>
            <div style={{ color: palette.muted, fontSize: layout.bodySize, lineHeight: 1.38 }}>{splitLines(displaySummary(scene), layout.isWide ? 20 : 15, 3).join(' ')}</div>
          </div>
          <div style={{ display: 'flex', gap: layout.isWide ? 18 : 14, alignItems: 'end', justifyContent: 'center', minHeight: 420 }}>
            {values.map((value, index) => {
              const reveal = cascadeReveal(progress, scene, index, { start: 0.1, end: 0.38, step: 0.08, latestEnd: 0.54 });
              return (
                <div key={`${value}-${index}`} style={{ flex: 1, maxWidth: 96, display: 'grid', gap: 12, alignItems: 'end' }}>
                  <div style={{ height: layout.isWide ? 320 : 410, display: 'flex', alignItems: 'end' }}>
                    <div style={{ width: '100%', height: `${value * reveal}%`, borderRadius: '22px 22px 10px 10px', background: `linear-gradient(180deg, ${palette.accent}, ${index % 2 ? palette.accent2 : palette.good})`, boxShadow: `0 0 36px ${palette.accent}33` }} />
                  </div>
                  <div style={{ color: palette.muted, fontSize: 16, textAlign: 'center', fontWeight: 800 }}>{items[index] || `M${index + 1}`}</div>
                </div>
              );
            })}
          </div>
        </div>
      </WindowChrome>
    </div>
  );
}

function ContrastFrame({ scene, palette, enter, progress }: { scene: RemotionSceneInput; palette: HyperPalette; enter: number; progress: number }) {
  const layout = useLayout();
  const items = displayItems(scene, 4);
  const mainIdea = displayHeadline(scene, 18);
  const left = splitLines(mainIdea, layout.isWide ? 18 : 14, 3);
  const right = items.filter((item) => item !== mainIdea).slice(0, 3);
  return (
    <div style={{ position: 'absolute', left: layout.stagePadX, right: layout.stagePadX, top: layout.isWide ? 152 : 204, bottom: layout.isWide ? 112 : 178, opacity: enter }}>
      <WindowChrome palette={palette} title="before.after">
        <div style={{ position: 'absolute', inset: layout.isWide ? '58px 58px' : '62px 38px', display: 'grid', gridTemplateColumns: layout.isWide ? '1fr 1fr' : '1fr', gap: 24 }}>
          <div style={{ borderRadius: 30, padding: 34, background: 'rgba(248, 113, 113, 0.12)', border: '1px solid rgba(248, 113, 113, 0.34)', transform: `translateX(${(1 - enter) * -28}px)` }}>
            <div style={{ color: '#fb7185', fontSize: 22, fontWeight: 950, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Before</div>
            <div style={{ marginTop: 24, color: palette.text, fontSize: layout.isWide ? 42 : 43, lineHeight: 1.13, fontWeight: 960 }}>{left.map((line, index) => <div key={`${line}-${index}`}>{line}</div>)}</div>
          </div>
          <div style={{ borderRadius: 30, padding: 34, background: `${palette.good}16`, border: `1px solid ${palette.good}66`, transform: `translateX(${(1 - enter) * 28}px)` }}>
            <div style={{ color: palette.good, fontSize: 22, fontWeight: 950, letterSpacing: '0.12em', textTransform: 'uppercase' }}>After</div>
            <div style={{ marginTop: 24, color: palette.text, fontSize: layout.isWide ? 42 : 43, lineHeight: 1.13, fontWeight: 960 }}>{right.map((line, index) => <div key={`${line}-${index}`}>{line}</div>)}</div>
          </div>
          <div style={{ gridColumn: layout.isWide ? '1 / 3' : undefined, display: 'grid', gridTemplateColumns: `repeat(${Math.min(4, items.length)}, 1fr)`, gap: 14 }}>
            {items.map((item, index) => (
              <div key={`${item}-${index}`} style={{ height: 10, borderRadius: 999, background: palette.stroke }}>
                <div style={{ height: '100%', width: `${clamp(progress * 1.2 - index * 0.12) * 100}%`, borderRadius: 999, background: index % 2 ? palette.accent2 : palette.accent }} />
              </div>
            ))}
          </div>
        </div>
      </WindowChrome>
    </div>
  );
}

function MatrixFrame({ scene, palette, enter, progress, variant }: { scene: RemotionSceneInput; palette: HyperPalette; enter: number; progress: number; variant: number }) {
  const layout = useLayout();
  const items = displayItems(scene, 4);
  const title = splitLines(displayHeadline(scene), layout.isWide ? 18 : 12, 2);
  const labels = ['定位', '证据', '节奏', '落点'];
  const titleRight = layout.isWide && variant === 1;
  const compactBand = layout.isWide && variant === 2;
  return (
    <div style={{ position: 'absolute', left: layout.stagePadX, right: layout.stagePadX, top: layout.isWide ? 150 : 202, bottom: layout.isWide ? 112 : 178, opacity: enter }}>
      <div style={{ position: 'absolute', inset: 0, borderRadius: 36, border: `1px solid ${palette.stroke}`, background: `linear-gradient(145deg, ${palette.panelStrong}, ${palette.panel})`, overflow: 'hidden', boxShadow: `0 30px 120px rgba(0,0,0,0.32)` }}>
        <div style={{ position: 'absolute', left: layout.isWide ? titleRight ? 610 : 52 : 38, top: layout.isWide ? 42 : 48, right: layout.isWide ? titleRight ? 52 : 610 : 38 }}>
          <div style={{ color: palette.accent, fontSize: 23, fontWeight: 950, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Core map</div>
          <div style={{ marginTop: 18, color: palette.text, fontSize: layout.isWide ? 54 : 50, lineHeight: 1.04, fontWeight: 990 }}>
            {title.map((line, index) => <div key={`${line}-${index}`}>{line}</div>)}
          </div>
        </div>
        <div style={{ position: 'absolute', left: layout.isWide ? titleRight ? 52 : 450 : 38, right: layout.isWide ? titleRight ? 450 : 38 : 38, top: layout.isWide ? compactBand ? 230 : 42 : 246, bottom: 42, display: 'grid', gridTemplateColumns: compactBand ? 'repeat(4, minmax(0, 1fr))' : 'repeat(2, minmax(0, 1fr))', gap: layout.isWide ? 20 : 18 }}>
          {items.map((item, index) => {
            const reveal = cascadeReveal(progress, scene, index, { start: 0.08, end: 0.28, step: 0.1 });
            const color = [palette.accent, palette.good, palette.accent2, palette.warn][index] || palette.accent;
            return (
              <div key={`${item}-${index}`} style={{ position: 'relative', borderRadius: 26, padding: 26, background: `${color}18`, border: `1px solid ${color}70`, transform: `translateY(${(1 - reveal) * 26}px)`, opacity: reveal, overflow: 'hidden' }}>
                <div style={{ position: 'absolute', right: 18, top: 14, color: `${color}7a`, fontSize: 58, lineHeight: 1, fontWeight: 990 }}>0{index + 1}</div>
                <div style={{ color, fontSize: 20, fontWeight: 950, letterSpacing: '0.14em', textTransform: 'uppercase' }}>{labels[index]}</div>
                <div style={{ marginTop: 30, color: palette.text, fontSize: labelFontSize(item, layout.isWide ? 38 : 34), lineHeight: 1.12, fontWeight: 960 }}>{item}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TimelineFrame({ scene, palette, enter, progress }: { scene: RemotionSceneInput; palette: HyperPalette; enter: number; progress: number }) {
  const layout = useLayout();
  const items = displayItems(scene, 5);
  const title = splitLines(displayHeadline(scene), layout.isWide ? 20 : 13, 2);
  return (
    <div style={{ position: 'absolute', left: layout.stagePadX, right: layout.stagePadX, top: layout.isWide ? 152 : 204, bottom: layout.isWide ? 112 : 178, opacity: enter }}>
      <div style={{ height: '100%', position: 'relative', borderRadius: 34, padding: layout.isWide ? '44px 52px' : '44px 38px', background: `linear-gradient(160deg, ${palette.panelStrong}, rgba(255,255,255,0.04))`, border: `1px solid ${palette.stroke}`, overflow: 'hidden' }}>
        <div style={{ color: palette.text, fontSize: layout.isWide ? 54 : 48, lineHeight: 1.05, fontWeight: 990 }}>{title.map((line, index) => <div key={`${line}-${index}`}>{line}</div>)}</div>
        <div style={{ position: 'absolute', left: layout.isWide ? 64 : 54, right: layout.isWide ? 64 : 54, top: layout.isWide ? 250 : 190, bottom: 48, display: 'flex', flexDirection: layout.isWide ? 'row' : 'column', alignItems: 'stretch', justifyContent: 'space-between', gap: layout.isWide ? 18 : 14 }}>
          <div style={{ position: 'absolute', left: layout.isWide ? '6%' : 25, right: layout.isWide ? '6%' : undefined, top: layout.isWide ? '45%' : 12, bottom: layout.isWide ? undefined : 12, width: layout.isWide ? undefined : 3, height: layout.isWide ? 3 : undefined, borderRadius: 999, background: palette.stroke }} />
          <div style={{ position: 'absolute', left: layout.isWide ? '6%' : 25, top: layout.isWide ? '45%' : 12, width: layout.isWide ? `${progress * 88}%` : 3, height: layout.isWide ? 3 : `${progress * 92}%`, borderRadius: 999, background: `linear-gradient(90deg, ${palette.accent}, ${palette.good})` }} />
          {items.map((item, index) => {
            const reveal = cascadeReveal(progress, scene, index, { start: 0.1, end: 0.28, step: 0.1, latestEnd: 0.5 });
            return (
              <div key={`${item}-${index}`} style={{ position: 'relative', zIndex: 1, flex: layout.isWide ? 1 : undefined, display: 'grid', gridTemplateColumns: layout.isWide ? '1fr' : '62px 1fr', gap: layout.isWide ? 16 : 20, alignItems: 'center', opacity: reveal, transform: `translateY(${layout.isWide ? (index % 2 ? 28 : -18) * (1 - reveal) : (1 - reveal) * 18}px)` }}>
                <div style={{ width: 58, height: 58, borderRadius: 20, display: 'grid', placeItems: 'center', background: index === 0 ? palette.accent : palette.panelStrong, border: `1px solid ${index === 0 ? palette.accent : palette.stroke}`, color: index === 0 ? '#020617' : palette.accent, fontSize: 22, fontWeight: 950 }}>{index + 1}</div>
                <div style={{ minHeight: layout.isWide ? 130 : 74, padding: layout.isWide ? '22px 18px' : '16px 20px', borderRadius: 24, background: palette.panel, border: `1px solid ${palette.stroke}`, color: palette.text, fontSize: labelFontSize(item, layout.isWide ? 28 : 30), lineHeight: 1.12, fontWeight: 920 }}>{item}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ChecklistFrame({ scene, palette, enter, progress, variant }: { scene: RemotionSceneInput; palette: HyperPalette; enter: number; progress: number; variant: number }) {
  const layout = useLayout();
  const items = displayItems(scene, 5);
  const title = splitLines(displayHeadline(scene), layout.isWide ? 20 : 13, 2);
  const reverse = layout.isWide && variant === 1;
  return (
    <div style={{ position: 'absolute', left: layout.stagePadX, right: layout.stagePadX, top: layout.isWide ? 150 : 202, bottom: layout.isWide ? 112 : 178, opacity: enter }}>
      <div style={{ height: '100%', display: 'grid', gridTemplateColumns: layout.isWide ? reverse ? '1.2fr 0.8fr' : '0.8fr 1.2fr' : '1fr', gap: 26 }}>
        <div style={{ borderRadius: 34, padding: layout.isWide ? 42 : 34, background: `linear-gradient(145deg, ${palette.accent}28, ${palette.panelStrong})`, border: `1px solid ${palette.stroke}`, display: 'grid', alignContent: 'center', order: reverse ? 2 : 1 }}>
          <div style={{ color: palette.accent, fontSize: 22, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 950 }}>Key points</div>
          <div style={{ marginTop: 22, color: palette.text, fontSize: layout.isWide ? 56 : 48, lineHeight: 1.05, fontWeight: 990 }}>{title.map((line, index) => <div key={`${line}-${index}`}>{line}</div>)}</div>
          <div style={{ marginTop: 28, color: palette.muted, fontSize: layout.bodySize, lineHeight: 1.36 }}>{displaySummary(scene)}</div>
        </div>
        <div style={{ borderRadius: 34, padding: layout.isWide ? 38 : 34, background: palette.panelStrong, border: `1px solid ${palette.stroke}`, display: 'grid', gap: 15, order: reverse ? 1 : 2 }}>
          {items.map((item, index) => {
            const reveal = cascadeReveal(progress, scene, index, { start: 0.08, end: 0.26, step: 0.1, latestEnd: 0.5 });
            return (
              <div key={`${item}-${index}`} style={{ display: 'grid', gridTemplateColumns: '58px 1fr', gap: 18, alignItems: 'center', padding: layout.isWide ? '14px 18px' : '18px 18px', borderRadius: 24, background: index === 0 ? `${palette.good}19` : 'rgba(255,255,255,0.045)', border: `1px solid ${index === 0 ? palette.good : palette.stroke}`, opacity: reveal, transform: `translateX(${(1 - reveal) * 26}px)` }}>
                <div style={{ width: 52, height: 52, borderRadius: 18, display: 'grid', placeItems: 'center', background: index === 0 ? palette.good : `${palette.accent}22`, color: index === 0 ? '#020617' : palette.accent, fontSize: 26, fontWeight: 990 }}>✓</div>
                <div style={{ color: palette.text, fontSize: labelFontSize(item, layout.isWide ? 30 : 32), lineHeight: 1.15, fontWeight: 920 }}>{item}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PyramidFrame({ scene, palette, enter, progress }: { scene: RemotionSceneInput; palette: HyperPalette; enter: number; progress: number }) {
  const layout = useLayout();
  const items = displayItems(scene, 4);
  const title = splitLines(displayHeadline(scene), layout.isWide ? 18 : 12, 2);
  return (
    <div style={{ position: 'absolute', left: layout.stagePadX, right: layout.stagePadX, top: layout.isWide ? 150 : 202, bottom: layout.isWide ? 112 : 178, opacity: enter }}>
      <div style={{ height: '100%', position: 'relative', borderRadius: 36, padding: layout.isWide ? '42px 56px' : '42px 38px', background: palette.panelStrong, border: `1px solid ${palette.stroke}`, overflow: 'hidden' }}>
        <div style={{ color: palette.accent, fontSize: 22, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 950 }}>Structure stack</div>
        <div style={{ marginTop: 18, color: palette.text, fontSize: layout.isWide ? 56 : 50, lineHeight: 1.04, fontWeight: 990 }}>{title.map((line, index) => <div key={`${line}-${index}`}>{line}</div>)}</div>
        <div style={{ position: 'absolute', left: layout.isWide ? 220 : 70, right: layout.isWide ? 220 : 70, bottom: layout.isWide ? 48 : 56, height: layout.isWide ? 410 : 520, display: 'flex', flexDirection: 'column', justifyContent: 'end', alignItems: 'center', gap: 14 }}>
          {items.map((item, index) => {
            const reveal = cascadeReveal(progress, scene, index, { start: 0.1, end: 0.34, step: 0.12, latestEnd: 0.54 });
            const level = items.length - index;
            const width = `${52 + index * 13}%`;
            const color = [palette.accent, palette.accent2, palette.good, palette.warn][index] || palette.accent;
            return (
              <div key={`${item}-${index}`} style={{ width, minHeight: layout.isWide ? 74 : 86, borderRadius: 24, display: 'grid', gridTemplateColumns: '58px 1fr', alignItems: 'center', gap: 18, padding: '16px 24px', background: `linear-gradient(90deg, ${color}38, ${palette.panel})`, border: `1px solid ${color}7a`, color: palette.text, opacity: reveal, transform: `translateY(${(1 - reveal) * 34}px) scaleX(${0.92 + reveal * 0.08})`, transformOrigin: 'center bottom' }}>
                <div style={{ color, fontSize: 24, fontWeight: 990 }}>L{level}</div>
                <div style={{ fontSize: labelFontSize(item, layout.isWide ? 30 : 32), lineHeight: 1.12, fontWeight: 940 }}>{item}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function NetworkFrame({ scene, palette, enter, progress }: { scene: RemotionSceneInput; palette: HyperPalette; enter: number; progress: number }) {
  const layout = useLayout();
  const items = displayItems(scene, 6);
  const positions = layout.isWide
    ? [[18, 26], [48, 14], [76, 30], [30, 62], [62, 68], [84, 58]]
    : [[18, 18], [68, 16], [42, 34], [20, 62], [72, 66], [45, 80]];
  return (
    <div style={{ position: 'absolute', left: layout.stagePadX, right: layout.stagePadX, top: layout.isWide ? 150 : 202, bottom: layout.isWide ? 112 : 178, opacity: enter }}>
      <WindowChrome palette={palette} title="node.graph">
        <div style={{ position: 'absolute', inset: 34 }}>
          <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, opacity: 0.56 }}>
            {positions.slice(0, items.length - 1).map((point, index) => {
              const next = positions[index + 1];
              return <line key={index} x1={point[0]} y1={point[1]} x2={next[0]} y2={next[1]} stroke={palette.accent} strokeWidth="0.28" strokeDasharray="2 2" strokeDashoffset={String(10 - progress * 14)} />;
            })}
          </svg>
          {items.map((item, index) => {
            const reveal = cascadeReveal(progress, scene, index, { start: 0.12, end: 0.35, step: 0.09, latestEnd: 0.54 });
            const point = positions[index];
            return (
              <div key={`${item}-${index}`} style={{ position: 'absolute', left: `${point[0]}%`, top: `${point[1]}%`, transform: `translate(-50%, -50%) scale(${0.84 + reveal * 0.16})`, opacity: reveal, minWidth: layout.isWide ? 160 : 170, padding: '18px 20px', borderRadius: 26, background: index === 0 ? `linear-gradient(135deg, ${palette.accent}, ${palette.accent2})` : palette.panel, color: index === 0 ? '#020617' : palette.text, border: `1px solid ${index === 0 ? palette.accent : palette.stroke}`, fontSize: layout.isWide ? 24 : 28, fontWeight: 950, textAlign: 'center', boxShadow: `0 16px 48px rgba(0,0,0,0.24)` }}>{item}</div>
            );
          })}
        </div>
      </WindowChrome>
    </div>
  );
}

function SpotlightFrame({ scene, palette, enter, progress }: { scene: RemotionSceneInput; palette: HyperPalette; enter: number; progress: number }) {
  const layout = useLayout();
  const core = displayHeadline(scene, 16);
  const items = displayItems(scene, 5).filter((item) => item !== core).slice(0, 4);
  const positions = layout.isWide
    ? [[18, 24], [78, 20], [84, 70], [20, 72]]
    : [[16, 20], [78, 24], [76, 74], [18, 76]];
  return (
    <div style={{ position: 'absolute', left: layout.stagePadX, right: layout.stagePadX, top: layout.isWide ? 148 : 202, bottom: layout.isWide ? 112 : 178, opacity: enter }}>
      <div style={{ height: '100%', position: 'relative', borderRadius: 38, background: `linear-gradient(145deg, ${palette.panelStrong}, rgba(255,255,255,0.035))`, border: `1px solid ${palette.stroke}`, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: layout.isWide ? 430 : 460, height: layout.isWide ? 430 : 460, borderRadius: 999, transform: `translate(-50%, -50%) scale(${0.9 + enter * 0.1})`, background: `radial-gradient(circle, ${palette.accent}42 0%, ${palette.accent2}1f 58%, transparent 72%)`, border: `1px solid ${palette.accent}70`, boxShadow: `0 0 92px ${palette.accent}2f` }} />
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: layout.isWide ? 330 : 350, height: layout.isWide ? 330 : 350, borderRadius: 999, transform: `translate(-50%, -50%) rotate(${progress * 10}deg)`, border: `2px dashed ${palette.stroke}` }} />
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: layout.isWide ? 350 : 380, transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
          <div style={{ color: palette.accent, fontSize: 23, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 950 }}>Core signal</div>
          <div style={{ marginTop: 22, color: palette.text, fontSize: layout.isWide ? 62 : 58, lineHeight: 1.04, fontWeight: 990 }}>
            {splitLines(core, layout.isWide ? 12 : 10, 3).map((line, index) => <div key={`${line}-${index}`}>{line}</div>)}
          </div>
        </div>
        {items.map((item, index) => {
          const reveal = cascadeReveal(progress, scene, index, { start: 0.12, end: 0.34, step: 0.1, latestEnd: 0.52 });
          const point = positions[index];
          return (
            <div key={`${item}-${index}`} style={{ position: 'absolute', left: `${point[0]}%`, top: `${point[1]}%`, width: layout.isWide ? 230 : 210, padding: '18px 20px', borderRadius: 26, background: palette.panel, border: `1px solid ${index % 2 ? palette.accent2 : palette.accent}`, color: palette.text, fontSize: labelFontSize(item, layout.isWide ? 27 : 29), lineHeight: 1.12, fontWeight: 930, textAlign: 'center', opacity: reveal, transform: `translate(-50%, -50%) scale(${0.86 + reveal * 0.14})` }}>
              {item}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function QuoteFrame({ scene, palette, enter, progress }: { scene: RemotionSceneInput; palette: HyperPalette; enter: number; progress: number }) {
  const layout = useLayout();
  const title = splitLines(displayHeadline(scene), layout.isWide ? 18 : 12, 3);
  const items = displayItems(scene, 4);
  return (
    <div style={{ position: 'absolute', left: layout.stagePadX, right: layout.stagePadX, top: layout.isWide ? 150 : 202, bottom: layout.isWide ? 112 : 178, opacity: enter }}>
      <div style={{ height: '100%', display: 'grid', gridTemplateColumns: layout.isWide ? '1.18fr 0.82fr' : '1fr', gap: 24 }}>
        <div style={{ position: 'relative', borderRadius: 38, padding: layout.isWide ? '54px 58px' : '48px 42px', background: `linear-gradient(145deg, ${palette.accent}24, ${palette.panelStrong})`, border: `1px solid ${palette.accent}68`, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', right: 36, top: 18, color: `${palette.accent}30`, fontSize: layout.isWide ? 170 : 150, lineHeight: 1, fontWeight: 990 }}>"</div>
          <div style={{ color: palette.accent, fontSize: 23, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 950 }}>Case excerpt</div>
          <div style={{ marginTop: 30, color: palette.text, fontSize: layout.isWide ? 66 : 58, lineHeight: 1.05, fontWeight: 990 }}>
            {title.map((line, index) => <div key={`${line}-${index}`}>{line}</div>)}
          </div>
          <div style={{ position: 'absolute', left: layout.isWide ? 58 : 42, right: layout.isWide ? 58 : 42, bottom: layout.isWide ? 46 : 42, color: palette.muted, fontSize: layout.bodySize, lineHeight: 1.32 }}>{splitLines(displaySummary(scene), layout.isWide ? 26 : 18, 2).join(' ')}</div>
        </div>
        <div style={{ display: 'grid', gap: 16 }}>
          {items.map((item, index) => {
            const reveal = cascadeReveal(progress, scene, index, { start: 0.1, end: 0.3, step: 0.11, latestEnd: 0.54 });
            return (
              <div key={`${item}-${index}`} style={{ borderRadius: 28, padding: layout.isWide ? '22px 24px' : '24px 26px', background: index === 0 ? `${palette.good}18` : palette.panel, border: `1px solid ${index === 0 ? palette.good : palette.stroke}`, color: palette.text, opacity: reveal, transform: `translateX(${(1 - reveal) * 24}px)` }}>
                <div style={{ color: index === 0 ? palette.good : palette.accent, fontSize: 17, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 950 }}>Evidence {index + 1}</div>
                <div style={{ marginTop: 12, fontSize: labelFontSize(item, layout.isWide ? 29 : 32), lineHeight: 1.14, fontWeight: 920 }}>{item}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ToolchainFrame({ scene, palette, enter, progress }: { scene: RemotionSceneInput; palette: HyperPalette; enter: number; progress: number }) {
  const layout = useLayout();
  const items = displayItems(scene, 5);
  const title = splitLines(displayHeadline(scene), layout.isWide ? 20 : 13, 2);
  return (
    <div style={{ position: 'absolute', left: layout.stagePadX, right: layout.stagePadX, top: layout.isWide ? 150 : 202, bottom: layout.isWide ? 112 : 178, opacity: enter }}>
      <div style={{ height: '100%', borderRadius: 36, padding: layout.isWide ? '42px 48px' : '42px 38px', background: palette.panelStrong, border: `1px solid ${palette.stroke}`, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 28, alignItems: 'start' }}>
          <div>
            <div style={{ color: palette.accent, fontSize: 22, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 950 }}>Tool chain</div>
            <div style={{ marginTop: 18, color: palette.text, fontSize: layout.isWide ? 54 : 48, lineHeight: 1.05, fontWeight: 990 }}>{title.map((line, index) => <div key={`${line}-${index}`}>{line}</div>)}</div>
          </div>
          {layout.isWide ? <div style={{ color: palette.muted, fontSize: 23, lineHeight: 1.28, maxWidth: 390, textAlign: 'right' }}>{displaySummary(scene)}</div> : null}
        </div>
        <div style={{ marginTop: layout.isWide ? 58 : 46, display: 'grid', gridTemplateColumns: layout.isWide ? `repeat(${items.length}, minmax(0, 1fr))` : '1fr', gap: layout.isWide ? 16 : 14 }}>
          {items.map((item, index) => {
            const reveal = cascadeReveal(progress, scene, index, { start: 0.08, end: 0.28, step: 0.09 });
            const color = [palette.accent, palette.accent2, palette.good, palette.warn, palette.accent3][index] || palette.accent;
            return (
              <div key={`${item}-${index}`} style={{ position: 'relative', minHeight: layout.isWide ? 260 : 104, borderRadius: 28, padding: layout.isWide ? '24px 18px' : '18px 22px', background: `${color}17`, border: `1px solid ${color}70`, color: palette.text, display: 'grid', alignContent: layout.isWide ? 'space-between' : 'center', gap: 18, opacity: reveal, transform: `translateY(${(1 - reveal) * 28}px)` }}>
                <div style={{ width: 48, height: 48, borderRadius: 18, display: 'grid', placeItems: 'center', background: color, color: '#020617', fontSize: 21, fontWeight: 990 }}>{index + 1}</div>
                <div style={{ fontSize: labelFontSize(item, layout.isWide ? 28 : 32), lineHeight: 1.12, fontWeight: 930 }}>{item}</div>
                {layout.isWide && index < items.length - 1 ? <div style={{ position: 'absolute', right: -22, top: '50%', width: 28, height: 4, borderRadius: 999, background: color, opacity: clamp(progress * 1.5 - index * 0.12) }} /> : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function RadarFrame({ scene, palette, enter, progress }: { scene: RemotionSceneInput; palette: HyperPalette; enter: number; progress: number }) {
  const layout = useLayout();
  const values = chartValues(scene, 5);
  const labels = displayItems(scene, values.length);
  const polygon = values.map((value, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / values.length;
    const radius = 12 + (value * 0.36 * progress);
    return `${50 + Math.cos(angle) * radius},${50 + Math.sin(angle) * radius}`;
  }).join(' ');
  return (
    <div style={{ position: 'absolute', left: layout.stagePadX, right: layout.stagePadX, top: layout.isWide ? 150 : 202, bottom: layout.isWide ? 112 : 178, opacity: enter }}>
      <div style={{ height: '100%', display: 'grid', gridTemplateColumns: layout.isWide ? '0.86fr 1.14fr' : '1fr', gap: 28 }}>
        <div style={{ borderRadius: 36, padding: layout.isWide ? 42 : 36, background: `linear-gradient(145deg, ${palette.warn}1d, ${palette.panelStrong})`, border: `1px solid ${palette.stroke}`, display: 'grid', alignContent: 'center' }}>
          <div style={{ color: palette.warn, fontSize: 22, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 950 }}>Evaluation radar</div>
          <div style={{ marginTop: 22, color: palette.text, fontSize: layout.isWide ? 55 : 49, lineHeight: 1.05, fontWeight: 990 }}>{splitLines(displayHeadline(scene), layout.isWide ? 16 : 12, 3).map((line, index) => <div key={`${line}-${index}`}>{line}</div>)}</div>
        </div>
        <div style={{ position: 'relative', borderRadius: 36, background: palette.panelStrong, border: `1px solid ${palette.stroke}`, overflow: 'hidden' }}>
          <svg width="100%" height="100%" viewBox="0 0 100 100" style={{ position: 'absolute', inset: 0 }}>
            {[18, 30, 42].map((radius) => <circle key={radius} cx="50" cy="50" r={radius} fill="none" stroke={palette.stroke} strokeWidth="0.5" />)}
            {values.map((_, index) => {
              const angle = -Math.PI / 2 + (index * Math.PI * 2) / values.length;
              return <line key={index} x1="50" y1="50" x2={50 + Math.cos(angle) * 42} y2={50 + Math.sin(angle) * 42} stroke={palette.stroke} strokeWidth="0.45" />;
            })}
            <polygon points={polygon} fill={`${palette.accent}40`} stroke={palette.accent} strokeWidth="1.2" />
            <circle cx="50" cy="50" r="2.2" fill={palette.warn} />
          </svg>
          {labels.map((label, index) => {
            const angle = -Math.PI / 2 + (index * Math.PI * 2) / labels.length;
            const left = 50 + Math.cos(angle) * 42;
            const top = 50 + Math.sin(angle) * 42;
            return (
              <div key={`${label}-${index}`} style={{ position: 'absolute', left: `${left}%`, top: `${top}%`, transform: 'translate(-50%, -50%)', width: layout.isWide ? 148 : 156, padding: '11px 12px', borderRadius: 18, background: palette.panel, border: `1px solid ${palette.stroke}`, color: palette.text, fontSize: labelFontSize(label, layout.isWide ? 18 : 20), lineHeight: 1.1, textAlign: 'center', fontWeight: 850 }}>
                {label}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MosaicFrame({ scene, palette, enter, progress }: { scene: RemotionSceneInput; palette: HyperPalette; enter: number; progress: number }) {
  const layout = useLayout();
  const items = displayItems(scene, 6);
  const title = splitLines(displayHeadline(scene), layout.isWide ? 18 : 12, 2);
  const spans = layout.isWide ? ['2 / 4', '4 / 6', '1 / 3', '3 / 5', '5 / 7', '2 / 5'] : ['1 / 3', '1 / 2', '2 / 3', '1 / 3', '1 / 2', '2 / 3'];
  return (
    <div style={{ position: 'absolute', left: layout.stagePadX, right: layout.stagePadX, top: layout.isWide ? 150 : 202, bottom: layout.isWide ? 112 : 178, opacity: enter }}>
      <div style={{ position: 'relative', height: '100%', borderRadius: 36, padding: layout.isWide ? '42px 48px' : '40px 34px', background: `linear-gradient(145deg, ${palette.panelStrong}, rgba(255,255,255,0.05))`, border: `1px solid ${palette.stroke}`, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: layout.isWide ? 48 : 34, top: layout.isWide ? 42 : 38, right: layout.isWide ? 760 : 34 }}>
          <div style={{ color: palette.accent, fontSize: 22, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 950 }}>Idea mosaic</div>
          <div style={{ marginTop: 18, color: palette.text, fontSize: layout.isWide ? 52 : 45, lineHeight: 1.06, fontWeight: 990 }}>{title.map((line, index) => <div key={`${line}-${index}`}>{line}</div>)}</div>
        </div>
        <div style={{ position: 'absolute', left: layout.isWide ? 390 : 34, right: layout.isWide ? 46 : 34, top: layout.isWide ? 52 : 220, bottom: 42, display: 'grid', gridTemplateColumns: layout.isWide ? 'repeat(6, minmax(0, 1fr))' : 'repeat(2, minmax(0, 1fr))', gridAutoRows: layout.isWide ? 118 : 108, gap: 16 }}>
          {items.map((item, index) => {
            const reveal = cascadeReveal(progress, scene, index, { start: 0.08, end: 0.27, step: 0.08, latestEnd: 0.5 });
            const color = [palette.accent, palette.good, palette.accent2, palette.warn, palette.accent3, palette.text][index] || palette.accent;
            return (
              <div key={`${item}-${index}`} style={{ gridColumn: spans[index], gridRow: index % 3 === 0 && layout.isWide ? 'span 2' : 'span 1', borderRadius: 28, padding: layout.isWide ? '22px 24px' : '18px 20px', background: index === 0 ? `linear-gradient(135deg, ${palette.accent}42, ${palette.accent2}26)` : palette.panel, border: `1px solid ${index === 0 ? palette.accent : palette.stroke}`, color: palette.text, display: 'grid', alignContent: 'center', fontSize: labelFontSize(item, layout.isWide ? 31 : 30), lineHeight: 1.12, fontWeight: 940, opacity: reveal, transform: `translateY(${(1 - reveal) * 28}px) rotate(${(index % 2 ? 1.5 : -1.2) * (1 - reveal)}deg)`, boxShadow: `0 18px 54px rgba(0,0,0,0.2)` }}>
                <div style={{ color, fontSize: 16, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 950, marginBottom: 10 }}>Card {index + 1}</div>
                {item}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CauseFrame({ scene, palette, enter, progress }: { scene: RemotionSceneInput; palette: HyperPalette; enter: number; progress: number }) {
  const layout = useLayout();
  const items = displayItems(scene, 4);
  const labels = ['Trigger', 'Mechanism', 'Effect', 'Outcome'];
  return (
    <div style={{ position: 'absolute', left: layout.stagePadX, right: layout.stagePadX, top: layout.isWide ? 150 : 202, bottom: layout.isWide ? 112 : 178, opacity: enter }}>
      <div style={{ height: '100%', borderRadius: 36, padding: layout.isWide ? '44px 52px' : '42px 38px', background: `linear-gradient(145deg, ${palette.panelStrong}, ${palette.accent}12)`, border: `1px solid ${palette.stroke}`, overflow: 'hidden' }}>
        <div style={{ color: palette.accent, fontSize: 22, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 950 }}>Cause chain</div>
        <div style={{ marginTop: 18, color: palette.text, fontSize: layout.isWide ? 54 : 48, lineHeight: 1.05, fontWeight: 990 }}>{splitLines(displayHeadline(scene), layout.isWide ? 18 : 12, 2).map((line, index) => <div key={`${line}-${index}`}>{line}</div>)}</div>
        <div style={{ marginTop: layout.isWide ? 56 : 42, display: 'grid', gridTemplateColumns: layout.isWide ? `repeat(${items.length}, minmax(0, 1fr))` : '1fr', gap: layout.isWide ? 18 : 14 }}>
          {items.map((item, index) => {
            const reveal = cascadeReveal(progress, scene, index, { start: 0.09, end: 0.3, step: 0.11, latestEnd: 0.54 });
            return (
              <div key={`${item}-${index}`} style={{ position: 'relative', minHeight: layout.isWide ? 230 : 96, borderRadius: 28, padding: layout.isWide ? 24 : '18px 22px', background: index === items.length - 1 ? `${palette.good}18` : palette.panel, border: `1px solid ${index === items.length - 1 ? palette.good : palette.stroke}`, color: palette.text, opacity: reveal, transform: `translateX(${(1 - reveal) * 28}px)` }}>
                <div style={{ color: index === items.length - 1 ? palette.good : palette.accent, fontSize: 17, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 950 }}>{labels[index] || `Step ${index + 1}`}</div>
                <div style={{ marginTop: 18, fontSize: labelFontSize(item, layout.isWide ? 31 : 32), lineHeight: 1.12, fontWeight: 930 }}>{item}</div>
                {layout.isWide && index < items.length - 1 ? <div style={{ position: 'absolute', right: -22, top: '50%', width: 28, height: 28, borderTop: `4px solid ${palette.accent}`, borderRight: `4px solid ${palette.accent}`, transform: 'translateY(-50%) rotate(45deg)', opacity: clamp(progress * 1.4 - index * 0.14) }} /> : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MistakeFrame({ scene, palette, enter, progress }: { scene: RemotionSceneInput; palette: HyperPalette; enter: number; progress: number }) {
  const layout = useLayout();
  const items = displayItems(scene, 4);
  return (
    <div style={{ position: 'absolute', left: layout.stagePadX, right: layout.stagePadX, top: layout.isWide ? 150 : 202, bottom: layout.isWide ? 112 : 178, opacity: enter }}>
      <div style={{ height: '100%', display: 'grid', gridTemplateColumns: layout.isWide ? '0.74fr 1.26fr' : '1fr', gap: 24 }}>
        <div style={{ borderRadius: 36, padding: layout.isWide ? 42 : 36, background: 'rgba(248,113,113,0.15)', border: '1px solid rgba(248,113,113,0.48)', display: 'grid', alignContent: 'center' }}>
          <div style={{ width: 78, height: 78, borderRadius: 26, display: 'grid', placeItems: 'center', background: '#fb7185', color: '#020617', fontSize: 46, fontWeight: 990 }}>!</div>
          <div style={{ marginTop: 28, color: palette.text, fontSize: layout.isWide ? 55 : 48, lineHeight: 1.05, fontWeight: 990 }}>{splitLines(displayHeadline(scene), layout.isWide ? 15 : 12, 3).map((line, index) => <div key={`${line}-${index}`}>{line}</div>)}</div>
        </div>
        <div style={{ borderRadius: 36, padding: layout.isWide ? 36 : 34, background: palette.panelStrong, border: `1px solid ${palette.stroke}`, display: 'grid', gridTemplateColumns: layout.isWide ? 'repeat(2, minmax(0, 1fr))' : '1fr', gap: 16 }}>
          {items.map((item, index) => {
            const reveal = cascadeReveal(progress, scene, index, { start: 0.08, end: 0.28, step: 0.1 });
            return (
              <div key={`${item}-${index}`} style={{ borderRadius: 28, padding: '22px 24px', background: index === 0 ? 'rgba(248,113,113,0.13)' : 'rgba(255,255,255,0.045)', border: `1px solid ${index === 0 ? 'rgba(248,113,113,0.58)' : palette.stroke}`, color: palette.text, opacity: reveal, transform: `translateY(${(1 - reveal) * 24}px)` }}>
                <div style={{ color: '#fb7185', fontSize: 17, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 950 }}>Risk {index + 1}</div>
                <div style={{ marginTop: 14, fontSize: labelFontSize(item, layout.isWide ? 31 : 32), lineHeight: 1.13, fontWeight: 930 }}>{item}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CtaFrame({ scene, palette, enter }: { scene: RemotionSceneInput; palette: HyperPalette; enter: number }) {
  const layout = useLayout();
  const title = splitLines(displayHeadline(scene), layout.isWide ? 18 : 11, 3);
  return (
    <div style={{ position: 'absolute', left: layout.stagePadX, right: layout.stagePadX, top: layout.isWide ? 152 : 204, bottom: layout.isWide ? 112 : 178, opacity: enter }}>
      <WindowChrome palette={palette} title="publish.action">
        <div style={{ position: 'absolute', inset: layout.isWide ? 58 : 42, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
          <div>
            <div style={{ color: palette.accent, fontSize: 25, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 950 }}>Ready to ship</div>
            <div style={{ marginTop: 24, color: palette.text, fontSize: layout.isWide ? 76 : 72, lineHeight: 1.02, fontWeight: 990 }}>{title.map((line, index) => <div key={`${line}-${index}`}>{line}</div>)}</div>
            <div style={{ margin: '38px auto 0', width: layout.isWide ? 420 : 470, padding: '22px 30px', borderRadius: 999, background: `linear-gradient(90deg, ${palette.accent}, ${palette.good})`, color: '#020617', fontSize: 30, fontWeight: 980 }}>生成脚本 → 预览 → 渲染成片</div>
          </div>
        </div>
      </WindowChrome>
    </div>
  );
}

type SceneMode =
  | 'hero'
  | 'workflow'
  | 'data'
  | 'contrast'
  | 'matrix'
  | 'timeline'
  | 'checklist'
  | 'pyramid'
  | 'network'
  | 'cta'
  | 'spotlight'
  | 'quote'
  | 'toolchain'
  | 'radar'
  | 'mosaic'
  | 'cause'
  | 'mistake';

function modeDisplayName(mode: SceneMode) {
  const labels: Record<SceneMode, string> = {
    hero: 'Opening',
    workflow: 'Flow',
    data: 'Data',
    contrast: 'Compare',
    matrix: 'Matrix',
    timeline: 'Timeline',
    checklist: 'Checklist',
    pyramid: 'Pyramid',
    network: 'Network',
    cta: 'Action',
    spotlight: 'Spotlight',
    quote: 'Case',
    toolchain: 'Tools',
    radar: 'Radar',
    mosaic: 'Mosaic',
    cause: 'Cause',
    mistake: 'Risk'
  };
  return labels[mode];
}

function baseSceneMode(scene: RemotionSceneInput, sceneIndex: number): SceneMode {
  const text = sceneSearchText(scene);
  if (scene.layout === 'spotlight') return 'spotlight';
  if (scene.layout === 'quote') return 'quote';
  if (scene.layout === 'toolchain') return 'toolchain';
  if (scene.layout === 'radar') return 'radar';
  if (scene.layout === 'mosaic') return 'mosaic';
  if (scene.layout === 'cause') return 'cause';
  if (scene.layout === 'mistake') return 'mistake';
  if (scene.layout === 'matrix') return 'matrix';
  if (scene.layout === 'timeline') return 'timeline';
  if (scene.layout === 'checklist') return 'checklist';
  if (scene.layout === 'pyramid') return 'pyramid';
  if (scene.shotType === 'title' || scene.layout === 'hero') return 'hero';
  if (scene.shotType === 'cta' || scene.layout === 'cta') return 'cta';
  if (containsAny(text, ['工具', '豆包', '千问', '即梦', 'Lovart', 'OiiOii', '剪映', '海螺', '可灵', '工具链', '分工'])) return 'toolchain';
  if (containsAny(text, ['案例', '例子', '品牌', '人物', '客户', '故事', '引用', '原文', '“', '”', '「', '」'])) return 'quote';
  if (containsAny(text, ['标准', '指标', '评分', '评估', '风险', '成熟度', '判断', '质量', '边界'])) return 'radar';
  if (containsAny(text, ['核心', '关键', '主张', '概念', '价值', '定位', '本质']) && sceneIndex % 2 === 0) return 'spotlight';
  if (containsAny(text, ['多个', '几类', '几种', '并列', '分类', '标签', '要点', '模块']) && sceneIndex % 3 !== 0) return 'mosaic';
  if (scene.shotType === 'pain' || scene.layout === 'contrast') return 'contrast';
  if (scene.shotType === 'result' || scene.layout === 'chart') return 'data';
  if (scene.layout === 'network') return 'network';
  return 'workflow';
}

function addModeCandidate(target: SceneMode[], mode: SceneMode) {
  if (!target.includes(mode)) target.push(mode);
}

function longVideoModeAlternatives(current: SceneMode, scene: RemotionSceneInput) {
  const text = sceneSearchText(scene);
  const candidates: SceneMode[] = [];
  if (containsAny(text, ['工具', '豆包', '千问', '即梦', 'Lovart', 'OiiOii', '剪映', '海螺', '可灵', '工具链', '分工'])) {
    ['toolchain', 'timeline', 'workflow', 'network'].forEach((mode) => addModeCandidate(candidates, mode as SceneMode));
  }
  if (containsAny(text, ['案例', '例子', '品牌', '人物', '客户', '故事', '引用', '原文', '“', '”', '「', '」'])) {
    ['quote', 'spotlight', 'mosaic'].forEach((mode) => addModeCandidate(candidates, mode as SceneMode));
  }
  if (containsAny(text, ['标准', '指标', '评分', '评估', '风险', '成熟度', '判断', '质量', '边界'])) {
    ['radar', 'checklist', 'matrix', 'data'].forEach((mode) => addModeCandidate(candidates, mode as SceneMode));
  }
  if (containsAny(text, ['核心', '关键', '主张', '概念', '价值', '定位', '本质'])) {
    ['spotlight', 'pyramid', 'matrix', 'quote'].forEach((mode) => addModeCandidate(candidates, mode as SceneMode));
  }
  if (containsAny(text, ['多个', '几类', '几种', '并列', '分类', '标签', '要点', '模块'])) {
    ['mosaic', 'matrix', 'checklist', 'timeline'].forEach((mode) => addModeCandidate(candidates, mode as SceneMode));
  }

  const generic: Record<SceneMode, SceneMode[]> = {
    hero: [],
    cta: [],
    workflow: ['timeline', 'toolchain', 'checklist', 'mosaic'],
    data: ['radar', 'matrix', 'spotlight'],
    contrast: ['mistake', 'cause', 'radar'],
    matrix: ['mosaic', 'spotlight', 'radar'],
    timeline: ['toolchain', 'workflow', 'checklist'],
    checklist: ['matrix', 'mosaic', 'timeline'],
    pyramid: ['spotlight', 'matrix', 'cause'],
    network: ['toolchain', 'cause', 'spotlight'],
    spotlight: ['matrix', 'quote', 'pyramid'],
    quote: ['spotlight', 'mosaic', 'checklist'],
    toolchain: ['timeline', 'workflow', 'network'],
    radar: ['data', 'checklist', 'matrix'],
    mosaic: ['matrix', 'checklist', 'quote'],
    cause: ['network', 'timeline', 'contrast'],
    mistake: ['radar', 'contrast', 'checklist']
  };

  generic[current].forEach((mode) => addModeCandidate(candidates, mode));
  return candidates.filter((mode) => mode !== current && mode !== 'hero' && mode !== 'cta');
}

function sceneMode(scene: RemotionSceneInput, sceneIndex: number, scenes: RemotionSceneInput[]): SceneMode {
  const current = baseSceneMode(scene, sceneIndex);
  if (current === 'hero' || current === 'cta' || scenes.length < 7) return current;

  const previous = scenes[sceneIndex - 1] ? baseSceneMode(scenes[sceneIndex - 1], sceneIndex - 1) : undefined;
  const previous2 = scenes[sceneIndex - 2] ? baseSceneMode(scenes[sceneIndex - 2], sceneIndex - 2) : undefined;
  const next = scenes[sceneIndex + 1] ? baseSceneMode(scenes[sceneIndex + 1], sceneIndex + 1) : undefined;
  const repeatedNow = current === previous || (scenes.length >= 10 && current === previous2);
  const repeatedAhead = scenes.length >= 12 && current === next && sceneIndex % 3 === 1;
  if (!repeatedNow && !repeatedAhead) return current;

  return longVideoModeAlternatives(current, scene)
    .find((mode) => mode !== previous && mode !== previous2 && mode !== next) || current;
}

function SceneFrame({ input, scene, sceneIndex, sceneCount, palette }: { input: RemotionVideoInput; scene: RemotionSceneInput; sceneIndex: number; sceneCount: number; palette: HyperPalette }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const duration = sceneFrames(scene);
  const enter = enterProgress(frame, fps);
  const exit = exitProgress(frame, duration);
  const progress = sceneProgress(frame, duration);
  const mode = sceneMode(scene, sceneIndex, input.scenes);
  const variant = frameVariant(sceneIndex, mode);
  const showChapterBumper = isChapterBoundary(sceneIndex, sceneCount, scene, input.scenes);

  return (
    <AbsoluteFill style={{ opacity: 1 - exit * 0.35, transform: `scale(${1 - exit * 0.018})` }}>
      <Background palette={palette} progress={progress} sceneIndex={sceneIndex} sceneCount={sceneCount} mode={mode} />
      <Header input={input} scene={scene} sceneIndex={sceneIndex} sceneCount={sceneCount} palette={palette} enter={enter} />
      {mode === 'hero' ? <HeroFrame scene={scene} palette={palette} enter={enter} progress={progress} /> : null}
      {mode === 'workflow' ? <WorkflowFrame scene={scene} palette={palette} enter={enter} progress={progress} variant={variant} /> : null}
      {mode === 'data' ? <DataFrame scene={scene} palette={palette} enter={enter} progress={progress} variant={variant} /> : null}
      {mode === 'contrast' ? <ContrastFrame scene={scene} palette={palette} enter={enter} progress={progress} /> : null}
      {mode === 'matrix' ? <MatrixFrame scene={scene} palette={palette} enter={enter} progress={progress} variant={variant} /> : null}
      {mode === 'timeline' ? <TimelineFrame scene={scene} palette={palette} enter={enter} progress={progress} /> : null}
      {mode === 'checklist' ? <ChecklistFrame scene={scene} palette={palette} enter={enter} progress={progress} variant={variant} /> : null}
      {mode === 'pyramid' ? <PyramidFrame scene={scene} palette={palette} enter={enter} progress={progress} /> : null}
      {mode === 'network' ? <NetworkFrame scene={scene} palette={palette} enter={enter} progress={progress} /> : null}
      {mode === 'spotlight' ? <SpotlightFrame scene={scene} palette={palette} enter={enter} progress={progress} /> : null}
      {mode === 'quote' ? <QuoteFrame scene={scene} palette={palette} enter={enter} progress={progress} /> : null}
      {mode === 'toolchain' ? <ToolchainFrame scene={scene} palette={palette} enter={enter} progress={progress} /> : null}
      {mode === 'radar' ? <RadarFrame scene={scene} palette={palette} enter={enter} progress={progress} /> : null}
      {mode === 'mosaic' ? <MosaicFrame scene={scene} palette={palette} enter={enter} progress={progress} /> : null}
      {mode === 'cause' ? <CauseFrame scene={scene} palette={palette} enter={enter} progress={progress} /> : null}
      {mode === 'mistake' ? <MistakeFrame scene={scene} palette={palette} enter={enter} progress={progress} /> : null}
      {mode === 'cta' ? <CtaFrame scene={scene} palette={palette} enter={enter} /> : null}
      {showChapterBumper ? <ChapterBumperOverlay scene={scene} sceneIndex={sceneIndex} sceneCount={sceneCount} palette={palette} frame={frame} enter={enter} mode={mode} /> : null}
      <StoryRail sceneIndex={sceneIndex} sceneCount={sceneCount} palette={palette} enter={enter} mode={mode} />
      <SubtitleBar scene={scene} palette={palette} frame={frame} enter={enter} />
    </AbsoluteFill>
  );
}

function SubtitleBar({ scene, palette, frame, enter }: { scene: RemotionSceneInput; palette: HyperPalette; frame: number; enter: number }) {
  const layout = useLayout();
  const text = activeSubtitle(scene, frame);
  return (
    <div style={{ position: 'absolute', left: layout.isWide ? 280 : 72, right: layout.isWide ? 280 : 72, bottom: layout.isWide ? 30 : 52, padding: layout.isWide ? '12px 22px' : '16px 22px', borderRadius: 26, background: 'rgba(2, 6, 23, 0.66)', border: `1px solid ${palette.stroke}`, color: palette.text, fontSize: layout.isWide ? 22 : 28, lineHeight: 1.25, fontWeight: 760, textAlign: 'center', opacity: enter * 0.92 }}>
      {splitLines(text, layout.isWide ? 42 : 24, 2).map((line, index) => <div key={`${line}-${index}`}>{line}</div>)}
    </div>
  );
}

export function HyperframesExplainer(input: RemotionVideoInput) {
  const palette = palettes[input.project.visualPreset || 'clarity-blue'] || palettes['clarity-blue'];
  return (
    <AbsoluteFill style={{ background: palette.bg, fontFamily: 'Inter, Arial, "PingFang SC", "Microsoft YaHei", sans-serif' }}>
      {input.project.audioPath ? <Audio src={staticFile(input.project.audioPath.replace(/^\//, ''))} /> : null}
      {input.scenes.map((scene, index) => {
        const durationInFrames = sceneFrames(scene);
        return (
          <Sequence key={scene.id} from={getSceneStart(input.scenes, index)} durationInFrames={durationInFrames}>
            {scene.audioPath ? <Audio src={staticFile(scene.audioPath.replace(/^\//, ''))} volume={(frame) => voiceoverVolume(frame, durationInFrames)} /> : null}
            <SceneFrame input={input} scene={scene} sceneIndex={index} sceneCount={input.scenes.length} palette={palette} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}
