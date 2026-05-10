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

type SceneMode =
  | 'hero'
  | 'contrast'
  | 'network'
  | 'process'
  | 'chart'
  | 'matrix'
  | 'checklist'
  | 'cta'
  | 'cause'
  | 'timeline'
  | 'mistake'
  | 'pyramid';

type TechPalette = {
  bg: string;
  panel: string;
  panelStrong: string;
  line: string;
  text: string;
  muted: string;
  accent: string;
  accent2: string;
  warning: string;
  success: string;
};

const palettes: Record<string, TechPalette> = {
  'clarity-blue': {
    bg: '#07111f',
    panel: 'rgba(15, 35, 60, 0.72)',
    panelStrong: 'rgba(8, 20, 40, 0.88)',
    line: 'rgba(148, 190, 255, 0.28)',
    text: '#f8fafc',
    muted: '#b6c5d8',
    accent: '#51e4ff',
    accent2: '#8b5cf6',
    warning: '#f7ea4f',
    success: '#43f2a5'
  },
  'midnight-cyan': {
    bg: '#03131f',
    panel: 'rgba(9, 45, 66, 0.74)',
    panelStrong: 'rgba(2, 22, 34, 0.9)',
    line: 'rgba(125, 249, 255, 0.24)',
    text: '#f0fdfa',
    muted: '#a8c7c8',
    accent: '#22d3ee',
    accent2: '#60a5fa',
    warning: '#d9f99d',
    success: '#2dd4bf'
  },
  'sunset-amber': {
    bg: '#170d13',
    panel: 'rgba(57, 25, 29, 0.72)',
    panelStrong: 'rgba(34, 14, 18, 0.9)',
    line: 'rgba(251, 191, 36, 0.24)',
    text: '#fff7ed',
    muted: '#f6cdb2',
    accent: '#fb923c',
    accent2: '#f43f5e',
    warning: '#fde047',
    success: '#86efac'
  }
};

const modeLabels: Record<SceneMode, string> = {
  hero: 'KEY IDEA',
  contrast: 'GAP',
  network: 'SYSTEM',
  process: 'FLOW',
  chart: 'TREND',
  matrix: 'FRAMEWORK',
  checklist: 'TAKEAWAY',
  cta: 'NEXT',
  cause: 'WHY',
  timeline: 'STEPS',
  mistake: 'AVOID',
  pyramid: 'MODEL'
};

function sceneFrames(scene: RemotionSceneInput) {
  return Math.max(1, Math.ceil(scene.durationSec * FPS));
}

function getSceneStart(scenes: RemotionSceneInput[], index: number) {
  return scenes.slice(0, index).reduce((total, scene) => total + sceneFrames(scene), 0);
}

export function getTechDurationInFrames(input: RemotionVideoInput) {
  return Math.max(FPS * 5, input.scenes.reduce((total, scene) => total + sceneFrames(scene), 0));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function progress(frame: number, duration: number) {
  return clamp(frame / Math.max(1, duration), 0, 1);
}

function lines(text: string, maxChars: number, maxLines: number) {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return [''];
  const chunks = compact.match(new RegExp(`.{1,${maxChars}}`, 'g')) || [compact];
  return chunks.slice(0, maxLines);
}

function semanticUnits(text: string, fallback: string[], maxItems: number) {
  const compact = text.replace(/\s+/g, ' ').trim();
  const byPunctuation = compact
    .split(/[。！？；;,.，、]/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
  const units = byPunctuation.length >= 2 ? byPunctuation : lines(compact, 9, maxItems);
  return (units.length ? units : fallback).slice(0, maxItems);
}

function displaySeeds(scene: RemotionSceneInput) {
  return Array.from(new Set([
    ...(scene.cards || []),
    scene.headline || '',
    scene.subtitle || '',
    scene.emphasis || '',
    ...(scene.keywords || [])
  ].map((item) => item.replace(/\s+/g, ' ').trim()).filter((item) => item.length >= 2)));
}

function displayUnits(scene: RemotionSceneInput, fallback: string[], maxItems: number, maxChars = 12) {
  const seeds = displaySeeds(scene);
  const units = seeds.flatMap((item) => semanticUnits(item, [], 2))
    .map((item) => item.slice(0, maxChars))
    .filter((item) => item.length >= 2);
  return (Array.from(new Set(units)).length ? Array.from(new Set(units)) : fallback).slice(0, maxItems);
}

function displayLines(scene: RemotionSceneInput, fallback: string, maxChars: number, maxLines: number) {
  const seeds = displaySeeds(scene);
  return lines(seeds.length ? seeds.slice(0, maxLines + 1).join(' · ') : fallback, maxChars, maxLines);
}

function hasAny(text: string, words: string[]) {
  return words.some((word) => text.includes(word));
}

function classifyMode(scene: RemotionSceneInput): SceneMode {
  if (scene.layout && modeLabels[scene.layout]) return scene.layout;
  const text = `${scene.subtitle} ${scene.voiceover} ${scene.visualPrompt}`.toLowerCase();
  if (scene.shotType === 'title') return 'hero';
  if (scene.shotType === 'cta') return 'cta';
  if (hasAny(text, ['为什么', '原因', '因为', '来自', '从哪来', '底层逻辑'])) return 'cause';
  if (hasAny(text, ['误区', '避坑', '不要', '不能', '错误', '注意'])) return 'mistake';
  if (hasAny(text, ['第一', '第二', '第三', '步骤', '三步', '流程', '路径'])) return 'timeline';
  if (hasAny(text, ['金字塔', '底层', '基础', '进阶', '顶层', '模型'])) return 'pyramid';
  if (scene.shotType === 'pain') return 'contrast';
  if (scene.visualType === 'image') return 'chart';
  if (scene.visualType === 'screen') {
    if (hasAny(text, ['节点', '工作流', '传递', '聊天框', '调用', '连接'])) return 'network';
    return 'process';
  }
  if (hasAny(text, ['数据', '增长', '提升', '趋势', '效率', '分数', '峰值'])) return 'chart';
  if (hasAny(text, ['方法', '框架', '能力', '模块', '规则', '体系'])) return 'matrix';
  if (scene.shotType === 'result') return 'checklist';
  return scene.shotType === 'step' ? 'process' : 'matrix';
}

function keywordSplit(text: string) {
  const hotWords = ['AI', '差距', '效率', '流程', '能力', '自动', '结果', '超级个体', '方法', '工具', '内容', '数据', '模型'];
  const found = hotWords.find((word) => text.includes(word));
  if (!found) return { before: text, hot: '', after: '' };
  const index = text.indexOf(found);
  return {
    before: text.slice(0, index),
    hot: found,
    after: text.slice(index + found.length)
  };
}

function TechBackground({ palette, mode, localProgress }: { palette: TechPalette; mode: SceneMode; localProgress: number }) {
  const drift = interpolate(localProgress, [0, 1], [-20, 44], { easing: Easing.inOut(Easing.cubic) });
  return (
    <AbsoluteFill
      style={{
        background:
          `radial-gradient(circle at 12% 34%, ${palette.accent}24 0%, transparent 28%), ` +
          `radial-gradient(circle at 78% 18%, ${palette.accent2}22 0%, transparent 30%), ` +
          `linear-gradient(135deg, ${palette.bg} 0%, #020617 54%, #111827 100%)`,
        overflow: 'hidden'
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: 0.13,
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.24) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.18) 1px, transparent 1px)',
          backgroundSize: '84px 84px',
          transform: `translateY(${drift}px)`
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(90deg, rgba(255,255,255,0.04), transparent 18%, transparent 82%, rgba(255,255,255,0.04))',
          opacity: mode === 'hero' ? 0.7 : 0.45
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: 1320,
          height: 1320,
          left: -640,
          bottom: -760,
          borderRadius: '50%',
          border: `2px solid ${palette.line}`,
          transform: `rotate(${localProgress * 14}deg)`
        }}
      />
    </AbsoluteFill>
  );
}

