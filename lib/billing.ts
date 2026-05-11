import { readJsonFile } from './storage';
import type { AuditLog, UserAccount, VideoAsset, VideoProject, VideoScene } from './types';
import { listCreditAccountsForUsers, listCreditLedger, summarizeCreditAccount } from './credits';

export type CreditPlanId = 'free' | 'creator' | 'pro';
export type CreditVideoMode = 'base' | 'image' | 'voice' | 'imageVoice';

export type CreditPlan = {
  id: CreditPlanId;
  name: string;
  priceCny: number;
  monthlyCredits: number;
  maxExports?: number;
  watermark: boolean;
  queue: 'slow' | 'standard' | 'priority';
  features: string[];
};

export const CREDIT_PLANS: CreditPlan[] = [
  {
    id: 'free',
    name: '免费版',
    priceCny: 0,
    monthlyCredits: 300,
    maxExports: 3,
    watermark: true,
    queue: 'slow',
    features: ['完整体验 1 条视频', '带水印导出', '低优先级队列', '基础模板']
  },
  {
    id: 'creator',
    name: '创作者版',
    priceCny: 39,
    monthlyCredits: 1500,
    watermark: false,
    queue: 'standard',
    features: ['无水印导出', '1080p 成片', '商用发布', '常规模板']
  },
  {
    id: 'pro',
    name: '专业版',
    priceCny: 99,
    monthlyCredits: 5000,
    watermark: false,
    queue: 'priority',
    features: ['批量生成', '声音复刻', '优先队列', '更多模板']
  }
];

export const CREDIT_VIDEO_RATES: Record<CreditVideoMode, { label: string; creditsPerMinute: number; description: string }> = {
  base: {
    label: '基础模板视频',
    creditsPerMinute: 100,
    description: '包含选题、脚本、分镜、普通配音、模板动画和导出。'
  },
  image: {
    label: 'AI 图片增强视频',
    creditsPerMinute: 180,
    description: '适合封面感、产品感、知识讲解类视频。'
  },
  voice: {
    label: '声音复刻视频',
    creditsPerMinute: 150,
    description: '使用个人或品牌音色生成旁白。'
  },
  imageVoice: {
    label: 'AI 图片 + 声音复刻',
    creditsPerMinute: 230,
    description: '高成本能力组合，适合重点发布内容。'
  }
};

export const CREDIT_ADD_ONS = [
  { credits: 1000, priceCny: 19.9 },
  { credits: 3000, priceCny: 49 },
  { credits: 10000, priceCny: 149 }
];

export function estimateMinutesForPlan(plan: CreditPlan, mode: CreditVideoMode) {
  const rate = CREDIT_VIDEO_RATES[mode].creditsPerMinute;
  return Number((plan.monthlyCredits / rate).toFixed(1));
}

export function formatMinutes(minutes: number) {
  if (minutes < 1) return `${Math.round(minutes * 60)} 秒`;
  if (Number.isInteger(minutes)) return `${minutes} 分钟`;
  return `${minutes.toFixed(1)} 分钟`;
}

export function estimateVideoCredits(minutes: number, mode: CreditVideoMode) {
  const billableMinutes = Math.max(0.25, minutes);
  return Math.ceil(billableMinutes * CREDIT_VIDEO_RATES[mode].creditsPerMinute);
}

export function estimateRenderReservationCredits(scenes: Array<{ durationSec?: number }>, mode: CreditVideoMode = 'imageVoice') {
  const seconds = scenes.reduce((sum, scene) => sum + Math.max(0, Number(scene.durationSec) || 0), 0);
  const minutes = seconds > 0 ? seconds / 60 : 1;
  return estimateVideoCredits(minutes, mode);
}

function getProjectDurationMinutes(project: VideoProject, scenes: VideoScene[]) {
  const projectScenes = scenes.filter((scene) => scene.projectId === project.id);
  const totalSeconds = projectScenes.reduce((sum, scene) => sum + Math.max(0, Number(scene.durationSec) || 0), 0);
  if (totalSeconds > 0) return totalSeconds / 60;
  return 1;
}

function inferProjectMode(project: VideoProject, scenes: VideoScene[], assets: VideoAsset[]): CreditVideoMode {
  const projectScenes = scenes.filter((scene) => scene.projectId === project.id);
  const projectAssets = assets.filter((asset) => asset.projectId === project.id);
  const imageReady = projectAssets.filter((asset) => asset.assetType === 'image' && asset.status === 'ready').length;
  const audioReady = projectAssets.filter((asset) => asset.assetType === 'audio' && asset.status === 'ready').length;
  const hasImageEnhancement = projectScenes.length > 0 && imageReady >= Math.ceil(projectScenes.length * 0.7);
  const hasVoiceTrack = audioReady > 0;

  if (hasImageEnhancement && hasVoiceTrack) return 'imageVoice';
  if (hasImageEnhancement) return 'image';
  if (hasVoiceTrack) return 'voice';
  return 'base';
}

