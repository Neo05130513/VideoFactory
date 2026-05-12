import { access } from 'fs/promises';
import path from 'path';
import { constants } from 'fs';
import { ensureDirectory } from '@/lib/storage';
import { getAiSettings } from '@/lib/ai-settings';
import { commandExists, getExecutablePath } from './commands';
import { generatedRelativePath, getAppRoot, getDataRoot, resolveAppPath, resolveDataPath } from './paths';

async function canWriteDirectory(directoryPath: string) {
  try {
    await ensureDirectory(directoryPath);
    await access(directoryPath, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function canResolveRemotion() {
  try {
    const runtimeImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;
    await Promise.all([
      runtimeImport('@remotion/bundler'),
      runtimeImport('@remotion/renderer')
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function getRuntimeStatus() {
  const dataRoot = getDataRoot();
  const generatedRoot = path.dirname(resolveAppPath(generatedRelativePath('.probe')));
  const importsRoot = resolveDataPath('imports');
  const [settings, ffmpegInstalled, dataDirectoryWritable, generatedDirectoryWritable, importsDirectoryWritable, remotionDependenciesInstalled] = await Promise.all([
    getAiSettings(),
    commandExists('ffmpeg', 'FFMPEG_PATH'),
    canWriteDirectory(dataRoot),
    canWriteDirectory(generatedRoot),
    canWriteDirectory(importsRoot),
    canResolveRemotion()
  ]);

  return {
    openaiConfigured: Boolean(settings.openaiApiKey),
    minimaxConfigured: Boolean(settings.minimaxApiKey),
    ffmpegInstalled,
    ffmpegCommand: getExecutablePath('ffmpeg', 'FFMPEG_PATH'),
    remotionDependenciesInstalled,
    dataDirectoryWritable,
    generatedDirectoryWritable,
    importsDirectoryWritable,
    appRoot: getAppRoot(),
    dataRoot,
    generatedRoot,
    importsRoot,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version
  };
}
