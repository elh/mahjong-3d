import { createBaselineBots } from "../bots/baselineBot";
import type { SimulateRoundResult } from "./engine";
import { simulateRound, simulateTestScenarioRound } from "./engine";
import { isTestScenarioSeed } from "./testScenarios";

export function simulateRoundForSeed(seed: string): SimulateRoundResult {
  return isTestScenarioSeed(seed)
    ? simulateTestScenarioRound(seed)
    : simulateRound({
        seed,
        bots: createBaselineBots(),
      });
}
