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

type Palette = {
  bg: string;
  panel: string;
  accent: string;
  warm: string;
  glow: string;
  ink: string;
};

const paletteByPreset: Record<string, Palette> = {
  'clarity-blue': {
    bg: '#07111f',
    panel: 'rgba(15, 36, 60, 0.78)',
    accent: '#38bdf8',
    warm: '#fbbf24',
    glow: 'rgba(56, 189, 248, 0.24)',
    ink: '#dbeafe'
  },
  'midnight-cyan': {
    bg: '#03131f',
    panel: 'rgba(8, 47, 73, 0.78)',
    accent: '#22d3ee',
    warm: '#a7f3d0',
    glow: 'rgba(34, 211, 238, 0.24)',
    ink: '#ccfbf1'
  },
  'sunset-amber': {
    bg: '#190d12',
    panel: 'rgba(67, 20, 7, 0.74)',
    accent: '#fb923c',
    warm: '#fde68a',
    glow: 'rgba(251, 146, 60, 0.24)',
    ink: '#ffedd5'
  }
};

const shotMeta: Record<RemotionSceneInput['shotType'], { label: string; eyebrow: string; symbol: string; color: string }> = {
  title: { label: 'OPENING', eyebrow: '今日教程', symbol: '01', color: '#38bdf8' },
  pain: { label: 'PAIN POINT', eyebrow: '先看问题', symbol: '!', color: '#fb7185' },
  step: { label: 'ACTION STEP', eyebrow: '跟着做', symbol: '#', color: '#a78bfa' },
  result: { label: 'OUTCOME', eyebrow: '你会得到', symbol: '+', color: '#34d399' },
  cta: { label: 'NEXT MOVE', eyebrow: '继续学习', symbol: '>', color: '#f59e0b' }
};

function splitText(text: string, maxChars: number, maxLines: number) {
  const compact = text.replace(/\s+/g, ' ').trim();
  const lines = compact.match(new RegExp(`.{1,${maxChars}}`, 'g')) || [''];
  return lines.slice(0, maxLines);
}

function sceneFrames(scene: RemotionSceneInput) {
  return Math.max(1, Math.ceil(scene.durationSec * FPS));
}

function getSceneStart(scenes: RemotionSceneInput[], index: number) {
  return scenes.slice(0, index).reduce((total, scene) => total + sceneFrames(scene), 0);
}

function getTotalFrames(scenes: RemotionSceneInput[]) {
  return scenes.reduce((total, scene) => total + sceneFrames(scene), 0);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function frameProgress(frame: number, duration: number) {
  return clamp(frame / Math.max(1, duration), 0, 1);
}

function Background({ palette, scene, progress }: { palette: Palette; scene: RemotionSceneInput; progress: number }) {
  const meta = shotMeta[scene.shotType];
  const orbit = interpolate(progress, [0, 1], [0, 84], { easing: Easing.inOut(Easing.cubic) });
  const meshOpacity = scene.shotType === 'pain' ? 0.16 : scene.shotType === 'result' ? 0.22 : 0.12;

  return (
    <AbsoluteFill
      style={{
        background:
          `radial-gradient(circle at 72% ${18 + orbit / 8}%, ${palette.glow}, transparent 35%), ` +
          `radial-gradient(circle at 8% 82%, ${meta.color}30, transparent 32%), ` +
          `linear-gradient(145deg, ${palette.bg} 0%, #020617 58%, #111827 100%)`,
        overflow: 'hidden'
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `url(${staticFile('noise.svg')})`,
          opacity: 0.075
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: meshOpacity,
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.16) 1px, transparent 1px)',
          backgroundSize: '72px 72px',
          transform: `translateY(${-progress * 42}px)`
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: 680,
          height: 680,
          borderRadius: '50%',
          right: -230,
          top: 120 + orbit,
          background: `radial-gradient(circle, ${meta.color}42 0%, transparent 62%)`,
          filter: 'blur(8px)'
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: 920,
          height: 920,
          left: -520,
          bottom: -460,
          borderRadius: '50%',
          border: `2px solid ${meta.color}30`,
          transform: `rotate(${progress * 16}deg)`
        }}
      />
    </AbsoluteFill>
  );
}

