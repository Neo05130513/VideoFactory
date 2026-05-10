export type SourceType = 'docx' | 'txt' | 'md' | 'html';
export type UserRole = 'admin' | 'content' | 'video' | 'ops';
export type TopicAngle = '痛点型' | '方法论型' | '工具实操型' | '避坑型' | '进阶优化型';
export type Platform = 'document' | 'douyin' | 'kuaishou' | 'bilibili' | 'article';
export type VideoProjectStatus = 'draft' | 'storyboarded' | 'rendering' | 'completed' | 'failed';
export type RenderJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type PipelineJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type VideoTemplate = 'tutorial-demo-v1' | 'tech-explainer-v1' | 'ai-explainer-short-v1' | 'hyperframes-explainer-v1';
export type VideoShotType = 'title' | 'pain' | 'step' | 'result' | 'cta';
export type VideoVisualType = 'slide' | 'screen' | 'image' | 'caption';
export type VideoAssetType = 'image' | 'audio' | 'subtitle' | 'video';
export type VideoAssetStatus = 'pending' | 'ready' | 'failed';
export type VideoVisualPreset = 'clarity-blue' | 'midnight-cyan' | 'sunset-amber';
export type VideoAspectRatio = '9:16' | '16:9';
export type VideoPublishTier = 'pending' | 'publishable' | 'review' | 'blocked';
export type VideoOpsStatus = 'idle' | 'queued_publish' | 'reviewed' | 'queued_rework';
export type VoiceProfileStatus = 'sample_uploaded' | 'ready' | 'failed';
export type VoiceProvider = 'aliyun-cosyvoice' | 'minimax' | 'custom-http';
export type VideoSceneLayout =
  | 'hero'
  | 'contrast'
  | 'network'
  | 'process'
  | 'chart'
  | 'matrix'
  | 'checklist'
  | 'cta'
  | 'cause'
  | 'timeline'
  | 'mistake'
  | 'pyramid';

export interface TutorialStep {
  title: string;
  detail: string;
}

export interface Tutorial {
  id: string;
  title: string;
  sourceType: SourceType;
  sourceFile?: string;
  rawContent: string;
  summary: string;
  targetAudience: string[];
  scenarios: string[];
  tools: string[];
  methods: string[];
  steps: TutorialStep[];
  keyQuotes: string[];
  risks: string[];
  categories: string[];
  tags: string[];
  shortVideoScore: number;
  priority: 'low' | 'medium' | 'high';
  status: 'imported' | 'parsed';
  createdAt: string;
  updatedAt: string;
}

export interface Topic {
  id: string;
  tutorialId: string;
  title: string;
  angle: TopicAngle;
  hookType: string;
  painPoint: string;
  audience: string;
  platformFit: Platform[];
  viralScore: number;
  createdAt: string;
}

export interface Script {
  id: string;
  topicId: string;
  tutorialId: string;
  platform: Platform;
  duration: string;
  title: string;
  hook: string;
  body: string;
  cta: string;
  style: string;
  createdAt: string;
  version?: number;
  sourceScriptId?: string;
}

export interface VideoProject {
  id: string;
  tutorialId: string;
  topicId: string;
  scriptId: string;
  status: VideoProjectStatus;
  template: VideoTemplate;
  title: string;
  aspectRatio: VideoAspectRatio;
  createdAt: string;
  updatedAt: string;
  outputPath?: string;
  lastError?: string;
  lastRenderAttemptAt?: string;
  visualPreset?: VideoVisualPreset;
  publishScore?: number;
  publishTier?: VideoPublishTier;
  opsStatus?: VideoOpsStatus;
  opsUpdatedAt?: string;
}

export interface VideoScene {
  id: string;
  projectId: string;
  order: number;
  shotType: VideoShotType;
  visualType: VideoVisualType;
  visualPrompt: string;
  voiceover: string;
  subtitle: string;
  durationSec: number;
  layout?: VideoSceneLayout;
  headline?: string;
  emphasis?: string;
  keywords?: string[];
  cards?: string[];
  chartData?: number[];
  transition?: 'push' | 'zoom' | 'flash' | 'wipe' | 'fade';
}

