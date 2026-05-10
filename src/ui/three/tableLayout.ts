import type { GameEvent } from "../../sim/events";
import type { ReplayState } from "../../sim/replay";
import type { PlayerId } from "../../sim/state";
import type { TileInstance } from "../../sim/tiles";

export type Vec3 = [number, number, number];

export type TilePlacement = {
  tile: TileInstance;
  owner: "wall" | "deadWall" | "hand" | "meld" | "flower" | "discard";
  player?: PlayerId;
  position: Vec3;
  rotation: Vec3;
  faceUp: boolean;
  physics: boolean;
};

export type ThreeTableLayout = {
  tiles: TilePlacement[];
  animation?: {
    event: Extract<GameEvent, { type: "tileDrawn" | "tileDiscarded" }>;
    from: Vec3;
    to: Vec3;
    rotation: Vec3;
  };
};

export const tileSize = {
  width: 0.22,
  height: 0.15,
  depth: 0.3,
};

const tableY = tileSize.height / 2 + 0.01;
const handRadius = 3.45;
const playerAuxiliaryRadius = handRadius - tileSize.depth - 0.1;
const playerAuxiliaryGap = tileSize.width * 0.5;
const playerAuxiliaryRightInset = 0;
const playerAuxiliaryRightEdge =
  (16 * tileSize.width) / 2 - playerAuxiliaryRightInset;
const discardRadius = 1.12;
const wallSideTiles = 18;
const wallSideLength = tileSize.width * wallSideTiles;
const wallRunRadius = wallSideLength / 2 - tileSize.width / 2;
const wallPerpendicularRadius = wallSideLength / 2 + tileSize.depth / 2;

export function createThreeTableLayout(
  replay: ReplayState,
  currentEvent: GameEvent | undefined,
): ThreeTableLayout {
  const tiles: TilePlacement[] = [
    ...layoutWall(replay.wall, "wall"),
    ...layoutWall(replay.deadWall, "deadWall"),
    ...replay.players.flatMap((player) => [
      ...layoutPlayerArea(
        player.hand,
        player.melds.flatMap((meld) => meld.tiles),
        player.flowers,
        player.id,
      ),
      ...layoutDiscards(player.discards, player.id),
    ]),
  ];

  const animation = currentEventAnimation(tiles, currentEvent);
  return { tiles, animation };
}

export function playerAngle(player: PlayerId): number {
  return player * (Math.PI / 2);
}

export function playerForward(player: PlayerId): Vec3 {
  const angle = playerAngle(player);
  return [Math.sin(angle), 0, Math.cos(angle)];
}

export function playerRight(player: PlayerId): Vec3 {
  const angle = playerAngle(player);
  return [Math.cos(angle), 0, -Math.sin(angle)];
}

export function playerRowPosition(
  player: PlayerId,
  index: number,
  total: number,
  radius: number,
  rowOffset: number,
): Vec3 {
  const right = playerRight(player);
  const forward = playerForward(player);
  const spacing = tileSize.width;
  const centered = (index - (total - 1) / 2) * spacing;
  return [
    forward[0] * radius + right[0] * centered,
    tableY + rowOffset,
    forward[2] * radius + right[2] * centered,
  ];
}

export function playerTileRotation(player: PlayerId): Vec3 {
  return [0, playerAngle(player), 0];
}

export function discardDropPosition(player: PlayerId): Vec3 {
  const forward = playerForward(player);
  return [
    forward[0] * discardRadius,
    tableY + 0.45,
    forward[2] * discardRadius,
  ];
}

function layoutPlayerRow(
  tiles: readonly TileInstance[],
  player: PlayerId,
  owner: TilePlacement["owner"],
  radius: number,
  rowOffset: number,
): TilePlacement[] {
  return tiles.map((tile, index) => ({
    tile,
    owner,
    player,
    position: playerRowPosition(player, index, tiles.length, radius, rowOffset),
    rotation: playerTileRotation(player),
    faceUp: true,
    physics: false,
  }));
}

function layoutPlayerArea(
  hand: readonly TileInstance[],
  melds: readonly TileInstance[],
  flowers: readonly TileInstance[],
  player: PlayerId,
): TilePlacement[] {
  return [
    ...layoutPlayerRow(hand, player, "hand", handRadius, 0),
    ...layoutPlayerAuxiliaryRow(melds, flowers, player),
  ];
}

