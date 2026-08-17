export const infiniteRoundHoldMs = 4500;
export const infiniteRoundFadeMs = 620;
export const infiniteRoundSwapMs = 560;
export const infiniteRoundFlipPrepMs = 300;
export const infiniteRoundFlipDurationMs = 1150;
export const infiniteRoundResetDelayMs = 4000;

export type EventAutoAdvanceMode = "animated" | "immediate";

export function eventAutoAdvanceMode({
  isPlaybackActive,
  prefersReducedMotion,
  isLoadingRound,
  hasGenerationError,
  eventCount,
}: {
  isPlaybackActive: boolean;
  prefersReducedMotion: boolean;
  isLoadingRound: boolean;
  hasGenerationError: boolean;
  eventCount: number;
}): EventAutoAdvanceMode | undefined {
  if (
    !isPlaybackActive ||
    isLoadingRound ||
    hasGenerationError ||
    eventCount <= 0
  ) {
    return undefined;
  }

  return prefersReducedMotion ? "immediate" : "animated";
}

export function infiniteRoundFlipTransitionDelayMs(): number {
  return (
    infiniteRoundFlipPrepMs +
    infiniteRoundFlipDurationMs +
    infiniteRoundResetDelayMs
  );
}

export type PromotionDelayInput = {
  isAtRoundEnd: boolean;
  hasQueuedNextRound: boolean;
  isDocumentHidden: boolean;
  terminalReachedAt: number | undefined;
  now: number;
};

export function nextRoundPromotionDelayMs({
  isAtRoundEnd,
  hasQueuedNextRound,
  isDocumentHidden,
  terminalReachedAt,
  now,
}: PromotionDelayInput): number | undefined {
  if (
    !isAtRoundEnd ||
    !hasQueuedNextRound ||
    isDocumentHidden ||
    terminalReachedAt === undefined
  ) {
    return undefined;
  }

  return Math.max(0, terminalReachedAt + infiniteRoundHoldMs - now);
}
