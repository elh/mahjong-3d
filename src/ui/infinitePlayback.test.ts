import { describe, expect, test } from "bun:test";
import {
  eventAutoAdvanceMode,
  infiniteRoundHoldMs,
  infiniteRoundSwapMs,
  nextRoundPromotionDelayMs,
} from "./infinitePlayback";
import { sceneTransitionFadeMs } from "./sceneTransition";

describe("infinite playback timing", () => {
  test("keeps the round swap covered until the fade is opaque", () => {
    expect(infiniteRoundSwapMs).toBeGreaterThanOrEqual(sceneTransitionFadeMs);
  });

  test("keeps semantic playback moving with reduced motion", () => {
    expect(
      eventAutoAdvanceMode({
        isPlaybackActive: true,
        isSceneRevealed: true,
        prefersReducedMotion: true,
        isLoadingRound: false,
        hasGenerationError: false,
        eventCount: 10,
      }),
    ).toBe("immediate");
  });

  test("pauses event playback only for runtime blockers", () => {
    const ready = {
      isPlaybackActive: true,
      isSceneRevealed: true,
      prefersReducedMotion: false,
      isLoadingRound: false,
      hasGenerationError: false,
      eventCount: 10,
    };

    expect(eventAutoAdvanceMode(ready)).toBe("animated");
    expect(
      eventAutoAdvanceMode({ ...ready, isPlaybackActive: false }),
    ).toBeUndefined();
    expect(
      eventAutoAdvanceMode({ ...ready, isSceneRevealed: false }),
    ).toBeUndefined();
    expect(
      eventAutoAdvanceMode({ ...ready, isLoadingRound: true }),
    ).toBeUndefined();
    expect(
      eventAutoAdvanceMode({ ...ready, hasGenerationError: true }),
    ).toBeUndefined();
    expect(eventAutoAdvanceMode({ ...ready, eventCount: 0 })).toBeUndefined();
  });

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
