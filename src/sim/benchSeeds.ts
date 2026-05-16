export type BenchSeedCase = {
  label: string;
  seed: string;
  intent: string;
};

export const benchSeedCases = [
  {
    label: "short",
    seed: "bench-short",
    intent: "Small fixed corpus case for quick generation checks.",
  },
  {
    label: "long",
    seed: "bench-scan-0314",
    intent: "Fixed corpus case expected to exercise a fuller event log.",
  },
  {
    label: "kong",
    seed: "bench-scan-0149",
    intent: "Fixed corpus case kept for kong-heavy regression comparisons.",
  },
  {
    label: "flowers",
    seed: "bench-scan-0147",
    intent: "Fixed corpus case kept for flower replacement comparisons.",
  },
  {
    label: "draw",
    seed: "bench-scan-0297",
    intent: "Fixed corpus case kept for drawn-round comparisons.",
  },
  {
    label: "win",
    seed: "bench-win",
    intent: "Fixed corpus case kept for winning-round comparisons.",
  },
] as const satisfies readonly BenchSeedCase[];

export const defaultBenchSweepCount = 25;

export function deterministicBenchSweepSeeds(
  count = defaultBenchSweepCount,
): string[] {
  return Array.from(
    { length: count },
    (_, index) => `bench-${index.toString().padStart(4, "0")}`,
  );
}
