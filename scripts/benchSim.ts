import { createBaselineBots } from "../src/bots/baselineBot";
import {
  benchSeedCases,
  deterministicBenchSweepSeeds,
} from "../src/sim/benchSeeds";
import { simulateRound } from "../src/sim/engine";
import type { GameEvent } from "../src/sim/events";

type RoundMeasurement = {
  seed: string;
  durationMs: number;
  eventCount: number;
  terminalOutcome: TerminalOutcome;
  rulesErrorCount: number;
};

type TerminalOutcome = "win" | "draw" | "turnLimit" | "rulesError" | "unknown";

const sweepCount = parseSweepCount(Bun.argv);
const seeds = [
  ...benchSeedCases.map((seedCase) => seedCase.seed),
  ...deterministicBenchSweepSeeds(sweepCount),
];
const measurements = seeds.map(measureRound);
const totalMs = measurements.reduce(
  (total, measurement) => total + measurement.durationMs,
  0,
);

printSummary(measurements, totalMs);

function measureRound(seed: string): RoundMeasurement {
  const startedAt = performance.now();
  const result = simulateRound({
    seed,
    bots: createBaselineBots(),
  });
  const durationMs = performance.now() - startedAt;
  const rulesErrorCount = result.events.filter(
    (event) => event.type === "rulesError",
  ).length;

  return {
    seed,
    durationMs,
    eventCount: result.events.length,
    terminalOutcome:
      rulesErrorCount > 0
        ? "rulesError"
        : terminalOutcome(result.events[result.events.length - 1]),
    rulesErrorCount,
  };
}

function terminalOutcome(event: GameEvent | undefined): TerminalOutcome {
  if (!event) {
    return "unknown";
  }
  if (event.type === "winDeclared") {
    return "win";
  }
  if (event.type === "drawDeclared") {
    return event.reason === "turnLimit" ? "turnLimit" : "draw";
  }
  if (event.type === "rulesError") {
    return "rulesError";
  }
  return "unknown";
}

function printSummary(
  measurements: readonly RoundMeasurement[],
  totalMs: number,
) {
  const durations = measurements.map((measurement) => measurement.durationMs);
  const eventCounts = measurements.map((measurement) => measurement.eventCount);
  const outcomes = countBy(measurements, (measurement) =>
    measurement.terminalOutcome.toString(),
  );

  console.log("Simulation benchmark");
  console.log(`Rounds: ${measurements.length}`);
  console.log(`Total: ${formatMs(totalMs)}`);
  console.log(
    `Throughput: ${formatNumber((measurements.length * 1000) / totalMs, 2)} rounds/sec`,
  );
  console.log("");
  console.log("Round duration");
  console.log(`p50: ${formatMs(percentile(durations, 0.5))}`);
  console.log(`p95: ${formatMs(percentile(durations, 0.95))}`);
  console.log(`p99: ${formatMs(percentile(durations, 0.99))}`);
  console.log("");
  console.log("Event count");
  console.log(`min: ${Math.min(...eventCounts)}`);
  console.log(`p50: ${formatNumber(percentile(eventCounts, 0.5), 0)}`);
  console.log(`p95: ${formatNumber(percentile(eventCounts, 0.95), 0)}`);
  console.log(`max: ${Math.max(...eventCounts)}`);
  console.log("");
  console.log("Terminal outcomes");
  for (const outcome of ["win", "draw", "turnLimit", "rulesError", "unknown"]) {
    console.log(`${outcome}: ${outcomes.get(outcome) ?? 0}`);
  }
  console.log("");
  console.log("Slowest rounds");
  for (const measurement of [...measurements]
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, 8)) {
    console.log(
      `${measurement.seed}: ${formatMs(measurement.durationMs)} (${measurement.eventCount} events, ${measurement.terminalOutcome})`,
    );
  }
}

function parseSweepCount(argv: readonly string[]): number {
  const sweepArg = argv.find((arg) => arg.startsWith("--sweep="));
  if (!sweepArg) {
    return 1000;
  }
  const value = Number(sweepArg.slice("--sweep=".length));
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("--sweep must be a non-negative integer.");
  }
  return value;
}

function countBy<T>(
  values: readonly T[],
  keyForValue: (value: T) => string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = keyForValue(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function percentile(values: readonly number[], rank: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * rank) - 1),
  );
  return sorted[index];
}

function formatMs(value: number): string {
  return `${formatNumber(value, 2)} ms`;
}

function formatNumber(value: number, maximumFractionDigits: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
    minimumFractionDigits: maximumFractionDigits,
  }).format(value);
}
