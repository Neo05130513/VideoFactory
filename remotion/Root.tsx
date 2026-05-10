import React from 'react';
import { Composition } from 'remotion';
import { TutorialDemo, getDurationInFrames } from './TutorialDemo';
import { TechExplainer, getTechDurationInFrames } from './TechExplainer';
import { AiExplainerShort, getAiExplainerDurationInFrames } from './AiExplainerShort';
import { HyperframesExplainer, getHyperframesDurationInFrames } from './HyperframesExplainer';
import aiExplainerShortFixture from './fixtures/ai-explainer-short.json';
import type { RemotionVideoInput } from './types';

const defaultInput = aiExplainerShortFixture as RemotionVideoInput;

function TutorialDemoComposition(props: Record<string, unknown>) {
  return <TutorialDemo {...(props as unknown as RemotionVideoInput)} />;
}

function TechExplainerComposition(props: Record<string, unknown>) {
  return <TechExplainer {...(props as unknown as RemotionVideoInput)} />;
}

function AiExplainerShortComposition(props: Record<string, unknown>) {
  return <AiExplainerShort {...(props as unknown as RemotionVideoInput)} />;
}

function HyperframesExplainerComposition(props: Record<string, unknown>) {
  return <HyperframesExplainer {...(props as unknown as RemotionVideoInput)} />;
}

function getRenderSize(input: RemotionVideoInput) {
  return input.project.aspectRatio === '16:9'
    ? { width: 1920, height: 1080 }
    : { width: 1080, height: 1920 };
}

export function RemotionRoot() {
  return (
    <>
      <Composition
        id="TutorialDemo"
        component={TutorialDemoComposition}
        durationInFrames={getDurationInFrames(defaultInput)}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{ ...defaultInput, project: { ...defaultInput.project, template: 'tutorial-demo-v1' } } as unknown as Record<string, unknown>}
        calculateMetadata={({ props }) => ({
          durationInFrames: getDurationInFrames(props as unknown as RemotionVideoInput),
          fps: 30,
          ...getRenderSize(props as unknown as RemotionVideoInput)
        })}
      />
      <Composition
        id="TechExplainer"
        component={TechExplainerComposition}
        durationInFrames={getTechDurationInFrames(defaultInput)}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={defaultInput as unknown as Record<string, unknown>}
        calculateMetadata={({ props }) => ({
          durationInFrames: getTechDurationInFrames(props as unknown as RemotionVideoInput),
          fps: 30,
          ...getRenderSize(props as unknown as RemotionVideoInput)
        })}
      />
      <Composition
        id="AiExplainerShort"
        component={AiExplainerShortComposition}
        durationInFrames={getAiExplainerDurationInFrames(defaultInput)}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{ ...defaultInput, project: { ...defaultInput.project, template: 'ai-explainer-short-v1' } } as unknown as Record<string, unknown>}
        calculateMetadata={({ props }) => ({
          durationInFrames: getAiExplainerDurationInFrames(props as unknown as RemotionVideoInput),
          fps: 30,
          ...getRenderSize(props as unknown as RemotionVideoInput)
        })}
      />
      <Composition
        id="HyperframesExplainer"
        component={HyperframesExplainerComposition}
        durationInFrames={getHyperframesDurationInFrames(defaultInput)}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{ ...defaultInput, project: { ...defaultInput.project, template: 'hyperframes-explainer-v1' } } as unknown as Record<string, unknown>}
        calculateMetadata={({ props }) => ({
          durationInFrames: getHyperframesDurationInFrames(props as unknown as RemotionVideoInput),
          fps: 30,
          ...getRenderSize(props as unknown as RemotionVideoInput)
        })}
      />
    </>
  );
}
