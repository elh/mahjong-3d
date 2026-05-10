import type { TileInstance } from "./tiles";

export function removeTile(
  tiles: TileInstance[],
  tileId: string,
): TileInstance | undefined {
  const index = tiles.findIndex((tile) => tile.id === tileId);
  if (index === -1) {
    return undefined;
  }
  return tiles.splice(index, 1)[0];
}
