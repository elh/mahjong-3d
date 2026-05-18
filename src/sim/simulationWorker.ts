import type { SimulateRoundResult } from "./engine";
import { simulateRoundForSeed } from "./runSimulation";

export type SimulationRequest = {
  requestId: number;
  seed: string;
};

export type SimulationResponse =
  | {
      requestId: number;
      status: "complete";
      result: SimulateRoundResult;
    }
  | {
      requestId: number;
      status: "error";
      message: string;
    };

self.onmessage = (event: MessageEvent<SimulationRequest>) => {
  const { requestId, seed } = event.data;
  try {
    const result = simulateRoundForSeed(seed);
    self.postMessage({
      requestId,
      status: "complete",
      result,
    } satisfies SimulationResponse);
  } catch (error) {
    self.postMessage({
      requestId,
      status: "error",
      message: error instanceof Error ? error.message : "Simulation failed.",
    } satisfies SimulationResponse);
  }
};
