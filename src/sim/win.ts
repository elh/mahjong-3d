import type { Meld } from "./state";
import type { TileInstance } from "./tiles";
import { tileKey } from "./tiles";

export function isWinningHand(
  hand: readonly TileInstance[],
  melds: readonly Meld[] = [],
): boolean {
  if (melds.length === 0 && isSevenPairsAndTriplet(hand)) {
    return true;
  }

  const neededGroups = 5 - melds.length;
  if (neededGroups < 0) {
    return false;
  }

  const keys = hand.map((tile) => tileKey(tile.kind)).sort();
  if (keys.length !== neededGroups * 3 + 2) {
    return false;
  }

  const counts = countKeys(keys);
  for (const [key, count] of counts) {
    if (count < 2) {
      continue;
    }
    counts.set(key, count - 2);
    if (canMakeGroups(counts, neededGroups)) {
      counts.set(key, count);
      return true;
    }
    counts.set(key, count);
  }

  return false;
}

export function isSevenPairsAndTriplet(hand: readonly TileInstance[]): boolean {
  if (hand.length !== 17) {
    return false;
  }

  const counts = countKeys(hand.map((tile) => tileKey(tile.kind)));
  const values = [...counts.values()].sort((left, right) => left - right);
  return (
    values.length === 8 &&
    values.filter((count) => count === 2).length === 7 &&
    values.filter((count) => count === 3).length === 1
  );
}

function canMakeGroups(
  counts: Map<string, number>,
  groupsRemaining: number,
): boolean {
  if (groupsRemaining === 0) {
    return [...counts.values()].every((count) => count === 0);
  }

  const key = firstRemainingKey(counts);
  if (!key) {
    return false;
  }

  const count = counts.get(key) ?? 0;
  if (count >= 3) {
    counts.set(key, count - 3);
    if (canMakeGroups(counts, groupsRemaining - 1)) {
      counts.set(key, count);
      return true;
    }
    counts.set(key, count);
  }

  const suited = parseSuitedKey(key);
  if (suited && suited.rank <= 7) {
    const second = `${suited.suit}${suited.rank + 1}`;
    const third = `${suited.suit}${suited.rank + 2}`;
    if ((counts.get(second) ?? 0) > 0 && (counts.get(third) ?? 0) > 0) {
      decrement(counts, key);
      decrement(counts, second);
      decrement(counts, third);
      if (canMakeGroups(counts, groupsRemaining - 1)) {
        increment(counts, key);
        increment(counts, second);
        increment(counts, third);
        return true;
      }
      increment(counts, key);
      increment(counts, second);
      increment(counts, third);
    }
  }

  return false;
}

function countKeys(keys: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function firstRemainingKey(counts: Map<string, number>): string | undefined {
  return [...counts.keys()].sort().find((key) => (counts.get(key) ?? 0) > 0);
}

function parseSuitedKey(
  key: string,
): { suit: "c" | "d" | "b"; rank: number } | null {
  const match = /^(c|d|b)([1-9])$/.exec(key);
  if (!match) {
    return null;
  }
  return { suit: match[1] as "c" | "d" | "b", rank: Number(match[2]) };
}

function decrement(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) - 1);
}

function increment(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}
