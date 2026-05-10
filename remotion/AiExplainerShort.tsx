import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Easing,
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

type AiPalette = {
  bg: string;
  surface: string;
  surfaceStrong: string;
  line: string;
  text: string;
  muted: string;
  accent: string;
  accent2: string;
  positive: string;
  alert: string;
};

type AiLayout = {
  isWide: boolean;
};

const palettes: Record<string, AiPalette> = {
  'clarity-blue': {
    bg: '#06121e',
    surface: 'rgba(13, 35, 54, 0.76)',
    surfaceStrong: 'rgba(4, 13, 24, 0.9)',
    line: 'rgba(125, 211, 252, 0.28)',
    text: '#f8fafc',
    muted: '#bad0e5',
    accent: '#22d3ee',
    accent2: '#a78bfa',
    positive: '#34d399',
    alert: '#fbbf24'
  },
  'midnight-cyan': {
    bg: '#03151b',
    surface: 'rgba(7, 47, 57, 0.76)',
    surfaceStrong: 'rgba(3, 20, 26, 0.92)',
    line: 'rgba(45, 212, 191, 0.26)',
    text: '#f0fdfa',
    muted: '#a6cbd1',
    accent: '#2dd4bf',
    accent2: '#60a5fa',
    positive: '#86efac',
    alert: '#fde047'
  },
  'sunset-amber': {
    bg: '#1b0d12',
    surface: 'rgba(58, 26, 31, 0.76)',
    surfaceStrong: 'rgba(28, 12, 16, 0.92)',
    line: 'rgba(251, 146, 60, 0.28)',
    text: '#fff7ed',
    muted: '#f4c7ad',
    accent: '#fb923c',
    accent2: '#f472b6',
    positive: '#a7f3d0',
    alert: '#fde68a'
  }
};

const shotMeta: Record<RemotionSceneInput['shotType'], { label: string; eyebrow: string; mark: string }> = {
  title: { label: 'AI EXPLAINER', eyebrow: '核心观点', mark: '01' },
  pain: { label: 'THE GAP', eyebrow: '问题在哪', mark: '02' },
  step: { label: 'HOW IT WORKS', eyebrow: '拆成步骤', mark: '03' },
  result: { label: 'RESULT', eyebrow: '能带来什么', mark: '04' },
  cta: { label: 'NEXT ACTION', eyebrow: '下一步', mark: '05' }
};

const radius = {
  stage: 34,
  panel: 30,
  card: 24,
  chip: 18,
  pill: 999
} as const;

function sceneFrames(scene: RemotionSceneInput) {
  return Math.max(1, Math.ceil(scene.durationSec * FPS));
}

function getSceneStart(scenes: RemotionSceneInput[], index: number) {
  return scenes.slice(0, index).reduce((total, scene) => total + sceneFrames(scene), 0);
}

