import { describe, expect, test } from "bun:test";
import {
  infiniteRoundHoldMs,
  nextRoundPromotionDelayMs,
} from "./infinitePlayback";

describe("infinite playback timing", () => {
  test("waits for the hold duration when next round generation is fast", () => {
    expect(
      nextRoundPromotionDelayMs({
        isAtRoundEnd: true,
        hasQueuedNextRound: true,
        isDocumentHidden: false,
        terminalReachedAt: 1000,
        now: 1200,
      }),
    ).toBe(infiniteRoundHoldMs - 200);
  });

  test("promotes immediately when next round generation finishes after the hold", () => {
    expect(
      nextRoundPromotionDelayMs({
        isAtRoundEnd: true,
        hasQueuedNextRound: true,
        isDocumentHidden: false,
        terminalReachedAt: 1000,
        now: 1000 + infiniteRoundHoldMs + 1,
      }),
    ).toBe(0);
  });

  test("does not promote before a terminal round has a queued replacement", () => {
    expect(
      nextRoundPromotionDelayMs({
        isAtRoundEnd: true,
        hasQueuedNextRound: false,
        isDocumentHidden: false,
        terminalReachedAt: 1000,
        now: 1000 + infiniteRoundHoldMs + 1,
      }),
    ).toBeUndefined();
  });

  test("does not promote while the document is hidden", () => {
    expect(
      nextRoundPromotionDelayMs({
        isAtRoundEnd: true,
        hasQueuedNextRound: true,
        isDocumentHidden: true,
        terminalReachedAt: 1000,
        now: 1000 + infiniteRoundHoldMs + 1,
      }),
    ).toBeUndefined();
  });
});
