import { createHash } from 'crypto';
import { execFile } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { promisify } from 'util';
import { ensureDirectory, nowIso, readJsonFile, simpleId, writeJsonFile, writeTextFile } from './storage';
import { sanitizeSceneText } from './narration';
import { getAudioDurationSec } from './audio-metadata';
import { buildProjectSrt, buildSubtitleCues } from './subtitles';
import { synthesizeLongSpeechWithCosyVoice } from './providers/cosyvoice';
import { generateSceneVoiceAudio } from './voice-provider';
import { getDefaultVoiceProfile } from './voice-profiles';
import { getVoiceSettings } from './voice-settings';
import { commandExists, getExecutablePath } from './runtime/commands';
import { generatedRelativePath, publicPathFromRelative, resolveAppPath } from './runtime/paths';
import type { Script, Topic, Tutorial, VideoAsset, VideoProject, VideoScene } from './types';
import type { RemotionVideoInput } from '@/remotion/types';

const execFileAsync = promisify(execFile);

type SceneAudioInfo = {
  publicPath: string;
  absolutePath: string;
  durationSec: number;
};

type ProjectAudioTrack = {
  publicPath: string;
  durationSec: number;
};

export type RemotionRenderProgress = {
  stage: string;
  progress: number;
  detail?: string;
};

type RenderOptions = {
  onProgress?: (progress: RemotionRenderProgress) => void | Promise<void>;
};

function getAudioTailPaddingSec() {
  const value = Number(process.env.REMOTION_AUDIO_TAIL_PADDING_SEC || 0.16);
  return Number.isFinite(value) ? Math.max(0, Math.min(0.5, value)) : 0.16;
}

function getAudioLeadTrimSec() {
  const value = Number(process.env.REMOTION_AUDIO_LEAD_TRIM_SEC || 0.02);
  return Number.isFinite(value) ? Math.max(0, Math.min(0.12, value)) : 0.02;
}

function getAudioTailTrimSec() {
  const value = Number(process.env.REMOTION_AUDIO_TAIL_TRIM_SEC || 0.18);
  return Number.isFinite(value) ? Math.max(0, Math.min(0.5, value)) : 0.18;
}

function getRemotionRenderScale() {
  const value = Number(process.env.REMOTION_RENDER_SCALE || 1);
  return Number.isFinite(value) ? Math.max(0.25, Math.min(1, value)) : 1;
}

function getRemotionRenderCrf() {
  const value = Number(process.env.REMOTION_RENDER_CRF || 20);
  return Number.isFinite(value) ? Math.max(1, Math.min(51, value)) : 20;
}

function getRemotionRenderConcurrency() {
  const value = Number(process.env.REMOTION_RENDER_CONCURRENCY || 2);
  return Number.isFinite(value) ? Math.max(1, Math.min(8, Math.round(value))) : 2;
}

function getAudioSegmentTiming(audioDurationSec: number) {
  const leadTrimSec = Math.min(getAudioLeadTrimSec(), Math.max(0, audioDurationSec - 0.7));
  const tailTrimSec = Math.min(getAudioTailTrimSec(), Math.max(0, audioDurationSec - leadTrimSec - 0.7));
  const voiceStartSec = leadTrimSec;
  const voiceEndSec = Math.max(voiceStartSec + 0.5, audioDurationSec - tailTrimSec);
  const voiceDurationSec = Math.max(0.5, voiceEndSec - voiceStartSec);
  const silencePadSec = leadTrimSec + tailTrimSec + getAudioTailPaddingSec();
  const fadeSec = Math.min(0.12, Math.max(0.04, voiceDurationSec / 16));

  return {
    voiceStartSec,
    voiceEndSec,
    voiceDurationSec,
    silencePadSec,
    fadeSec
  };
}

function getRemotionTtsProvider() {
  const provider = (process.env.REMOTION_TTS_PROVIDER || 'voice-profile').trim().toLowerCase();
  if (['none', 'off', 'false', 'disabled', 'silent'].includes(provider)) return 'none';
  if (['cosyvoice-preset', 'dashscope-preset', 'dashscope', 'preset'].includes(provider)) return 'cosyvoice-preset';
  return 'voice-profile';
}

