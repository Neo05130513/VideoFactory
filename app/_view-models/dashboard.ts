import { getQualityReviews, getScripts, getTopics, getTutorials, getVideoAssets, getVideoProjects, getVideoRuntimeStatus } from '@/lib/queries';

const launchPoolTarget = 30;

export async function getDashboardViewModel() {
  const [tutorials, topics, scripts, videoProjects, videoAssets, runtimeStatus, qualityReviews] = await Promise.all([
    getTutorials(),
    getTopics(),
    getScripts(),
    getVideoProjects(),
    getVideoAssets(),
    getVideoRuntimeStatus(),
    getQualityReviews()
  ]);

  const parsedCount = tutorials.filter((item) => item.status === 'parsed').length;
  const completedProjects = videoProjects.filter((item) => item.status === 'completed');
  const failedProjects = videoProjects.filter((item) => item.status === 'failed');
  const queuedPublishProjects = videoProjects.filter((item) => item.opsStatus === 'queued_publish');
  const reviewedProjects = videoProjects.filter((item) => item.opsStatus === 'reviewed');
  const queuedReworkProjects = videoProjects.filter((item) => item.opsStatus === 'queued_rework');
  const failureStats = summarizeFailureStats(videoProjects);
  const firstUnprocessedTutorial = tutorials.find((item) => item.status !== 'parsed') || tutorials[0];
  const firstScriptWithoutProject = scripts.find((script) => !videoProjects.some((project) => project.scriptId === script.id));
  const firstRenderableProject = videoProjects.find((project) => project.status !== 'rendering');
  const latestProject = [...videoProjects].sort((a, b) => Number(new Date(b.updatedAt)) - Number(new Date(a.updatedAt)))[0];
  const tutorialsWithTopics = new Set(topics.map((item) => item.tutorialId)).size;
  const topicsWithScripts = new Set(scripts.map((item) => item.topicId)).size;
  const completedWithReviews = new Set(qualityReviews.map((item) => item.projectId)).size;
  const readyVideoAssets = videoAssets.filter((item) => item.assetType === 'video' && item.status === 'ready').length;

  const parseRate = tutorials.length ? Math.round((parsedCount / tutorials.length) * 100) : 0;
  const topicCoverageRate = tutorials.length ? Math.round((tutorialsWithTopics / tutorials.length) * 100) : 0;
  const scriptCoverageRate = topics.length ? Math.round((topicsWithScripts / topics.length) * 100) : 0;
  const completionRate = videoProjects.length ? Math.round((completedProjects.length / videoProjects.length) * 100) : 0;
  const qaCoverageRate = completedProjects.length ? Math.round((completedWithReviews / completedProjects.length) * 100) : 0;
  const launchPoolCoverageRate = Math.min(100, Math.round((completedProjects.length / launchPoolTarget) * 100));
  const deliveryReadinessScore = Math.round((parseRate + topicCoverageRate + scriptCoverageRate + completionRate + qaCoverageRate + launchPoolCoverageRate) / 6);
  const deliveryReadinessLabel = deliveryReadinessScore >= 80 ? '可以正式交付' : deliveryReadinessScore >= 60 ? '接近正式交付' : '仍需继续补齐';

  const tutorialsWithoutTopics = tutorials.filter((tutorial) => !topics.some((topic) => topic.tutorialId === tutorial.id));
  const topicsWithoutScripts = topics.filter((topic) => !scripts.some((script) => script.topicId === topic.id));
  const scriptsWithoutProjects = scripts.filter((script) => !videoProjects.some((project) => project.scriptId === script.id));
  const projectsPendingRender = videoProjects.filter((project) => project.status === 'storyboarded' || project.status === 'draft' || project.status === 'failed');
  const rankedPendingScripts = scriptsWithoutProjects
    .map((script) => {
      const topic = topics.find((item) => item.id === script.topicId);
      const tutorial = tutorials.find((item) => item.id === script.tutorialId);
      const score = inferScriptPriority(script, topic?.viralScore || 0, tutorial?.priority || 'medium');
      return { script, topic, tutorial, score, level: score >= 85 ? 'P0' : score >= 70 ? 'P1' : 'P2' };
    })
    .sort((a, b) => b.score - a.score);
  const nextP0Scripts = rankedPendingScripts.filter((item) => item.level === 'P0').slice(0, 5);

  const bottlenecks = [
    { name: '教程->选题覆盖', value: topicCoverageRate },
    { name: '选题->脚本覆盖', value: scriptCoverageRate },
    { name: '发布池覆盖', value: launchPoolCoverageRate },
    { name: '已完成项目质检覆盖', value: qaCoverageRate }
  ].sort((a, b) => a.value - b.value);
  const biggestBottleneck = bottlenecks[0];

  return {
    tutorials,
    topics,
    scripts,
    videoProjects,
    videoAssets,
    runtimeStatus,
    qualityReviews,
    parsedCount,
    completedProjects,
    failedProjects,
    queuedPublishProjects,
    reviewedProjects,
    queuedReworkProjects,
    failureStats,
    firstUnprocessedTutorial,
    firstScriptWithoutProject,
    firstRenderableProject,
    latestProject,
    tutorialsWithTopics,
    topicsWithScripts,
    completedWithReviews,
    readyVideoAssets,
    launchPoolTarget,
    parseRate,
    topicCoverageRate,
    scriptCoverageRate,
    completionRate,
    qaCoverageRate,
    launchPoolCoverageRate,
    deliveryReadinessScore,
    deliveryReadinessLabel,
    tutorialsWithoutTopics,
    topicsWithoutScripts,
    scriptsWithoutProjects,
    projectsPendingRender,
    rankedPendingScripts,
    nextP0Scripts,
    bottlenecks,
    biggestBottleneck
  };
}

function inferScriptPriority(script: { title: string }, viralScore: number, tutorialPriority: 'low' | 'medium' | 'high') {
  let score = 40;
  if (/DeepSeek|Dify|飞书|扣子|豆包|ChatGPT|Kimi|Trae/i.test(script.title)) score += 14;
  score += Math.min(20, Math.round(viralScore / 5));
  if (tutorialPriority === 'high') score += 12;
  if (tutorialPriority === 'medium') score += 6;
  return Math.min(100, score);
}

function summarizeFailureStats(projects: Array<{ status: string; lastError?: string }>) {
  const failedProjects = projects.filter((item) => item.status === 'failed');
  return [
    { label: '渲染失败', count: failedProjects.filter((item) => /render|ffmpeg|渲染/i.test(item.lastError || '')).length, note: 'ffmpeg / render 相关', tone: '#fca5a5' },
    { label: '素材缺失', count: failedProjects.filter((item) => /image|audio|subtitle|素材/i.test(item.lastError || '')).length, note: '图片/音频/字幕不完整', tone: '#fde68a' },
    { label: '配置问题', count: failedProjects.filter((item) => /openai|minimax|api key|配置|installed/i.test(item.lastError || '')).length, note: '环境或密钥问题', tone: '#93c5fd' },
    { label: '其他失败', count: Math.max(0, failedProjects.length - failedProjects.filter((item) => /render|ffmpeg|渲染|image|audio|subtitle|素材|openai|minimax|api key|配置|installed/i.test(item.lastError || '')).length), note: '需要人工继续归类', tone: '#c4b5fd' }
  ];
}
