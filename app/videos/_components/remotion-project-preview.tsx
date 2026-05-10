'use client';

import { Player } from '@remotion/player';
import type { ComponentType } from 'react';
import { AiExplainerShort, getAiExplainerDurationInFrames } from '@/remotion/AiExplainerShort';
import { HyperframesExplainer, getHyperframesDurationInFrames } from '@/remotion/HyperframesExplainer';
import { TechExplainer, getTechDurationInFrames } from '@/remotion/TechExplainer';
import { TutorialDemo, getDurationInFrames } from '@/remotion/TutorialDemo';
import type { RemotionVideoInput } from '@/remotion/types';

const componentByTemplate = {
  'ai-explainer-short-v1': AiExplainerShort,
  'hyperframes-explainer-v1': HyperframesExplainer,
  'tech-explainer-v1': TechExplainer,
  'tutorial-demo-v1': TutorialDemo
} as const;

function getPreviewComponent(template: string): ComponentType<RemotionVideoInput> {
  return componentByTemplate[template as keyof typeof componentByTemplate] || TutorialDemo;
}

function getDuration(input: RemotionVideoInput) {
  if (input.project.template === 'ai-explainer-short-v1') return getAiExplainerDurationInFrames(input);
  if (input.project.template === 'hyperframes-explainer-v1') return getHyperframesDurationInFrames(input);
  if (input.project.template === 'tech-explainer-v1') return getTechDurationInFrames(input);
  return getDurationInFrames(input);
}

function getSize(input: RemotionVideoInput) {
  return input.project.aspectRatio === '16:9'
    ? { width: 1920, height: 1080 }
    : { width: 1080, height: 1920 };
}

export function RemotionProjectPreview({ input }: { input: RemotionVideoInput }) {
  const size = getSize(input);
  const TemplateComponent = getPreviewComponent(input.project.template);
  const PreviewComponent = ((props: Record<string, unknown>) => (
    <TemplateComponent {...(props as unknown as RemotionVideoInput)} />
  )) as ComponentType<Record<string, unknown>>;
  const durationInFrames = getDuration(input);
  const isWide = input.project.aspectRatio === '16:9';

  return (
    <div style={{
      width: '100%',
      maxWidth: isWide ? 860 : 380,
      margin: '0 auto',
      background: '#020617',
      border: '1px solid rgba(148,163,184,0.16)',
      overflow: 'hidden'
    }}>
      <Player
        component={PreviewComponent}
        inputProps={input as unknown as Record<string, unknown>}
        durationInFrames={durationInFrames}
        compositionWidth={size.width}
        compositionHeight={size.height}
        fps={30}
        controls
        loop
        acknowledgeRemotionLicense
        style={{ width: '100%' }}
      />
    </div>
  );
}
