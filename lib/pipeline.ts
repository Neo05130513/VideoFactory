import { createHash } from 'crypto';
import { copyFile } from 'fs/promises';
import path from 'path';
import { extractTextFromFile } from './importers';
import { parseTutorial } from './parser';
import { generateTopics } from './topics';
import { generateScripts } from './scripts';
import { buildScriptShotBreakdown } from './script-shots';
import { ensureDirectory, nowIso, readJsonFile, simpleId, writeJsonFile } from './storage';
import { resolveDataPath, resolveRuntimePath, toPosixRelativePath } from './runtime/paths';
import { Script, SourceType, Topic, Tutorial } from './types';

export interface TutorialPipelineProgress {
  stage: string;
  progress: number;
  detail?: string;
  previewText?: string;
  streamText?: string;
  persist?: boolean;
  currentTopicTitle?: string;
  currentTopicIndex?: number;
  totalTopics?: number;
  attempt?: number;
  maxAttempts?: number;
  elapsedMs?: number;
}

export interface TutorialPipelineResult {
  tutorial: Tutorial;
  topics: Topic[];
  scripts: Script[];
  scriptShots: Array<{
    scriptId: string;
    shots: ReturnType<typeof buildScriptShotBreakdown>;
  }>;
}

async function mergePipelineArtifacts(params: {
  tutorial: Tutorial;
  tutorialId: string;
  topics: Topic[];
  scripts: Script[];
}) {
  const [latestTutorials, latestTopics, latestScripts] = await Promise.all([
    readJsonFile<Tutorial[]>('data/tutorials.json'),
    readJsonFile<Topic[]>('data/topics.json'),
    readJsonFile<Script[]>('data/scripts.json')
  ]);

  const tutorialIndex = latestTutorials.findIndex((item) => item.id === params.tutorialId);
  if (tutorialIndex === -1) {
    throw new Error('Tutorial no longer exists');
  }

  latestTutorials[tutorialIndex] = params.tutorial;
  const nextTopics = [...params.topics, ...latestTopics.filter((item) => item.tutorialId !== params.tutorialId)];
  const nextScripts = [...params.scripts, ...latestScripts.filter((item) => item.tutorialId !== params.tutorialId)];

  await Promise.all([
    writeJsonFile('data/tutorials.json', latestTutorials),
    writeJsonFile('data/topics.json', nextTopics),
    writeJsonFile('data/scripts.json', nextScripts)
  ]);
}

function throwIfPipelineAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  throw new Error(typeof signal.reason === 'string' ? signal.reason : '用户已停止脚本生成');
}

interface ImportInput {
  sourceFile: string;
  sourceType: SourceType;
}

function normalizeTitleFromPath(sourceFile: string) {
  return path.basename(sourceFile).replace(/\.(docx|txt|md|html)$/i, '');
}

function contentHash(rawContent: string) {
  return createHash('sha1').update(rawContent).digest('hex');
}

function isDuplicateTutorial(existing: Tutorial[], sourceFile: string, rawContent: string) {
  const normalizedFile = path.resolve(resolveRuntimePath(sourceFile));
  const nextHash = contentHash(rawContent);

  return existing.find((tutorial) => {
    const sameFile = tutorial.sourceFile ? path.resolve(resolveRuntimePath(tutorial.sourceFile)) === normalizedFile : false;
    const sameHash = tutorial.tags.includes(`content-hash:${nextHash}`);
    const sameTitleAndSummary = tutorial.title === normalizeTitleFromPath(sourceFile) && tutorial.rawContent.slice(0, 200) === rawContent.slice(0, 200);
    return sameFile || sameHash || sameTitleAndSummary;
  });
}

async function copySourceFileIntoImports(tutorialId: string, sourceFile: string, sourceType: SourceType) {
  const ext = path.extname(sourceFile) || `.${sourceType}`;
  const relativePath = toPosixRelativePath(path.posix.join('data', 'imports', tutorialId, `source${ext.toLowerCase()}`));
  const absolutePath = resolveDataPath(relativePath);
  await ensureDirectory(path.dirname(absolutePath));
  await copyFile(resolveRuntimePath(sourceFile), absolutePath);
  return relativePath;
}

export async function importTutorials(inputs: ImportInput[]) {
  const tutorials = await readJsonFile<Tutorial[]>('data/tutorials.json');
  const created: Tutorial[] = [];
  const duplicates: { sourceFile: string; tutorialId: string; title: string }[] = [];

  for (const input of inputs) {
    const rawContent = await extractTextFromFile(input.sourceFile, input.sourceType);
    const duplicate = isDuplicateTutorial(tutorials, input.sourceFile, rawContent);

    if (duplicate) {
      duplicates.push({ sourceFile: input.sourceFile, tutorialId: duplicate.id, title: duplicate.title });
      continue;
    }

    const timestamp = nowIso();
    const tutorialId = simpleId('tutorial');
    const importedSourceFile = await copySourceFileIntoImports(tutorialId, input.sourceFile, input.sourceType);
    const tutorial: Tutorial = {
      id: tutorialId,
      title: normalizeTitleFromPath(input.sourceFile),
      sourceType: input.sourceType,
      sourceFile: importedSourceFile,
      rawContent,
      summary: '',
      targetAudience: [],
      scenarios: [],
      tools: [],
      methods: [],
      steps: [],
      keyQuotes: [],
      risks: [],
      categories: [],
      tags: [`content-hash:${contentHash(rawContent)}`, `source-name:${path.basename(input.sourceFile)}`],
      shortVideoScore: 0,
      priority: 'medium',
      status: 'imported',
      createdAt: timestamp,
      updatedAt: timestamp
    };

    tutorials.unshift(tutorial);
    created.push(tutorial);
  }

  await writeJsonFile('data/tutorials.json', tutorials);
  return { created, duplicates };
}