function audioHash(text: string, provider: string) {
  return createHash('sha1').update(`${provider}:${text}`).digest('hex').slice(0, 12);
}

function getPresetCosyVoiceId(settings: Awaited<ReturnType<typeof getVoiceSettings>>) {
  return process.env.REMOTION_COSYVOICE_VOICE_ID
    || settings.cosyvoiceTestVoiceId
    || process.env.COSYVOICE_TEST_VOICE_ID
    || 'longxiaochun_v2';
}

async function generatePresetCosyVoiceAudio(params: {
  projectId: string;
  sceneId: string;
  order: number;
  text: string;
}) {
  const settings = await getVoiceSettings();
  const voiceId = getPresetCosyVoiceId(settings);
  const hash = audioHash(params.text, `cosyvoice-preset:${voiceId}`);
  const relativePath = generatedRelativePath('remotion', params.projectId, 'audio-cosyvoice-preset', `${String(params.order).padStart(2, '0')}-${params.sceneId}-${hash}.wav`);
  const absolutePath = resolveAppPath(relativePath);

  if (!existsSync(absolutePath)) {
    await synthesizeLongSpeechWithCosyVoice({
      text: params.text,
      outputRelativePath: relativePath,
      voiceId,
      settings
    });
  }

  return {
    relativePath,
    absolutePath,
    publicPath: publicPathFromRelative(relativePath)
  };
}

function getCompositionId(template: string) {
  if (template === 'tech-explainer-v1') return 'TechExplainer';
  if (template === 'ai-explainer-short-v1') return 'AiExplainerShort';
  if (template === 'hyperframes-explainer-v1') return 'HyperframesExplainer';
  return 'TutorialDemo';
}

