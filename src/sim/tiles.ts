export type Suit = "characters" | "dots" | "bamboo";
export type Wind = "east" | "south" | "west" | "north";
export type Dragon = "red" | "green" | "white";
export type FlowerGroup = "flower" | "season";

export type SuitedTileKind = {
  category: "suited";
  suit: Suit;
  rank: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
};

export type WindTileKind = {
  category: "wind";
  wind: Wind;
};

export type DragonTileKind = {
  category: "dragon";
  dragon: Dragon;
};

export type FlowerTileKind = {
  category: "flower";
  group: FlowerGroup;
  rank: 1 | 2 | 3 | 4;
};

export type TileKind =
  | SuitedTileKind
  | WindTileKind
  | DragonTileKind
  | FlowerTileKind;

export type TileInstance = {
  id: string;
  kind: TileKind;
};

const suits: Suit[] = ["characters", "dots", "bamboo"];
const winds: Wind[] = ["east", "south", "west", "north"];
const dragons: Dragon[] = ["red", "green", "white"];
const flowerGroups: FlowerGroup[] = ["flower", "season"];

export function createTileSet(): TileInstance[] {
  const tiles: TileInstance[] = [];

  for (const suit of suits) {
    for (let rank = 1; rank <= 9; rank += 1) {
      for (let copy = 0; copy < 4; copy += 1) {
        const kind: SuitedTileKind = {
          category: "suited",
          suit,
          rank: rank as SuitedTileKind["rank"],
        };
        tiles.push({ id: `${tileKey(kind)}-${copy}`, kind });
      }
    }
  }

  for (const wind of winds) {
    for (let copy = 0; copy < 4; copy += 1) {
      const kind: WindTileKind = { category: "wind", wind };
      tiles.push({ id: `${tileKey(kind)}-${copy}`, kind });
    }
  }

  for (const dragon of dragons) {
    for (let copy = 0; copy < 4; copy += 1) {
      const kind: DragonTileKind = { category: "dragon", dragon };
      tiles.push({ id: `${tileKey(kind)}-${copy}`, kind });
    }
  }

  for (const group of flowerGroups) {
    for (let rank = 1; rank <= 4; rank += 1) {
      const kind: FlowerTileKind = {
        category: "flower",
        group,
        rank: rank as FlowerTileKind["rank"],
      };
      tiles.push({ id: `${tileKey(kind)}-0`, kind });
    }
  }

  return tiles;
}

export function tileKey(kind: TileKind): string {
  switch (kind.category) {
    case "suited":
      return `${kind.suit[0]}${kind.rank}`;
    case "wind":
      return `wind-${kind.wind}`;
    case "dragon":
      return `dragon-${kind.dragon}`;
    case "flower":
      return `${kind.group}-${kind.rank}`;
  }
}

export function tileLabel(tile: TileInstance): string {
  return tileKey(tile.kind);
}

export function isFlower(tile: TileInstance): boolean {
  return tile.kind.category === "flower";
}

export function sortTiles(tiles: readonly TileInstance[]): TileInstance[] {
  return [...tiles].sort(
    (left, right) =>
      tileKey(left.kind).localeCompare(tileKey(right.kind)) ||
      left.id.localeCompare(right.id),
  );
}