export function getAiExplainerDurationInFrames(input: RemotionVideoInput) {
  return Math.max(FPS * 5, input.scenes.reduce((total, scene) => total + sceneFrames(scene), 0));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function localProgress(frame: number, duration: number) {
  return clamp(frame / Math.max(1, duration), 0, 1);
}

function compactText(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function splitLines(text: string, maxChars: number, maxLines: number) {
  const compact = compactText(text);
  if (!compact) return [''];
  const lines = compact.match(new RegExp(`.{1,${maxChars}}`, 'g')) || [compact];
  if (lines.length > 1 && /^[，。！？、；：,.!?;:]$/.test(lines[lines.length - 1])) {
    lines[lines.length - 2] = `${lines[lines.length - 2]}${lines[lines.length - 1]}`;
    lines.pop();
  }
  return lines.slice(0, maxLines);
}

function keyTerms(scene: RemotionSceneInput) {
  const terms = [
    ...(scene.keywords || []),
    ...(scene.emphasis ? [scene.emphasis] : []),
    ...compactText(scene.subtitle).split(/[，、。！？\s]+/)
  ]
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 12);

  return Array.from(new Set(terms)).slice(0, 5);
}

function displaySeeds(scene: RemotionSceneInput) {
  return Array.from(new Set([
    ...(scene.cards || []),
    scene.headline || '',
    scene.subtitle || '',
    scene.emphasis || '',
    ...(scene.keywords || [])
  ].map((item) => compactText(item)).filter((item) => item.length >= 2)));
}

function displaySummary(scene: RemotionSceneInput, fallback: string, maxChars: number, maxLines: number) {
  const seeds = displaySeeds(scene);
  return splitLines(seeds.length ? seeds.slice(0, maxLines + 1).join(' · ') : fallback, maxChars, maxLines);
}

function cardItems(scene: RemotionSceneInput) {
  if (scene.cards?.length) return scene.cards.slice(0, 4);
  const seeds = displaySeeds(scene);
  if (seeds.length) return seeds.map((item) => conciseLabel(item, 12)).slice(0, 4);
  return ['核心概念', '关键步骤', '结果变化', '下一动作'];
}

function conciseLabel(text: string, maxChars = 8) {
  const compact = compactText(text)
    .replace(/[《》"'“”‘’]/g, '')
    .replace(/^(所以|然后|最后|因此|同时|另外|其实|就是|我们|你会发现|这里要|需要把|先把)/, '')
    .trim();
  return (compact || text).slice(0, maxChars);
}

function visualTokens(scene: RemotionSceneInput, count: number, maxChars = 8) {
  const source = [...cardItems(scene), ...keyTerms(scene)];
  const items = Array.from(new Set(source.map((item) => conciseLabel(item, maxChars)).filter((item) => item.length >= 2)));
  return items.slice(0, count);
}

function chartValues(scene: RemotionSceneInput, count: number) {
  const values = scene.chartData?.length ? scene.chartData : [32, 54, 48, 76, 88];
  const normalized = values.slice(0, count).map((value) => clamp(Number(value) || 0, 8, 100));
  while (normalized.length < count) normalized.push(normalized[normalized.length - 1] || 42);
  return normalized;
}

function metricValue(scene: RemotionSceneInput) {
  const values = chartValues(scene, 5);
  return Math.max(...values);
}

function staggerReveal(enter: number, index: number, total: number) {
  const start = 0.16 + index * 0.16;
  const end = Math.min(0.96, start + 0.26);
  return clamp(interpolate(enter, [start, end], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  }), 0, 1);
}

function typingText(text: string, progress: number) {
  const compact = compactText(text);
  if (!compact) return '';
  const chars = Math.max(1, Math.floor(interpolate(progress, [0, 1], [1, compact.length])));
  return compact.slice(0, chars);
}

function sceneMotion(scene: RemotionSceneInput, progress: number) {
  const baseOpacity = interpolate(progress, [0, 0.1, 0.92, 1], [0, 1, 1, 0.82]);
  switch (scene.transition) {
    case 'zoom':
      return { opacity: baseOpacity, transform: `scale(${interpolate(progress, [0, 1], [1.04, 1])})` };
    case 'push':
      return { opacity: baseOpacity, transform: `translateX(${interpolate(progress, [0, 1], [48, -18])}px)` };
    case 'flash':
      return { opacity: interpolate(progress, [0, 0.08, 0.14, 1], [0, 1, 0.9, 1]), transform: `scale(${interpolate(progress, [0, 1], [0.98, 1])})` };
    case 'fade':
      return { opacity: baseOpacity, transform: 'translateX(0px)' };
    default:
      return { opacity: baseOpacity, transform: `translateY(${interpolate(progress, [0, 1], [24, -6])}px)` };
  }
}

function primaryDisplay(scene: RemotionSceneInput) {
  if (scene.layout === 'hero') return 'hero';
  if (scene.layout === 'cause') return 'cause';
  if (scene.layout === 'chart') return 'data';
  if (scene.layout === 'process') return 'process';
  if (scene.layout === 'timeline') return 'timeline';
  if (scene.layout === 'matrix') return 'matrix';
  if (scene.layout === 'network') return 'network';
  if (scene.layout === 'pyramid') return 'pyramid';
  if (scene.layout === 'contrast' || scene.layout === 'mistake') return 'contrast';
  if (scene.shotType === 'result' && scene.layout !== 'checklist') return 'result';
  if (scene.layout === 'cta') return 'cta';
  if (scene.layout === 'checklist') return 'checklist';
  if (scene.shotType === 'title') return 'hero';
  if (scene.visualType === 'image') return 'data';
  if (scene.shotType === 'step') return 'process';
  return 'cards';
}

function SceneBackdrop({
  scene,
  palette,
  progress,
  layout,
  displayMode
}: {
  scene: RemotionSceneInput;
  palette: AiPalette;
  progress: number;
  layout: AiLayout;
  displayMode: string;
}) {
  const isWide = layout.isWide;
  const tokens = visualTokens(scene, isWide ? 5 : 4, isWide ? 8 : 6);
  const values = chartValues(scene, 5);
  const pulse = interpolate(progress, [0, 1], [0.92, 1.08], { easing: Easing.inOut(Easing.ease) });

  if (displayMode === 'process' || displayMode === 'timeline') {
    return (
      <div
        style={{
          position: 'absolute',
          left: isWide ? 72 : 40,
          right: isWide ? 72 : 40,
          top: isWide ? 150 : 220,
          height: isWide ? 180 : 220,
          opacity: 0.48
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: isWide ? 88 : 104,
            height: 2,
            background: `linear-gradient(90deg, transparent, ${palette.accent}, ${palette.positive}, transparent)`
          }}
        />
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${tokens.length || 3}, minmax(0, 1fr))`, gap: 20 }}>
          {(tokens.length ? tokens : ['拆目标', '搭结构', '出结果']).map((token, index) => (
            <div key={`${token}-${index}`} style={{ display: 'grid', justifyItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: isWide ? 88 : 76,
                  height: isWide ? 88 : 76,
                  borderRadius: 999,
                  border: `1px solid ${palette.line}`,
                  display: 'grid',
                  placeItems: 'center',
                  background: index % 2 === 0 ? `${palette.accent}18` : `${palette.accent2}18`,
                  boxShadow: `0 0 28px ${index % 2 === 0 ? palette.accent : palette.accent2}22`,
                  transform: `scale(${index === 1 ? pulse : 1})`
                }}
              >
                <div style={{ color: palette.text, fontSize: isWide ? 26 : 22, fontWeight: 950 }}>
                  {String(index + 1).padStart(2, '0')}
                </div>
              </div>
              <div style={{ color: palette.muted, fontSize: isWide ? 18 : 16, fontWeight: 820 }}>{token}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (displayMode === 'data' || displayMode === 'result') {
    return (
      <div
        style={{
          position: 'absolute',
          left: isWide ? 80 : 48,
          right: isWide ? 80 : 48,
          top: isWide ? 152 : 212,
          height: isWide ? 260 : 220,
          opacity: 0.34,
          display: 'flex',
          alignItems: 'end',
          gap: 18
        }}
      >
        {values.map((value, index) => (
          <div key={`${value}-${index}`} style={{ flex: 1, display: 'grid', gap: 8, alignItems: 'end' }}>
            <div
              style={{
                height: `${Math.max(18, value * (isWide ? 1.5 : 1.2))}px`,
                borderRadius: '18px 18px 0 0',
                background: `linear-gradient(180deg, ${index % 2 ? palette.accent2 : palette.accent}, ${palette.positive})`,
                boxShadow: `0 0 34px ${palette.accent}18`,
                transform: `scaleY(${interpolate(progress, [0, 1], [0.3, 1])})`,
                transformOrigin: 'bottom center'
              }}
            />
            <div style={{ color: palette.muted, fontSize: 15, textAlign: 'center', fontWeight: 800 }}>{index + 1}</div>
          </div>
        ))}
      </div>
    );
  }

  if (displayMode === 'network' || displayMode === 'matrix' || displayMode === 'pyramid') {
    const dots = tokens.length ? tokens : ['目标', '流程', '素材', '结果'];
    return (
      <div
        style={{
          position: 'absolute',
          left: isWide ? 74 : 34,
          right: isWide ? 74 : 34,
          top: isWide ? 142 : 210,
          height: isWide ? 250 : 250,
          opacity: 0.36
        }}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          {dots.map((_, index) => {
            const x1 = 18 + (index % 3) * 28;
            const y1 = 24 + Math.floor(index / 3) * 28;
            const x2 = 50;
            const y2 = displayMode === 'pyramid' ? 18 : 54;
            return (
              <line
                key={`line-${index}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={palette.line}
                strokeWidth="0.5"
                strokeDasharray="2 2"
              />
            );
          })}
        </svg>
        {dots.map((token, index) => {
          const left = displayMode === 'pyramid' ? 18 + index * 18 : 10 + (index % 3) * 28;
          const top = displayMode === 'pyramid' ? 160 - Math.floor(index / 2) * 54 : 36 + Math.floor(index / 3) * 74;
          return (
            <div
              key={`${token}-${index}`}
              style={{
                position: 'absolute',
                left: `${left}%`,
                top,
                minWidth: isWide ? 120 : 96,
                padding: '12px 14px',
                borderRadius: radius.card,
                border: `1px solid ${palette.line}`,
                background: index % 2 === 0 ? `${palette.accent}16` : `${palette.accent2}16`,
                color: palette.text,
                fontSize: isWide ? 18 : 16,
                fontWeight: 820,
                textAlign: 'center'
              }}
            >
              {token}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'absolute',
        right: isWide ? 72 : 40,
        top: isWide ? 150 : 220,
        width: isWide ? 320 : 240,
        height: isWide ? 220 : 180,
        opacity: 0.26
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: radius.stage,
          border: `1px solid ${palette.line}`,
          background: palette.surfaceStrong,
          overflow: 'hidden'
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 18,
          right: 18,
          top: 22,
          height: 12,
          borderRadius: 999,
          background: `linear-gradient(90deg, ${palette.accent}, ${palette.accent2})`
        }}
      />
      {visualTokens(scene, 3, 10).map((token, index) => (
        <div
          key={`${token}-${index}`}
          style={{
            position: 'absolute',
          left: 18,
          right: 18,
          top: 58 + index * 42,
          height: 26,
          borderRadius: radius.chip,
          border: `1px solid ${palette.line}`,
          background: 'rgba(255,255,255,0.04)',
            color: palette.muted,
            fontSize: 16,
            fontWeight: 800,
            paddingLeft: 12,
            display: 'grid',
            alignItems: 'center'
          }}
        >
          {token}
        </div>
      ))}
    </div>
  );
}

function Background({ palette, progress }: { palette: AiPalette; progress: number }) {
  const drift = interpolate(progress, [0, 1], [-36, 42], { easing: Easing.inOut(Easing.cubic) });
  const sweep = interpolate(progress, [0, 1], [-220, 260]);

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(145deg, ${palette.bg} 0%, #020617 58%, #111827 100%)`,
        overflow: 'hidden'
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `url(${staticFile('noise.svg')})`,
          opacity: 0.06
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: 0.13,
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.18) 1px, transparent 1px)',
          backgroundSize: '76px 76px',
          transform: `translateY(${drift}px)`
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            `linear-gradient(116deg, transparent 0%, transparent 35%, ${palette.accent}18 48%, transparent 62%, transparent 100%)`,
          transform: `translateX(${sweep}px)`
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: 10,
          background: `linear-gradient(90deg, ${palette.accent}, ${palette.accent2}, ${palette.positive})`
        }}
      />
    </AbsoluteFill>
  );
}

function AccentWave({ palette, progress }: { palette: AiPalette; progress: number }) {
  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: interpolate(progress, [0, 1], [-260, 1200]),
          top: 148,
          width: 280,
          height: 2,
          background: `linear-gradient(90deg, transparent, ${palette.accent}, transparent)`,
          opacity: 0.55
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: interpolate(progress, [0, 1], [-220, 980]),
          bottom: 124,
          width: 240,
          height: 2,
          background: `linear-gradient(90deg, transparent, ${palette.accent2}, transparent)`,
          opacity: 0.4
        }}
      />
    </>
  );
}