function HeaderBand({
  scene,
  sceneIndex,
  sceneCount,
  palette,
  enter
}: {
  scene: RemotionSceneInput;
  sceneIndex: number;
  sceneCount: number;
  palette: Palette;
  enter: number;
}) {
  const meta = shotMeta[scene.shotType];

  return (
    <div
      style={{
        position: 'absolute',
        left: 68,
        right: 68,
        top: 80,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        opacity: enter,
        transform: `translateY(${interpolate(enter, [0, 1], [24, 0])}px)`
      }}
    >
      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <div
          style={{
            width: 66,
            height: 66,
            borderRadius: 24,
            display: 'grid',
            placeItems: 'center',
            background: `${meta.color}24`,
            border: `1px solid ${meta.color}`,
            color: meta.color,
            fontSize: 24,
            fontWeight: 950
          }}
        >
          {meta.symbol}
        </div>
        <div>
          <div style={{ color: meta.color, fontSize: 26, fontWeight: 900, letterSpacing: 1.8 }}>{meta.label}</div>
          <div style={{ color: '#94a3b8', fontSize: 20, marginTop: 4 }}>{meta.eyebrow}</div>
        </div>
      </div>
      <div style={{ minWidth: 210, textAlign: 'right' }}>
        <div style={{ color: '#e2e8f0', fontSize: 24, fontWeight: 850 }}>
          {String(sceneIndex + 1).padStart(2, '0')} / {String(sceneCount).padStart(2, '0')}
        </div>
        <div style={{ height: 5, marginTop: 10, borderRadius: 99, background: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
          <div style={{ width: `${((sceneIndex + 1) / sceneCount) * 100}%`, height: '100%', background: palette.accent }} />
        </div>
      </div>
    </div>
  );
}

function TitleBlock({
  lines,
  scene,
  enter,
  palette
}: {
  lines: string[];
  scene: RemotionSceneInput;
  enter: number;
  palette: Palette;
}) {
  const meta = shotMeta[scene.shotType];
  const isTitle = scene.shotType === 'title';
  const top = isTitle ? 270 : scene.shotType === 'step' ? 250 : 286;
  const fontSize = isTitle ? 86 : scene.shotType === 'cta' ? 74 : 68;

  return (
    <div
      style={{
        position: 'absolute',
        left: 68,
        right: 68,
        top,
        opacity: enter,
        transform: `translateY(${interpolate(enter, [0, 1], [70, 0])}px)`
      }}
    >
      {isTitle ? (
        <div style={{ color: meta.color, fontSize: 28, fontWeight: 900, letterSpacing: 5, marginBottom: 28 }}>
          REMOTION VIDEO FACTORY
        </div>
      ) : null}
      {lines.map((line, index) => (
        <div
          key={index}
          style={{
            color: index === lines.length - 1 && scene.shotType === 'result' ? palette.warm : '#f8fafc',
            fontSize,
            lineHeight: 1.1,
            fontWeight: 950,
            letterSpacing: -2.4,
            textShadow: `0 0 44px ${palette.glow}`
          }}
        >
          {line}
        </div>
      ))}
    </div>
  );
}

function StepRail({
  scene,
  sceneIndex,
  sceneCount,
  progress
}: {
  scene: RemotionSceneInput;
  sceneIndex: number;
  sceneCount: number;
  progress: number;
}) {
  if (scene.shotType !== 'step') return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: 68,
        right: 68,
        top: 600,
        display: 'grid',
        gridTemplateColumns: `repeat(${sceneCount}, 1fr)`,
        gap: 10
      }}
    >
      {Array.from({ length: sceneCount }).map((_, index) => {
        const active = index <= sceneIndex;
        return (
          <div key={index} style={{ height: 12, borderRadius: 99, background: 'rgba(255,255,255,0.10)', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: index < sceneIndex ? '100%' : index === sceneIndex ? `${progress * 100}%` : '0%',
                background: active ? '#a78bfa' : 'transparent'
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

function CaptionPanel({
  scene,
  captionLines,
  frame,
  duration,
  enter,
  palette
}: {
  scene: RemotionSceneInput;
  captionLines: string[];
  frame: number;
  duration: number;
  enter: number;
  palette: Palette;
}) {
  const meta = shotMeta[scene.shotType];
  const top = scene.shotType === 'step' ? 682 : scene.shotType === 'title' ? 760 : 708;
  const localSec = frame / FPS;
  const cues = scene.subtitleCues || [];
  const activeCueIndex = cues.findIndex((cue) => localSec >= cue.startSec && localSec < cue.endSec);
  const activeCue = activeCueIndex >= 0 ? cues[activeCueIndex] : null;
  const timedCaptionLines = activeCue ? splitText(activeCue.text, 18, 2) : captionLines;
  const nextCue = activeCueIndex >= 0 ? cues[activeCueIndex + 1] : null;
  const cueProgress = activeCue
    ? frameProgress(localSec - activeCue.startSec, Math.max(0.2, activeCue.endSec - activeCue.startSec))
    : frameProgress(frame, duration);

  return (
    <div
      style={{
        position: 'absolute',
        left: 68,
        right: 68,
        top,
        padding: scene.shotType === 'pain' ? '42px 42px 46px' : '36px 40px',
        borderRadius: 38,
        background: scene.shotType === 'cta' ? `${meta.color}20` : palette.panel,
        border: `1px solid ${meta.color}`,
        boxShadow: `0 28px 90px ${palette.glow}`,
        transform: `scale(${interpolate(enter, [0, 1], [0.965, 1])})`,
        opacity: enter
      }}
    >
      {scene.shotType === 'pain' ? <div style={{ color: meta.color, fontSize: 26, fontWeight: 900, marginBottom: 20 }}>先把坑讲清楚</div> : null}
      {timedCaptionLines.map((line, index) => {
        const reveal = activeCue
          ? interpolate(frame % 30, [index * 4, index * 4 + 10], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: Easing.out(Easing.cubic)
          })
          : interpolate(frame, [index * 8, index * 8 + 14], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: Easing.out(Easing.cubic)
        });
        const emphasis = scene.shotType === 'cta' || (scene.shotType === 'pain' && index === 0);
        return (
          <div
            key={index}
            style={{
              color: emphasis ? '#f8fafc' : palette.ink,
              fontSize: emphasis ? 48 : 44,
              lineHeight: 1.32,
              fontWeight: emphasis ? 850 : 650,
              opacity: reveal,
              transform: `translateX(${interpolate(reveal, [0, 1], [28, 0])}px)`
            }}
          >
            {line}
          </div>
        );
      })}
      {nextCue ? (
        <div style={{ color: '#94a3b8', fontSize: 28, lineHeight: 1.28, fontWeight: 550, marginTop: 18, opacity: 0.72 }}>
          {nextCue.text}
        </div>
      ) : null}
      <div
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          height: 6,
          width: `${cueProgress * 100}%`,
          background: meta.color,
          borderBottomLeftRadius: 38,
          borderBottomRightRadius: cueProgress > 0.98 ? 38 : 0
        }}
      />
    </div>
  );
}

function IntentCard({
  scene,
  promptLines,
  enter,
  palette
}: {
  scene: RemotionSceneInput;
  promptLines: string[];
  enter: number;
  palette: Palette;
}) {
  const meta = shotMeta[scene.shotType];
  const bottom = scene.shotType === 'title' ? 108 : 126;

  return (
    <div
      style={{
        position: 'absolute',
        left: 68,
        right: 68,
        bottom,
        padding: '30px 36px',
        borderRadius: 34,
        background: 'rgba(2, 6, 23, 0.62)',
        border: '1px solid rgba(255,255,255,0.14)',
        opacity: interpolate(enter, [0, 1], [0, 1])
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, alignItems: 'center', marginBottom: 16 }}>
        <div style={{ color: palette.warm, fontSize: 25, fontWeight: 900 }}>VISUAL DIRECTION</div>
        <div style={{ color: meta.color, fontSize: 22, fontWeight: 800 }}>{scene.visualType.toUpperCase()}</div>
      </div>
      {promptLines.map((line, index) => (
        <div key={index} style={{ color: '#cbd5e1', fontSize: 32, lineHeight: 1.32, fontWeight: 550 }}>
          {line}
        </div>
      ))}
    </div>
  );
}

function GlobalProgress({ scenes, sceneIndex, localProgress }: { scenes: RemotionSceneInput[]; sceneIndex: number; localProgress: number }) {
  const beforeFrames = scenes.slice(0, sceneIndex).reduce((total, scene) => total + sceneFrames(scene), 0);
  const currentFrames = sceneFrames(scenes[sceneIndex] || scenes[0] || { durationSec: 1 } as RemotionSceneInput);
  const totalFrames = getTotalFrames(scenes);
  const progress = (beforeFrames + currentFrames * localProgress) / Math.max(1, totalFrames);

  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 16, background: 'rgba(255,255,255,0.08)' }}>
      <div style={{ width: `${clamp(progress, 0, 1) * 100}%`, height: '100%', background: 'linear-gradient(90deg, #38bdf8, #a78bfa, #f59e0b)' }} />
    </div>
  );
}