export function estimateProjectCreditUsage(project: VideoProject, scenes: VideoScene[], assets: VideoAsset[]) {
  const minutes = getProjectDurationMinutes(project, scenes);
  const mode = inferProjectMode(project, scenes, assets);
  return {
    minutes,
    mode,
    credits: estimateVideoCredits(minutes, mode)
  };
}

function baseEmptyUsage(user: UserAccount) {
  return {
    user,
    estimatedCredits: 0,
    importedDocs: 0,
    scripts: 0,
    videos: 0,
    completedVideos: 0,
    failedVideos: 0,
    videoMinutes: 0,
    lastActivityAt: user.lastLoginAt || user.createdAt
  };
}

export async function getBillingDashboard() {
  const [users, auditLogs, projects, scenes, assets] = await Promise.all([
    readJsonFile<UserAccount[]>('data/users.json'),
    readJsonFile<AuditLog[]>('data/audit-logs.json').catch(() => []),
    readJsonFile<VideoProject[]>('data/video-projects.json').catch(() => []),
    readJsonFile<VideoScene[]>('data/video-scenes.json').catch(() => []),
    readJsonFile<VideoAsset[]>('data/video-assets.json').catch(() => [])
  ]);
  const [accounts, ledger] = await Promise.all([
    listCreditAccountsForUsers(users),
    listCreditLedger()
  ]);
  const accountByUserId = new Map(accounts.map((account) => [account.userId, summarizeCreditAccount(account)]));

  const usageByUser = new Map(users.map((user) => [user.id, baseEmptyUsage(user)]));
  const projectCreator = new Map<string, string>();

  for (const log of auditLogs) {
    const usage = usageByUser.get(log.actorId);
    if (!usage) continue;
    usage.lastActivityAt = new Date(log.createdAt).getTime() > new Date(usage.lastActivityAt).getTime()
      ? log.createdAt
      : usage.lastActivityAt;

    if (log.action === 'tutorial.import') {
      usage.importedDocs += 1;
      usage.estimatedCredits += 3;
    }
    if (log.action === 'topic.generate') {
      usage.estimatedCredits += 5;
    }
    if (log.action === 'script.generate') {
      usage.scripts += 1;
      usage.estimatedCredits += 8;
    }
    if (log.action.startsWith('video_project.') && log.targetType === 'video_project') {
      projectCreator.set(log.targetId, log.actorId);
    }
    if (log.action === 'voice.clone.ready') {
      usage.estimatedCredits += 80;
    }
  }

  for (const project of projects) {
    const userId = project.ownerUserId || projectCreator.get(project.id);
    if (!userId) continue;
    const usage = usageByUser.get(userId);
    if (!usage) continue;
    const projectUsage = estimateProjectCreditUsage(project, scenes, assets);

    usage.videos += 1;
    usage.videoMinutes += projectUsage.minutes;
    usage.estimatedCredits += projectUsage.credits;
    if (project.status === 'completed') usage.completedVideos += 1;
    if (project.status === 'failed') usage.failedVideos += 1;
  }

  const userUsage = Array.from(usageByUser.values())
    .map((usage) => ({
      ...usage,
      creditAccount: accountByUserId.get(usage.user.id) || null,
      ledgerCount: ledger.filter((entry) => entry.userId === usage.user.id).length
    }))
    .sort((a, b) => (b.creditAccount?.usedCredits || b.estimatedCredits) - (a.creditAccount?.usedCredits || a.estimatedCredits));
  const totals = userUsage.reduce((sum, item) => ({
    users: sum.users + 1,
    activeUsers: sum.activeUsers + (item.estimatedCredits > 0 ? 1 : 0),
    estimatedCredits: sum.estimatedCredits + (item.creditAccount?.usedCredits || item.estimatedCredits),
    videos: sum.videos + item.videos,
    completedVideos: sum.completedVideos + item.completedVideos,
    videoMinutes: sum.videoMinutes + item.videoMinutes
  }), {
    users: 0,
    activeUsers: 0,
    estimatedCredits: 0,
    videos: 0,
    completedVideos: 0,
    videoMinutes: 0
  });

  return {
    plans: CREDIT_PLANS,
    rates: CREDIT_VIDEO_RATES,
    addOns: CREDIT_ADD_ONS,
    ledger,
    totals,
    userUsage
  };
}
