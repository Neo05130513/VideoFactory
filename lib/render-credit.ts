import { estimateRenderReservationCredits } from './billing';
import { readJsonFile } from './storage';
import type { VideoScene } from './types';

export async function estimateProjectRenderCredits(projectId: string) {
  const scenes = await readJsonFile<VideoScene[]>('data/video-scenes.json').catch(() => []);
  const projectScenes = scenes.filter((scene) => scene.projectId === projectId);
  return estimateRenderReservationCredits(projectScenes, 'imageVoice');
}

export function creditErrorStatus(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/^Forbidden/i.test(message)) return 403;
  if (/not found/i.test(message)) return 404;
  return /积分|credit|frozen|余额|不足|冻结/i.test(message) ? 402 : 500;
}

export function isActiveRenderStatus(status?: string) {
  return status === 'queued' || status === 'running';
}
