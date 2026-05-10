export function voiceoverVolume(frame: number, durationInFrames: number) {
  const safeDuration = Math.max(1, durationInFrames);
  const fadeFrames = Math.max(1, Math.min(5, Math.floor(safeDuration / 4)));
  const fadeIn = Math.min(1, Math.max(0, frame / fadeFrames));
  const fadeOutStart = Math.max(0, safeDuration - fadeFrames - 1);
  const fadeOut = frame <= fadeOutStart ? 1 : Math.max(0, (safeDuration - frame) / fadeFrames);
  return Math.min(fadeIn, fadeOut);
}
