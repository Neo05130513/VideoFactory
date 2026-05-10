import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { readDbBackedJsonFile, writeDbBackedJsonFile } from './db';
import { isDataRelativePath, resolveAppPath, resolveRuntimePath } from './runtime/paths';

export async function readJsonFile<T>(relativePath: string): Promise<T> {
  try {
    return await readDbBackedJsonFile<T>(relativePath);
  } catch {
    const filePath = resolveRuntimePath(relativePath);
    try {
      const content = await readFile(filePath, 'utf-8');
      return JSON.parse(content) as T;
    } catch (error) {
      if (!isDataRelativePath(relativePath)) throw error;
      const seedContent = await readFile(resolveAppPath(relativePath), 'utf-8');
      return JSON.parse(seedContent) as T;
    }
  }
}

async function writeJsonMirror<T>(relativePath: string, data: T): Promise<void> {
  const filePath = resolveRuntimePath(relativePath);
  await ensureDirectory(path.dirname(filePath));
  await writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

export async function writeJsonFile<T>(relativePath: string, data: T): Promise<void> {
  try {
    await writeDbBackedJsonFile(relativePath, data);
    if (isDataRelativePath(relativePath)) {
      await writeJsonMirror(relativePath, data).catch(() => undefined);
    }
    return;
  } catch {
    await writeJsonMirror(relativePath, data);
  }
}

export async function writeTextFile(relativePath: string, content: string): Promise<void> {
  const filePath = resolveRuntimePath(relativePath);
  await ensureDirectory(path.dirname(filePath));
  await writeFile(filePath, content, 'utf-8');
}

export async function ensureDirectory(absoluteDirectoryPath: string): Promise<void> {
  await mkdir(absoluteDirectoryPath, { recursive: true });
}

export function nowIso() {
  return new Date().toISOString();
}

export function simpleId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
