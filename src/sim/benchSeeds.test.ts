import { describe, expect, test } from "bun:test";
import {
  benchSeedCases,
  defaultBenchSweepCount,
  deterministicBenchSweepSeeds,
} from "./benchSeeds";

describe("benchmark seeds", () => {
  test("keeps a stable named corpus", () => {
    expect(benchSeedCases.map((seedCase) => seedCase.label)).toEqual([
      "short",
      "long",
      "kong",
      "flowers",
      "draw",
      "win",
    ]);
    expect(new Set(benchSeedCases.map((seedCase) => seedCase.seed)).size).toBe(
      benchSeedCases.length,
    );
  });

  test("creates deterministic sweep seeds", () => {
    expect(deterministicBenchSweepSeeds(3)).toEqual([
      "bench-0000",
      "bench-0001",
      "bench-0002",
    ]);
  });

  test("defaults to a compact timing sweep", () => {
    expect(defaultBenchSweepCount).toBe(25);
    expect(deterministicBenchSweepSeeds()).toHaveLength(25);
  });
});