export async function processTutorialPipeline(
  tutorialId: string,
  options?: { signal?: AbortSignal; onProgress?: (progress: TutorialPipelineProgress) => void | Promise<void> }
): Promise<TutorialPipelineResult> {
  const emitProgress = async (progress: TutorialPipelineProgress) => {
    throwIfPipelineAborted(options?.signal);
    await options?.onProgress?.({
      ...progress,
      progress: Math.max(0, Math.min(100, Math.round(progress.progress)))
    });
  };

  await emitProgress({
    stage: 'loading',
    progress: 5,
    detail: '正在读取教程、选题和脚本数据。'
  });
  throwIfPipelineAborted(options?.signal);
  const tutorials = await readJsonFile<Tutorial[]>('data/tutorials.json');
  const topics = await readJsonFile<Topic[]>('data/topics.json');
  const scripts = await readJsonFile<Script[]>('data/scripts.json');

  const tutorialIndex = tutorials.findIndex((item) => item.id === tutorialId);
  if (tutorialIndex === -1) {
    throw new Error('Tutorial not found');
  }

  await emitProgress({
    stage: 'parsing-tutorial',
    progress: 20,
    detail: '正在解析文档内容。'
  });
  throwIfPipelineAborted(options?.signal);
  const parsed = parseTutorial(tutorials[tutorialIndex]);
  tutorials[tutorialIndex] = parsed;

  await emitProgress({
    stage: 'generating-topics',
    progress: 36,
    detail: '正在从文档中提炼选题。'
  });
  const generatedTopics = await generateTopics(parsed);
  const nextTopics = [...generatedTopics, ...topics.filter((item) => item.tutorialId !== tutorialId)];
  const totalTopics = generatedTopics.length;

  await emitProgress({
    stage: 'topics-ready',
    progress: 46,
    detail: totalTopics ? 'AI 已生成主选题，开始撰写主脚本。' : '没有生成可用选题。',
    totalTopics
  });

  const generatedScripts: Script[] = [];
  for (const [index, topic] of generatedTopics.entries()) {
    throwIfPipelineAborted(options?.signal);
    const topicIndex = index + 1;
    const topicStart = 48 + ((topicIndex - 1) / Math.max(totalTopics, 1)) * 40;
    const topicSpan = 40 / Math.max(totalTopics, 1);

    await emitProgress({
      stage: 'generating-script',
      progress: topicStart,
      detail: `正在生成主脚本：${topic.title}`,
      currentTopicIndex: topicIndex,
      totalTopics,
      currentTopicTitle: topic.title
    });

    // Avoid bursty parallel text-generation requests that make upstream models time out.
    const nextScripts = await generateScripts(topic, parsed, {
      signal: options?.signal,
      onProgress: async (progress) => {
        const phaseRatio = progress.stage === 'requesting-model' ? 0.45 : progress.stage === 'validating-result' ? 0.78 : 1;
        await emitProgress({
          stage: progress.stage,
          progress: topicStart + topicSpan * phaseRatio,
          detail: progress.detail,
          previewText: progress.previewText,
          currentTopicIndex: topicIndex,
          totalTopics,
          currentTopicTitle: topic.title,
          attempt: progress.attempt,
          maxAttempts: progress.maxAttempts,
          elapsedMs: progress.elapsedMs
        });
      }
    });
    generatedScripts.push(...nextScripts);
    const latestScript = nextScripts[0];
    await emitProgress({
      stage: 'script-ready',
      progress: topicStart + topicSpan,
      detail: `主脚本已完成：${latestScript?.title || topic.title}`,
      previewText: latestScript ? `${latestScript.title}｜${latestScript.hook}` : undefined,
      currentTopicIndex: topicIndex,
      totalTopics,
      currentTopicTitle: topic.title
    });
  }
  await emitProgress({
    stage: 'saving-results',
    progress: 94,
    detail: '正在写入教程、选题和脚本结果。'
  });
  throwIfPipelineAborted(options?.signal);
  await mergePipelineArtifacts({
    tutorial: parsed,
    tutorialId,
    topics: generatedTopics,
    scripts: generatedScripts
  });

  const result = {
    tutorial: parsed,
    topics: generatedTopics,
    scripts: generatedScripts,
    scriptShots: generatedScripts.map((script) => ({
      scriptId: script.id,
      shots: buildScriptShotBreakdown(script, parsed)
    }))
  };
  await emitProgress({
    stage: 'completed',
    progress: 100,
    detail: `处理完成，生成了 ${generatedScripts.length} 条脚本。`,
    previewText: result.scripts[0] ? `${result.scripts[0].title}｜${result.scripts[0].hook}` : undefined,
    totalTopics
  });
  return result;
}