function SceneCard({
  scene,
  projectTitle,
  preset,
  sceneIndex,
  scenes
}: {
  scene: RemotionSceneInput;
  projectTitle: string;
  preset: string;
  sceneIndex: number;
  scenes: RemotionSceneInput[];
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const duration = sceneFrames(scene);
  const palette = paletteByPreset[preset] || paletteByPreset['clarity-blue'];
  const enter = spring({ frame, fps, config: { damping: 18, stiffness: 88 } });
  const progress = frameProgress(frame, duration);
  const titleLines = splitText(scene.shotType === 'title' ? projectTitle : scene.subtitle, scene.shotType === 'title' ? 12 : 13, 4);
  const captionLines = splitText(scene.voiceover, scene.shotType === 'pain' ? 18 : 19, scene.shotType === 'title' ? 3 : 5);
  const promptLines = splitText(scene.visualPrompt, 22, 3);

  return (
    <AbsoluteFill
      style={{
        color: '#f8fafc',
        fontFamily: '"Avenir Next", "PingFang SC", "Hiragino Sans GB", sans-serif',
        overflow: 'hidden'
      }}
    >
      {scene.audioPath ? <Audio src={staticFile(scene.audioPath.replace(/^\/+/, ''))} volume={(audioFrame) => voiceoverVolume(audioFrame, duration)} /> : null}
      <Background palette={palette} scene={scene} progress={progress} />
      <HeaderBand scene={scene} sceneIndex={sceneIndex} sceneCount={scenes.length} palette={palette} enter={enter} />
      <TitleBlock lines={titleLines} scene={scene} enter={enter} palette={palette} />
      <StepRail scene={scene} sceneIndex={sceneIndex} sceneCount={scenes.length} progress={progress} />
      <CaptionPanel scene={scene} captionLines={captionLines} frame={frame} duration={duration} enter={enter} palette={palette} />
      <IntentCard scene={scene} promptLines={promptLines} enter={enter} palette={palette} />
      <GlobalProgress scenes={scenes} sceneIndex={sceneIndex} localProgress={progress} />
    </AbsoluteFill>
  );
}

export function getDurationInFrames(input: RemotionVideoInput) {
  return Math.max(FPS * 5, input.scenes.reduce((total, scene) => total + sceneFrames(scene), 0));
}

export function TutorialDemo(input: RemotionVideoInput) {
  const preset = input.project.visualPreset || 'clarity-blue';
  const scenes = [...input.scenes].sort((a, b) => a.order - b.order);

  return (
    <AbsoluteFill style={{ background: '#020617' }}>
      {input.project.audioPath ? <Audio src={staticFile(input.project.audioPath.replace(/^\//, ''))} /> : null}
      {scenes.map((scene, index) => (
        <Sequence key={scene.id} from={getSceneStart(scenes, index)} durationInFrames={sceneFrames(scene)}>
          <SceneCard scene={scene} projectTitle={input.project.title} preset={preset} sceneIndex={index} scenes={scenes} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
