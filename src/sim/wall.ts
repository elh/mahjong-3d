import { createSeededRng, shuffle } from "./rng";
import type { PlayerId } from "./state";
import type { TileInstance } from "./tiles";
import { createTileSet } from "./tiles";

export const wallSideStacks = 18;
export const wallStackCount = wallSideStacks * 4;
export const deadWallTileCount = 16;

export type WallBreak = {
  dice: [number, number, number];
  diceTotal: number;
  wallOwner: PlayerId;
  cutStack: number;
};

export type WallState = {
  wall: TileInstance[];
  deadWall: TileInstance[];
  wallBreak: WallBreak;
};

type DrawableWallState = {
  wall: TileInstance[];
  deadWall: TileInstance[];
};

type WallStack = [TileInstance, TileInstance];

export function createShuffledWalls(
  seed: string,
  dealer: PlayerId = 0,
  dice?: [number, number, number],
): WallState {
  const shuffledTiles = shuffle(createTileSet(), createSeededRng(seed));
  const wallBreak = createWallBreak(seed, dealer, dice);
  const stacks = createPhysicalWallStacks(shuffledTiles);
  const liveStackIndexes = liveStackIndexesFromBreak(wallBreak);
  const deadStackIndexes = deadStackIndexesFromBreak(wallBreak);

  return {
    wall: liveStackIndexes.flatMap((stackIndex) =>
      stackDrawOrder(stacks[stackIndex]),
    ),
    deadWall: deadStackIndexes.flatMap((stackIndex) =>
      stackDrawOrder(stacks[stackIndex]),
    ),
    wallBreak,
  };
}

export function createWallBreak(
  seed: string,
  dealer: PlayerId = 0,
  forcedDice?: [number, number, number],
): WallBreak {
  const rng = createSeededRng(`${seed}:wall-break`);
  const dice: [number, number, number] = forcedDice ?? [
    rollDie(rng),
    rollDie(rng),
    rollDie(rng),
  ];
  if (dice.some((die) => !Number.isInteger(die) || die < 1 || die > 6)) {
    throw new Error("Wall break dice must be three integers from 1 to 6.");
  }
  const diceTotal = dice[0] + dice[1] + dice[2];
  const wallOwner = ((dealer + diceTotal - 1) % 4) as PlayerId;
  const countedStack = diceTotal % wallSideStacks;
  const cutStack = wallOwner * wallSideStacks + countedStack;

  return { dice, diceTotal, wallOwner, cutStack };
}

export function physicalWallSlotMap(seed: string): Map<string, number> {
  const shuffledTiles = shuffle(createTileSet(), createSeededRng(seed));
  const slots = new Map<string, number>();
  for (const [stackIndex, stack] of createPhysicalWallStacks(
    shuffledTiles,
  ).entries()) {
    slots.set(stack[0].id, stackIndex);
    slots.set(stack[1].id, stackIndex + wallStackCount);
  }
  return slots;
}

export function drawLiveTile(
  state: DrawableWallState,
): TileInstance | undefined {
  return state.wall.shift();
}

export function drawSupplementTile(
  state: DrawableWallState,
): TileInstance | undefined {
  const tile = state.deadWall.shift();
  if (!tile) {
    return undefined;
  }
  replenishDeadWall(state);
  return tile;
}

export function replenishDeadWall(state: DrawableWallState): void {
  const replenishment = state.wall.pop();
  if (replenishment) {
    state.deadWall.push(replenishment);
  }
}

function rollDie(rng: { next(): number }): number {
  return Math.floor(rng.next() * 6) + 1;
}

function createPhysicalWallStacks(tiles: readonly TileInstance[]): WallStack[] {
  const stacks: WallStack[] = [];
  for (let index = 0; index < tiles.length; index += 2) {
    const bottom = tiles[index];
    const top = tiles[index + 1];
    if (!bottom || !top) {
      throw new Error("Mahjong wall must contain complete two-tile stacks.");
    }
    stacks.push([bottom, top]);
  }
  return stacks;
}

function liveStackIndexesFromBreak(wallBreak: WallBreak): number[] {
  const firstLiveStack = previousStack(wallBreak.cutStack);
  return Array.from(
    { length: wallStackCount - deadWallTileCount / 2 },
    (_, index) => wrapStack(firstLiveStack - index),
  );
}

function deadStackIndexesFromBreak(wallBreak: WallBreak): number[] {
  return Array.from({ length: deadWallTileCount / 2 }, (_, index) =>
    wrapStack(wallBreak.cutStack + index),
  );
}

function stackDrawOrder(stack: WallStack): TileInstance[] {
  return [stack[1], stack[0]];
}

function previousStack(stackIndex: number): number {
  return wrapStack(stackIndex - 1);
}

function wrapStack(stackIndex: number): number {
  return (stackIndex + wallStackCount) % wallStackCount;
}