function SceneChrome({
  scene,
  sceneIndex,
  sceneCount,
  mode,
  palette,
  enter
}: {
  scene: RemotionSceneInput;
  sceneIndex: number;
  sceneCount: number;
  mode: SceneMode;
  palette: TechPalette;
  enter: number;
}) {
  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: 62,
          right: 62,
          top: 58,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          opacity: enter
        }}
      >
        <div
          style={{
            padding: '14px 24px',
            borderRadius: 18,
            color: palette.accent,
            border: `1px solid ${palette.line}`,
            background: palette.panel,
            fontSize: 24,
            fontWeight: 900
          }}
        >
          {modeLabels[mode]}
        </div>
        <div style={{ color: palette.muted, fontSize: 24, fontWeight: 800 }}>
          {String(sceneIndex + 1).padStart(2, '0')} / {String(sceneCount).padStart(2, '0')}
        </div>
      </div>
      <div style={{ position: 'absolute', left: 62, right: 62, bottom: 50, height: 8, background: 'rgba(255,255,255,0.08)' }}>
        <div
          style={{
            width: `${((sceneIndex + 1) / sceneCount) * 100}%`,
            height: '100%',
            background: `linear-gradient(90deg, ${palette.accent}, ${palette.accent2}, ${palette.warning})`
          }}
        />
      </div>
    </>
  );
}

function MainCaption({ scene, palette, frame }: { scene: RemotionSceneInput; palette: TechPalette; frame: number }) {
  const currentSec = frame / FPS;
  const activeCue = scene.subtitleCues?.find((cue) => currentSec >= cue.startSec && currentSec < cue.endSec);
  const captionLines = semanticUnits(scene.voiceover, [scene.subtitle], 3);
  const hotWords = [
    scene.emphasis,
    ...(scene.keywords || []),
    'AI',
    '差距',
    '效率',
    '流程',
    '能力',
    '自动',
    '结果',
    '方法',
    '工具',
    '内容'
  ].filter((item): item is string => Boolean(item));

  if (activeCue) {
    const cueProgress = interpolate(currentSec, [activeCue.startSec, activeCue.startSec + 0.22], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp'
    });
    const hot = hotWords.find((word) => activeCue.text.includes(word));
    const parts = hot ? activeCue.text.split(hot) : [activeCue.text];
    return (
      <div
        style={{
          position: 'absolute',
          left: 84,
          right: 84,
          bottom: 156,
          textAlign: 'center',
          color: palette.text,
          fontSize: 42,
          lineHeight: 1.25,
          fontWeight: 820,
          opacity: cueProgress,
          transform: `translateY(${(1 - cueProgress) * 16}px)`,
          textShadow: '0 3px 18px rgba(0,0,0,0.75)'
        }}
      >
        {hot ? (
          <>
            {parts[0]}
            <span style={{ color: palette.warning, textShadow: `0 0 22px ${palette.warning}66` }}>{hot}</span>
            {parts.slice(1).join(hot)}
          </>
        ) : activeCue.text}
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'absolute',
        left: 84,
        right: 84,
        bottom: 156,
        textAlign: 'center',
        color: palette.text,
        fontSize: 40,
        lineHeight: 1.25,
        fontWeight: 760,
        textShadow: '0 3px 18px rgba(0,0,0,0.75)'
      }}
    >
      {captionLines.map((line, index) => {
        const reveal = interpolate(frame, [index * 18, index * 18 + 14], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp'
        });
        const hot = hotWords.find((word) => line.includes(word));
        const parts = hot ? line.split(hot) : [line];
        return (
          <div
            key={line + index}
            style={{
              display: index > 1 ? 'none' : 'block',
              opacity: reveal,
              transform: `translateY(${(1 - reveal) * 18}px) scale(${interpolate(reveal, [0, 1], [0.98, 1])})`
            }}
          >
            {hot ? (
              <>
                {parts[0]}
                <span style={{ color: palette.warning, textShadow: `0 0 22px ${palette.warning}66` }}>{hot}</span>
                {parts.slice(1).join(hot)}
              </>
            ) : line}
          </div>
        );
      })}
    </div>
  );
}

