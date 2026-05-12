export const infiniteRoundHoldMs = 5000;
export const infiniteRoundFadeMs = 700;
export const infiniteRoundSwapMs = 180;

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
