import type { Meld } from "./state";
import type { TileInstance } from "./tiles";
import { createTileSet, isFlower, tileKey } from "./tiles";
import { isWinningHand } from "./win";

export type HandAnalysis = {
  shanten: number;
  waitKeys: string[];
  liveWaits: number;
};

type Shape = {
  completeSets: number;
  partialSets: number;
  hasPair: boolean;
};

const allNonFlowerTiles = createTileSet().filter((tile) => !isFlower(tile));
const allTileKeys = Array.from(
  new Set(allNonFlowerTiles.map((tile) => tileKey(tile.kind))),
).sort();
const representativeTileByKey = new Map(
  allNonFlowerTiles.map((tile) => [tileKey(tile.kind), tile]),
);

export function analyzeHand(
  hand: readonly TileInstance[],
  melds: readonly Meld[],
  visibleTiles: readonly TileInstance[],
): HandAnalysis {
  const concealed = hand.filter((tile) => !isFlower(tile));
  const visibleCounts = countVisibleTiles(visibleTiles, concealed);
  const baseDistance = estimateShanten(concealed, melds);
  const waitKeys = allTileKeys.filter((key) => {
    if ((visibleCounts.get(key) ?? 0) >= 4) {
      return false;
    }
    const candidate = representativeTileByKey.get(key);
    return candidate
      ? estimateShanten([...concealed, candidate], melds) < baseDistance
      : false;
  });

  return {
    shanten: baseDistance,
    waitKeys,
    liveWaits: waitKeys.reduce(
      (total, key) => total + Math.max(0, 4 - (visibleCounts.get(key) ?? 0)),
      0,
    ),
  };
}

export function evaluateDiscard(
  hand: readonly TileInstance[],
  melds: readonly Meld[],
  visibleTiles: readonly TileInstance[],
  discard: TileInstance,
): HandAnalysis {
  return analyzeHand(
    hand.filter((tile) => tile.id !== discard.id),
    melds,
    [...visibleTiles, discard],
  );
}

export function estimateShanten(
  hand: readonly TileInstance[],
  melds: readonly Meld[] = [],
): number {
  const concealed = hand.filter((tile) => !isFlower(tile));
  if (isWinningHand(concealed, melds)) {
    return -1;
  }

  const requiredSets = Math.max(0, 5 - melds.length);
  const baseCounts = countKeys(concealed.map((tile) => tileKey(tile.kind)));
  const shapes = [greedyShape(new Map(baseCounts), requiredSets, false)];

  for (const [key, count] of baseCounts) {
    if (count < 2) {
      continue;
    }
    const counts = new Map(baseCounts);
    decrement(counts, key, 2);
    shapes.push(greedyShape(counts, requiredSets, true));
  }

  const best = shapes.sort((left, right) => shapeScore(right) - shapeScore(left))[0];
  return Math.max(
    0,
    requiredSets * 2 -
      best.completeSets * 2 -
      best.partialSets -
      (best.hasPair ? 1 : 0),
  );
}

function greedyShape(
  counts: Map<string, number>,
  requiredSets: number,
  hasPair: boolean,
): Shape {
  let completeSets = 0;
  let partialSets = 0;

  for (const key of sortedKeys(counts)) {
    while ((counts.get(key) ?? 0) >= 3 && completeSets < requiredSets) {
      decrement(counts, key, 3);
      completeSets += 1;
    }
  }

  for (const suit of ["b", "c", "d"]) {
    for (let rank = 1; rank <= 7; rank += 1) {
      const first = `${suit}${rank}`;
      const second = `${suit}${rank + 1}`;
      const third = `${suit}${rank + 2}`;
      while (
        (counts.get(first) ?? 0) > 0 &&
        (counts.get(second) ?? 0) > 0 &&
        (counts.get(third) ?? 0) > 0 &&
        completeSets < requiredSets
      ) {
        decrement(counts, first, 1);
        decrement(counts, second, 1);
        decrement(counts, third, 1);
        completeSets += 1;
      }
    }
  }

  const maxPartials = Math.max(0, requiredSets - completeSets);
  for (const key of sortedKeys(counts)) {
    while ((counts.get(key) ?? 0) >= 2 && partialSets < maxPartials) {
      decrement(counts, key, 2);
      partialSets += 1;
    }
  }

  for (const suit of ["b", "c", "d"]) {
    for (let rank = 1; rank <= 8; rank += 1) {
      const first = `${suit}${rank}`;
      for (const second of [`${suit}${rank + 1}`, `${suit}${rank + 2}`]) {
        const secondRank = Number(second.slice(1));
        if (secondRank > 9) {
          continue;
        }
        while (
          (counts.get(first) ?? 0) > 0 &&
          (counts.get(second) ?? 0) > 0 &&
          partialSets < maxPartials
        ) {
          decrement(counts, first, 1);
          decrement(counts, second, 1);
          partialSets += 1;
        }
      }
    }
  }

  return { completeSets, partialSets, hasPair };
}

function shapeScore(shape: Shape): number {
  return shape.completeSets * 100 + shape.partialSets * 10 + (shape.hasPair ? 1 : 0);
}

function countVisibleTiles(
  visibleTiles: readonly TileInstance[],
  hand: readonly TileInstance[],
): Map<string, number> {
  return countKeys([...visibleTiles, ...hand].map((tile) => tileKey(tile.kind)));
}

function countKeys(keys: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function sortedKeys(counts: Map<string, number>): string[] {
  return [...counts.keys()].sort();
}

function decrement(counts: Map<string, number>, key: string, amount: number): void {
  counts.set(key, (counts.get(key) ?? 0) - amount);
}