function GlassPanel({
  children,
  style,
  palette
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  palette: TechPalette;
}) {
  return (
    <div
      style={{
        borderRadius: 22,
        border: `1px solid ${palette.line}`,
        background: palette.panel,
        boxShadow: `0 30px 80px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.14)`,
        ...style
      }}
    >
      {children}
    </div>
  );
}

function ChipIcon({ palette, label = 'AI' }: { palette: TechPalette; label?: string }) {
  return (
    <div style={{ position: 'relative', width: 116, height: 116, display: 'grid', placeItems: 'center' }}>
      <div style={{ position: 'absolute', inset: 16, borderRadius: 18, border: `3px solid ${palette.accent}`, boxShadow: `0 0 36px ${palette.accent}66` }} />
      {Array.from({ length: 8 }).map((_, index) => (
        <div
          key={index}
          style={{
            position: 'absolute',
            width: index < 4 ? 4 : 18,
            height: index < 4 ? 18 : 4,
            background: index % 2 ? palette.warning : palette.success,
            left: index < 4 ? 24 + index * 22 : index < 6 ? 6 : 92,
            top: index < 4 ? index % 2 ? 6 : 92 : index === 4 || index === 6 ? 32 : 76,
            borderRadius: 4
          }}
        />
      ))}
      <div style={{ color: palette.text, fontSize: 30, fontWeight: 950 }}>{label}</div>
    </div>
  );
}

function Stage({
  children,
  palette,
  top = 250,
  height = 780,
  style
}: {
  children: React.ReactNode;
  palette: TechPalette;
  top?: number;
  height?: number;
  style?: React.CSSProperties;
}) {
  return (
    <GlassPanel
      palette={palette}
      style={{
        position: 'absolute',
        left: 54,
        right: 54,
        top,
        height,
        overflow: 'hidden',
        ...style
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            `linear-gradient(90deg, ${palette.accent}14, transparent 28%, transparent 72%, ${palette.accent2}12), ` +
            'radial-gradient(circle at 18% 18%, rgba(255,255,255,0.12), transparent 28%)'
        }}
      />
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>{children}</div>
    </GlassPanel>
  );
}

function SceneTitle({ children, palette, top = 160 }: { children: React.ReactNode; palette: TechPalette; top?: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 70,
        right: 70,
        top,
        color: palette.text,
        fontSize: 54,
        lineHeight: 1.12,
        fontWeight: 950,
        textShadow: '0 8px 28px rgba(0,0,0,0.42)'
      }}
    >
      {children}
    </div>
  );
}

function HeroScene({ scene, projectTitle, palette, enter }: { scene: RemotionSceneInput; projectTitle: string; palette: TechPalette; enter: number }) {
  const title = scene.headline || projectTitle || scene.subtitle;
  const split = keywordSplit(title);
  const titleLines = lines(title, 11, 4);
  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: 78,
          right: 78,
          top: 236,
          color: palette.text,
          opacity: enter,
          transform: `translateY(${(1 - enter) * 58}px)`
        }}
      >
        <div style={{ color: palette.accent, fontSize: 28, fontWeight: 900, marginBottom: 32, letterSpacing: 1.5 }}>
          TECH EXPLAINER
        </div>
        {split.hot ? (
          <div style={{ fontSize: 76, lineHeight: 1.12, fontWeight: 950 }}>
            {split.before}
            <span style={{ color: palette.warning, textShadow: `0 0 34px ${palette.warning}55` }}>{split.hot}</span>
            {split.after}
          </div>
        ) : (
          titleLines.map((line, index) => (
            <div key={line + index} style={{ fontSize: 82, lineHeight: 1.08, fontWeight: 950 }}>
              {line}
            </div>
          ))
        )}
      </div>
      <GlassPanel
        palette={palette}
        style={{
          position: 'absolute',
          left: 86,
          right: 86,
          top: 800,
          height: 390,
          display: 'grid',
          placeItems: 'center',
          opacity: enter,
          transform: `scale(${interpolate(enter, [0, 1], [0.96, 1])})`
        }}
      >
        <div style={{ display: 'flex', gap: 42, alignItems: 'center' }}>
          <ChipIcon palette={palette} />
          <div>
            <div style={{ color: palette.text, fontSize: 42, fontWeight: 900 }}>{scene.emphasis || '信息图自动编排'}</div>
            <div style={{ color: palette.muted, fontSize: 30, marginTop: 18 }}>{displayLines(scene, '问题拆清，结构展开', 14, 1)[0]}</div>
          </div>
        </div>
      </GlassPanel>
    </>
  );
}

function ContrastScene({ scene, palette, frame, enter }: { scene: RemotionSceneInput; palette: TechPalette; frame: number; enter: number }) {
  const chunks = displayUnits(scene, ['问题暴露', '方法缺位', '结果不稳', '需要新做法'], 4, 10);
  return (
    <div style={{ position: 'absolute', left: 72, right: 72, top: 272 }}>
      <div style={{ color: palette.warning, fontSize: 64, lineHeight: 1.12, fontWeight: 950, opacity: enter }}>
        差距从这里开始
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 26, marginTop: 72 }}>
        {['不会用 AI', '会拆问题'].map((label, index) => {
          const reveal = interpolate(frame, [index * 12, index * 12 + 22], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          return (
            <GlassPanel
              key={label}
              palette={palette}
              style={{
                height: 420,
                padding: 34,
                opacity: reveal,
                transform: `translateX(${(index === 0 ? -1 : 1) * (1 - reveal) * 70}px)`
              }}
            >
              <div style={{ color: index === 0 ? '#fca5a5' : palette.success, fontSize: 42, fontWeight: 950 }}>{label}</div>
              <div style={{ color: palette.muted, fontSize: 30, lineHeight: 1.38, marginTop: 34 }}>
                {chunks[index] || (index === 0 ? '被工具牵着走' : '让工具放大能力')}
              </div>
            </GlassPanel>
          );
        })}
      </div>
      <div style={{ marginTop: 44, color: palette.text, fontSize: 42, lineHeight: 1.25, fontWeight: 780 }}>
        {displayLines(scene, '先把问题和方法拆开，再让画面逐步推进', 14, 2).join('')}
      </div>
    </div>
  );
}

