import type { TileInstance, TileKind } from "../sim/tiles";
import { tileLabel } from "../sim/tiles";

export function tileImage(tile: TileInstance): string {
  return `/tiles/${tileImageName(tile.kind)}`;
}

export function tileAlt(tile: TileInstance): string {
  return tileLabel(tile);
}

function tileImageName(kind: TileKind): string {
  switch (kind.category) {
    case "suited":
      return `${suitedTileDir(kind.suit)}/${padRank(kind.rank)}.svg`;
    case "wind":
      return `wind/${windTileNumber(kind.wind)}.svg`;
    case "dragon":
      return `dragon/${dragonTileNumber(kind.dragon)}.svg`;
    case "flower":
      return `${kind.group}/${padRank(kind.rank)}.svg`;
  }
}

function suitedTileDir(suit: string): string {
  switch (suit) {
    case "characters":
      return "character";
    case "dots":
      return "dot";
    case "bamboo":
      return "bamboo";
    default:
      return "character";
  }
}

function windTileNumber(wind: string): string {
  switch (wind) {
    case "east":
      return "01";
    case "south":
      return "02";
    case "west":
      return "03";
    case "north":
      return "04";
    default:
      return "01";
  }
}

function dragonTileNumber(dragon: string): string {
  switch (dragon) {
    case "red":
      return "01";
    case "green":
      return "02";
    case "white":
      return "03";
    default:
      return "01";
  }
}

function padRank(rank: number): string {
  return String(rank).padStart(2, "0");
}
