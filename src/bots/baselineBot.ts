/**
 * Baseline legal-play bot, not a strong Mahjong AI.
 *
 * This strategy is intentionally shallow: it wins when possible, declares
 * available kongs, picks discards with a shanten-ish hand-shape heuristic,
 * considers live waits and visible tile exhaustion, and makes only simple
 * chow/pong/kong claim decisions. It does not score Taiwanese tai/fan, model
 * opponents, read discard danger, search future draws, optimize seat/dealer
 * context, or adapt to house-rule variants.
 */
import type { BotContext, LegalAction } from "../sim/actions";
import { analyzeHand, evaluateDiscard } from "../sim/handAnalysis";
import type { TileInstance } from "../sim/tiles";
import { isFlower, tileKey } from "../sim/tiles";
import type { MahjongBot } from "./types";

export function createBaselineBot(name = "Baseline Bot"): MahjongBot {
  return {
    name,
    chooseAction(context) {
      const win = context.legalActions.find(
        (action) => action.type === "claim" && action.claim === "win",
      );
      if (win) {
        return win;
      }

      const concealedKong = context.legalActions.find(
        (action): action is Extract<LegalAction, { type: "declareKong" }> =>
          action.type === "declareKong",
      );
      if (concealedKong) {
        return concealedKong;
      }

      const discardActions = context.legalActions.filter(
        (action): action is Extract<LegalAction, { type: "discard" }> =>
          action.type === "discard",
      );
      if (discardActions.length > 0) {
        const discard = chooseDiscard(context);
        return (
          discardActions.find((action) => action.tileId === discard.id) ??
          discardActions[0]
        );
      }

      const claim = context.legalActions.find(
        (action): action is Extract<LegalAction, { type: "claim" }> =>
          action.type === "claim" && action.claim !== "win",
      );
      if (claim && claim.claim !== "win" && shouldClaim(context, claim.claim)) {
        return claim;
      }

      return { type: "pass" };
    },
  };
}

export function createBaselineBots(): [
  MahjongBot,
  MahjongBot,
  MahjongBot,
  MahjongBot,
] {
  return [
    createBaselineBot("East Baseline"),
    createBaselineBot("South Baseline"),
    createBaselineBot("West Baseline"),
    createBaselineBot("North Baseline"),
  ];
}

function chooseDiscard(context: BotContext): TileInstance {
  const hand = context.hand;
  const candidates = hand.filter((tile) => !isFlower(tile));
  const visibleCounts = new Map<string, number>();
  for (const tile of context.visibleTiles) {
    visibleCounts.set(
      tileKey(tile.kind),
      (visibleCounts.get(tileKey(tile.kind)) ?? 0) + 1,
    );
  }

  const scores = new Map(
    candidates.map((tile) => [
      tile.id,
      {
        analysis: evaluateDiscard(
          hand,
          context.melds,
          context.visibleTiles,
          tile,
        ),
        usefulness: tileUsefulness(tile, candidates, visibleCounts),
      },
    ]),
  );

  return [...candidates].sort((left, right) => {
    const leftScore = scores.get(left.id);
    const rightScore = scores.get(right.id);
    if (!leftScore || !rightScore) {
      return left.id.localeCompare(right.id);
    }

    return (
      leftScore.analysis.shanten - rightScore.analysis.shanten ||
      rightScore.analysis.liveWaits - leftScore.analysis.liveWaits ||
      leftScore.usefulness - rightScore.usefulness ||
      left.id.localeCompare(right.id)
    );
  })[0];
}

function shouldClaim(
  context: BotContext,
  claim: "chow" | "pong" | "kong",
): boolean {
  if (claim === "kong") {
    return true;
  }
  const current = analyzeHand(
    context.hand,
    context.melds,
    context.visibleTiles,
  );
  if (claim === "pong") {
    return current.shanten <= 3 && current.liveWaits >= 4;
  }
  return (
    current.shanten <= 2 || (context.wallCount < 50 && current.liveWaits >= 4)
  );
}

function tileUsefulness(
  tile: TileInstance,
  hand: readonly TileInstance[],
  visibleCounts: Map<string, number>,
): number {
  const key = tileKey(tile.kind);
  const matching = hand.filter(
    (candidate) => tileKey(candidate.kind) === key,
  ).length;
  const exhaustedPenalty = (visibleCounts.get(key) ?? 0) >= 4 ? -3 : 0;

  if (tile.kind.category !== "suited") {
    return matching >= 2 ? 8 + exhaustedPenalty : 1 + exhaustedPenalty;
  }

  const suited = tile.kind;
  const neighborScore = [-2, -1, 1, 2].reduce((score, offset) => {
    const rank = suited.rank + offset;
    if (rank < 1 || rank > 9) {
      return score;
    }
    const neighborKey = `${suited.suit[0]}${rank}`;
    const inHand = hand.some(
      (candidate) => tileKey(candidate.kind) === neighborKey,
    );
    const visible = visibleCounts.get(neighborKey) ?? 0;
    return score + (inHand ? 2 : 0) - (visible >= 4 ? 1 : 0);
  }, 0);

  return matching * 4 + neighborScore + exhaustedPenalty;
}
