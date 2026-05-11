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

function compactText(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function splitLines(text: string, maxChars: number, maxLines: number) {
  const value = compactText(text);
  if (!value) return [''];
  return (value.match(new RegExp(`.{1,${maxChars}}`, 'g')) || [value]).slice(0, maxLines);
}

function cleanVisualLabel(text: string, maxChars = 12) {
  const value = compactText(text)
    .replace(/^content-hash:.*/i, '')
    .replace(/[《》"'“”‘’]/g, '')
    .replace(/实体企业做AI最容易踩的坑：一上来先做宣传，结果效率没起来/g, '')
    .replace(/很多实体企业把AI优先用在写文案做宣传，短期看热闹但内部依旧被重复咨询、文档表格/g, '')
    .replace(/^(所以|然后|最后|因此|同时|另外|其实|就是|我们|你会发现|这里要|需要把|先把|原文给得很明确)/, '')
    .replace(/有没有/g, '')
    .trim();
  if (!value || /^(避坑型|销售|document|AI|客户|流程|业务)$/.test(value)) return '';
  return value.length <= maxChars ? value : `${value.slice(0, maxChars - 1)}…`;
}

function cleanDisplayLabel(text: string, maxChars = 12) {
  const value = compactText(text)
    .replace(/^content-hash:.*/i, '')
    .replace(/[“”"']/g, '')
    .replace(/^(这里|这类内容|很多品牌|很多|如果|因为|所以|但是|而是|同时|另外|其实|问题是|需要|可以|就是|它可以|它要|它会)/, '')
    .replace(/^(第一|第二|第三|第四|第五|第六)[步点：:、\s]*/, '')
    .replace(/^(一是|二是|三是|四是|五是|六是)[：:、\s]*/, '')
    .replace(/^(把|让|用|通过|完成|实现)/, '')
    .replace(/更生动地/g, '生动')
    .replace(/品牌宣传视频/g, '品牌片')
    .replace(/品牌理念/g, '理念')
    .trim();
  if (!value || /^(AI|IP|业务|内容|方式|表达|问题)$/.test(value)) return '';
  const parts = value.split(/[，、。！？；;:：]/).map((item) => item.trim()).filter(Boolean);
  const bestPart = parts.find((item) => item.length >= 2 && item.length <= maxChars) || parts[0] || value;
  return bestPart.length <= maxChars ? bestPart : bestPart.slice(0, maxChars);
}

function sceneItems(scene: RemotionSceneInput, count = 5) {
  const primaryValues = [
    ...(scene.cards || []),
    scene.emphasis || '',
    scene.headline || '',
    ...(scene.keywords || [])
  ].map((item) => cleanDisplayLabel(item, 14)).filter((item) => item.length >= 2);
  const unique = Array.from(new Set(primaryValues));
  if (unique.length) return unique.slice(0, count);

  const fallbackValues = splitLines(scene.subtitle || scene.visualPrompt || '', 12, count)
    .map((item) => cleanDisplayLabel(item, 12))
    .filter((item) => item.length >= 2);
  if (fallbackValues.length) return Array.from(new Set(fallbackValues)).slice(0, count);
  return ['输入资料', '结构拆解', '视觉表达', '节奏控制', '成片输出'].slice(0, count);
}

function displaySummary(scene: RemotionSceneInput) {
  const cards = sceneItems(scene, 3);
  return scene.subtitle || cards.join(' / ') || scene.emphasis || scene.headline || '';
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

function Background({ palette, progress }: { palette: HyperPalette; progress: number }) {
  const drift = interpolate(progress, [0, 1], [-38, 42]);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at 18% 14%, ${palette.accent}38 0%, transparent 28%), radial-gradient(circle at 86% 18%, ${palette.accent2}2f 0%, transparent 30%), linear-gradient(140deg, ${palette.bg} 0%, ${palette.bg2} 100%)` }}>
      <div style={{ position: 'absolute', inset: 0, opacity: 0.18, backgroundImage: `linear-gradient(${palette.stroke} 1px, transparent 1px), linear-gradient(90deg, ${palette.stroke} 1px, transparent 1px)`, backgroundSize: '70px 70px', transform: `translate(${drift}px, ${-drift * 0.5}px)` }} />
      <div style={{ position: 'absolute', width: 620, height: 620, borderRadius: 999, right: -190, bottom: -190, background: `radial-gradient(circle, ${palette.accent3}30 0%, transparent 66%)`, filter: 'blur(2px)' }} />
      <div style={{ position: 'absolute', width: 420, height: 420, borderRadius: 999, left: -120, top: 420, background: `radial-gradient(circle, ${palette.accent2}24 0%, transparent 68%)` }} />
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
  return (
    <div style={{ position: 'absolute', left: layout.stagePadX, right: layout.stagePadX, top: layout.stagePadY, display: 'flex', alignItems: 'center', justifyContent: 'space-between', opacity: enter, transform: `translateY(${(1 - enter) * -20}px)` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 48, height: 48, borderRadius: 18, display: 'grid', placeItems: 'center', background: `linear-gradient(135deg, ${palette.accent}, ${palette.accent2})`, color: '#020617', fontSize: 26, fontWeight: 950 }}>{meta.icon}</div>
        <div>
          <div style={{ color: palette.text, fontSize: layout.isWide ? 24 : 26, fontWeight: 940 }}>{meta.label}</div>
          <div style={{ color: palette.muted, fontSize: layout.isWide ? 15 : 17, letterSpacing: '0.16em', textTransform: 'uppercase' }}>{meta.tag} / {String(sceneIndex + 1).padStart(2, '0')} of {String(sceneCount).padStart(2, '0')}</div>
        </div>
      </div>
      <div style={{ color: palette.muted, fontSize: layout.isWide ? 18 : 20, maxWidth: layout.isWide ? 520 : 340, textAlign: 'right', lineHeight: 1.35 }}>{input.project.title}</div>
    </div>
  );
}

function HeroFrame({ scene, palette, enter, progress }: { scene: RemotionSceneInput; palette: HyperPalette; enter: number; progress: number }) {
  const layout = useLayout();
  const lines = splitLines(scene.headline || scene.subtitle, layout.isWide ? 16 : 11, 3);
  const cards = sceneItems(scene, 3);
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
            const reveal = clamp(interpolate(progress, [0.12 + index * 0.14, 0.34 + index * 0.14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
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

function WorkflowFrame({ scene, palette, enter, progress }: { scene: RemotionSceneInput; palette: HyperPalette; enter: number; progress: number }) {
  const layout = useLayout();
  const items = sceneItems(scene, 5);
  return (
    <div style={{ position: 'absolute', left: layout.stagePadX, right: layout.stagePadX, top: layout.isWide ? 148 : 198, bottom: layout.isWide ? 110 : 178, opacity: enter }}>
      <WindowChrome palette={palette} title="sequence.builder">
        <div style={{ position: 'absolute', inset: layout.isWide ? '52px 54px' : '58px 38px', display: layout.isWide ? 'grid' : 'flex', gridTemplateColumns: layout.isWide ? '1.1fr 0.9fr' : undefined, flexDirection: layout.isWide ? undefined : 'column', gap: 34 }}>
          <div style={{ display: 'grid', gap: 18 }}>
            {items.map((item, index) => {
              const reveal = clamp(interpolate(progress, [0.08 + index * 0.11, 0.26 + index * 0.11], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
              return (
                <div key={`${item}-${index}`} style={{ display: 'grid', gridTemplateColumns: '62px 1fr', gap: 16, alignItems: 'center', transform: `translateY(${(1 - reveal) * 24}px)`, opacity: reveal }}>
                  <div style={{ width: 62, height: 62, borderRadius: 22, display: 'grid', placeItems: 'center', background: index === 0 ? palette.accent : `${palette.accent}22`, color: index === 0 ? '#020617' : palette.accent, border: `1px solid ${palette.stroke}`, fontSize: 24, fontWeight: 950 }}>{index + 1}</div>
                  <div style={{ padding: '18px 22px', borderRadius: 24, background: palette.panel, border: `1px solid ${palette.stroke}`, color: palette.text, fontSize: layout.isWide ? 28 : 31, fontWeight: 900 }}>{item}</div>
                </div>
              );
            })}
          </div>
          <div style={{ position: 'relative', minHeight: layout.isWide ? undefined : 380, borderRadius: 30, background: 'rgba(255,255,255,0.05)', border: `1px solid ${palette.stroke}`, overflow: 'hidden' }}>
            <div style={{ position: 'absolute', inset: 28, borderRadius: 26, background: `linear-gradient(160deg, ${palette.accent}1f, ${palette.accent2}1c)` }} />
            {[0, 1, 2, 3].map((item) => (
              <div key={item} style={{ position: 'absolute', left: 52 + item * 34, right: 52 + (3 - item) * 26, top: 62 + item * 74, height: 48, borderRadius: 18, background: item % 2 ? `${palette.good}44` : `${palette.accent}38`, transform: `scaleX(${clamp(progress * 1.4 - item * 0.18)})`, transformOrigin: 'left center' }} />
            ))}
            <div style={{ position: 'absolute', left: `${18 + progress * 56}%`, top: '52%', width: 26, height: 26, borderRadius: 999, background: palette.warn, boxShadow: `0 0 28px ${palette.warn}` }} />
          </div>
        </div>
      </WindowChrome>
    </div>
  );
}

function DataFrame({ scene, palette, enter, progress }: { scene: RemotionSceneInput; palette: HyperPalette; enter: number; progress: number }) {
  const layout = useLayout();
  const values = chartValues(scene, layout.isWide ? 6 : 5);
  const items = sceneItems(scene, values.length);
  return (
    <div style={{ position: 'absolute', left: layout.stagePadX, right: layout.stagePadX, top: layout.isWide ? 150 : 202, bottom: layout.isWide ? 112 : 178, opacity: enter }}>
      <WindowChrome palette={palette} title="insight.dashboard">
        <div style={{ position: 'absolute', inset: layout.isWide ? '56px 58px' : '64px 42px', display: 'grid', gridTemplateColumns: layout.isWide ? '0.9fr 1.1fr' : '1fr', gap: 32 }}>
          <div style={{ display: 'grid', alignContent: 'center', gap: 24 }}>
            <div style={{ color: palette.accent, fontSize: 24, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 950 }}>Signal score</div>
            <div style={{ color: palette.text, fontSize: layout.isWide ? 86 : 92, lineHeight: 0.95, fontWeight: 990 }}>{Math.round(Math.max(...values))}<span style={{ color: palette.accent, fontSize: 42 }}>%</span></div>
            <div style={{ color: palette.muted, fontSize: layout.bodySize, lineHeight: 1.38 }}>{splitLines(scene.headline || scene.subtitle, layout.isWide ? 20 : 15, 3).join(' ')}</div>
          </div>
          <div style={{ display: 'flex', gap: layout.isWide ? 18 : 14, alignItems: 'end', justifyContent: 'center', minHeight: 420 }}>
            {values.map((value, index) => {
              const reveal = clamp(interpolate(progress, [0.1 + index * 0.08, 0.38 + index * 0.08], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
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
  const items = sceneItems(scene, 4);
  const left = splitLines(scene.subtitle || scene.visualPrompt, layout.isWide ? 18 : 14, 3);
  const right = (items.length ? items : splitLines(scene.headline || scene.emphasis || scene.subtitle, layout.isWide ? 16 : 12, 3)).slice(0, 3);
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

function NetworkFrame({ scene, palette, enter, progress }: { scene: RemotionSceneInput; palette: HyperPalette; enter: number; progress: number }) {
  const layout = useLayout();
  const items = sceneItems(scene, 6);
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
            const reveal = clamp(interpolate(progress, [0.12 + index * 0.09, 0.35 + index * 0.09], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
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

function CtaFrame({ scene, palette, enter }: { scene: RemotionSceneInput; palette: HyperPalette; enter: number }) {
  const layout = useLayout();
  const title = splitLines(scene.headline || scene.subtitle, layout.isWide ? 18 : 11, 3);
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

function SceneFrame({ input, scene, sceneIndex, sceneCount, palette }: { input: RemotionVideoInput; scene: RemotionSceneInput; sceneIndex: number; sceneCount: number; palette: HyperPalette }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const duration = sceneFrames(scene);
  const enter = enterProgress(frame, fps);
  const exit = exitProgress(frame, duration);
  const progress = sceneProgress(frame, duration);
  const mode = scene.shotType === 'title' || scene.layout === 'hero'
    ? 'hero'
    : scene.shotType === 'pain' || scene.layout === 'contrast' || scene.layout === 'mistake'
      ? 'contrast'
      : scene.shotType === 'result' || scene.layout === 'chart' || scene.layout === 'matrix'
        ? 'data'
        : scene.shotType === 'cta' || scene.layout === 'cta'
          ? 'cta'
          : scene.layout === 'network' || scene.layout === 'cause'
            ? 'network'
            : 'workflow';

  return (
    <AbsoluteFill style={{ opacity: 1 - exit * 0.35, transform: `scale(${1 - exit * 0.018})` }}>
      <Background palette={palette} progress={progress} />
      <Header input={input} scene={scene} sceneIndex={sceneIndex} sceneCount={sceneCount} palette={palette} enter={enter} />
      {mode === 'hero' ? <HeroFrame scene={scene} palette={palette} enter={enter} progress={progress} /> : null}
      {mode === 'workflow' ? <WorkflowFrame scene={scene} palette={palette} enter={enter} progress={progress} /> : null}
      {mode === 'data' ? <DataFrame scene={scene} palette={palette} enter={enter} progress={progress} /> : null}
      {mode === 'contrast' ? <ContrastFrame scene={scene} palette={palette} enter={enter} progress={progress} /> : null}
      {mode === 'network' ? <NetworkFrame scene={scene} palette={palette} enter={enter} progress={progress} /> : null}
      {mode === 'cta' ? <CtaFrame scene={scene} palette={palette} enter={enter} /> : null}
      <SubtitleBar scene={scene} palette={palette} frame={frame} enter={enter} />
    </AbsoluteFill>
  );
}

function SubtitleBar({ scene, palette, frame, enter }: { scene: RemotionSceneInput; palette: HyperPalette; frame: number; enter: number }) {
  const layout = useLayout();
  const text = activeSubtitle(scene, frame);
  return (
    <div style={{ position: 'absolute', left: layout.isWide ? 250 : 58, right: layout.isWide ? 250 : 58, bottom: layout.isWide ? 34 : 58, padding: layout.isWide ? '16px 24px' : '20px 24px', borderRadius: 30, background: 'rgba(2, 6, 23, 0.84)', border: `1px solid ${palette.stroke}`, color: palette.text, fontSize: layout.isWide ? 28 : 34, lineHeight: 1.25, fontWeight: 880, textAlign: 'center', opacity: enter }}>
      {splitLines(text, layout.isWide ? 36 : 23, 2).map((line, index) => <div key={`${line}-${index}`}>{line}</div>)}
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
