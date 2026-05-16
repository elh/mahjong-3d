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
import type { Meld } from "../sim/state";
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

      const claim = chooseClaim(context);
      if (claim) {
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
  const handCounts = countTileKeys(candidates);

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
        discardability: tileDiscardability(tile, visibleCounts, handCounts),
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
      rightScore.discardability - leftScore.discardability ||
      leftScore.usefulness - rightScore.usefulness ||
      left.id.localeCompare(right.id)
    );
  })[0];
}

function chooseClaim(
  context: BotContext,
): Extract<LegalAction, { type: "claim" }> | undefined {
  const current = analyzeHand(
    context.hand,
    context.melds,
    context.visibleTiles,
  );

  const claims = context.legalActions
    .filter(
      (action): action is Extract<LegalAction, { type: "claim" }> =>
        action.type === "claim" && action.claim !== "win",
    )
    .map((action) => ({ action, projected: projectClaim(context, action) }))
    .filter(hasProjectedClaim)
    .filter(({ action, projected }) => shouldClaim(action, projected));

  return claims.sort(
    (left, right) =>
      left.projected.analysis.shanten - right.projected.analysis.shanten ||
      right.projected.analysis.liveWaits - left.projected.analysis.liveWaits ||
      claimValue(right.action.claim) - claimValue(left.action.claim) ||
      claimTieBreak(left.action).localeCompare(claimTieBreak(right.action)),
  )[0]?.action;

  function shouldClaim(
    action: Extract<LegalAction, { type: "claim" }>,
    projected: ClaimProjection,
  ): boolean {
    if (projected.analysis.shanten > current.shanten) {
      return false;
    }
    if (
      projected.analysis.shanten === current.shanten &&
      projected.analysis.liveWaits < current.liveWaits
    ) {
      return false;
    }
    if (action.claim === "kong") {
      return true;
    }
    if (action.claim === "pong") {
      return (
        projected.analysis.shanten <= 3 && projected.analysis.liveWaits >= 4
      );
    }
    return (
      projected.analysis.shanten <= 2 ||
      (context.wallCount < 50 && projected.analysis.liveWaits >= 4)
    );
  }
}

type ClaimProjection = {
  analysis: ReturnType<typeof analyzeHand>;
};

function hasProjectedClaim(claim: {
  action: Extract<LegalAction, { type: "claim" }>;
  projected: ClaimProjection | undefined;
}): claim is {
  action: Extract<LegalAction, { type: "claim" }>;
  projected: ClaimProjection;
} {
  return Boolean(claim.projected);
}

function projectClaim(
  context: BotContext,
  action: Extract<LegalAction, { type: "claim" }>,
): ClaimProjection | undefined {
  const claimed = context.visibleTiles.find(
    (tile) => tile.id === action.tileId,
  );
  if (!claimed || action.claim === "win") {
    return undefined;
  }

  const consumed = consumedTilesForClaim(context.hand, action, claimed);
  if (!consumed) {
    return undefined;
  }

  const consumedIds = new Set(consumed.map((tile) => tile.id));
  const hand = context.hand.filter((tile) => !consumedIds.has(tile.id));
  const melds: Meld[] = [
    ...context.melds,
    {
      type: action.claim,
      tiles: [...consumed, claimed],
    },
  ];

  return {
    analysis: analyzeHand(hand, melds, [...context.visibleTiles, ...consumed]),
  };
}

function consumedTilesForClaim(
  hand: readonly TileInstance[],
  action: Extract<LegalAction, { type: "claim" }>,
  claimed: TileInstance,
): TileInstance[] | undefined {
  if (action.claim === "chow") {
    const ids = action.consumedTileIds;
    if (!ids) {
      return undefined;
    }
    const consumed = ids
      .map((id) => hand.find((tile) => tile.id === id))
      .filter((tile): tile is TileInstance => Boolean(tile));
    return consumed.length === 2 ? consumed : undefined;
  }

  const count = action.claim === "kong" ? 3 : 2;
  const consumed = hand
    .filter((tile) => tileKey(tile.kind) === tileKey(claimed.kind))
    .slice(0, count);
  return consumed.length === count ? consumed : undefined;
}

function claimValue(claim: "chow" | "pong" | "kong" | "win"): number {
  switch (claim) {
    case "kong":
      return 3;
    case "pong":
      return 2;
    case "chow":
      return 1;
    case "win":
      return 4;
  }
}

function claimTieBreak(
  action: Extract<LegalAction, { type: "claim" }>,
): string {
  return (
    action.consumedTileIds?.join("|") ?? `${action.claim}|${action.tileId}`
  );
}

function countTileKeys(tiles: readonly TileInstance[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tile of tiles) {
    const key = tileKey(tile.kind);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function tileDiscardability(
  tile: TileInstance,
  visibleCounts: Map<string, number>,
  handCounts: Map<string, number>,
): number {
  const key = tileKey(tile.kind);
  const matching = handCounts.get(key) ?? 0;
  let score = 0;

  if (matching >= 4) {
    score += 7;
  } else if (matching === 3) {
    score -= 6;
  } else if (matching === 2) {
    score -= 4;
  }

  if (tile.kind.category !== "suited") {
    return score + (matching === 1 ? 6 : 0);
  }

  const { rank, suit } = tile.kind;
  const directSupport = [-1, 1].filter((offset) =>
    hasLiveNeighbor(handCounts, visibleCounts, `${suit[0]}${rank + offset}`),
  ).length;
  const nearSupport = [-2, 2].filter((offset) =>
    hasLiveNeighbor(handCounts, visibleCounts, `${suit[0]}${rank + offset}`),
  ).length;

  if (directSupport + nearSupport === 0) {
    score += rank === 1 || rank === 9 ? 5 : 3;
  } else if ((rank === 1 || rank === 9) && directSupport === 0) {
    score += 2;
  }

  return score + exhaustedNeighborCount(tile, handCounts, visibleCounts);
}

function hasLiveNeighbor(
  handCounts: Map<string, number>,
  visibleCounts: Map<string, number>,
  key: string,
): boolean {
  const handCount = handCounts.get(key) ?? 0;
  if (handCount === 0) {
    return false;
  }
  return handCount + (visibleCounts.get(key) ?? 0) < 4;
}

function exhaustedNeighborCount(
  tile: TileInstance,
  handCounts: Map<string, number>,
  visibleCounts: Map<string, number>,
): number {
  if (tile.kind.category !== "suited") {
    return 0;
  }
  const suited = tile.kind;
  return [-2, -1, 1, 2].filter((offset) => {
    const rank = suited.rank + offset;
    if (rank < 1 || rank > 9) {
      return false;
    }
    const key = `${suited.suit[0]}${rank}`;
    const handCount = handCounts.get(key) ?? 0;
    return handCount > 0 && handCount + (visibleCounts.get(key) ?? 0) >= 4;
  }).length;
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
