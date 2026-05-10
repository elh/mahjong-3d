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
  width: 0.24,
  height: 0.08,
  depth: 0.34,
};

const tableY = tileSize.height / 2 + 0.01;
const handRadius = 3.45;
const discardRadius = 1.12;
const wallRadius = 2.1;

export function createThreeTableLayout(
  replay: ReplayState,
  currentEvent: GameEvent | undefined,
): ThreeTableLayout {
  const tiles: TilePlacement[] = [
    ...layoutWall(replay.wall, "wall"),
    ...layoutWall(replay.deadWall, "deadWall"),
    ...replay.players.flatMap((player) => [
      ...layoutPlayerRow(player.hand, player.id, "hand", handRadius, 0),
      ...layoutPlayerRow(
        player.melds.flatMap((meld) => meld.tiles),
        player.id,
        "meld",
        handRadius - 0.42,
        0,
      ),
      ...layoutPlayerRow(
        player.flowers,
        player.id,
        "flower",
        handRadius - 0.76,
        0,
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
  const spacing = tileSize.width + 0.04;
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

function layoutDiscards(
  tiles: readonly TileInstance[],
  player: PlayerId,
): TilePlacement[] {
  const right = playerRight(player);
  const forward = playerForward(player);
  const columns = 6;
  const columnSpacing = tileSize.width + 0.05;
  const rowSpacing = tileSize.depth + 0.06;
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
  const perimeter = 18;
  const offset = owner === "wall" ? 0 : perimeter * 3 + 4;

  return tiles.map((tile, index) => {
    const pathIndex = (index + offset) % (perimeter * 4);
    const side = Math.floor(pathIndex / perimeter);
    const sideIndex = pathIndex % perimeter;
    const t = sideIndex / Math.max(perimeter - 1, 1);
    const line = -wallRadius + t * wallRadius * 2;
    const stack = Math.floor(index / (perimeter * 4));
    const y = tableY + stack * (tileSize.height + 0.01);

    if (side === 0) {
      return wallPlacement(tile, owner, [line, y, wallRadius], [0, 0, 0]);
    }
    if (side === 1) {
      return wallPlacement(
        tile,
        owner,
        [wallRadius, y, -line],
        [0, Math.PI / 2, 0],
      );
    }
    if (side === 2) {
      return wallPlacement(
        tile,
        owner,
        [-line, y, -wallRadius],
        [0, Math.PI, 0],
      );
    }
    return wallPlacement(
      tile,
      owner,
      [-wallRadius, y, line],
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
    ? [-wallRadius, tableY + 0.28, -wallRadius]
    : [0, tableY + 0.28, wallRadius];
}