async function loadRemotionModules() {
  try {
    const runtimeImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
    const [{ bundle }, { renderMedia, selectComposition }] = await Promise.all([
      runtimeImport('@remotion/bundler'),
      runtimeImport('@remotion/renderer')
    ]);
    return { bundle, renderMedia, selectComposition };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Remotion dependencies are not installed or not resolvable yet: ${message}`);
  }
}

async function readVideoState() {
  const [projects, scenes, assets, scripts, topics, tutorials] = await Promise.all([
    readJsonFile<VideoProject[]>('data/video-projects.json'),
    readJsonFile<VideoScene[]>('data/video-scenes.json'),
    readJsonFile<VideoAsset[]>('data/video-assets.json'),
    readJsonFile<Script[]>('data/scripts.json'),
    readJsonFile<Topic[]>('data/topics.json'),
    readJsonFile<Tutorial[]>('data/tutorials.json')
  ]);

  return { projects, scenes, assets, scripts, topics, tutorials };
}

function normalizeDisplayText(value?: string | null) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[“”"']/g, '')
    .trim();
}

function splitDisplayCandidates(value?: string | null) {
  return normalizeDisplayText(value)
    .replace(/([。！？!?；;：:，、,])/g, '$1\n')
    .split('\n')
    .map((item) => item.replace(/[。！？!?；;：:，、,]+$/g, '').trim())
    .filter(Boolean);
}

function compactDisplayLabel(value?: string | null, maxLength = 12) {
  let text = normalizeDisplayText(value)
    .replace(/^(这里|这类内容|很多品牌|很多|如果|因为|所以|但是|而是|同时|另外|其实|问题是|需要|可以|就是|它可以|它要|它会)/, '')
    .replace(/^(第一|第二|第三|第四|第五|第六)[步点：:、\s]*/, '')
    .replace(/^(一是|二是|三是|四是|五是|六是)[：:、\s]*/, '')
    .replace(/^(把|让|用|通过|完成|实现)/, '')
    .trim();

  if (!text) return '';
  const clauses = splitDisplayCandidates(text);
  if (clauses.length > 1) text = clauses[0];

  if (text.length > maxLength && text.includes('，')) {
    text = text.split('，').find((item) => item.length >= 2 && item.length <= maxLength) || text;
  }
  if (text.length > maxLength && text.includes('、')) {
    text = text.split('、').find((item) => item.length >= 2 && item.length <= maxLength) || text;
  }
  if (text.length > maxLength && text.includes('的')) {
    const tail = text.split('的').slice(-2).join('的');
    if (tail.length >= 2 && tail.length <= maxLength) text = tail;
  }
  if (text.length > maxLength) {
    text = text
      .replace(/更生动地/g, '生动')
      .replace(/品牌宣传视频/g, '品牌片')
      .replace(/品牌理念/g, '理念')
      .replace(/企业文化/g, '文化')
      .replace(/使命愿景/g, '愿景')
      .replace(/用户熟悉的/g, '熟悉')
      .replace(/提升认知度和好感度/g, '提升好感');
  }
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

function uniqueDisplayLabels(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeDisplayText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function deriveDisplayCards(scene: VideoScene) {
  const candidates = [
    ...(scene.cards || []),
    ...(scene.keywords || []),
    scene.emphasis || '',
    ...splitDisplayCandidates(scene.voiceover),
    ...splitDisplayCandidates(scene.subtitle)
  ];
  return uniqueDisplayLabels(
    candidates
      .map((item) => compactDisplayLabel(item, 12))
      .filter((item) => item.length >= 2)
      .filter((item) => item !== compactDisplayLabel(scene.headline, 12))
  ).slice(0, scene.layout === 'process' || scene.layout === 'timeline' ? 5 : 4);
}

function deriveDisplayHeadline(scene: VideoScene, cards: string[]) {
  const current = compactDisplayLabel(scene.headline, 18);
  if (current.length >= 4) return current;
  const subtitle = compactDisplayLabel(scene.subtitle, 18);
  if (subtitle.length >= 4) return subtitle;
  const voiceover = compactDisplayLabel(splitDisplayCandidates(scene.voiceover)[0], 18);
  return voiceover || cards[0] || '核心结构';
}

function deriveDisplaySubtitle(scene: VideoScene, headline: string, cards: string[]) {
  const joinedCards = cards.filter((item) => item !== headline).slice(0, 3).join(' / ');
  if (joinedCards) return joinedCards;
  const current = compactDisplayLabel(scene.subtitle, 24);
  if (current && current !== headline) return current;
  return compactDisplayLabel(scene.emphasis, 24) || headline;
}

function enhanceSceneDisplayLayer(scene: VideoScene): VideoScene {
  const cleanScene = sanitizeSceneText(scene);
  const cards = deriveDisplayCards(cleanScene);
  const headline = deriveDisplayHeadline(cleanScene, cards);
  const subtitle = deriveDisplaySubtitle(cleanScene, headline, cards);
  const emphasis = compactDisplayLabel(cleanScene.emphasis, 12)
    || cards.find((item) => item !== headline)
    || compactDisplayLabel(cleanScene.keywords?.[0], 12)
    || undefined;
  const keywords = uniqueDisplayLabels([
    ...(cleanScene.keywords || []).map((item) => compactDisplayLabel(item, 10)),
    ...cards.map((item) => compactDisplayLabel(item, 10)),
    compactDisplayLabel(headline, 10)
  ]).filter(Boolean).slice(0, 6);

  return {
    ...cleanScene,
    headline,
    subtitle,
    emphasis,
    cards,
    keywords
  };
}

function toRemotionInput(project: VideoProject, scenes: VideoScene[], audioBySceneId: Map<string, SceneAudioInfo>, projectAudio?: ProjectAudioTrack | null): RemotionVideoInput {
  return {
    project: {
      id: project.id,
      title: project.title,
      template: project.template,
      aspectRatio: project.aspectRatio,
      visualPreset: project.visualPreset,
      audioPath: projectAudio?.publicPath
    },
    scenes: scenes.map((rawScene) => {
      const scene = enhanceSceneDisplayLayer(rawScene);
      const audio = audioBySceneId.get(scene.id);
      const durationSec = audio ? Math.max(scene.durationSec, audio.durationSec + getAudioTailPaddingSec()) : scene.durationSec;
      const cueSource = rawScene.voiceover || rawScene.subtitle || scene.voiceover || scene.subtitle;
      return ({
      id: scene.id,
      order: scene.order,
      shotType: scene.shotType,
      visualType: scene.visualType,
      visualPrompt: scene.visualPrompt,
      voiceover: scene.voiceover,
      subtitle: scene.subtitle,
      durationSec,
      audioPath: projectAudio ? undefined : audio?.publicPath,
      audioDurationSec: audio?.durationSec,
      layout: scene.layout,
      headline: scene.headline,
      emphasis: scene.emphasis,
      keywords: scene.keywords,
      cards: scene.cards,
      chartData: scene.chartData,
      transition: scene.transition,
      subtitleCues: buildSubtitleCues(cueSource, audio?.durationSec || scene.durationSec)
    });
    })
  };
}

function updateProjectFailure(project: VideoProject, message: string): VideoProject {
  return {
    ...project,
    status: 'failed',
    outputPath: undefined,
    lastError: message,
    lastRenderAttemptAt: nowIso(),
    updatedAt: nowIso(),
    publishScore: 0,
    publishTier: 'blocked'
  };
}

function evaluateRemotionPublishability(scenes: VideoScene[]) {
  const sceneScore = scenes.length >= 6 ? 22 : scenes.length >= 4 ? 16 : 8;
  const durationScore = scenes.reduce((total, scene) => total + scene.durationSec, 0) >= 20 ? 18 : 10;
  const subtitleScore = scenes.every((scene) => scene.subtitle.trim()) ? 18 : 8;
  const visualPromptScore = scenes.every((scene) => scene.visualPrompt.trim()) ? 12 : 4;
  const renderScore = 40;
  const publishScore = Math.min(100, renderScore + sceneScore + durationScore + subtitleScore + visualPromptScore);
  return {
    publishScore,
    publishTier: publishScore >= 80 ? 'publishable' as const : publishScore >= 60 ? 'review' as const : 'blocked' as const
  };
}

async function isFfmpegAvailable() {
  return commandExists('ffmpeg', 'FFMPEG_PATH');
}

function formatFfmpegConcatPath(filePath: string) {
  return filePath.replace(/\\/g, '/').replace(/'/g, `'\''`);
}

function fixedSeconds(value: number) {
  return Math.max(0, Number(value.toFixed(3)));
}

async function createSilentAudioSegment(outputAbsolutePath: string, durationSec: number) {
  await execFileAsync(getExecutablePath('ffmpeg', 'FFMPEG_PATH'), [
    '-y',
    '-f', 'lavfi',
    '-i', 'anullsrc=r=48000:cl=stereo',
    '-t', String(fixedSeconds(durationSec)),
    '-c:a', 'pcm_s16le',
    outputAbsolutePath
  ]);
}

async function createVoiceAudioSegment(params: {
  inputAbsolutePath: string;
  outputAbsolutePath: string;
  audioDurationSec: number;
}) {
  const timing = getAudioSegmentTiming(params.audioDurationSec);
  const fadeOutStart = Math.max(0, timing.voiceDurationSec - timing.fadeSec);
  const totalDurationSec = timing.voiceDurationSec + timing.silencePadSec;

  await execFileAsync(getExecutablePath('ffmpeg', 'FFMPEG_PATH'), [
    '-y',
    '-i', params.inputAbsolutePath,
    '-af', [
      `atrim=start=${fixedSeconds(timing.voiceStartSec)}:end=${fixedSeconds(timing.voiceEndSec)}`,
      'asetpts=N/SR/TB',
      'aresample=48000',
      'aformat=sample_fmts=s16:channel_layouts=mono',
      'highpass=f=70',
      'lowpass=f=12000',
      `afade=t=in:st=0:d=${fixedSeconds(timing.fadeSec)}`,
      `afade=t=out:st=${fixedSeconds(fadeOutStart)}:d=${fixedSeconds(timing.fadeSec)}`,
      `apad=pad_dur=${fixedSeconds(timing.silencePadSec)}`,
      `atrim=0:${fixedSeconds(totalDurationSec)}`,
      'pan=stereo|c0=c0|c1=c0'
    ].join(','),
    '-ar', '48000',
    '-ac', '2',
    '-c:a', 'pcm_s16le',
    params.outputAbsolutePath
  ]);
}

async function buildProjectVoiceoverTrack(params: {
  projectId: string;
  scenes: VideoScene[];
  audioBySceneId: Map<string, SceneAudioInfo>;
  onProgress?: RenderOptions['onProgress'];
}): Promise<ProjectAudioTrack | null> {
  if (!params.audioBySceneId.size || !(await isFfmpegAvailable())) return null;

  await params.onProgress?.({ stage: 'building-audio-track', progress: 46, detail: 'Building one continuous voiceover track.' });

  const segmentDirectory = resolveAppPath(generatedRelativePath('remotion', params.projectId, 'timeline-audio'));
  await ensureDirectory(segmentDirectory);

  const segmentPaths: string[] = [];
  for (const [index, scene] of params.scenes.entries()) {
    const segmentRelativePath = generatedRelativePath('remotion', params.projectId, 'timeline-audio', `${String(index + 1).padStart(2, '0')}.wav`);
    const segmentAbsolutePath = resolveAppPath(segmentRelativePath);
    const audio = params.audioBySceneId.get(scene.id);
    if (audio) {
      await createVoiceAudioSegment({
        inputAbsolutePath: audio.absolutePath,
        outputAbsolutePath: segmentAbsolutePath,
        audioDurationSec: audio.durationSec
      });
    } else {
      await createSilentAudioSegment(segmentAbsolutePath, scene.durationSec);
    }
    segmentPaths.push(segmentAbsolutePath);
  }

  const concatRelativePath = generatedRelativePath('remotion', params.projectId, 'timeline-audio', 'concat.txt');
  const outputRelativePath = generatedRelativePath('remotion', params.projectId, 'voiceover-track.wav');
  const concatAbsolutePath = resolveAppPath(concatRelativePath);
  const outputAbsolutePath = resolveAppPath(outputRelativePath);
  const concatContent = segmentPaths.map((filePath) => `file '${formatFfmpegConcatPath(filePath)}'`).join('\n') + '\n';
  await writeTextFile(concatRelativePath, concatContent);
  await execFileAsync(getExecutablePath('ffmpeg', 'FFMPEG_PATH'), [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatAbsolutePath,
    '-c:a', 'pcm_s16le',
    outputAbsolutePath
  ]);

  const durationSec = await getAudioDurationSec(outputAbsolutePath);
  return {
    publicPath: publicPathFromRelative(outputRelativePath),
    durationSec
  };
}

async function prepareSceneAudio(params: {
  projectId: string;
  scenes: VideoScene[];
  existingAssets: VideoAsset[];
  onProgress?: RenderOptions['onProgress'];
}) {
  const provider = getRemotionTtsProvider();
  if (provider === 'none') {
    const cleanedScenes = params.scenes.map((scene) => sanitizeSceneText(scene));
    await params.onProgress?.({ stage: 'audio-skipped', progress: 34, detail: 'Voiceover is disabled; rendering with visual timing only.' });
    return { audioBySceneId: new Map<string, SceneAudioInfo>(), createdAssets: [], scenes: cleanedScenes };
  }

  const profile = provider === 'voice-profile' ? await getDefaultVoiceProfile() : null;
  const audioBySceneId = new Map<string, SceneAudioInfo>();
  const createdAssets: VideoAsset[] = [];
  const cleanedScenes = params.scenes.map((scene) => sanitizeSceneText(scene));

  if (provider === 'voice-profile' && !profile) {
    await params.onProgress?.({ stage: 'audio-skipped', progress: 34, detail: 'No default voice profile; rendering with visual timing only.' });
    return { audioBySceneId, createdAssets, scenes: cleanedScenes };
  }

  for (const [index, scene] of cleanedScenes.entries()) {
    if (!scene.voiceover.trim()) {
      await params.onProgress?.({
        stage: 'audio-skipped-scene',
        progress: 24 + Math.round((index / Math.max(1, params.scenes.length)) * 18),
        detail: `Skipping empty voiceover ${index + 1}/${params.scenes.length}`
      });
      continue;
    }
    await params.onProgress?.({
      stage: 'audio-generating',
      progress: 24 + Math.round((index / Math.max(1, params.scenes.length)) * 18),
      detail: `Generating voiceover ${index + 1}/${params.scenes.length}`
    });
    const generated = provider === 'cosyvoice-preset'
      ? await generatePresetCosyVoiceAudio({
        projectId: params.projectId,
        sceneId: scene.id,
        order: scene.order,
        text: scene.voiceover
      })
      : await generateSceneVoiceAudio({
        profile: profile!,
        projectId: params.projectId,
        sceneId: scene.id,
        order: scene.order,
        text: scene.voiceover
      });
    const durationSec = await getAudioDurationSec(generated.absolutePath);
    audioBySceneId.set(scene.id, {
      publicPath: generated.publicPath,
      absolutePath: generated.absolutePath,
      durationSec
    });
    createdAssets.push({
      id: simpleId('video_asset'),
      projectId: params.projectId,
      sceneId: scene.id,
      assetType: 'audio',
      path: generated.publicPath,
      status: 'ready'
    });
  }

  await params.onProgress?.({ stage: 'audio-ready', progress: 44, detail: 'Voiceover timing is ready.' });
  const scenes = cleanedScenes.map((scene) => {
    const audio = audioBySceneId.get(scene.id);
    if (!audio) return scene;
    return {
      ...scene,
      durationSec: Math.max(1, Number((audio.durationSec + getAudioTailPaddingSec()).toFixed(2)))
    };
  });

  return { audioBySceneId, createdAssets, scenes };
}

export async function renderVideoProjectWithRemotion(projectId: string, options: RenderOptions = {}) {
  await options.onProgress?.({ stage: 'loading-project', progress: 20, detail: 'Loading project scenes and assets.' });
  const state = await readVideoState();
  const projectIndex = state.projects.findIndex((item) => item.id === projectId);
  if (projectIndex === -1) throw new Error('Video project not found');

  const project = state.projects[projectIndex];
  const projectScenes = state.scenes
    .filter((item) => item.projectId === projectId)
    .sort((a, b) => a.order - b.order);

  if (!projectScenes.length) throw new Error('No storyboard scenes found');

  const renderingProject: VideoProject = {
    ...project,
    status: 'rendering',
    outputPath: undefined,
    lastError: undefined,
    lastRenderAttemptAt: nowIso(),
    updatedAt: nowIso()
  };
  state.projects[projectIndex] = renderingProject;
  await writeJsonFile('data/video-projects.json', state.projects);
  await options.onProgress?.({ stage: 'project-marked-rendering', progress: 24, detail: 'Project entered rendering state.' });

  try {
    const preparedAudio = await prepareSceneAudio({
      projectId,
      scenes: projectScenes,
      existingAssets: state.assets,
      onProgress: options.onProgress
    });
    const renderScenes = preparedAudio.scenes.map((scene) => enhanceSceneDisplayLayer(scene));
    const projectAudio = await buildProjectVoiceoverTrack({
      projectId,
      scenes: renderScenes,
      audioBySceneId: preparedAudio.audioBySceneId,
      onProgress: options.onProgress
    });
    await options.onProgress?.({ stage: 'building-input', progress: 48, detail: 'Building Remotion input and subtitles.' });
    const inputProps = toRemotionInput(renderingProject, renderScenes, preparedAudio.audioBySceneId, projectAudio);
    const outputRelativePath = generatedRelativePath('remotion', projectId, 'output.mp4');
    const inputRelativePath = generatedRelativePath('remotion', projectId, 'input.json');
    const subtitleRelativePath = generatedRelativePath('remotion', projectId, 'subtitles.srt');
    const outputAbsolutePath = resolveAppPath(outputRelativePath);

    await ensureDirectory(path.dirname(outputAbsolutePath));
    await writeTextFile(inputRelativePath, JSON.stringify(inputProps, null, 2) + '\n');
    await writeTextFile(subtitleRelativePath, buildProjectSrt(inputProps.scenes));

    await options.onProgress?.({ stage: 'loading-remotion', progress: 55, detail: 'Loading Remotion renderer modules.' });
    const { bundle, renderMedia, selectComposition } = await loadRemotionModules();
    await options.onProgress?.({ stage: 'bundling-remotion', progress: 62, detail: 'Bundling Remotion composition.' });
    const serveUrl = await bundle({
      entryPoint: resolveAppPath('remotion/index.tsx')
    });
    await options.onProgress?.({ stage: 'selecting-composition', progress: 72, detail: 'Selecting video composition.' });
    const composition = await selectComposition({
      serveUrl,
      id: getCompositionId(renderingProject.template),
      inputProps: inputProps as unknown as Record<string, unknown>
    });

    await options.onProgress?.({ stage: 'rendering-media', progress: 80, detail: 'Rendering final MP4.' });
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation: outputAbsolutePath,
      inputProps: inputProps as unknown as Record<string, unknown>,
      crf: getRemotionRenderCrf(),
      concurrency: getRemotionRenderConcurrency(),
      scale: getRemotionRenderScale(),
      onProgress: (progress: { progress: number; renderedFrames: number; encodedFrames: number }) => {
        const percent = 80 + Math.round(Math.max(0, Math.min(1, progress.progress)) * 14);
        void options.onProgress?.({
          stage: 'rendering-media',
          progress: percent,
          detail: `Rendering MP4: ${progress.renderedFrames} rendered, ${progress.encodedFrames} encoded.`
        });
      }
    });

    await options.onProgress?.({ stage: 'saving-results', progress: 94, detail: 'Saving video assets and project state.' });
    const publicOutputPath = publicPathFromRelative(outputRelativePath);
    const publicSubtitlePath = publicPathFromRelative(subtitleRelativePath);
    const nextAssets = state.assets.filter((item) => item.projectId !== projectId);
    const createdAssets: VideoAsset[] = [
      ...preparedAudio.createdAssets,
      {
        id: simpleId('video_asset'),
        projectId,
        sceneId: renderScenes[0].id,
        assetType: 'video',
        path: publicOutputPath,
        status: 'ready'
      },
      {
        id: simpleId('video_asset'),
        projectId,
        sceneId: renderScenes[0].id,
        assetType: 'subtitle',
        path: publicSubtitlePath,
        status: 'ready'
      }
    ];
    const publishability = evaluateRemotionPublishability(renderScenes);
    const completedProject: VideoProject = {
      ...renderingProject,
      status: 'completed',
      outputPath: publicOutputPath,
      updatedAt: nowIso(),
      lastError: undefined,
      publishScore: publishability.publishScore,
      publishTier: publishability.publishTier
    };

    state.projects[projectIndex] = completedProject;
    await Promise.all([
      writeJsonFile('data/video-projects.json', state.projects),
      writeJsonFile('data/video-assets.json', [...createdAssets, ...nextAssets]),
      writeJsonFile('data/video-scenes.json', [
        ...renderScenes,
        ...state.scenes.filter((scene) => scene.projectId !== projectId)
      ])
    ]);

    await options.onProgress?.({ stage: 'completed', progress: 100, detail: 'Render completed.' });
    return {
      project: completedProject,
      scenes: renderScenes,
      assets: createdAssets,
      remotionReady: true,
      outputPath: publicOutputPath,
      inputProps
    };
  } catch (error) {
    await options.onProgress?.({ stage: 'failed', progress: 100, detail: error instanceof Error ? error.message : 'Remotion render failed' });
    const failedProject = updateProjectFailure(renderingProject, error instanceof Error ? error.message : 'Remotion render failed');
    state.projects[projectIndex] = failedProject;
    await writeJsonFile('data/video-projects.json', state.projects);
    throw error;
  }
}