export interface VideoAsset {
  id: string;
  projectId: string;
  sceneId: string;
  assetType: VideoAssetType;
  path: string;
  status: VideoAssetStatus;
}

export interface VoiceProfile {
  id: string;
  userId: string;
  name: string;
  provider: VoiceProvider;
  status: VoiceProfileStatus;
  samplePath: string;
  sampleObjectKey?: string;
  sampleStorageProvider?: 'aliyun-oss';
  providerVoiceId?: string;
  lastError?: string;
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VoiceSettings {
  provider: VoiceProvider;
  dashscopeApiKey?: string;
  dashscopeBaseUrl?: string;
  cosyvoiceModel?: string;
  cosyvoiceCloneModel?: string;
  cosyvoiceTestVoiceId?: string;
  cosyvoiceVoicePrefix?: string;
  cosyvoicePublicBaseUrl?: string;
  cosyvoiceChunkCharLimit?: number;
  aliyunOssRegion?: string;
  aliyunOssEndpoint?: string;
  aliyunOssBucket?: string;
  aliyunOssAccessKeyId?: string;
  aliyunOssAccessKeySecret?: string;
  aliyunOssPrefix?: string;
  aliyunOssSignedUrlExpiresSec?: number;
  minimaxApiKey?: string;
  minimaxBaseUrl?: string;
  minimaxTtsModel?: string;
  minimaxCloneModel?: string;
  minimaxLanguageBoost?: string;
  minimaxVoicePrefix?: string;
  voiceCloneEndpoint?: string;
  voiceTtsEndpoint?: string;
  voiceProviderApiKey?: string;
  updatedAt: string;
}

export interface RenderJob {
  id: string;
  projectId: string;
  status: RenderJobStatus;
  attempt: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  outputPath?: string;
  stage?: string;
  progress?: number;
}

export interface PipelineScriptPreview {
  id: string;
  title: string;
  hook: string;
}

export interface PipelineJobResult {
  tutorialId: string;
  tutorialTitle: string;
  topicCount: number;
  scriptCount: number;
  scripts: PipelineScriptPreview[];
  firstScriptId?: string;
  firstScriptTitle?: string;
}

export interface PipelineJob {
  id: string;
  tutorialId: string;
  status: PipelineJobStatus;
  stage: string;
  progress: number;
  detail?: string;
  previewText?: string;
  streamText?: string;
  streamUpdatedAt?: string;
  currentTopicTitle?: string;
  currentTopicIndex?: number;
  totalTopics?: number;
  attempt?: number;
  maxAttempts?: number;
  elapsedMs?: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  result?: PipelineJobResult;
}

export interface QualityReview {
  id: string;
  projectId: string;
  reviewer: 'auto-sampler';
  round: string;
  visualScore: number;
  subtitleScore: number;
  rhythmScore: number;
  publishDecision: 'publishable' | 'review' | 'blocked';
  notes: string;
  issueTags: string[];
  recommendations: string[];
  createdAt: string;
}

export interface StoryboardReview {
  id: string;
  projectId: string;
  source: 'openai' | 'minimax' | 'rule-fallback';
  model?: string;
  endpoint?: string;
  score: number;
  issues: string[];
  reasons?: string[];
  retried: boolean;
  usedFallback: boolean;
  sceneCount: number;
  totalDurationSec: number;
  createdAt: string;
}

export interface TrendMatch {
  tutorialId: string;
  tutorialTitle: string;
  score: number;
  reasons: string[];
  suggestedAngles: string[];
}

export interface UserAccount {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  createdAt: string;
  disabledAt?: string;
  lastLoginAt?: string;
  failedLoginAttempts?: number;
  lockedUntil?: string;
  mustChangePassword?: boolean;
}

export interface UserSession {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

export interface AuditLog {
  id: string;
  actorId: string;
  actorName: string;
  actorRole: UserRole;
  action: string;
  targetType: 'script' | 'video_project' | 'tutorial' | 'topic' | 'system';
  targetId: string;
  summary: string;
  createdAt: string;
}
