# neo

Video Factory project.

## AI Provider

- Script, topic, storyboard, video keyframe image, and simple render-audio generation use OpenAI by default.
- Configure `OPENAI_API_KEY`; optional defaults are `OPENAI_TEXT_MODEL=gpt-5.4`, `OPENAI_IMAGE_MODEL=gpt-image-1`, and `OPENAI_TTS_MODEL=gpt-4o-mini-tts`.
- OpenAI-compatible relays can set `OPENAI_TEXT_BASE_URL` or `OPENAI_BASE_URL`; URLs ending in `/v1` are handled correctly.
- Runtime AI settings can also be changed from `/settings` or `PUT /api/settings/ai`; saved values are stored in the ignored `data/ai-settings.json` and take priority over `.env.local`.
- Set `STORYBOARD_PLANNER_PROVIDER=local` to bypass slow relay storyboard calls and create video projects immediately; `STORYBOARD_FALLBACK_ON_AI_ERROR=true` keeps a local fallback when AI planning fails.
- Set `TEXT_GENERATION_PROVIDER=minimax`, `VIDEO_IMAGE_PROVIDER=minimax`, or `VIDEO_TTS_PROVIDER=minimax` only if you intentionally want the legacy MiniMax flows.
- Remotion still renders the final MP4 locally; CosyVoice/custom voice settings remain available for advanced voice-clone workflows.
- On Windows NVIDIA machines, Remotion render jobs default to `REMOTION_GPU_ENCODER=auto`: if an external ffmpeg with `h264_nvenc` is found, final video encoding uses NVENC and falls back to CPU otherwise. Set `REMOTION_GPU_ENCODER=off` to force CPU or `REMOTION_GPU_FFMPEG_PATH` to pin a specific ffmpeg.

## Windows Desktop

- Run `npm run package:win` to build the desktop folder at `dist/windows/win-unpacked`.
- Start the app with `dist/windows/win-unpacked/Video Factory.exe`.
- Put a `.env.local` file beside the exe to provide default local API settings; values changed in `/settings` are saved in the user's app data folder.

## Remotion Studio

- Start Studio with the AI explainer fixture: `npm run remotion:studio:ai`
- Start Studio with the tech explainer fixture: `npm run remotion:studio:tech`
- Start Studio with the tutorial demo fixture: `npm run remotion:studio:tutorial`
- Start Studio with the Hyperframes visual experiment fixture: `npm run remotion:studio:hyperframes`
- Start Studio with a compact edge-case fixture: `npm run remotion:studio:ai:compact`
- Start Studio with a landscape edge-case fixture: `npm run remotion:studio:ai:landscape`
- Start Studio with a long-form edge-case fixture: `npm run remotion:studio:ai:longform`
- Check all AI explainer fixtures: `npm run remotion:check:ai`
- Check one fixture for each template: `npm run remotion:check:templates`
- Render the AI explainer fixture locally: `npm run remotion:render:ai`
- Fixture sources:
  - `remotion/fixtures/ai-explainer-short.json`
  - `remotion/fixtures/ai-explainer-short-compact.json`
  - `remotion/fixtures/ai-explainer-short-landscape.json`
  - `remotion/fixtures/ai-explainer-short-longform.json`
  - `remotion/fixtures/tech-explainer.json`
  - `remotion/fixtures/tutorial-demo.json`
  - `remotion/fixtures/hyperframes-explainer.json`

### Template tuning workflow

1. Pick the closest fixture for the template you are changing.
2. Run the matching `npm run remotion:studio:*` command.
3. Tune the template component until the fixture looks good in Studio.
4. Run `npm run remotion:check:templates` before wiring template changes back into the app.

## Roadmap

- Remotion implementation plan: [docs/remotion-roadmap.md](docs/remotion-roadmap.md)
- Monetization and credit plans: [docs/monetization-and-credits.md](docs/monetization-and-credits.md)
