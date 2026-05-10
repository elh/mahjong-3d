import type { ClaimAction } from "./actions";

export function claimPriority(claim: ClaimAction["claim"]): number {
  switch (claim) {
    case "win":
      return 4;
    case "kong":
      return 3;
    case "pong":
      return 2;
    case "chow":
      return 1;
  }
}