function layoutPlayerAuxiliaryRow(
  melds: readonly TileInstance[],
  flowers: readonly TileInstance[],
  player: PlayerId,
): TilePlacement[] {
  if (melds.length === 0 && flowers.length === 0) {
    return [];
  }

  const gap = melds.length > 0 && flowers.length > 0 ? playerAuxiliaryGap : 0;
  const auxiliaryWidth = (melds.length + flowers.length) * tileSize.width + gap;
  const leftEdge = playerAuxiliaryRightEdge - auxiliaryWidth;
  const placements: TilePlacement[] = [];

  for (const [index, tile] of melds.entries()) {
    placements.push(
      playerAuxiliaryPlacement(
        tile,
        "meld",
        player,
        leftEdge + tileSize.width / 2 + index * tileSize.width,
      ),
    );
  }

  const flowerLeftEdge = leftEdge + melds.length * tileSize.width + gap;
  for (const [index, tile] of flowers.entries()) {
    placements.push(
      playerAuxiliaryPlacement(
        tile,
        "flower",
        player,
        flowerLeftEdge + tileSize.width / 2 + index * tileSize.width,
      ),
    );
  }

  return placements;
}

function playerAuxiliaryPlacement(
  tile: TileInstance,
  owner: "meld" | "flower",
  player: PlayerId,
  rightOffset: number,
): TilePlacement {
  const right = playerRight(player);
  const forward = playerForward(player);
  return {
    tile,
    owner,
    player,
    position: [
      forward[0] * playerAuxiliaryRadius + right[0] * rightOffset,
      tableY,
      forward[2] * playerAuxiliaryRadius + right[2] * rightOffset,
    ],
    rotation: playerTileRotation(player),
    faceUp: true,
    physics: false,
  };
}

function layoutDiscards(
  tiles: readonly TileInstance[],
  player: PlayerId,
): TilePlacement[] {
  const right = playerRight(player);
  const forward = playerForward(player);
  const columns = 6;
  const columnSpacing = tileSize.width;
  const rowSpacing = tileSize.depth;
  const origin = [
    forward[0] * discardRadius - right[0] * 0.58,
    tableY + 0.02,
    forward[2] * discardRadius - right[2] * 0.58,
  ] satisfies Vec3;

  return tiles.map((tile, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      tile,
      owner: "discard",
      player,
      position: [
        origin[0] +
          right[0] * column * columnSpacing -
          forward[0] * row * rowSpacing,
        origin[1] + index * 0.002,
        origin[2] +
          right[2] * column * columnSpacing -
          forward[2] * row * rowSpacing,
      ],
      rotation: playerTileRotation(player),
      faceUp: true,
      physics: true,
    };
  });
}

function layoutWall(
  tiles: readonly TileInstance[],
  owner: "wall" | "deadWall",
): TilePlacement[] {
  const offset = owner === "wall" ? 0 : wallSideTiles * 3 + 4;

  return tiles.map((tile, index) => {
    const pathIndex = (index + offset) % (wallSideTiles * 4);
    const side = Math.floor(pathIndex / wallSideTiles);
    const sideIndex = pathIndex % wallSideTiles;
    const line = -wallRunRadius + sideIndex * tileSize.width;
    const stack = Math.floor(index / (wallSideTiles * 4));
    const y = tableY + stack * (tileSize.height + 0.01);

    if (side === 0) {
      return wallPlacement(
        tile,
        owner,
        [line, y, wallPerpendicularRadius],
        [0, 0, 0],
      );
    }
    if (side === 1) {
      return wallPlacement(
        tile,
        owner,
        [wallPerpendicularRadius, y, -line],
        [0, Math.PI / 2, 0],
      );
    }
    if (side === 2) {
      return wallPlacement(
        tile,
        owner,
        [-line, y, -wallPerpendicularRadius],
        [0, Math.PI, 0],
      );
    }
    return wallPlacement(
      tile,
      owner,
      [-wallPerpendicularRadius, y, line],
      [0, -Math.PI / 2, 0],
    );
  });
}

function wallPlacement(
  tile: TileInstance,
  owner: "wall" | "deadWall",
  position: Vec3,
  rotation: Vec3,
): TilePlacement {
  return {
    tile,
    owner,
    position,
    rotation,
    faceUp: false,
    physics: false,
  };
}

function currentEventAnimation(
  tiles: readonly TilePlacement[],
  event: GameEvent | undefined,
): ThreeTableLayout["animation"] {
  if (event?.type === "tileDrawn") {
    const finalPlacement = tiles.find(
      (placement) => placement.tile.id === event.tile.id,
    );
    return {
      event,
      from: sourcePosition(event.source),
      to:
        finalPlacement?.position ??
        playerRowPosition(event.player, 0, 1, handRadius, 0),
      rotation: playerTileRotation(event.player),
    };
  }

  if (event?.type === "tileDiscarded") {
    const finalPlacement = tiles.find(
      (placement) => placement.tile.id === event.tile.id,
    );
    return {
      event,
      from: playerRowPosition(event.player, 0, 1, handRadius, 0),
      to: finalPlacement?.position ?? discardDropPosition(event.player),
      rotation: playerTileRotation(event.player),
    };
  }

  return undefined;
}

function sourcePosition(source: "liveWall" | "deadWall"): Vec3 {
  return source === "deadWall"
    ? [-wallPerpendicularRadius, tableY + 0.28, -wallPerpendicularRadius]
    : [0, tableY + 0.28, wallPerpendicularRadius];
}
