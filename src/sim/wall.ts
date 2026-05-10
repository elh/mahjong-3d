import { createSeededRng, shuffle } from "./rng";
import type { TileInstance } from "./tiles";
import { createTileSet } from "./tiles";

export type WallState = {
  wall: TileInstance[];
  deadWall: TileInstance[];
};

export function createShuffledWalls(seed: string): WallState {
  const shuffledTiles = shuffle(createTileSet(), createSeededRng(seed));
  return {
    wall: shuffledTiles.slice(0, -16),
    deadWall: shuffledTiles.slice(-16),
  };
}

export function drawLiveTile(state: WallState): TileInstance | undefined {
  return state.wall.shift();
}

export function drawSupplementTile(state: WallState): TileInstance | undefined {
  const tile = state.deadWall.shift();
  if (!tile) {
    return undefined;
  }
  replenishDeadWall(state);
  return tile;
}

export function replenishDeadWall(state: WallState): void {
  const replenishment = state.wall.pop();
  if (replenishment) {
    state.deadWall.push(replenishment);
  }
}