function NetworkScene({ scene, palette, frame }: { scene: RemotionSceneInput; palette: TechPalette; frame: number }) {
  const items = displayUnits(scene, ['输入', '模型', '知识', '输出'], 4, 10);
  const center = { x: 486, y: 376 };
  const nodes = [
    { x: 210, y: 166, label: items[0] || '输入' },
    { x: 762, y: 166, label: items[1] || '模型' },
    { x: 210, y: 590, label: items[2] || '知识' },
    { x: 762, y: 590, label: items[3] || '输出' }
  ];
  const lineReveal = interpolate(frame, [12, 42], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <>
      <SceneTitle palette={palette}>{scene.headline || '把问题连成系统'}</SceneTitle>
      <Stage palette={palette} top={292} height={760}>
      <svg width="972" height="760" style={{ position: 'absolute', left: 0, top: 0 }}>
        {nodes.map((node) => (
          <line
            key={`${node.x}-${node.y}`}
            x1={center.x}
            y1={center.y}
            x2={center.x + (node.x - center.x) * lineReveal}
            y2={center.y + (node.y - center.y) * lineReveal}
            stroke={palette.line}
            strokeWidth="3"
          />
        ))}
        <circle cx={center.x} cy={center.y} r={126 + lineReveal * 20} fill="none" stroke={palette.accent} strokeOpacity="0.35" strokeWidth="2" />
      </svg>
      <GlassPanel palette={palette} style={{ position: 'absolute', left: 360, top: 252, width: 252, height: 252, display: 'grid', placeItems: 'center' }}>
        <ChipIcon palette={palette} label="AI" />
      </GlassPanel>
      {nodes.map((node, index) => {
        const reveal = interpolate(frame, [20 + index * 8, 38 + index * 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        return (
          <GlassPanel
            key={node.label + index}
            palette={palette}
            style={{
              position: 'absolute',
              left: node.x - 132,
              top: node.y - 70,
              width: 264,
              height: 140,
              display: 'grid',
              placeItems: 'center',
              opacity: reveal,
              transform: `scale(${interpolate(reveal, [0, 1], [0.82, 1])})`
            }}
          >
            <div style={{ color: palette.text, fontSize: 34, fontWeight: 900, textAlign: 'center' }}>{node.label}</div>
          </GlassPanel>
        );
      })}
      </Stage>
    </>
  );
}

function ProcessScene({ scene, palette, frame }: { scene: RemotionSceneInput; palette: TechPalette; frame: number }) {
  const items = displayUnits(scene, ['识别问题', '拆成步骤', '调用工具', '得到结果'], 4, 10);
  return (
    <>
      <SceneTitle palette={palette}>{scene.headline || lines(scene.subtitle, 14, 2).join('')}</SceneTitle>
      <Stage palette={palette} top={315} height={690} style={{ padding: 40 }}>
      <div style={{ display: 'grid', gap: 26 }}>
        {items.slice(0, 4).map((item, index) => {
          const reveal = interpolate(frame, [index * 12, index * 12 + 22], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          return (
            <div key={item + index} style={{ display: 'grid', gridTemplateColumns: '92px 1fr', gap: 22, alignItems: 'center', opacity: reveal }}>
              <div
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 18,
                  display: 'grid',
                  placeItems: 'center',
                  color: palette.bg,
                  background: index % 2 ? palette.accent2 : palette.accent,
                  fontSize: 28,
                  fontWeight: 950
                }}
              >
                {index + 1}
              </div>
              <GlassPanel palette={palette} style={{ padding: '26px 32px' }}>
                <div style={{ color: palette.text, fontSize: 40, lineHeight: 1.18, fontWeight: 850 }}>{item}</div>
              </GlassPanel>
            </div>
          );
        })}
      </div>
      </Stage>
    </>
  );
}

function ChartScene({ scene, palette, frame }: { scene: RemotionSceneInput; palette: TechPalette; frame: number }) {
  const chartProgress = interpolate(frame, [12, 58], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const data = scene.chartData?.length ? scene.chartData.slice(0, 7) : [8, 25, 52, 41, 80, 64, 95];
  const max = Math.max(...data, 100);
  const points = data.map((value, index) => {
    const x = 120 + index * (840 / Math.max(1, data.length - 1));
    const y = 630 - (value / max) * 390;
    return [x, y];
  });
  const polyline = points.map(([x, y]) => `${x},${y}`).join(' ');
  return (
    <>
      <SceneTitle palette={palette}>{scene.headline || '把能力变成曲线'}</SceneTitle>
      <Stage palette={palette} top={300} height={670} style={{ padding: 34 }}>
        <svg width="940" height="520">
          {Array.from({ length: 5 }).map((_, index) => (
            <line key={index} x1="60" x2="920" y1={110 + index * 84} y2={110 + index * 84} stroke={palette.line} strokeWidth="2" />
          ))}
          <polyline
            points={polyline}
            fill="none"
            stroke={palette.accent}
            strokeWidth="8"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="1200"
            strokeDashoffset={1200 - chartProgress * 1200}
          />
          {points.map(([x, y], index) => {
            const show = chartProgress > index / points.length;
            return <circle key={`${x}-${y}`} cx={x} cy={y} r={show ? 9 : 0} fill={index === 4 ? palette.warning : palette.accent} />;
          })}
          <text x="656" y="286" fill={palette.warning} fontSize="30" fontWeight="900">PEAK</text>
        </svg>
      </Stage>
      <div style={{ position: 'absolute', left: 70, right: 70, top: 1008, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
        {(scene.cards?.length ? scene.cards.slice(0, 3) : ['模块化', '可复用', '规则包']).map((item, index) => (
          <GlassPanel key={item} palette={palette} style={{ padding: '28px 10px', textAlign: 'center' }}>
            <div style={{ color: index === 1 ? palette.warning : palette.text, fontSize: 36, fontWeight: 950 }}>{item}</div>
          </GlassPanel>
        ))}
      </div>
    </>
  );
}

function MatrixScene({ scene, palette, frame }: { scene: RemotionSceneInput; palette: TechPalette; frame: number }) {
  const items = displayUnits(scene, ['行业 Know-how', '流程规则', '内容方法'], 6, 12);
  const labels = items.length >= 3 ? items.slice(0, 3) : ['行业 Know-how', '流程规则', '内容方法'];
  return (
    <div style={{ position: 'absolute', left: 62, right: 62, top: 300 }}>
      <SceneTitle palette={palette} top={-120}>{scene.headline || '三层能力框架'}</SceneTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 22 }}>
        {labels.map((label, index) => {
          const reveal = interpolate(frame, [index * 10, index * 10 + 20], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          return (
            <GlassPanel key={label + index} palette={palette} style={{ minHeight: 560, padding: 24, opacity: reveal }}>
              <div style={{ color: palette.text, fontSize: 34, lineHeight: 1.14, fontWeight: 950 }}>{label}</div>
              <div style={{ marginTop: 34, height: 2, background: palette.line }} />
              <div style={{ color: palette.muted, fontSize: 26, lineHeight: 1.45, marginTop: 32 }}>
                {index === 0 ? '知识沉淀' : index === 1 ? '标准动作' : '表达模板'}
              </div>
            </GlassPanel>
          );
        })}
      </div>
    </div>
  );
}

function ChecklistScene({ scene, palette, frame }: { scene: RemotionSceneInput; palette: TechPalette; frame: number }) {
  const items = displayUnits(scene, ['清晰框架', '更快产出', '稳定复用'], 4, 10);
  return (
    <div style={{ position: 'absolute', left: 82, right: 82, top: 310 }}>
      <div style={{ color: palette.success, fontSize: 62, fontWeight: 950 }}>{scene.headline || '你会得到'}</div>
      <div style={{ display: 'grid', gap: 28, marginTop: 66 }}>
        {(items.length ? items : ['清晰框架', '更快产出', '稳定复用']).map((item, index) => {
          const reveal = interpolate(frame, [index * 12, index * 12 + 22], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          return (
            <GlassPanel key={item + index} palette={palette} style={{ padding: '30px 34px', opacity: reveal }}>
              <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
                <div style={{ color: palette.bg, background: palette.success, width: 44, height: 44, borderRadius: 99, display: 'grid', placeItems: 'center', fontSize: 28, fontWeight: 950 }}>✓</div>
                <div style={{ color: palette.text, fontSize: 40, fontWeight: 850 }}>{item}</div>
              </div>
            </GlassPanel>
          );
        })}
      </div>
    </div>
  );
}

function CauseScene({ scene, palette, frame }: { scene: RemotionSceneInput; palette: TechPalette; frame: number }) {
  const items = displayUnits(scene, ['工具变多', '问题变复杂', '方法没沉淀'], 3, 10);
  const result = scene.emphasis || displayLines(scene, '先建立规则，再放大能力', 14, 2).join('');
  return (
    <>
      <SceneTitle palette={palette}>{scene.headline || '为什么会拉开差距？'}</SceneTitle>
      <Stage palette={palette} top={310} height={720}>
        <svg width="972" height="720" style={{ position: 'absolute', inset: 0 }}>
          <line x1="240" y1="180" x2="486" y2="360" stroke={palette.line} strokeWidth="4" />
          <line x1="240" y1="540" x2="486" y2="360" stroke={palette.line} strokeWidth="4" />
          <line x1="732" y1="360" x2="486" y2="360" stroke={palette.line} strokeWidth="4" />
        </svg>
        {items.map((item, index) => {
          const positions = [
            { left: 82, top: 102 },
            { left: 82, top: 462 },
            { left: 622, top: 282 }
          ];
          const reveal = interpolate(frame, [index * 12, index * 12 + 24], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          return (
            <GlassPanel key={item + index} palette={palette} style={{ position: 'absolute', ...positions[index], width: 270, height: 148, padding: 24, opacity: reveal }}>
              <div style={{ color: index === 1 ? palette.warning : palette.text, fontSize: 34, lineHeight: 1.12, fontWeight: 900 }}>{item}</div>
            </GlassPanel>
          );
        })}
        <GlassPanel palette={palette} style={{ position: 'absolute', left: 338, top: 250, width: 300, height: 220, display: 'grid', placeItems: 'center' }}>
          <div style={{ color: palette.accent, fontSize: 42, fontWeight: 950, textAlign: 'center' }}>{result || '能力差距'}</div>
        </GlassPanel>
      </Stage>
    </>
  );
}

function TimelineScene({ scene, palette, frame }: { scene: RemotionSceneInput; palette: TechPalette; frame: number }) {
  const items = displayUnits(scene, ['明确目标', '拆成节点', '生成结果'], 4, 10);
  const revealLine = interpolate(frame, [10, 62], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <>
      <SceneTitle palette={palette}>{scene.headline || '按步骤推进'}</SceneTitle>
      <Stage palette={palette} top={310} height={710}>
        <svg width="972" height="710" style={{ position: 'absolute', inset: 0 }}>
          <line x1="120" y1="355" x2={120 + 732 * revealLine} y2="355" stroke={palette.accent} strokeWidth="6" strokeLinecap="round" />
        </svg>
        {items.map((item, index) => {
          const x = 95 + index * (780 / Math.max(1, items.length - 1));
          const reveal = interpolate(frame, [16 + index * 12, 34 + index * 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          return (
            <div key={item + index} style={{ position: 'absolute', left: x, top: index % 2 ? 386 : 152, width: 220, opacity: reveal }}>
              <div style={{ width: 54, height: 54, borderRadius: 99, background: palette.warning, color: palette.bg, display: 'grid', placeItems: 'center', fontSize: 26, fontWeight: 950, margin: '0 auto 18px' }}>{index + 1}</div>
              <GlassPanel palette={palette} style={{ padding: 22, minHeight: 130 }}>
                <div style={{ color: palette.text, fontSize: 30, lineHeight: 1.16, fontWeight: 850, textAlign: 'center' }}>{item}</div>
              </GlassPanel>
            </div>
          );
        })}
      </Stage>
    </>
  );
}

function MistakeScene({ scene, palette, frame }: { scene: RemotionSceneInput; palette: TechPalette; frame: number }) {
  const items = displayUnits(scene, ['直接套模板', '忽略目标', '缺少复盘', '先拆问题', '建立规则', '持续迭代'], 6, 10);
  const bad = items.slice(0, 3);
  const good = items.slice(3, 6).length ? items.slice(3, 6) : ['先拆问题', '建立规则', '持续迭代'];
  return (
    <>
      <SceneTitle palette={palette}>{scene.headline || '避开这几个坑'}</SceneTitle>
      <div style={{ position: 'absolute', left: 62, right: 62, top: 315, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28 }}>
        {[
          { title: '不要这样', color: '#fca5a5', items: bad },
          { title: '应该这样', color: palette.success, items: good }
        ].map((group, groupIndex) => (
          <GlassPanel key={group.title} palette={palette} style={{ minHeight: 660, padding: 30 }}>
            <div style={{ color: group.color, fontSize: 40, fontWeight: 950, marginBottom: 34 }}>{group.title}</div>
            {group.items.map((item, index) => {
              const reveal = interpolate(frame, [groupIndex * 12 + index * 10, groupIndex * 12 + index * 10 + 18], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
              return (
                <div key={item + index} style={{ color: palette.text, fontSize: 31, lineHeight: 1.22, fontWeight: 780, marginBottom: 28, opacity: reveal }}>
                  {groupIndex === 0 ? '× ' : '✓ '}
                  {item}
                </div>
              );
            })}
          </GlassPanel>
        ))}
      </div>
    </>
  );
}

function PyramidScene({ scene, palette, frame }: { scene: RemotionSceneInput; palette: TechPalette; frame: number }) {
  const items = displayUnits(scene, ['底层知识', '流程规则', 'AI 放大'], 3, 10);
  const levels = [
    { width: 760, top: 500, color: palette.accent2, label: items[0] || '底层知识' },
    { width: 600, top: 360, color: palette.accent, label: items[1] || '流程规则' },
    { width: 420, top: 220, color: palette.warning, label: items[2] || 'AI 放大' }
  ];
  return (
    <>
      <SceneTitle palette={palette}>{scene.headline || '把能力搭成模型'}</SceneTitle>
      <Stage palette={palette} top={310} height={720}>
        {levels.map((level, index) => {
          const reveal = interpolate(frame, [index * 14, index * 14 + 24], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          return (
            <div
              key={level.label}
              style={{
                position: 'absolute',
                left: (972 - level.width) / 2,
                top: level.top,
                width: level.width,
                height: 112,
                clipPath: 'polygon(7% 0, 93% 0, 100% 100%, 0% 100%)',
                background: `linear-gradient(90deg, ${level.color}44, ${level.color}88)`,
                border: `1px solid ${level.color}`,
                opacity: reveal,
                display: 'grid',
                placeItems: 'center',
                transform: `translateY(${(1 - reveal) * 34}px)`
              }}
            >
              <div style={{ color: palette.text, fontSize: 36, fontWeight: 950 }}>{level.label}</div>
            </div>
          );
        })}
      </Stage>
    </>
  );
}

function CtaScene({ scene, palette, enter }: { scene: RemotionSceneInput; palette: TechPalette; enter: number }) {
  return (
    <div style={{ position: 'absolute', left: 82, right: 82, top: 380, textAlign: 'center', opacity: enter }}>
      <div style={{ color: palette.text, fontSize: 78, lineHeight: 1.12, fontWeight: 950 }}>{scene.headline || '收藏这套框架'}</div>
      <div style={{ color: palette.warning, fontSize: 58, lineHeight: 1.18, marginTop: 42, fontWeight: 900 }}>{scene.emphasis || displayLines(scene, '先收下这套框架', 12, 3).join('')}</div>
      <GlassPanel palette={palette} style={{ marginTop: 86, padding: '42px 40px' }}>
        <div style={{ color: palette.accent, fontSize: 32, fontWeight: 900 }}>NEXT MOVE</div>
        <div style={{ color: palette.muted, fontSize: 34, lineHeight: 1.36, marginTop: 24 }}>把文案拆成问题、流程、方法和结果，画面会自动匹配对应的信息图。</div>
      </GlassPanel>
    </div>
  );
}

function SceneBody({
  mode,
  scene,
  projectTitle,
  palette,
  frame,
  enter
}: {
  mode: SceneMode;
  scene: RemotionSceneInput;
  projectTitle: string;
  palette: TechPalette;
  frame: number;
  enter: number;
}) {
  if (mode === 'hero') return <HeroScene scene={scene} projectTitle={projectTitle} palette={palette} enter={enter} />;
  if (mode === 'contrast') return <ContrastScene scene={scene} palette={palette} frame={frame} enter={enter} />;
  if (mode === 'network') return <NetworkScene scene={scene} palette={palette} frame={frame} />;
  if (mode === 'process') return <ProcessScene scene={scene} palette={palette} frame={frame} />;
  if (mode === 'chart') return <ChartScene scene={scene} palette={palette} frame={frame} />;
  if (mode === 'matrix') return <MatrixScene scene={scene} palette={palette} frame={frame} />;
  if (mode === 'checklist') return <ChecklistScene scene={scene} palette={palette} frame={frame} />;
  if (mode === 'cause') return <CauseScene scene={scene} palette={palette} frame={frame} />;
  if (mode === 'timeline') return <TimelineScene scene={scene} palette={palette} frame={frame} />;
  if (mode === 'mistake') return <MistakeScene scene={scene} palette={palette} frame={frame} />;
  if (mode === 'pyramid') return <PyramidScene scene={scene} palette={palette} frame={frame} />;
  return <CtaScene scene={scene} palette={palette} enter={enter} />;
}

function transitionStyle(scene: RemotionSceneInput, frame: number): React.CSSProperties {
  const transition = scene.transition || 'fade';
  const t = interpolate(frame, [0, 18], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic)
  });

  if (transition === 'push') {
    return {
      opacity: t,
      transform: `translateX(${(1 - t) * 92}px)`
    };
  }
  if (transition === 'zoom') {
    return {
      opacity: t,
      transform: `scale(${interpolate(t, [0, 1], [1.08, 1])})`
    };
  }
  if (transition === 'wipe') {
    return {
      opacity: 1,
      clipPath: `inset(0 ${100 - t * 100}% 0 0)`
    };
  }
  if (transition === 'flash') {
    return {
      opacity: t,
      filter: `brightness(${interpolate(t, [0, 0.35, 1], [1.9, 1.25, 1])})`,
      transform: `scale(${interpolate(t, [0, 1], [1.02, 1])})`
    };
  }
  return {
    opacity: t,
    transform: `translateY(${(1 - t) * 28}px)`
  };
}

function TransitionOverlay({ scene, frame, palette }: { scene: RemotionSceneInput; frame: number; palette: TechPalette }) {
  if (scene.transition !== 'flash' && scene.transition !== 'wipe') return null;
  const opacity = scene.transition === 'flash'
    ? interpolate(frame, [0, 5, 16], [0.5, 0.18, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    : interpolate(frame, [0, 14], [0.42, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill
      style={{
        pointerEvents: 'none',
        opacity,
        background: scene.transition === 'flash'
          ? palette.warning
          : `linear-gradient(90deg, ${palette.accent}, transparent)`
      }}
    />
  );
}

function LandscapeChrome({
  sceneIndex,
  sceneCount,
  mode,
  palette,
  enter
}: {
  sceneIndex: number;
  sceneCount: number;
  mode: SceneMode;
  palette: TechPalette;
  enter: number;
}) {
  return (
    <>
      <div style={{ position: 'absolute', left: 72, right: 72, top: 48, display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: enter }}>
        <div style={{ color: palette.accent, fontSize: 26, fontWeight: 950, letterSpacing: 1.6 }}>{modeLabels[mode]} / TECH EXPLAINER</div>
        <div style={{ color: palette.muted, fontSize: 24, fontWeight: 850 }}>{String(sceneIndex + 1).padStart(2, '0')} / {String(sceneCount).padStart(2, '0')}</div>
      </div>
      <div style={{ position: 'absolute', left: 72, right: 72, bottom: 42, height: 7, background: 'rgba(255,255,255,0.08)' }}>
        <div style={{ width: `${((sceneIndex + 1) / sceneCount) * 100}%`, height: '100%', background: `linear-gradient(90deg, ${palette.accent}, ${palette.accent2}, ${palette.warning})` }} />
      </div>
    </>
  );
}

function landscapeItems(scene: RemotionSceneInput, fallback: string[], count = 4) {
  return displayUnits(scene, fallback, count, 12);
}

function LandscapeVisual({ scene, mode, palette, frame }: { scene: RemotionSceneInput; mode: SceneMode; palette: TechPalette; frame: number }) {
  const items = landscapeItems(scene, ['输入', '模型', '流程', '结果'], 6);
  const reveal = interpolate(frame, [8, 28], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  if (mode === 'chart') {
    const data = scene.chartData?.length ? scene.chartData.slice(0, 7) : [10, 28, 45, 38, 72, 64, 92];
    const max = Math.max(...data, 100);
    const points = data.map((value, index) => {
      const x = 80 + index * (700 / Math.max(1, data.length - 1));
      const y = 500 - (value / max) * 350;
      return [x, y];
    });
    const chartProgress = interpolate(frame, [12, 62], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
    return (
      <GlassPanel palette={palette} style={{ position: 'absolute', right: 74, top: 170, width: 850, height: 590, padding: 34, opacity: reveal }}>
        <svg width="782" height="510">
          {Array.from({ length: 5 }).map((_, index) => <line key={index} x1="50" x2="760" y1={100 + index * 86} y2={100 + index * 86} stroke={palette.line} strokeWidth="2" />)}
          <polyline points={points.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" stroke={palette.accent} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1100" strokeDashoffset={1100 - chartProgress * 1100} />
          {points.map(([x, y], index) => <circle key={`${x}-${y}`} cx={x} cy={y} r={chartProgress > index / points.length ? 9 : 0} fill={index === points.length - 1 ? palette.warning : palette.accent} />)}
        </svg>
      </GlassPanel>
    );
  }

  if (mode === 'network' || mode === 'cause') {
    const nodes = items.slice(0, 4);
    return (
      <GlassPanel palette={palette} style={{ position: 'absolute', right: 74, top: 154, width: 850, height: 620, opacity: reveal }}>
        <svg width="850" height="620" style={{ position: 'absolute', inset: 0 }}>
          {[0, 1, 2, 3].map((index) => <line key={index} x1="425" y1="310" x2={index % 2 ? 660 : 190} y2={index < 2 ? 150 : 470} stroke={palette.line} strokeWidth="3" />)}
          <circle cx="425" cy="310" r="112" fill="none" stroke={palette.accent} strokeOpacity="0.42" strokeWidth="3" />
        </svg>
        <div style={{ position: 'absolute', left: 330, top: 215 }}><ChipIcon palette={palette} label="AI" /></div>
        {nodes.map((item, index) => {
          const positions = [
            { left: 80, top: 92 },
            { left: 560, top: 92 },
            { left: 80, top: 406 },
            { left: 560, top: 406 }
          ];
          return (
            <GlassPanel key={item + index} palette={palette} style={{ position: 'absolute', ...positions[index], width: 210, height: 120, display: 'grid', placeItems: 'center', padding: 16 }}>
              <div style={{ color: palette.text, fontSize: 30, lineHeight: 1.12, fontWeight: 900, textAlign: 'center' }}>{item}</div>
            </GlassPanel>
          );
        })}
      </GlassPanel>
    );
  }

  return (
    <div style={{ position: 'absolute', right: 74, top: 154, width: 850, height: 640, display: 'grid', gridTemplateColumns: mode === 'mistake' ? '1fr 1fr' : '1fr 1fr', gap: 24, opacity: reveal }}>
      {items.slice(0, mode === 'pyramid' ? 3 : 4).map((item, index) => (
        <GlassPanel key={item + index} palette={palette} style={{ padding: 30, minHeight: mode === 'pyramid' ? 150 : 210, display: 'grid', alignContent: 'center' }}>
          <div style={{ color: index === 0 ? palette.warning : palette.text, fontSize: 36, lineHeight: 1.14, fontWeight: 950 }}>{item}</div>
          <div style={{ marginTop: 18, height: 3, width: 72, background: index % 2 ? palette.accent2 : palette.accent }} />
        </GlassPanel>
      ))}
    </div>
  );
}

function LandscapeTechScene({
  scene,
  projectTitle,
  preset,
  sceneIndex,
  sceneCount
}: {
  scene: RemotionSceneInput;
  projectTitle: string;
  preset: string;
  sceneIndex: number;
  sceneCount: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const duration = sceneFrames(scene);
  const palette = palettes[preset] || palettes['clarity-blue'];
  const localProgress = progress(frame, duration);
  const enter = spring({ frame, fps, config: { damping: 18, stiffness: 90 } });
  const mode = classifyMode(scene);
  const title = scene.headline || (mode === 'hero' ? projectTitle : scene.subtitle);

  return (
    <AbsoluteFill style={{ fontFamily: '"Avenir Next", "PingFang SC", "Hiragino Sans GB", sans-serif', overflow: 'hidden' }}>
      {scene.audioPath ? <Audio src={staticFile(scene.audioPath.replace(/^\/+/, ''))} volume={(audioFrame) => voiceoverVolume(audioFrame, duration)} /> : null}
      <div style={{ position: 'absolute', inset: 0, ...transitionStyle(scene, frame) }}>
        <TechBackground palette={palette} mode={mode} localProgress={localProgress} />
        <div style={{ position: 'absolute', left: 82, top: 180, width: 760, color: palette.text, opacity: enter, transform: `translateY(${(1 - enter) * 42}px)` }}>
          <div style={{ color: palette.accent, fontSize: 28, fontWeight: 950, marginBottom: 28 }}>{scene.emphasis || modeLabels[mode]}</div>
          <div style={{ fontSize: 72, lineHeight: 1.08, fontWeight: 950 }}>{lines(title, 11, 3).map((line) => <div key={line}>{line}</div>)}</div>
          <div style={{ marginTop: 42, color: palette.muted, fontSize: 34, lineHeight: 1.42, fontWeight: 650 }}>{displayLines(scene, '把信息拆成结构、卡片和结果，再让旁白补解释', 18, 3).join('')}</div>
        </div>
        <LandscapeVisual scene={scene} mode={mode} palette={palette} frame={frame} />
        <MainCaption scene={scene} palette={palette} frame={frame} />
        <LandscapeChrome sceneIndex={sceneIndex} sceneCount={sceneCount} mode={mode} palette={palette} enter={enter} />
        </div>
      <TransitionOverlay scene={scene} frame={frame} palette={palette} />
    </AbsoluteFill>
  );
}

function TechScene({
  scene,
  projectTitle,
  preset,
  sceneIndex,
  sceneCount
}: {
  scene: RemotionSceneInput;
  projectTitle: string;
  preset: string;
  sceneIndex: number;
  sceneCount: number;
}) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  if (width > height) {
    return <LandscapeTechScene scene={scene} projectTitle={projectTitle} preset={preset} sceneIndex={sceneIndex} sceneCount={sceneCount} />;
  }
  const duration = sceneFrames(scene);
  const palette = palettes[preset] || palettes['clarity-blue'];
  const localProgress = progress(frame, duration);
  const enter = spring({ frame, fps, config: { damping: 18, stiffness: 90 } });
  const mode = classifyMode(scene);

  return (
    <AbsoluteFill style={{ fontFamily: '"Avenir Next", "PingFang SC", "Hiragino Sans GB", sans-serif', overflow: 'hidden' }}>
      {scene.audioPath ? <Audio src={staticFile(scene.audioPath.replace(/^\/+/, ''))} volume={(audioFrame) => voiceoverVolume(audioFrame, duration)} /> : null}
      <div style={{ position: 'absolute', inset: 0, ...transitionStyle(scene, frame) }}>
        <TechBackground palette={palette} mode={mode} localProgress={localProgress} />
        <SceneBody mode={mode} scene={scene} projectTitle={projectTitle} palette={palette} frame={frame} enter={enter} />
        <MainCaption scene={scene} palette={palette} frame={frame} />
        <SceneChrome scene={scene} sceneIndex={sceneIndex} sceneCount={sceneCount} mode={mode} palette={palette} enter={enter} />
      </div>
      <TransitionOverlay scene={scene} frame={frame} palette={palette} />
    </AbsoluteFill>
  );
}

export function TechExplainer(input: RemotionVideoInput) {
  const preset = input.project.visualPreset || 'clarity-blue';
  const scenes = [...input.scenes].sort((a, b) => a.order - b.order);
  return (
    <AbsoluteFill style={{ background: '#020617' }}>
      {input.project.audioPath ? <Audio src={staticFile(input.project.audioPath.replace(/^\//, ''))} /> : null}
      {scenes.map((scene, index) => (
        <Sequence key={scene.id} from={getSceneStart(scenes, index)} durationInFrames={sceneFrames(scene)}>
          <TechScene scene={scene} projectTitle={input.project.title} preset={preset} sceneIndex={index} sceneCount={scenes.length} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
