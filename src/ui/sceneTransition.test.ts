import { describe, expect, test } from "bun:test";
import {
  sceneTransitionFadeMs,
  sceneTransitionSample,
} from "./sceneTransition";

describe("scene transition timing", () => {
  test("keeps the starting opacity at the first frame", () => {
    expect(
      sceneTransitionSample({
        startOpacity: 1,
        targetOpacity: 0,
        elapsedMs: 0,
      }),
    ).toEqual({ opacity: 1, complete: false });
  });

  test("interpolates cover and reveal fades in both directions", () => {
    const reveal = sceneTransitionSample({
      startOpacity: 1,
      targetOpacity: 0,
      elapsedMs: sceneTransitionFadeMs / 2,
    });
    const cover = sceneTransitionSample({
      startOpacity: 0,
      targetOpacity: 1,
      elapsedMs: sceneTransitionFadeMs / 2,
    });

    expect(reveal.opacity).toBeCloseTo(0.5);
    expect(cover.opacity).toBeCloseTo(0.5);
    expect(reveal.complete).toBe(false);
    expect(cover.complete).toBe(false);
  });

  test("clamps at the target and reports completion", () => {
    expect(
      sceneTransitionSample({
        startOpacity: 0.72,
        targetOpacity: 0,
        elapsedMs: sceneTransitionFadeMs + 100,
      }),
    ).toEqual({ opacity: 0, complete: true });
  });

  test("supports immediate transitions", () => {
    expect(
      sceneTransitionSample({
        startOpacity: 0,
        targetOpacity: 1,
        elapsedMs: 0,
        durationMs: 0,
      }),
    ).toEqual({ opacity: 1, complete: true });
  });
});
