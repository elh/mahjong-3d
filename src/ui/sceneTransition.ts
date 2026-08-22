export const sceneTransitionFadeMs = 620;

export type SceneTransitionSample = {
  opacity: number;
  complete: boolean;
};

/**
 * Samples a fade without relying on CSS animation scheduling. Both the normal
 * web surface and the native screen saver use this calculation with their own
 * frame clocks.
 */
export function sceneTransitionSample({
  startOpacity,
  targetOpacity,
  elapsedMs,
  durationMs = sceneTransitionFadeMs,
}: {
  startOpacity: number;
  targetOpacity: number;
  elapsedMs: number;
  durationMs?: number;
}): SceneTransitionSample {
  const progress = durationMs <= 0 ? 1 : clamp(elapsedMs / durationMs, 0, 1);
  const easedProgress = easeInOutCubic(progress);

  return {
    opacity: startOpacity + (targetOpacity - startOpacity) * easedProgress,
    complete: progress >= 1,
  };
}

function easeInOutCubic(progress: number): number {
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - (-2 * progress + 2) ** 3 / 2;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