function Header({
  input,
  scene,
  sceneIndex,
  sceneCount,
  palette,
  enter,
  layout
}: {
  input: RemotionVideoInput;
  scene: RemotionSceneInput;
  sceneIndex: number;
  sceneCount: number;
  palette: AiPalette;
  enter: number;
  layout: AiLayout;
}) {
  const meta = shotMeta[scene.shotType];
  const isWide = layout.isWide;
  return (
    <div
      style={{
        position: 'absolute',
        left: isWide ? 64 : 58,
        right: isWide ? 64 : 58,
        top: isWide ? 42 : 58,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        opacity: enter,
        transform: `translateY(${interpolate(enter, [0, 1], [22, 0])}px)`
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: radius.card,
            display: 'grid',
            placeItems: 'center',
            border: `1px solid ${palette.line}`,
            background: palette.surface,
            color: palette.accent,
            fontSize: 26,
            fontWeight: 950
          }}
        >
          {meta.mark}
        </div>
        <div>
          <div style={{ color: palette.accent, fontSize: 24, fontWeight: 950 }}>{meta.label}</div>
          <div style={{ color: palette.muted, fontSize: 20, marginTop: 5 }}>{meta.eyebrow}</div>
        </div>
      </div>
      <div style={{ width: isWide ? 520 : 260, textAlign: 'right' }}>
        <div style={{ color: palette.text, fontSize: isWide ? 26 : 24, fontWeight: 900, lineHeight: 1.2 }}>
          {splitLines(input.project.title, isWide ? 22 : 11, isWide ? 2 : 2).map((line, index) => (
            <div key={`${line}-${index}`}>{line}</div>
          ))}
        </div>
        <div style={{ height: 6, marginTop: 12, borderRadius: radius.pill, background: 'rgba(255,255,255,0.13)', overflow: 'hidden' }}>
          <div style={{ width: `${((sceneIndex + 1) / sceneCount) * 100}%`, height: '100%', borderRadius: radius.pill, background: palette.accent }} />
        </div>
      </div>
    </div>
  );
}

