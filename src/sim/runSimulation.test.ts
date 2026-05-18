import { describe, expect, test } from "bun:test";
import { simulateRoundForSeed } from "./runSimulation";

describe("simulateRoundForSeed", () => {
  test("generates a replayable round without the worker", () => {
    const round = simulateRoundForSeed("screensaver-fallback-test");
    expect(round.seed).toBe("screensaver-fallback-test");
    expect(round.events.length).toBeGreaterThan(0);
    expect(round.events.at(-1)?.type).toMatch(/winDeclared|drawDeclared/);
  });
});
