export interface RemotionSceneInput {
  id: string;
  order: number;
  shotType: 'title' | 'pain' | 'step' | 'result' | 'cta';
  visualType: 'slide' | 'screen' | 'image' | 'caption';
  visualPrompt: string;
  voiceover: string;
  subtitle: string;
  durationSec: number;
  audioPath?: string;
  audioDurationSec?: number;
  layout?: 'hero' | 'contrast' | 'network' | 'process' | 'chart' | 'matrix' | 'checklist' | 'cta' | 'cause' | 'timeline' | 'mistake' | 'pyramid';
  headline?: string;
  emphasis?: string;
  keywords?: string[];
  cards?: string[];
  chartData?: number[];
  transition?: 'push' | 'zoom' | 'flash' | 'wipe' | 'fade';
  subtitleCues?: Array<{
    text: string;
    startSec: number;
    endSec: number;
  }>;
}

export interface RemotionVideoInput {
  project: {
    id: string;
    title: string;
    template: 'tutorial-demo-v1' | 'tech-explainer-v1' | 'ai-explainer-short-v1' | 'hyperframes-explainer-v1' | string;
    aspectRatio: '9:16' | '16:9';
    visualPreset?: string;
    audioPath?: string;
  };
  scenes: RemotionSceneInput[];
}
