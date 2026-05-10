# Remotion Roadmap

This file is the persistent implementation plan for the Remotion upgrade work. Read this before continuing Remotion-related development.

## Decision

Prioritize local video-factory improvements first:

1. More production-quality Remotion templates.
2. In-app Remotion preview.
3. Better render progress and reliability.
4. Remotion Studio workflow for template development.

Cloud rendering is useful, but intentionally postponed until after the local workflow is strong.

## Current Baseline

- Remotion packages are already installed in `package.json`.
- Remotion entry point: `remotion/index.tsx`.
- Composition registry: `remotion/Root.tsx`.
- Existing templates: `remotion/TutorialDemo.tsx`, `remotion/TechExplainer.tsx`, `remotion/AiExplainerShort.tsx`, `remotion/HyperframesExplainer.tsx`.
- Render pipeline: `lib/remotion-renderer.ts`.
- Render job orchestration: `lib/render-jobs.ts`.
- Preview/dev command: `npm run remotion:preview`.

## Phase 1: Add Better Templates

Status: first template complete. `AiExplainerShort` is implemented, registered, selectable, and verified with a full MP4 render.

Goal: make generated videos feel closer to finished short-form content.

Start with one high-quality template:

- `AiExplainerShort`
- Best for AI education, product explainers, and short knowledge videos.
- Should support 9:16 and 16:9 through existing `aspectRatio`.
- Should consume existing `RemotionVideoInput` without requiring pipeline changes.
- Should use scenes, subtitles, voiceover duration, keywords, cards, chart data, and transitions where available.

Implementation notes:

- Add a new file under `remotion/`.
- Register the composition in `remotion/Root.tsx`.
- Update `getCompositionId()` in `lib/remotion-renderer.ts`.
- Add the template option wherever templates are selected or displayed.
- Keep the first version data-driven and reliable before adding complex effects.

Acceptance:

- Done: `npx remotion compositions remotion/index.tsx` lists `AiExplainerShort`.
- Done: `npx remotion still remotion/index.tsx AiExplainerShort /tmp/ai-explainer-short.png` renders a static frame.
- Done: project creation UI can select `AiExplainerShort`.
- Done: render pipeline maps `ai-explainer-short-v1` to the new composition.
- Done: representative app project rendered a full MP4 using temp data.
  - Command used `VIDEO_FACTORY_DATA_ROOT=/tmp/video-factory-ai-template-data` and `VIDEO_FACTORY_GENERATED_ROOT=/tmp/video-factory-ai-template-generated`.
  - Output: `/tmp/video-factory-ai-template-generated/remotion/video_project_1776945368255_uvn1ir/output.mp4`.
  - Video metadata: h264, 1080x1920, 46.06 seconds, about 17 MB.
- Done: existing templates remain available as fallback options in the UI.
- Done: Hyperframes-inspired experimental template is registered as `hyperframes-explainer-v1` for preview/render comparison without replacing Remotion.

## Phase 2: In-App Preview

Status: implemented on the video detail page and verified by production build.

Goal: preview a Remotion composition in the web UI before rendering a final MP4.

Use `@remotion/player`.

Likely areas:

- Add a reusable preview component in `app/videos/_components/`.
- Feed it the same input shape produced for rendering.
- Add preview to the video detail page first, then consider script/storyboard pages.

Acceptance:

- Done: `app/videos/_components/remotion-project-preview.tsx` uses `@remotion/player`.
- Done: `/videos/[id]` builds a `RemotionVideoInput` from project scenes and ready audio assets.
- Done: video detail page shows a template preview before final MP4 output.
- Done: `npm run build` compiles successfully with the preview component.
- Todo: perform a browser-level visual check with a real persisted project once sample app data exists.

## Phase 3: Render Progress And Reliability

Status: first progress pass implemented and verified by type check plus production build.

Goal: make rendering easier to monitor, retry, and diagnose.

Improve:

- Progress percentage.
- Current render phase.
- Error messages and logs.
- Retry behavior.
- Cancel behavior.
- Output file checks.
- Render duration metrics.

Likely areas:

- `lib/render-jobs.ts`
- `lib/remotion-renderer.ts`
- `app/videos/video-progress-panel.tsx`
- `app/videos/video-actions-panel.tsx`

Acceptance:

- Done: render jobs persist `stage` and `progress`.
- Done: JSON/SQLite job storage maps `stage` and `progress`.
- Done: queued, low-memory wait, start, render, retry, completed, failed, and cancelled states update progress metadata.
- Done: progress snapshots prefer real job progress before falling back to asset-count heuristics.
- Done: `npm run build` and `npx tsc --noEmit` pass after the change.
- Done: `renderVideoProjectWithRemotion` reports finer-grained stages through an `onProgress` callback.
- Done: queue render validation completed with `stage: completed` and `progress: 100`.
- Todo: add true per-scene media progress from Remotion renderer if needed.
- Todo: add richer render logs if failures remain hard to diagnose.

## Phase 4: Remotion Studio Workflow

Status: template fixture set and first tuning workflow are in place.

Goal: make template development fast and repeatable.

Improve:

- Keep `npm run remotion:preview` working.
- Add sample input fixtures for each template.
- Document how to test a template in Studio before wiring it into the app.
- Consider adding helper scripts if repeated manual steps appear.

Acceptance:

- Done: `remotion/fixtures/ai-explainer-short.json` provides a realistic `RemotionVideoInput`.
- Done: `remotion/Root.tsx` uses the fixture as default Studio props.
- Done: `remotion/fixtures/tech-explainer.json` provides a realistic `TechExplainer` input.
- Done: `remotion/fixtures/tutorial-demo.json` provides a realistic `TutorialDemo` input.
- Done: `remotion/fixtures/hyperframes-explainer.json` provides a realistic `HyperframesExplainer` input.
- Done: `README.md` documents the short template-tuning workflow and template check command.
- Todo: expand fixture coverage if future templates add new scene metadata or layout variants.

## Deferred: Cloud Rendering

Cloud rendering is intentionally out of scope for the next implementation pass. Revisit after phases 1-4 are usable locally.

Possible future direction:

- Queue render jobs locally.
- Send render tasks to cloud workers.
- Store output files in object storage.
- Report render progress back to the app.

## Continuation Rule

When resuming work, continue from the earliest unfinished phase. Do not jump to cloud rendering unless explicitly requested.