function HeroPanel({ scene, palette, enter, layout }: { scene: RemotionSceneInput; palette: AiPalette; enter: number; layout: AiLayout }) {
  const isWide = layout.isWide;
  const title = splitLines(scene.headline || scene.subtitle, isWide ? 16 : 12, isWide ? 2 : 3);
  const emphasis = scene.emphasis || keyTerms(scene)[0] || 'AI';
  const terms = keyTerms(scene).slice(0, 3);
  const summary = displaySummary(scene, '核心信息逐项展开', isWide ? 16 : 12, 3);
  return (
    <div
      style={{
        position: 'absolute',
        left: isWide ? 88 : 72,
        right: isWide ? 720 : 72,
        top: isWide ? 184 : 210,
        display: 'grid',
        gap: isWide ? 22 : 30,
        opacity: enter,
        transform: `translateY(${interpolate(enter, [0, 1], [42, 0])}px)`
      }}
    >
      <div
        style={{
          color: palette.text,
          fontSize: isWide ? 70 : 84,
          lineHeight: 1.06,
          fontWeight: 980,
          textWrap: 'balance'
        }}
      >
        {title.map((line, index) => (
          <div key={`${line}-${index}`}>{line}</div>
        ))}
      </div>
      <div
        style={{
          width: 'fit-content',
          maxWidth: '100%',
          padding: isWide ? '14px 22px' : '18px 26px',
          borderRadius: radius.card,
          color: '#020617',
          background: `linear-gradient(90deg, ${palette.accent}, ${palette.positive})`,
          fontSize: isWide ? 26 : 30,
          fontWeight: 950
        }}
      >
        {emphasis}
      </div>
      <div style={{ color: palette.muted, fontSize: isWide ? 27 : 30, lineHeight: 1.48, maxWidth: isWide ? 720 : 840 }}>
        {summary.map((line, index) => (
          <div key={`${line}-${index}`}>{line}</div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {terms.map((term, index) => (
          <div
            key={`${term}-${index}`}
            style={{
              padding: isWide ? '10px 16px' : '12px 18px',
              borderRadius: radius.chip,
              border: `1px solid ${index === 0 ? palette.accent : palette.line}`,
              background: index === 0 ? `${palette.accent}18` : 'rgba(255,255,255,0.05)',
              color: index === 0 ? palette.accent : palette.text,
              fontSize: isWide ? 20 : 22,
              fontWeight: 850,
              letterSpacing: 0
            }}
          >
            {term}
          </div>
        ))}
      </div>
      {isWide ? (
        <div
          style={{
            position: 'absolute',
            left: 1220,
            top: 164,
            width: 500,
            height: 560,
            borderRadius: radius.panel,
            border: `1px solid ${palette.line}`,
            background: palette.surfaceStrong,
            display: 'grid',
            gridTemplateRows: 'auto auto 1fr',
            gap: 18,
            padding: 38,
            overflow: 'hidden'
          }}
        >
          <div style={{ color: palette.accent, fontSize: 22, fontWeight: 950 }}>内容信号</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'end' }}>
            <div style={{ color: palette.text, fontSize: 34, lineHeight: 1.18, fontWeight: 920 }}>
              {splitLines(scene.subtitle, 10, 3).map((line, index) => (
                <div key={`${line}-${index}`}>{line}</div>
              ))}
            </div>
            <div style={{ color: palette.positive, fontSize: 72, lineHeight: 1, fontWeight: 980 }}>
              {Math.round(interpolate(enter, [0.72, 1], [52, 96]))}
            </div>
          </div>
          <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
            {keyTerms(scene).slice(0, 4).map((term, index) => (
              <div
                key={`${term}-${index}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '72px 1fr 96px',
                  alignItems: 'center',
                  minHeight: 76,
                  borderRadius: radius.card,
                  border: `1px solid ${palette.line}`,
                  background: index === 0 ? `${palette.accent}14` : palette.surface,
                  overflow: 'hidden'
                }}
              >
                <div
                  style={{
                    height: '100%',
                    display: 'grid',
                    placeItems: 'center',
                    background: index === 0 ? palette.accent : 'rgba(255,255,255,0.04)',
                    color: index === 0 ? '#04121f' : palette.accent,
                    fontSize: 22,
                    fontWeight: 950
                  }}
                >
                  {String(index + 1).padStart(2, '0')}
                </div>
                <div style={{ padding: '0 18px', color: palette.text, fontSize: 24, fontWeight: 860 }}>{term}</div>
                <div style={{ paddingRight: 18, color: palette.muted, fontSize: 18, fontWeight: 820, textAlign: 'right' }}>
                  {Math.round(interpolate(enter, [0.72, 1], [60 + index * 6, 88 + index * 3]))}%
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function InsightCards({ scene, palette, enter, layout }: { scene: RemotionSceneInput; palette: AiPalette; enter: number; layout: AiLayout }) {
  const items = cardItems(scene);
  const isWide = layout.isWide;
  const detailTokens = visualTokens(scene, 6, isWide ? 8 : 6);
  return (
    <div
      style={{
        position: 'absolute',
        left: isWide ? 88 : 70,
        right: isWide ? 88 : 70,
        top: isWide ? 190 : 260,
        display: 'grid',
        gridTemplateColumns: isWide && items.length >= 3 ? '1.2fr 0.8fr 0.8fr' : isWide ? `repeat(${Math.min(items.length, 4)}, minmax(0, 1fr))` : items.length > 2 ? '1fr 1fr' : '1fr',
        gap: isWide ? 20 : 18,
        opacity: enter
      }}
    >
      {items.map((item, index) => (
        <div
          key={`${item}-${index}`}
          style={{
            minHeight: isWide ? 410 : 154,
            padding: isWide ? 28 : 24,
            borderRadius: radius.panel,
            border: `1px solid ${palette.line}`,
            background: index === 0 ? palette.surfaceStrong : palette.surface,
            transform: `translateY(${interpolate(enter, [0, 1], [30 + index * 10, 0])}px)`,
            display: 'grid',
            alignContent: 'space-between',
            gridColumn: isWide && index === 0 && items.length >= 3 ? 'span 1' : undefined
          }}
        >
          <div>
            <div style={{ color: index === 0 ? palette.accent : palette.accent2, fontSize: 24, fontWeight: 950 }}>
              {String(index + 1).padStart(2, '0')}
            </div>
            <div style={{ color: palette.text, fontSize: isWide ? (index === 0 ? 38 : 30) : 34, lineHeight: 1.18, fontWeight: 900, marginTop: 12 }}>
              {splitLines(item, isWide ? (index === 0 ? 9 : 10) : 15, isWide ? (index === 0 ? 4 : 5) : 3).map((line, lineIndex) => (
                <div key={`${line}-${lineIndex}`}>{line}</div>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {detailTokens.slice(index * (isWide ? 2 : 1), index * (isWide ? 2 : 1) + (isWide ? 2 : 1)).map((line, lineIndex) => (
              <div
                key={`${line}-${lineIndex}`}
                style={{
                  padding: '10px 12px',
                  borderRadius: radius.chip,
                  border: `1px solid ${palette.line}`,
                  background: 'rgba(255,255,255,0.04)',
                  color: palette.muted,
                  fontSize: isWide ? 18 : 20,
                  fontWeight: 780,
                  lineHeight: 1.22
                }}
              >
                {line}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ProcessStrip({ scene, palette, enter, layout }: { scene: RemotionSceneInput; palette: AiPalette; enter: number; layout: AiLayout }) {
  const items = cardItems(scene).slice(0, 3);
  const isWide = layout.isWide;
  const detailTokens = visualTokens(scene, 9, isWide ? 8 : 6);
  return (
    <div
      style={{
        position: 'absolute',
        left: isWide ? 88 : 70,
        right: isWide ? 88 : 70,
        top: isWide ? 220 : 300,
        display: 'grid',
        gridTemplateColumns: isWide ? 'repeat(3, minmax(0, 1fr))' : '1fr',
        gap: isWide ? 20 : 22,
        opacity: enter
      }}
    >
      {items.map((item, index) => (
        <div
          key={`${item}-${index}`}
          style={{
            opacity: staggerReveal(enter, index, items.length),
            transform: `translateY(${interpolate(staggerReveal(enter, index, items.length), [0, 1], [28, 0])}px)`
          }}
        >
          <div
            style={{
              position: 'relative',
              display: 'grid',
              gridTemplateColumns: isWide ? '1fr' : '92px 1fr',
              gridTemplateRows: isWide ? '92px 1fr auto' : undefined,
              alignItems: 'stretch',
              gap: 16
            }}
          >
          {isWide && index < items.length - 1 ? (
            <div
              style={{
                position: 'absolute',
                right: -26,
                top: 178,
                width: 48,
                height: 2,
                background: `linear-gradient(90deg, ${palette.accent}, ${palette.positive})`,
                opacity: 0.9
              }}
            />
          ) : null}
          {isWide && index < items.length - 1 ? (
            <div
              style={{
                position: 'absolute',
                right: -2,
                top: 172,
                width: 14,
                height: 14,
                borderTop: `2px solid ${palette.positive}`,
                borderRight: `2px solid ${palette.positive}`,
                transform: 'rotate(45deg)'
              }}
            />
          ) : null}
          <div
            style={{
              display: 'grid',
              placeItems: 'center',
              borderRadius: isWide ? radius.card : radius.card,
              background: index === 1 ? palette.accent : palette.surface,
              color: index === 1 ? '#020617' : palette.accent,
              border: `1px solid ${palette.line}`,
              fontSize: 32,
              fontWeight: 950
            }}
          >
            {index + 1}
          </div>
          <div
            style={{
              padding: '26px 28px',
              minHeight: isWide ? 250 : undefined,
              borderRadius: radius.panel,
              background: index === 1 ? `${palette.accent}12` : palette.surface,
              border: `1px solid ${palette.line}`,
              color: palette.text,
              fontSize: isWide ? 30 : 36,
              lineHeight: 1.22,
              fontWeight: 880,
              transform: `translateX(${interpolate(enter, [0, 1], [42, 0])}px)`,
              display: 'grid',
              alignContent: 'space-between',
              position: 'relative',
              overflow: 'hidden'
            }}
          >
            {isWide ? (
              <div
                style={{
                  position: 'absolute',
                  right: 16,
                  top: -8,
                  color: 'rgba(255,255,255,0.06)',
                  fontSize: 120,
                  lineHeight: 1,
                  fontWeight: 980
                }}
              >
                {index + 1}
              </div>
            ) : null}
            <div>
              {splitLines(item, isWide ? 12 : 18, isWide ? 4 : 2).map((line, lineIndex) => (
                <div key={`${line}-${lineIndex}`}>{line}</div>
              ))}
            </div>
            <div style={{ display: 'grid', gap: 10, marginTop: 18 }}>
              <div style={{ color: palette.muted, fontSize: 18, fontWeight: 800 }}>
                {index === 0 ? '先建立结论' : index === 1 ? '再展开结构' : '最后补足证据'}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', maxWidth: '92%' }}>
                {detailTokens.slice(index * 3, index * 3 + 3).map((line, lineIndex) => (
                  <div
                    key={`${line}-${lineIndex}`}
                    style={{
                      padding: '8px 10px',
                      borderRadius: radius.chip,
                      border: `1px solid ${palette.line}`,
                      background: 'rgba(255,255,255,0.05)',
                      color: palette.muted,
                      fontSize: isWide ? 16 : 18,
                      lineHeight: 1.1,
                      fontWeight: 760
                    }}
                  >
                    {line}
                  </div>
                ))}
              </div>
              {[0, 1].map((lineIndex) => (
                <div
                  key={`${index}-${lineIndex}`}
                  style={{
                    height: 6,
                    width: `${72 - lineIndex * 16}%`,
                    background: lineIndex === 0 ? `linear-gradient(90deg, ${palette.accent}, ${palette.accent2})` : 'rgba(255,255,255,0.12)'
                  }}
                />
              ))}
            </div>
          </div>
          {isWide ? (
            <div
              style={{
                height: 6,
                borderRadius: radius.pill,
                background: 'rgba(255,255,255,0.08)',
                overflow: 'hidden',
                border: `1px solid ${palette.line}`
              }}
            >
              <div
                style={{
                  width: `${72 + index * 12}%`,
                  height: '100%',
                  borderRadius: radius.pill,
                  background: `linear-gradient(90deg, ${palette.accent}, ${index % 2 ? palette.accent2 : palette.positive})`
                }}
              />
            </div>
          ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function DataPanel({ scene, palette, enter, progress, layout }: { scene: RemotionSceneInput; palette: AiPalette; enter: number; progress: number; layout: AiLayout }) {
  const values = chartValues(scene, 5);
  const isWide = layout.isWide;
  const best = metricValue(scene);
  return (
    <div
      style={{
        position: 'absolute',
        left: isWide ? 110 : 70,
        right: isWide ? 110 : 70,
        top: isWide ? 176 : 280,
        display: 'grid',
        gridTemplateColumns: isWide ? '340px 1fr' : '1fr',
        gap: 22,
        opacity: enter
      }}
    >
      <div
        style={{
          padding: isWide ? 32 : 26,
          borderRadius: radius.panel,
          border: `1px solid ${palette.line}`,
          background: palette.surfaceStrong,
          display: 'grid',
          alignContent: 'space-between'
        }}
      >
        <div>
          <div style={{ color: palette.muted, fontSize: 20, fontWeight: 850 }}>核心结果</div>
          <div style={{ color: palette.text, fontSize: isWide ? 92 : 74, lineHeight: 1, fontWeight: 980, marginTop: 16 }}>
            {best}
            <span style={{ fontSize: isWide ? 34 : 28, color: palette.accent, marginLeft: 8 }}>%</span>
          </div>
          <div style={{ color: palette.text, fontSize: isWide ? 30 : 28, lineHeight: 1.2, fontWeight: 900, marginTop: 16 }}>
            {scene.emphasis || '关键指标抬升'}
          </div>
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          {values.slice(-3).map((value, index) => (
            <div key={`${value}-${index}`} style={{ display: 'grid', gridTemplateColumns: '68px 1fr 58px', alignItems: 'center', gap: 12 }}>
              <div style={{ color: palette.muted, fontSize: 16, fontWeight: 800 }}>S0{index + 3}</div>
              <div style={{ height: 8, borderRadius: radius.pill, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                <div style={{ width: `${value}%`, height: '100%', borderRadius: radius.pill, background: `linear-gradient(90deg, ${palette.accent}, ${palette.positive})` }} />
              </div>
              <div style={{ color: palette.text, fontSize: 18, fontWeight: 850 }}>{value}%</div>
            </div>
          ))}
        </div>
      </div>
      <div
        style={{
          padding: isWide ? 34 : 30,
          borderRadius: radius.panel,
          border: `1px solid ${palette.line}`,
          background: palette.surfaceStrong,
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        <div style={{ color: palette.muted, fontSize: 24, fontWeight: 850 }}>Signal change</div>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{
            position: 'absolute',
            inset: isWide ? '120px 34px 56px 34px' : '110px 20px 54px 20px',
            width: 'auto',
            height: 'auto',
            opacity: 0.28,
            pointerEvents: 'none'
          }}
        >
          <polyline
            fill="none"
            stroke={palette.accent}
            strokeWidth="1.8"
            points={chartValues(scene, 5).map((value, index, arr) => `${index * (100 / (arr.length - 1))},${100 - value}`).join(' ')}
            style={{
              strokeDasharray: 180,
              strokeDashoffset: interpolate(progress, [0, 1], [180, 0])
            }}
          />
        </svg>
        <div style={{ display: 'flex', height: isWide ? 470 : 360, gap: 22, alignItems: 'end', marginTop: 34 }}>
          {values.map((value, index) => (
            <div key={`${value}-${index}`} style={{ flex: 1, display: 'grid', gap: 12 }}>
              <div
                style={{
                  height: `${interpolate(progress, [0, 1], [12, value])}%`,
                  borderRadius: '18px 18px 0 0',
                  background: `linear-gradient(180deg, ${palette.accent}, ${index % 2 ? palette.accent2 : palette.positive})`,
                  border: `1px solid ${palette.line}`,
                  boxShadow: `0 0 24px ${palette.accent}22`
                }}
              />
              <div style={{ color: palette.muted, fontSize: 20, textAlign: 'center' }}>{index + 1}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ResultShowcasePanel({ scene, palette, enter, progress, layout }: { scene: RemotionSceneInput; palette: AiPalette; enter: number; progress: number; layout: AiLayout }) {
  const isWide = layout.isWide;
  const items = cardItems(scene).slice(0, 3);
  const value = metricValue(scene);
  return (
    <div
      style={{
        position: 'absolute',
        left: isWide ? 92 : 70,
        right: isWide ? 92 : 70,
        top: isWide ? 188 : 270,
        display: 'grid',
        gridTemplateColumns: isWide ? '1.05fr 0.95fr' : '1fr',
        gap: 22,
        opacity: enter
      }}
    >
      <div
        style={{
          minHeight: isWide ? 420 : 260,
          padding: '28px 30px',
          borderRadius: radius.panel,
          border: `1px solid ${palette.line}`,
          background: palette.surfaceStrong,
          display: 'grid',
          alignContent: 'space-between'
        }}
      >
        <div>
          <div style={{ color: palette.positive, fontSize: 20, fontWeight: 900 }}>完成态</div>
          <div style={{ color: palette.text, fontSize: isWide ? 66 : 54, lineHeight: 1.04, fontWeight: 960, marginTop: 14 }}>
            {splitLines(scene.headline || scene.subtitle, isWide ? 10 : 12, 3).map((line, index) => (
              <div key={`${line}-${index}`}>{line}</div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 24 }}>
            <div style={{ color: palette.text, fontSize: isWide ? 108 : 88, lineHeight: 1, fontWeight: 980 }}>
              {Math.round(interpolate(progress, [0, 1], [0, value]))}
            </div>
            <div style={{ color: palette.positive, fontSize: isWide ? 36 : 30, fontWeight: 900 }}>%</div>
          </div>
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          {items.map((item, index) => (
            <div
              key={`${item}-${index}`}
              style={{
                display: 'grid',
                gridTemplateColumns: '58px 1fr',
                minHeight: 64,
                borderRadius: radius.card,
                border: `1px solid ${palette.line}`,
                background: index === 0 ? `${palette.positive}14` : 'rgba(255,255,255,0.04)',
                overflow: 'hidden'
              }}
            >
              <div
                style={{
                  display: 'grid',
                  placeItems: 'center',
                  background: index === 0 ? palette.positive : 'rgba(255,255,255,0.05)',
                  color: index === 0 ? '#062014' : palette.text,
                  fontSize: 22,
                  fontWeight: 950
                }}
              >
                {index === 0 ? '✓' : String(index + 1).padStart(2, '0')}
              </div>
              <div style={{ padding: '0 16px', display: 'grid', alignItems: 'center', color: palette.text, fontSize: 22, fontWeight: 840, lineHeight: 1.2 }}>
                {splitLines(item, isWide ? 12 : 14, 2).map((line, lineIndex) => (
                  <div key={`${line}-${lineIndex}`}>{line}</div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div
        style={{
          minHeight: isWide ? 420 : 240,
          padding: '26px 28px',
          borderRadius: radius.panel,
          border: `1px solid ${palette.line}`,
          background: palette.surface,
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        <div style={{ color: palette.muted, fontSize: 18, fontWeight: 850 }}>完成进度</div>
        <div style={{ display: 'grid', gap: 18, marginTop: 22 }}>
          {chartValues(scene, 4).map((metric, index) => (
            <div key={`${metric}-${index}`} style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: palette.text, fontSize: 16, fontWeight: 820 }}>
                <span>{['结构清晰', '镜头表达', '信息密度', '成片感'][index] || `指标 ${index + 1}`}</span>
                <span>{metric}%</span>
              </div>
              <div style={{ height: 10, borderRadius: radius.pill, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${interpolate(progress, [0, 1], [10, metric])}%`,
                    height: '100%',
                    borderRadius: radius.pill,
                    background: `linear-gradient(90deg, ${palette.accent}, ${index % 2 ? palette.accent2 : palette.positive})`
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        <div
          style={{
            position: 'absolute',
            right: 20,
            bottom: 18,
            color: 'rgba(255,255,255,0.08)',
            fontSize: 120,
            lineHeight: 1,
            fontWeight: 980
          }}
        >
          DONE
        </div>
      </div>
    </div>
  );
}

function ContrastPanel({ scene, palette, enter, layout }: { scene: RemotionSceneInput; palette: AiPalette; enter: number; layout: AiLayout }) {
  const items = cardItems(scene).slice(0, 2);
  const isWide = layout.isWide;
  const modeLabel = scene.layout === 'mistake' ? '常见误区' : scene.layout === 'cause' ? '原因拆解' : '前后对比';
  const summary = displaySummary(scene, modeLabel, isWide ? 18 : 14, 3);
  return (
    <div
      style={{
        position: 'absolute',
        left: isWide ? 88 : 70,
        right: isWide ? 88 : 70,
        top: isWide ? 198 : 260,
        display: 'grid',
        gridTemplateColumns: isWide ? '1.15fr 0.85fr' : '1fr',
        gap: 20,
        opacity: enter
      }}
    >
      <div
        style={{
          minHeight: isWide ? 418 : 240,
          padding: isWide ? 34 : 28,
          borderRadius: radius.panel,
          border: `1px solid ${palette.line}`,
          background: palette.surfaceStrong
        }}
      >
        <div style={{ color: palette.alert, fontSize: 22, fontWeight: 900 }}>{modeLabel}</div>
        <div style={{ color: palette.text, fontSize: isWide ? 56 : 48, lineHeight: 1.08, fontWeight: 950, marginTop: 18 }}>
          {splitLines(scene.headline || items[0] || scene.subtitle, isWide ? 12 : 14, 3).map((line, index) => (
            <div key={`${line}-${index}`}>{line}</div>
          ))}
        </div>
        <div style={{ color: palette.muted, fontSize: isWide ? 26 : 28, lineHeight: 1.42, marginTop: 22 }}>
          {summary.map((line, index) => (
            <div key={`${line}-${index}`}>{line}</div>
          ))}
        </div>
      </div>
      <div style={{ display: 'grid', gap: 16 }}>
        {items.map((item, index) => (
          <div
            key={`${item}-${index}`}
            style={{
              opacity: staggerReveal(enter, index, items.length),
              minHeight: isWide ? 200 : 150,
              padding: '24px 26px',
              borderRadius: radius.panel,
              border: `1px solid ${palette.line}`,
              background: index === 0 ? `${palette.alert}18` : `${palette.accent}14`,
              color: palette.text,
              transform: `translateX(${interpolate(staggerReveal(enter, index, items.length), [0, 1], [28 + index * 12, 0])}px)`,
              position: 'relative',
              overflow: 'hidden'
            }}
          >
            <div
              style={{
                position: 'absolute',
                right: 16,
                top: 10,
                fontSize: 54,
                lineHeight: 1,
                fontWeight: 980,
                color: index === 0 ? 'rgba(251,191,36,0.22)' : 'rgba(45,212,191,0.2)'
              }}
            >
              {index === 0 ? '!' : '+'}
            </div>
            <div style={{ color: index === 0 ? palette.alert : palette.accent, fontSize: 20, fontWeight: 900 }}>
              {index === 0 ? '问题点' : '解决线索'}
            </div>
            <div style={{ fontSize: isWide ? 30 : 32, lineHeight: 1.28, fontWeight: 860, marginTop: 12 }}>
              {splitLines(item, isWide ? 10 : 14, 4).map((line, lineIndex) => (
                <div key={`${line}-${lineIndex}`}>{line}</div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CauseFlowPanel({ scene, palette, enter, progress, layout }: { scene: RemotionSceneInput; palette: AiPalette; enter: number; progress: number; layout: AiLayout }) {
  const items = cardItems(scene).slice(0, 3);
  const isWide = layout.isWide;
  const labels = ['触发点', '中间机制', '最终表现'];
  return (
    <div
      style={{
        position: 'absolute',
        left: isWide ? 98 : 70,
        right: isWide ? 98 : 70,
        top: isWide ? 212 : 272,
        display: 'grid',
        gridTemplateColumns: isWide ? 'repeat(3, minmax(0, 1fr))' : '1fr',
        gap: 20,
        opacity: enter
      }}
    >
      {items.map((item, index) => (
        <div
          key={`${item}-${index}`}
          style={{
            position: 'relative',
            minHeight: isWide ? 280 : 150,
            padding: '22px 24px 24px',
            borderRadius: radius.card,
            border: `1px solid ${palette.line}`,
            background: index === 1 ? `${palette.accent}14` : palette.surfaceStrong,
            overflow: 'hidden'
          }}
        >
          <div style={{ color: index === 0 ? palette.alert : index === 1 ? palette.accent : palette.positive, fontSize: 18, fontWeight: 900 }}>
            {labels[index] || `节点 ${index + 1}`}
          </div>
          <div style={{ color: palette.text, fontSize: isWide ? 30 : 32, lineHeight: 1.2, fontWeight: 900, marginTop: 14 }}>
            {splitLines(item, isWide ? 9 : 12, 4).map((line, lineIndex) => (
              <div key={`${line}-${lineIndex}`}>{line}</div>
            ))}
          </div>
          {index < items.length - 1 && isWide ? (
            <>
              <div
                style={{
                  position: 'absolute',
                  top: '50%',
                  right: -26,
                  width: 52,
                  height: 2,
                  background: `linear-gradient(90deg, ${palette.accent}, ${palette.positive})`,
                  transform: 'translateY(-50%)'
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(50% - 7px)',
                  right: -4,
                  width: 14,
                  height: 14,
                  borderTop: `2px solid ${palette.positive}`,
                  borderRight: `2px solid ${palette.positive}`,
                  transform: 'rotate(45deg)'
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: '50%',
                  right: interpolate(progress, [0, 1], [8, -10]),
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background: palette.positive,
                  boxShadow: `0 0 14px ${palette.positive}`,
                  transform: 'translateY(-50%)'
                }}
              />
            </>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function TimelinePanel({ scene, palette, enter, layout }: { scene: RemotionSceneInput; palette: AiPalette; enter: number; layout: AiLayout }) {
  const items = cardItems(scene).slice(0, 4);
  const isWide = layout.isWide;
  return (
    <div
      style={{
        position: 'absolute',
        left: isWide ? 92 : 70,
        right: isWide ? 92 : 70,
        top: isWide ? 232 : 276,
        display: 'grid',
        gridTemplateColumns: isWide ? `repeat(${items.length}, minmax(0, 1fr))` : '1fr',
        gap: 18,
        opacity: enter
      }}
    >
      {items.map((item, index) => (
        <div key={`${item}-${index}`} style={{ position: 'relative', paddingTop: isWide ? 40 : 0, paddingLeft: isWide ? 0 : 70 }}>
          <div
            style={{
              position: 'absolute',
              left: isWide ? 0 : 20,
              top: isWide ? 10 : 0,
              width: isWide ? '100%' : 2,
              height: isWide ? 2 : '100%',
              background: `linear-gradient(90deg, ${palette.accent}, ${palette.accent2})`,
              opacity: 0.65
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: isWide ? 0 : 0,
              top: isWide ? 0 : 0,
              width: 40,
              height: 40,
              borderRadius: 999,
              background: palette.accent,
              color: '#020617',
              display: 'grid',
              placeItems: 'center',
              fontSize: 20,
              fontWeight: 950
            }}
          >
            {index + 1}
          </div>
          <div
            style={{
              marginTop: isWide ? 24 : 0,
              minHeight: isWide ? 260 : 120,
              padding: '22px 24px',
              borderRadius: radius.card,
              border: `1px solid ${palette.line}`,
              background: palette.surface
            }}
          >
            <div style={{ color: palette.text, fontSize: isWide ? 28 : 30, lineHeight: 1.28, fontWeight: 860 }}>
              {splitLines(item, isWide ? 9 : 16, isWide ? 4 : 3).map((line, lineIndex) => (
                <div key={`${line}-${lineIndex}`}>{line}</div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MatrixPanel({ scene, palette, enter, layout }: { scene: RemotionSceneInput; palette: AiPalette; enter: number; layout: AiLayout }) {
  const items = cardItems(scene).slice(0, 4);
  const labels = ['认知', '动作', '效果', '复用'];
  const isWide = layout.isWide;
  return (
    <div
      style={{
        position: 'absolute',
        left: isWide ? 124 : 70,
        right: isWide ? 124 : 70,
        top: isWide ? 210 : 280,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 18,
        opacity: enter
      }}
    >
      {items.map((item, index) => (
        <div
          key={`${item}-${index}`}
          style={{
            minHeight: isWide ? 190 : 160,
            padding: '22px 24px',
            borderRadius: radius.card,
            border: `1px solid ${palette.line}`,
            background: index === 0 ? palette.surfaceStrong : palette.surface
          }}
        >
          <div style={{ color: index % 2 === 0 ? palette.accent : palette.accent2, fontSize: 20, fontWeight: 900 }}>
            {labels[index] || `模块 ${index + 1}`}
          </div>
          <div style={{ color: palette.text, fontSize: isWide ? 28 : 30, lineHeight: 1.28, fontWeight: 860, marginTop: 14 }}>
            {splitLines(item, isWide ? 11 : 14, 4).map((line, lineIndex) => (
              <div key={`${line}-${lineIndex}`}>{line}</div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function NetworkPanel({ scene, palette, enter, progress, layout }: { scene: RemotionSceneInput; palette: AiPalette; enter: number; progress: number; layout: AiLayout }) {
  const items = cardItems(scene).slice(0, 4);
  const isWide = layout.isWide;
  const nodes = isWide
    ? [
        { left: 240, top: 320 },
        { left: 700, top: 170 },
        { left: 1180, top: 320 },
        { left: 700, top: 490 }
      ]
    : [
        { left: 120, top: 280 },
        { left: 420, top: 180 },
        { left: 420, top: 430 },
        { left: 120, top: 560 }
      ];
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: enter }}>
      <div
        style={{
          position: 'absolute',
          left: isWide ? 610 : 90,
          top: isWide ? 250 : 300,
          width: isWide ? 300 : 220,
          height: isWide ? 300 : 220,
          borderRadius: 999,
          border: `1px solid ${palette.line}`,
          opacity: 0.18,
          transform: `scale(${interpolate(progress, [0, 1], [0.92, 1.08])})`
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: isWide ? 655 : 122,
          top: isWide ? 295 : 332,
          width: isWide ? 210 : 156,
          height: isWide ? 210 : 156,
          borderRadius: 999,
          border: `1px solid ${palette.line}`,
          opacity: 0.14,
          transform: `scale(${interpolate(progress, [0, 1], [1.08, 0.96])})`
        }}
      />
      {nodes.slice(0, items.length).map((node, index) => (
        <React.Fragment key={`line-${index}`}>
          <div
            style={{
              position: 'absolute',
              left: isWide ? 760 : 240,
              top: isWide ? 392 : 420,
              width: isWide ? Math.abs(node.left - 760) : Math.abs(node.left - 240),
              height: 2,
              background: `linear-gradient(90deg, ${palette.accent}, ${palette.accent2})`,
              transformOrigin: 'left center',
              transform: `rotate(${Math.atan2(node.top - (isWide ? 392 : 420), node.left - (isWide ? 760 : 240))}rad) scaleX(${0.7 + progress * 0.3})`,
              opacity: 0.55
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: interpolate(progress, [0, 1], [isWide ? 760 : 240, node.left]),
              top: interpolate(progress, [0, 1], [isWide ? 392 : 420, node.top]),
              width: 10,
              height: 10,
              borderRadius: 999,
              background: palette.positive,
              boxShadow: `0 0 12px ${palette.positive}`,
              transform: 'translate(-50%, -50%)'
            }}
          />
        </React.Fragment>
      ))}
      <div
        style={{
          position: 'absolute',
          left: isWide ? 650 : 140,
          top: isWide ? 290 : 360,
          width: isWide ? 220 : 200,
          minHeight: 180,
          padding: '22px 24px',
          borderRadius: radius.panel,
          border: `1px solid ${palette.line}`,
          background: palette.surfaceStrong,
          boxShadow: `0 0 28px ${palette.accent}18`
        }}
      >
        <div style={{ color: palette.accent, fontSize: 20, fontWeight: 900 }}>核心节点</div>
        <div style={{ color: palette.text, fontSize: isWide ? 34 : 32, lineHeight: 1.2, fontWeight: 920, marginTop: 12 }}>
          {splitLines(scene.headline || scene.emphasis || '核心逻辑', 8, 3).map((line, index) => (
            <div key={`${line}-${index}`}>{line}</div>
          ))}
        </div>
      </div>
      {items.slice(0, nodes.length).map((item, index) => (
        <div
          key={`${item}-${index}`}
          style={{
            position: 'absolute',
            left: nodes[index]?.left,
            top: nodes[index]?.top,
            width: isWide ? 280 : 220,
            minHeight: isWide ? 130 : 110,
            padding: '20px 22px',
            borderRadius: radius.card,
            border: `1px solid ${palette.line}`,
            background: index % 2 === 0 ? palette.surface : `${palette.accent}12`,
            color: palette.text,
            transform: `translateY(${interpolate(enter, [0, 1], [22 + index * 8, 0])}px)`
          }}
        >
          <div style={{ fontSize: isWide ? 26 : 24, lineHeight: 1.3, fontWeight: 860 }}>
            {splitLines(item, isWide ? 9 : 10, 4).map((line, lineIndex) => (
              <div key={`${line}-${lineIndex}`}>{line}</div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function PyramidPanel({ scene, palette, enter, layout }: { scene: RemotionSceneInput; palette: AiPalette; enter: number; layout: AiLayout }) {
  const items = cardItems(scene).slice(0, 4).reverse();
  const isWide = layout.isWide;
  const widths = isWide ? [900, 700, 500, 320] : [520, 420, 320, 230];
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: isWide ? 210 : 290,
        display: 'grid',
        justifyItems: 'center',
        gap: 14,
        opacity: enter
      }}
    >
      {items.map((item, index) => (
        <div
          key={`${item}-${index}`}
          style={{
            width: widths[index] || widths[widths.length - 1],
            minHeight: isWide ? 88 : 80,
            padding: '18px 24px',
            borderRadius: radius.card,
            border: `1px solid ${palette.line}`,
            background: index === 0 ? `${palette.accent2}20` : index === items.length - 1 ? palette.surfaceStrong : palette.surface,
            color: palette.text,
            textAlign: 'center',
            transform: `translateY(${interpolate(enter, [0, 1], [32 - index * 4, 0])}px)`
          }}
        >
          <div style={{ fontSize: isWide ? 28 : 30, lineHeight: 1.24, fontWeight: 880 }}>
            {splitLines(item, isWide ? 18 : 16, 2).map((line, lineIndex) => (
              <div key={`${line}-${lineIndex}`}>{line}</div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ChecklistPanel({ scene, palette, enter, layout }: { scene: RemotionSceneInput; palette: AiPalette; enter: number; layout: AiLayout }) {
  const items = cardItems(scene).slice(0, 4);
  const isWide = layout.isWide;
  return (
    <div
      style={{
        position: 'absolute',
        left: isWide ? 140 : 70,
        right: isWide ? 140 : 70,
        top: isWide ? 196 : 276,
        display: 'grid',
        gridTemplateColumns: isWide ? '340px 1fr' : '1fr',
        gap: 22,
        opacity: enter
      }}
    >
      {isWide ? (
        <div
          style={{
            padding: '28px 28px 30px',
            borderRadius: radius.panel,
            border: `1px solid ${palette.line}`,
            background: palette.surfaceStrong,
            display: 'grid',
            alignContent: 'space-between'
          }}
        >
          <div>
            <div style={{ color: palette.accent, fontSize: 20, fontWeight: 900 }}>执行清单</div>
            <div style={{ color: palette.text, fontSize: 52, lineHeight: 1.06, fontWeight: 950, marginTop: 16 }}>
              READY
            </div>
            <div style={{ color: palette.muted, fontSize: 24, lineHeight: 1.38, marginTop: 18 }}>
              {splitLines(scene.headline || scene.subtitle, 10, 4).map((line, index) => (
                <div key={`${line}-${index}`}>{line}</div>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 20 }}>
            {keyTerms(scene).slice(0, 3).map((term, index) => (
              <div
                key={`${term}-${index}`}
                style={{
                  padding: '8px 12px',
                  borderRadius: radius.chip,
                  border: `1px solid ${palette.line}`,
                  background: index === 0 ? `${palette.accent}18` : 'rgba(255,255,255,0.05)',
                  color: index === 0 ? palette.accent : palette.text,
                  fontSize: 16,
                  fontWeight: 800
                }}
              >
                {term}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div style={{ display: 'grid', gap: 16 }}>
        {items.map((item, index) => (
          <div
            key={`${item}-${index}`}
            style={{
              display: 'grid',
              gridTemplateColumns: '72px 1fr',
              alignItems: 'center',
              gap: 18,
              minHeight: isWide ? 94 : 88,
              padding: '0 24px 0 0',
              borderRadius: radius.card,
              border: `1px solid ${palette.line}`,
              background: index === 0 ? palette.surfaceStrong : palette.surface,
              overflow: 'hidden'
            }}
          >
            <div
              style={{
                height: '100%',
                display: 'grid',
                placeItems: 'center',
                background: index === 0 ? `linear-gradient(180deg, ${palette.accent}, ${palette.positive})` : 'rgba(255,255,255,0.06)',
                color: index === 0 ? '#020617' : palette.accent,
                fontSize: 26,
                fontWeight: 950
              }}
            >
              {index === 0 ? '✓' : String(index + 1).padStart(2, '0')}
            </div>
            <div style={{ color: palette.text, fontSize: isWide ? 29 : 30, lineHeight: 1.26, fontWeight: 860 }}>
              {splitLines(item, isWide ? 22 : 14, 2).map((line, lineIndex) => (
                <div key={`${line}-${lineIndex}`}>{line}</div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CtaPanel({ scene, palette, enter, layout }: { scene: RemotionSceneInput; palette: AiPalette; enter: number; layout: AiLayout }) {
  const isWide = layout.isWide;
  const summary = displaySummary(scene, '记住框架，再去执行', isWide ? 18 : 14, 3);
  return (
    <div
      style={{
        position: 'absolute',
        left: isWide ? 112 : 72,
        right: isWide ? 112 : 72,
        top: isWide ? 208 : 286,
        padding: isWide ? '38px 42px' : '34px 30px',
        borderRadius: radius.panel,
        border: `1px solid ${palette.line}`,
        background: palette.surfaceStrong,
        display: 'grid',
        gap: 24,
        opacity: enter
      }}
    >
      <div style={{ color: palette.accent, fontSize: 22, fontWeight: 900 }}>下一步动作</div>
      <div style={{ color: palette.text, fontSize: isWide ? 64 : 52, lineHeight: 1.08, fontWeight: 960 }}>
        {splitLines(scene.headline || scene.subtitle, isWide ? 16 : 12, 3).map((line, index) => (
          <div key={`${line}-${index}`}>{line}</div>
        ))}
      </div>
      <div style={{ color: palette.muted, fontSize: isWide ? 28 : 30, lineHeight: 1.42 }}>
        {summary.map((line, index) => (
          <div key={`${line}-${index}`}>{line}</div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {keyTerms(scene).slice(0, 3).map((term, index) => (
          <div
            key={`${term}-${index}`}
            style={{
              padding: '14px 22px',
              borderRadius: radius.card,
              background: index === 0 ? `linear-gradient(90deg, ${palette.accent}, ${palette.positive})` : 'rgba(255,255,255,0.08)',
              color: index === 0 ? '#020617' : palette.text,
              border: `1px solid ${index === 0 ? palette.accent : palette.line}`,
              fontSize: 22,
              fontWeight: 900
            }}
          >
            {term}
          </div>
        ))}
      </div>
    </div>
  );
}

function Keywords({ scene, palette, enter, layout }: { scene: RemotionSceneInput; palette: AiPalette; enter: number; layout: AiLayout }) {
  const terms = keyTerms(scene);
  const isWide = layout.isWide;
  if (!terms.length) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: isWide ? 88 : 70,
        right: isWide ? 88 : 70,
        bottom: isWide ? 144 : 226,
        display: 'flex',
        gap: 12,
        flexWrap: 'wrap',
        opacity: enter
      }}
    >
      {terms.map((term, index) => (
        <div
          key={`${term}-${index}`}
          style={{
            padding: '11px 18px',
            borderRadius: radius.chip,
            background: index === 0 ? `${palette.accent}2e` : 'rgba(255,255,255,0.07)',
            border: `1px solid ${index === 0 ? palette.accent : palette.line}`,
            color: index === 0 ? palette.accent : palette.text,
            fontSize: isWide ? 20 : 22,
            fontWeight: 850
          }}
        >
          {term}
        </div>
      ))}
    </div>
  );
}

function SubtitleBar({ scene, palette, frame, layout }: { scene: RemotionSceneInput; palette: AiPalette; frame: number; layout: AiLayout }) {
  const activeCue = scene.subtitleCues?.find((cue) => frame >= cue.startSec * FPS && frame <= cue.endSec * FPS);
  const rawText = activeCue?.text || scene.subtitle;
  const cueProgress = activeCue
    ? clamp((frame - activeCue.startSec * FPS) / Math.max(1, (activeCue.endSec - activeCue.startSec) * FPS), 0, 1)
    : 1;
  const shouldType = scene.visualType === 'screen' || scene.layout === 'process' || scene.layout === 'network';
  const text = shouldType ? `${typingText(rawText, cueProgress)}${cueProgress < 0.98 ? '|' : ''}` : rawText;
  const isWide = layout.isWide;
  return (
    <div
      style={{
        position: 'absolute',
        left: isWide ? 260 : 62,
        right: isWide ? 260 : 62,
        bottom: isWide ? 38 : 62,
        padding: isWide ? '16px 24px' : '20px 24px',
        borderRadius: radius.panel,
        background: 'rgba(2, 6, 23, 0.82)',
        border: `1px solid ${palette.line}`,
        color: palette.text,
        fontSize: isWide ? 28 : 34,
        lineHeight: 1.28,
        fontWeight: 850,
        textAlign: 'center'
      }}
    >
      {splitLines(text, isWide ? 34 : 24, 2).map((line, index) => (
        <div key={`${line}-${index}`}>{line}</div>
      ))}
    </div>
  );
}

function SceneVisual({
  input,
  scene,
  sceneIndex,
  sceneCount,
  palette
}: {
  input: RemotionVideoInput;
  scene: RemotionSceneInput;
  sceneIndex: number;
  sceneCount: number;
  palette: AiPalette;
}) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const layout = { isWide: width > height };
  const duration = sceneFrames(scene);
  const progress = localProgress(frame, duration);
  const enter = Math.max(0.72, spring({ frame, fps, config: { damping: 18, stiffness: 90, mass: 0.9 } }));
  const displayMode = primaryDisplay(scene);
  const motion = sceneMotion(scene, progress);

  return (
    <AbsoluteFill style={{ opacity: motion.opacity, transform: motion.transform }}>
      <Background palette={palette} progress={progress} />
      <AccentWave palette={palette} progress={progress} />
      <SceneBackdrop scene={scene} palette={palette} progress={progress} layout={layout} displayMode={displayMode} />
      <Header input={input} scene={scene} sceneIndex={sceneIndex} sceneCount={sceneCount} palette={palette} enter={enter} layout={layout} />
      {displayMode === 'hero' ? <HeroPanel scene={scene} palette={palette} enter={enter} layout={layout} /> : null}
      {displayMode === 'cards' ? <InsightCards scene={scene} palette={palette} enter={enter} layout={layout} /> : null}
      {displayMode === 'process' ? <ProcessStrip scene={scene} palette={palette} enter={enter} layout={layout} /> : null}
      {displayMode === 'cause' ? <CauseFlowPanel scene={scene} palette={palette} enter={enter} progress={progress} layout={layout} /> : null}
      {displayMode === 'result' ? <ResultShowcasePanel scene={scene} palette={palette} enter={enter} progress={progress} layout={layout} /> : null}
      {displayMode === 'data' ? <DataPanel scene={scene} palette={palette} enter={enter} progress={progress} layout={layout} /> : null}
      {displayMode === 'contrast' ? <ContrastPanel scene={scene} palette={palette} enter={enter} layout={layout} /> : null}
      {displayMode === 'timeline' ? <TimelinePanel scene={scene} palette={palette} enter={enter} layout={layout} /> : null}
      {displayMode === 'matrix' ? <MatrixPanel scene={scene} palette={palette} enter={enter} layout={layout} /> : null}
      {displayMode === 'network' ? <NetworkPanel scene={scene} palette={palette} enter={enter} progress={progress} layout={layout} /> : null}
      {displayMode === 'pyramid' ? <PyramidPanel scene={scene} palette={palette} enter={enter} layout={layout} /> : null}
      {displayMode === 'checklist' ? <ChecklistPanel scene={scene} palette={palette} enter={enter} layout={layout} /> : null}
      {displayMode === 'cta' ? <CtaPanel scene={scene} palette={palette} enter={enter} layout={layout} /> : null}
      <Keywords scene={scene} palette={palette} enter={enter} layout={layout} />
      <SubtitleBar scene={scene} palette={palette} frame={frame} layout={layout} />
    </AbsoluteFill>
  );
}

export function AiExplainerShort(input: RemotionVideoInput) {
  const palette = palettes[input.project.visualPreset || 'clarity-blue'] || palettes['clarity-blue'];
  return (
    <AbsoluteFill style={{ background: palette.bg, fontFamily: 'Inter, Arial, "PingFang SC", "Microsoft YaHei", sans-serif' }}>
      {input.project.audioPath ? <Audio src={staticFile(input.project.audioPath.replace(/^\//, ''))} /> : null}
      {input.scenes.map((scene, index) => {
        const durationInFrames = sceneFrames(scene);
        return (
          <Sequence key={scene.id} from={getSceneStart(input.scenes, index)} durationInFrames={durationInFrames}>
            {scene.audioPath ? <Audio src={staticFile(scene.audioPath.replace(/^\//, ''))} volume={(frame) => voiceoverVolume(frame, durationInFrames)} /> : null}
            <SceneVisual input={input} scene={scene} sceneIndex={index} sceneCount={input.scenes.length} palette={palette} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}
