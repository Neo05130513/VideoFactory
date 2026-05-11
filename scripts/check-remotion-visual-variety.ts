import fs from 'node:fs';
import path from 'node:path';

type Scene = {
  id?: string;
  order?: number;
  shotType?: string;
  layout?: string;
  headline?: string;
  subtitle?: string;
  emphasis?: string;
  cards?: string[];
  keywords?: string[];
};

const allowedLayouts = new Set([
  'hero',
  'contrast',
  'network',
  'process',
  'chart',
  'matrix',
  'checklist',
  'cta',
  'cause',
  'timeline',
  'mistake',
  'pyramid',
  'spotlight',
  'quote',
  'toolchain',
  'radar',
  'mosaic'
]);

const defaultFiles = [
  'remotion/fixtures/hyperframes-explainer.json',
  'remotion/fixtures/hyperframes-longform-gallery.json',
  'remotion/fixtures/ai-explainer-short-longform.json',
  'remotion/fixtures/tech-explainer.json'
];

function compact(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sceneLabel(scene: Scene, index: number) {
  return scene.id || scene.order || index + 1;
}

function readScenes(file: string): Scene[] {
  const fullPath = path.resolve(file);
  const raw = fs.readFileSync(fullPath, 'utf8');
  const input = JSON.parse(raw);
  if (!Array.isArray(input.scenes)) {
    throw new Error(`${file}: missing scenes array`);
  }
  return input.scenes;
}

function checkFile(file: string) {
  const scenes = readScenes(file);
  const errors: string[] = [];
  const warnings: string[] = [];
  const contentScenes = scenes.filter((scene) => scene.shotType !== 'title' && scene.shotType !== 'cta' && scene.layout !== 'hero' && scene.layout !== 'cta');

  scenes.forEach((scene, index) => {
    const layout = scene.layout || (scene.shotType === 'title' ? 'hero' : scene.shotType === 'cta' ? 'cta' : '');
    if (layout && !allowedLayouts.has(layout)) {
      errors.push(`scene ${sceneLabel(scene, index)} uses unsupported layout "${layout}"`);
    }

    const headline = compact(scene.headline);
    const subtitle = compact(scene.subtitle);
    const cards = Array.isArray(scene.cards) ? scene.cards.map(compact).filter(Boolean) : [];
    if (headline.length > 24) warnings.push(`scene ${sceneLabel(scene, index)} headline is long (${headline.length})`);
    if (subtitle.length > 34) warnings.push(`scene ${sceneLabel(scene, index)} subtitle is long (${subtitle.length})`);
    cards.forEach((card, cardIndex) => {
      if (card.length > 18) warnings.push(`scene ${sceneLabel(scene, index)} card ${cardIndex + 1} is long (${card.length})`);
    });

    if (layout === 'mosaic' && cards.length < 5) warnings.push(`scene ${sceneLabel(scene, index)} mosaic has fewer than 5 cards`);
    if (['toolchain', 'timeline', 'process', 'checklist'].includes(layout) && cards.length < 4) warnings.push(`scene ${sceneLabel(scene, index)} ${layout} has fewer than 4 cards`);
  });

  for (let index = 2; index < scenes.length; index += 1) {
    const a = scenes[index - 2].layout;
    const b = scenes[index - 1].layout;
    const c = scenes[index].layout;
    if (a && a === b && b === c && !['hero', 'cta'].includes(a)) {
      errors.push(`layout "${a}" repeats 3 times in a row around scene ${index + 1}`);
    }
  }

  if (scenes.length >= 9) {
    const uniqueLayouts = new Set(contentScenes.map((scene) => scene.layout).filter(Boolean));
    const minimum = Math.min(6, Math.max(4, Math.ceil(contentScenes.length / 3)));
    if (uniqueLayouts.size < minimum) {
      errors.push(`long video has only ${uniqueLayouts.size} content layouts, expected at least ${minimum}`);
    }
  } else if (scenes.length >= 7) {
    const uniqueLayouts = new Set(contentScenes.map((scene) => scene.layout).filter(Boolean));
    if (uniqueLayouts.size <= 2) warnings.push(`video uses only ${uniqueLayouts.size} content layouts`);
  }

  return { scenes: scenes.length, errors, warnings };
}

const files = process.argv.slice(2).length ? process.argv.slice(2) : defaultFiles;
let failed = false;

for (const file of files) {
  try {
    const result = checkFile(file);
    if (result.errors.length) {
      failed = true;
      console.error(`[visual-check] ${file} failed (${result.scenes} scenes)`);
      result.errors.forEach((error) => console.error(`  error: ${error}`));
    } else {
      console.log(`[visual-check] ${file} ok (${result.scenes} scenes, ${result.warnings.length} warnings)`);
    }
    result.warnings.forEach((warning) => console.warn(`  warn: ${warning}`));
  } catch (error) {
    failed = true;
    console.error(`[visual-check] ${file} failed`);
    console.error(`  error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failed) process.exit(1);
