import { readJsonFile } from './storage';
import { getCurrentUser } from './auth';
import { canAccessOwnedRecord, filterOwnedRecords } from './ownership';
import { getRuntimeStatus } from './runtime/environment';
import { Script, StoryboardReview, Topic, Tutorial, VideoAsset, VideoProject, VideoScene } from './types';

export async function getTutorials() {
  const [user, tutorials] = await Promise.all([
    getCurrentUser(),
    readJsonFile<Tutorial[]>('data/tutorials.json')
  ]);
  return filterOwnedRecords(tutorials, user);
}

export async function getTopics() {
  const [user, topics] = await Promise.all([
    getCurrentUser(),
    readJsonFile<Topic[]>('data/topics.json')
  ]);
  return filterOwnedRecords(topics, user);
}

export async function getScripts() {
  const [user, scripts] = await Promise.all([
    getCurrentUser(),
    readJsonFile<Script[]>('data/scripts.json')
  ]);
  return filterOwnedRecords(scripts, user);
}

export async function getVideoProjects() {
  const [user, projects] = await Promise.all([
    getCurrentUser(),
    readJsonFile<VideoProject[]>('data/video-projects.json')
  ]);
  return filterOwnedRecords(projects, user);
}

export async function getVideoScenes() {
  const [user, scenes, projects] = await Promise.all([
    getCurrentUser(),
    readJsonFile<VideoScene[]>('data/video-scenes.json'),
    readJsonFile<VideoProject[]>('data/video-projects.json').catch(() => [])
  ]);
  const accessibleProjectIds = new Set(projects
    .filter((project) => canAccessOwnedRecord(user, project.ownerUserId))
    .map((project) => project.id));
  return scenes.filter((scene) => accessibleProjectIds.has(scene.projectId));
}

export async function getVideoAssets() {
  const [user, assets, projects] = await Promise.all([
    getCurrentUser(),
    readJsonFile<VideoAsset[]>('data/video-assets.json'),
    readJsonFile<VideoProject[]>('data/video-projects.json').catch(() => [])
  ]);
  const accessibleProjectIds = new Set(projects
    .filter((project) => canAccessOwnedRecord(user, project.ownerUserId))
    .map((project) => project.id));
  return assets.filter((asset) => accessibleProjectIds.has(asset.projectId));
}

export async function getVideoRuntimeStatus() {
  return getRuntimeStatus();
}

export async function getRenderJobs() {
  const [user, jobs, projects] = await Promise.all([
    getCurrentUser(),
    readJsonFile<import('./types').RenderJob[]>('data/render-jobs.json'),
    readJsonFile<VideoProject[]>('data/video-projects.json').catch(() => [])
  ]);
  const projectById = new Map(projects.map((project) => [project.id, project]));
  return jobs.filter((job) => {
    if (canAccessOwnedRecord(user, job.ownerUserId)) return true;
    const project = projectById.get(job.projectId);
    return project ? canAccessOwnedRecord(user, project.ownerUserId) : false;
  });
}

export async function getQualityReviews() {
  const [user, reviews, projects] = await Promise.all([
    getCurrentUser(),
    readJsonFile<import('./types').QualityReview[]>('data/quality-reviews.json'),
    readJsonFile<VideoProject[]>('data/video-projects.json').catch(() => [])
  ]);
  const accessibleProjectIds = new Set(projects
    .filter((project) => canAccessOwnedRecord(user, project.ownerUserId))
    .map((project) => project.id));
  return reviews.filter((review) => accessibleProjectIds.has(review.projectId));
}

export async function getStoryboardReviews() {
  try {
    const [user, reviews, projects] = await Promise.all([
      getCurrentUser(),
      readJsonFile<StoryboardReview[]>('data/storyboard-reviews.json'),
      readJsonFile<VideoProject[]>('data/video-projects.json').catch(() => [])
    ]);
    const accessibleProjectIds = new Set(projects
      .filter((project) => canAccessOwnedRecord(user, project.ownerUserId))
      .map((project) => project.id));
    return reviews.filter((review) => accessibleProjectIds.has(review.projectId));
  } catch {
    return [];
  }
}
