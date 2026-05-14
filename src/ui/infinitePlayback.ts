export const infiniteRoundHoldMs = 5000;
export const infiniteRoundFadeMs = 620;
export const infiniteRoundSwapMs = 560;
export const infiniteRoundFlipPrepMs = 300;
export const infiniteRoundFlipDurationMs = 1150;
export const infiniteRoundResetDelayMs = 4000;

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
