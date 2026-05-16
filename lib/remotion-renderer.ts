import { createHash } from 'crypto';
import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { copyFile, readFile, readdir, rename, stat, unlink } from 'fs/promises';
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
import { enhanceSceneDisplayLayer as enhanceSceneDisplayLayerShared, repairStoryboardDisplayLayer, summarizeStoryboardDisplayIssues } from './storyboard-display';
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

type FfmpegOverrideInfo = {
  type: 'pre-stitcher' | 'stitcher';
  args: string[];
};

type RemotionGpuEncoderConfig = {
  enabled: true;
  encoder: 'h264_nvenc';
  ffmpegPath: string;
  ffprobePath: string;
  binariesDirectory: string;
  quality: number;
  audioCodec: 'mp3';
  ffmpegOverride: (info: FfmpegOverrideInfo) => string[];
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

function getRemotionGpuEncoderMode() {
  const value = (process.env.REMOTION_GPU_ENCODER || process.env.REMOTION_HARDWARE_ENCODER || 'auto').trim().toLowerCase();
  if (['0', 'false', 'off', 'disable', 'disabled', 'cpu', 'none'].includes(value)) return 'off' as const;
  if (['1', 'true', 'on', 'required', 'require', 'nvenc', 'nvidia'].includes(value)) return 'required' as const;
  return 'auto' as const;
}

async function fileExists(filePath: string) {
  try {
    const item = await stat(filePath);
    return item.isFile();
  } catch {
    return false;
  }
}

async function resolveWindowsCommandShim(filePath: string, executableName: string) {
  if (!['.cmd', '.bat'].includes(path.extname(filePath).toLowerCase())) return filePath;
  try {
    const content = await readFile(filePath, 'utf-8');
    const escapedExecutableName = executableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const quotedMatch = content.match(new RegExp(`"([^"]*${escapedExecutableName})"`, 'i'));
    if (quotedMatch?.[1]) return quotedMatch[1];
    const plainMatch = content.match(new RegExp(`([A-Z]:\\\\[^\\r\\n"]*${escapedExecutableName})`, 'i'));
    if (plainMatch?.[1]) return plainMatch[1];
  } catch {
    return filePath;
  }
  return filePath;
}

async function findOnPath(command: string) {
  const lookup = process.platform === 'win32' ? 'where.exe' : 'which';
  try {
    const { stdout } = await execFileAsync(lookup, [command]);
    return stdout
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function resolveExecutableCandidate(candidate: string | undefined, executableName: string) {
  if (!candidate?.trim()) return null;
  const trimmed = candidate.trim();
  const candidates = path.isAbsolute(trimmed) || /[\\/]/.test(trimmed)
    ? [trimmed]
    : await findOnPath(trimmed);

  for (const candidatePath of candidates) {
    const resolvedPath = process.platform === 'win32'
      ? await resolveWindowsCommandShim(candidatePath, executableName)
      : candidatePath;
    if (await fileExists(resolvedPath)) return resolvedPath;
  }

  return null;
}

async function findExternalFfmpegPath() {
  const candidates = [
    process.env.REMOTION_GPU_FFMPEG_PATH,
    process.env.REMOTION_FFMPEG_PATH,
    process.env.FFMPEG_PATH,
    'ffmpeg'
  ];

  for (const candidate of candidates) {
    const resolvedPath = await resolveExecutableCandidate(candidate, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    if (resolvedPath) return resolvedPath;
  }

  return null;
}

async function findExternalFfprobePath(ffmpegPath: string) {
  const siblingName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  const siblingPath = path.join(path.dirname(ffmpegPath), siblingName);
  if (await fileExists(siblingPath)) return siblingPath;

  const candidates = [
    process.env.REMOTION_GPU_FFPROBE_PATH,
    process.env.REMOTION_FFPROBE_PATH,
    process.env.FFPROBE_PATH,
    'ffprobe'
  ];

  for (const candidate of candidates) {
    const resolvedPath = await resolveExecutableCandidate(candidate, siblingName);
    if (resolvedPath) return resolvedPath;
  }

  return null;
}

async function ffmpegSupportsEncoder(ffmpegPath: string, encoder: string) {
  try {
    const { stdout, stderr } = await execFileAsync(ffmpegPath, ['-hide_banner', '-encoders'], { maxBuffer: 1024 * 1024 * 6 });
    return `${stdout}\n${stderr}`.includes(encoder);
  } catch {
    return false;
  }
}

function getBundledRemotionBinariesDirectory() {
  if (process.platform !== 'win32' || process.arch !== 'x64') return null;
  return resolveAppPath(path.join('node_modules', '@remotion', 'compositor-win32-x64-msvc'));
}

async function copyIfChanged(sourcePath: string, destinationPath: string) {
  const sourceStat = await stat(sourcePath);
  const destinationStat = await stat(destinationPath).catch(() => null);
  if (destinationStat?.isFile() && destinationStat.size === sourceStat.size) return;
  await copyFile(sourcePath, destinationPath);
}

async function copyExecutableIfChanged(sourcePath: string, destinationPath: string) {
  const sourceStat = await stat(sourcePath);
  const destinationStat = await stat(destinationPath).catch(() => null);
  if (destinationStat?.isFile() && destinationStat.size === sourceStat.size) return;
  await unlink(destinationPath).catch(() => undefined);
  await copyFile(sourcePath, destinationPath);
}

async function prepareGpuRemotionBinaries(ffmpegPath: string, ffprobePath: string) {
  const sourceDirectory = getBundledRemotionBinariesDirectory();
  if (!sourceDirectory || !existsSync(sourceDirectory)) {
    throw new Error('GPU rendering is currently wired for the Windows x64 Remotion compositor only.');
  }

  const binariesDirectory = process.env.REMOTION_GPU_BINARIES_DIRECTORY || resolveAppPath(path.join('.run', 'remotion-nvenc-binaries'));
  await ensureDirectory(binariesDirectory);
  const entries = await readdir(sourceDirectory, { withFileTypes: true });
  await Promise.all(entries
    .filter((entry) => entry.isFile())
    .filter((entry) => !['ffmpeg.exe', 'ffprobe.exe', 'ffmpeg', 'ffprobe'].includes(entry.name.toLowerCase()))
    .map((entry) => copyIfChanged(path.join(sourceDirectory, entry.name), path.join(binariesDirectory, entry.name))));

  await Promise.all([
    copyExecutableIfChanged(ffmpegPath, path.join(binariesDirectory, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')),
    copyExecutableIfChanged(ffprobePath, path.join(binariesDirectory, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'))
  ]);

  return binariesDirectory;
}

function createNvencFfmpegOverride(quality: number) {
  return ({ args }: FfmpegOverrideInfo) => {
    const nextArgs: string[] = [];
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      const next = args[index + 1];
      if ((arg === '-c:v' || arg === '-vcodec') && next === 'libx264') {
        nextArgs.push(arg, 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', String(quality), '-b:v', '0');
        index += 1;
        continue;
      }
      if (arg === '-crf') {
        index += 1;
        continue;
      }
      nextArgs.push(arg);
    }
    return nextArgs;
  };
}

async function resolveRemotionGpuEncoderConfig(quality: number): Promise<RemotionGpuEncoderConfig | null> {
  const mode = getRemotionGpuEncoderMode();
  if (mode === 'off') return null;

  const ffmpegPath = await findExternalFfmpegPath();
  if (!ffmpegPath) {
    if (mode === 'required') throw new Error('REMOTION_GPU_ENCODER requires an external ffmpeg with h264_nvenc, but no ffmpeg executable was found.');
    return null;
  }

  const ffprobePath = await findExternalFfprobePath(ffmpegPath);
  if (!ffprobePath) {
    if (mode === 'required') throw new Error('REMOTION_GPU_ENCODER requires ffprobe next to the NVENC ffmpeg, but ffprobe was not found.');
    return null;
  }

  const binariesDirectory = await prepareGpuRemotionBinaries(ffmpegPath, ffprobePath);
  const stagedFfmpegPath = path.join(binariesDirectory, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  const stagedFfprobePath = path.join(binariesDirectory, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
  if (!(await ffmpegSupportsEncoder(stagedFfmpegPath, 'h264_nvenc'))) {
    if (mode === 'required') throw new Error(`The configured ffmpeg does not provide h264_nvenc: ${ffmpegPath}`);
    return null;
  }

  return {
    enabled: true,
    encoder: 'h264_nvenc',
    ffmpegPath: stagedFfmpegPath,
    ffprobePath: stagedFfprobePath,
    binariesDirectory,
    quality,
    audioCodec: 'mp3',
    ffmpegOverride: createNvencFfmpegOverride(quality)
  };
}

async function normalizeGpuRenderAudioToAac(outputAbsolutePath: string, gpuEncoder: RemotionGpuEncoderConfig) {
  const tempOutputPath = outputAbsolutePath.replace(/\.mp4$/i, '') + '.aac-normalized.mp4';
  const backupPath = outputAbsolutePath.replace(/\.mp4$/i, '') + '.before-aac-normalize.mp4';
  await unlink(tempOutputPath).catch(() => undefined);
  await unlink(backupPath).catch(() => undefined);

  await execFileAsync(gpuEncoder.ffmpegPath, [
    '-y',
    '-i', outputAbsolutePath,
    '-map', '0:v:0',
    '-map', '0:a?',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', process.env.REMOTION_GPU_AAC_BITRATE || '192k',
    '-movflags', 'faststart',
    tempOutputPath
  ], { maxBuffer: 1024 * 1024 * 8 });

  await rename(outputAbsolutePath, backupPath);
  try {
    await rename(tempOutputPath, outputAbsolutePath);
    await unlink(backupPath).catch(() => undefined);
  } catch (error) {
    await rename(backupPath, outputAbsolutePath).catch(() => undefined);
    throw error;
  }
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
    .replace(/[.…]+$/g, '')
    .trim();
}

function splitDisplayCandidates(value?: string | null) {
  return normalizeDisplayText(value)
    .replace(/([。！？!?；;：:，、,])/g, '$1\n')
    .split('\n')
    .map((item) => item.replace(/[。！？!?；;：:，、,]+$/g, '').trim())
    .filter(Boolean);
}

const compactSingleCharLabels = new Set(['人', '景', '事']);

function isWeakDisplayLabel(value?: string | null) {
  const text = normalizeDisplayText(value)
    .replace(/^第[一二三四五六七八九十]+个问题[，,：:\s]*(是)?/, '')
    .replace(/^(这个|这份|这些|文档里的|文档里|文档给出的|文档强调|当前原文|最终|需要注意)[，,：:\s]*/, '')
    .replace(/^是/, '')
    .trim();
  return !text
    || /^(问题|个问题|这个任务|这个品牌|文档|例子|种模式|模式|任务|内容|方式|表达|输出|需要注意|最终判断|核心方法很简单|关键在于|就是三个字|三个字)$/.test(text)
    || /^(它|这个|这类|这些|文档|比如|因为|而|但|如果|很多|对这个案例来说)/.test(text)
    || /^在日常运营里/.test(text)
    || /^[户景事]\S{4,}/.test(text)
    || /[「“]/.test(text) && !/[」”]/.test(text)
    || /[支类种条句段项]$/.test(text)
    || /[的了都在把让用及和跟与或、，：:；;]$/.test(text)
    || (/[A-Za-z]$/.test(text) && !/(AI|IP|CEO|OiiOii|Lovart|Logo)$/i.test(text));
}

function isUsefulDisplayLabel(value?: string | null) {
  const text = normalizeDisplayText(value);
  if (!text) return false;
  if (compactSingleCharLabels.has(text)) return true;
  return text.length >= 2 && !isWeakDisplayLabel(text);
}

function compactDisplayLabel(value?: string | null, maxLength = 12) {
  let text = normalizeDisplayText(value)
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
    .trim();

  if (!text) return '';
  const quoted = text.match(/[「“]([^」”]{2,18})[」”]/);
  if (quoted?.[1]) text = quoted[1];
  const clauses = splitDisplayCandidates(text);
  if (clauses.length > 1) {
    text = clauses.find((item) => item.length <= maxLength && isUsefulDisplayLabel(item))
      || clauses.find((item) => isUsefulDisplayLabel(item))
      || clauses[0];
  }

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
  const existingCards = uniqueDisplayLabels(
    (scene.cards || [])
      .map((item) => compactDisplayLabel(item, 12))
      .filter(isUsefulDisplayLabel)
  );
  const hasCleanExistingCards = existingCards.length >= 3 && (scene.cards || []).every((item) => {
    const normalized = normalizeDisplayText(item);
    return normalized.length <= 18 && !/[.…]/.test(normalized) && isUsefulDisplayLabel(compactDisplayLabel(normalized, 12));
  });
  if (hasCleanExistingCards) {
    return existingCards.slice(0, scene.layout === 'process' || scene.layout === 'timeline' || scene.layout === 'checklist' ? 5 : 4);
  }

  const candidates = [
    ...splitDisplayCandidates(scene.voiceover),
    ...(scene.cards || []),
    ...(scene.keywords || []),
    scene.emphasis || '',
    ...splitDisplayCandidates(scene.subtitle)
  ];
  return uniqueDisplayLabels(
    candidates
      .map((item) => compactDisplayLabel(item, 12))
      .filter(isUsefulDisplayLabel)
      .filter((item) => item !== compactDisplayLabel(scene.headline, 12))
  ).slice(0, scene.layout === 'process' || scene.layout === 'timeline' || scene.layout === 'checklist' ? 5 : 4);
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
      const scene = enhanceSceneDisplayLayerShared(rawScene);
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

  const displayCheck = repairStoryboardDisplayLayer(projectScenes);
  if (!displayCheck.passed) {
    throw new Error(`STORYBOARD_DISPLAY_QUALITY_FAILED: ${summarizeStoryboardDisplayIssues(displayCheck.issues)}`);
  }
  const checkedScenes = displayCheck.scenes;
  if (displayCheck.repaired) {
    const repairedById = new Map(checkedScenes.map((scene) => [scene.id, scene]));
    state.scenes = state.scenes.map((scene) => scene.projectId === projectId
      ? repairedById.get(scene.id) || scene
      : scene);
    await writeJsonFile('data/video-scenes.json', state.scenes);
    await options.onProgress?.({
      stage: 'storyboard-sanitized',
      progress: 22,
      detail: 'Storyboard display layer auto-repaired before render.'
    });
  }

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
      scenes: checkedScenes,
      existingAssets: state.assets,
      onProgress: options.onProgress
    });
    const renderScenes = preparedAudio.scenes.map((scene) => enhanceSceneDisplayLayerShared(scene));
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
    const renderQuality = getRemotionRenderCrf();
    const gpuEncoder = await resolveRemotionGpuEncoderConfig(renderQuality);

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
      inputProps: inputProps as unknown as Record<string, unknown>,
      binariesDirectory: gpuEncoder?.binariesDirectory
    });

    await options.onProgress?.({
      stage: 'rendering-media',
      progress: 80,
      detail: gpuEncoder
        ? `Rendering final MP4 with ${gpuEncoder.encoder}.`
        : 'Rendering final MP4.'
    });
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation: outputAbsolutePath,
      inputProps: inputProps as unknown as Record<string, unknown>,
      crf: gpuEncoder ? null : renderQuality,
      concurrency: getRemotionRenderConcurrency(),
      scale: getRemotionRenderScale(),
      binariesDirectory: gpuEncoder?.binariesDirectory,
      ffmpegOverride: gpuEncoder?.ffmpegOverride,
      audioCodec: gpuEncoder?.audioCodec,
      onProgress: (progress: { progress: number; renderedFrames: number; encodedFrames: number }) => {
        const percent = 80 + Math.round(Math.max(0, Math.min(1, progress.progress)) * 14);
        void options.onProgress?.({
          stage: 'rendering-media',
          progress: percent,
          detail: `Rendering MP4: ${progress.renderedFrames} rendered, ${progress.encodedFrames} encoded.`
        });
      }
    });

    if (gpuEncoder) {
      await options.onProgress?.({ stage: 'normalizing-audio', progress: 93, detail: 'Normalizing GPU render audio to AAC.' });
      await normalizeGpuRenderAudioToAac(outputAbsolutePath, gpuEncoder);
    }

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
      writeJsonFile('data/video-assets.json', [...createdAssets, ...nextAssets])
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
