import type { GameEvent } from "../../sim/events";
import type { ReplayState } from "../../sim/replay";
import type { PlayerId } from "../../sim/state";
import { sortTiles, type TileInstance } from "../../sim/tiles";

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
  animations: TileAnimation[];
};

export type TileAnimation = {
  tile: TileInstance;
  event: Extract<
    GameEvent,
    {
      type:
        | "tileDrawn"
        | "tileDiscarded"
        | "flowerExposed"
        | "claimMade"
        | "kongDeclared";
    }
  >;
  from: Vec3;
  to: Vec3;
  fromRotation: Vec3;
  toRotation: Vec3;
  via?: {
    position: Vec3;
    rotation: Vec3;
    holdMs?: number;
  };
  flick?: {
    position: Vec3;
    rotation: Vec3;
    linearVelocity: Vec3;
    angularVelocity: Vec3;
    delayMs: number;
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
const handUprightY = tileSize.depth / 2 + 0.01;
const wallSideTiles = 18;
const wallSideLength = tileSize.width * wallSideTiles;
const wallRunRadius = wallSideLength / 2 - tileSize.width / 2;
const wallPerpendicularRadius = wallSideLength / 2 + tileSize.depth / 2;
const discardRevealRightOffset = tileSize.width * 7;
const discardRevealForwardRadius =
  wallPerpendicularRadius - tileSize.depth * 1.7;

export function createThreeTableLayout(
  replay: ReplayState,
  currentEvent: GameEvent | undefined,
  previousReplay?: ReplayState,
): ThreeTableLayout {
  const tiles = createStaticThreeTableLayout(replay);
  const previousTiles = previousReplay
    ? createStaticThreeTableLayout(previousReplay)
    : [];
  const animations = currentEventAnimations(
    tiles,
    previousTiles,
    replay,
    currentEvent,
  );
  return { tiles, animations };
}

function createStaticThreeTableLayout(replay: ReplayState): TilePlacement[] {
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
  return tiles;
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

export function playerHandTileRotation(player: PlayerId): Vec3 {
  return [Math.PI / 2, 0, -playerAngle(player)];
}

export function playerHandRowPosition(
  player: PlayerId,
  index: number,
  total: number,
  radius: number,
): Vec3 {
  const [x, , z] = playerRowPosition(player, index, total, radius, 0);
  return [x, handUprightY, z];
}

export function discardDropPosition(player: PlayerId): Vec3 {
  const forward = playerForward(player);
  return [
    forward[0] * discardRadius,
    tableY + 0.45,
    forward[2] * discardRadius,
  ];
}

export function discardFallPosition(player: PlayerId): Vec3 {
  const forward = playerForward(player);
  const right = playerRight(player);
  return [
    forward[0] * discardRevealForwardRadius +
      right[0] * discardRevealRightOffset,
    tableY,
    forward[2] * discardRevealForwardRadius +
      right[2] * discardRevealRightOffset,
  ];
}

export function discardFlickVelocity(
  tile: TileInstance,
  player: PlayerId,
): Vec3 {
  const reveal = discardFallPosition(player);
  const baseAngle = Math.atan2(-reveal[2], -reveal[0]);
  const angle = baseAngle + (stableUnit(tile.id) - 0.5) * 0.46;
  const forceDelta = (stableUnit(`${tile.id}:force`) - 0.5) * 0.4;
  const speed =
    (5.6 + stableUnit(`${tile.id}:speed`) * 0.65) * (1 + forceDelta);
  return [Math.cos(angle) * speed, 0.09, Math.sin(angle) * speed];
}

export function discardFlickAngularVelocity(
  tile: TileInstance,
  player: PlayerId,
): Vec3 {
  const spin = stableUnit(`${tile.id}:spin`) - 0.5;
  return [
    0.1 + spin * 0.8,
    2.8 + stableUnit(`${tile.id}:yaw`) * 1.8,
    (player % 2 === 0 ? 1 : -1) * (0.8 + stableUnit(`${tile.id}:roll`) * 1.2),
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
    position:
      owner === "hand"
        ? playerHandRowPosition(player, index, tiles.length, radius)
        : playerRowPosition(player, index, tiles.length, radius, rowOffset),
    rotation:
      owner === "hand"
        ? playerHandTileRotation(player)
        : playerTileRotation(player),
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

function currentEventAnimations(
  tiles: readonly TilePlacement[],
  previousTiles: readonly TilePlacement[],
  replay: ReplayState,
  event: GameEvent | undefined,
): TileAnimation[] {
  if (event?.type === "tileDrawn") {
    const finalPlacement = tiles.find(
      (placement) => placement.tile.id === event.tile.id,
    );
    const previousPlacement = previousTiles.find(
      (placement) => placement.tile.id === event.tile.id,
    );
    return [
      {
        tile: event.tile,
        event,
        from: previousPlacement?.position ?? sourcePosition(event.source),
        to:
          finalPlacement?.position ??
          playerHandRowPosition(event.player, 0, 1, handRadius),
        fromRotation: previousPlacement?.rotation ?? playerTileRotation(0),
        toRotation:
          finalPlacement?.rotation ?? playerHandTileRotation(event.player),
      },
    ];
  }

  if (event?.type === "tileDiscarded") {
    const finalPlacement = tiles.find(
      (placement) => placement.tile.id === event.tile.id,
    );
    const previousPlacement =
      previousTiles.find((placement) => placement.tile.id === event.tile.id) ??
      previousDiscardHandPlacement(replay, event);
    return [
      {
        tile: event.tile,
        event,
        from: previousPlacement.position,
        to: finalPlacement?.position ?? discardDropPosition(event.player),
        fromRotation: previousPlacement.rotation,
        toRotation:
          finalPlacement?.rotation ?? playerTileRotation(event.player),
        via: {
          position: discardFallPosition(event.player),
          rotation: playerTileRotation(event.player),
          holdMs: 500,
        },
        flick: {
          position: discardFallPosition(event.player),
          rotation: playerTileRotation(event.player),
          linearVelocity: discardFlickVelocity(event.tile, event.player),
          angularVelocity: discardFlickAngularVelocity(
            event.tile,
            event.player,
          ),
          delayMs: 880,
        },
      },
    ];
  }

  if (event?.type === "flowerExposed") {
    return meldTileAnimation(
      event.tile,
      event,
      tiles,
      previousTiles,
      event.player,
    );
  }

  if (event?.type === "claimMade") {
    return event.tiles.flatMap((tile) =>
      meldTileAnimation(tile, event, tiles, previousTiles, event.player),
    );
  }

  if (event?.type === "kongDeclared") {
    return event.tiles.flatMap((tile) =>
      meldTileAnimation(tile, event, tiles, previousTiles, event.player),
    );
  }

  return [];
}

function sourcePosition(source: "liveWall" | "deadWall"): Vec3 {
  return source === "deadWall"
    ? [-wallPerpendicularRadius, tableY + 0.28, -wallPerpendicularRadius]
    : [0, tableY + 0.28, wallPerpendicularRadius];
}

function stableUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function previousDiscardHandPlacement(
  replay: ReplayState,
  event: Extract<GameEvent, { type: "tileDiscarded" }>,
): Pick<TilePlacement, "position" | "rotation"> {
  const handBeforeDiscard = sortTiles([
    ...replay.players[event.player].hand,
    event.tile,
  ]);
  const tileIndex = handBeforeDiscard.findIndex(
    (tile) => tile.id === event.tile.id,
  );
  const index = tileIndex === -1 ? handBeforeDiscard.length - 1 : tileIndex;
  return {
    position: playerHandRowPosition(
      event.player,
      index,
      handBeforeDiscard.length,
      handRadius,
    ),
    rotation: playerHandTileRotation(event.player),
  };
}

function meldTileAnimation(
  tile: TileInstance,
  event: Extract<
    GameEvent,
    { type: "flowerExposed" | "claimMade" | "kongDeclared" }
  >,
  tiles: readonly TilePlacement[],
  previousTiles: readonly TilePlacement[],
  player: PlayerId,
): TileAnimation[] {
  const finalPlacement = tiles.find(
    (placement) =>
      placement.tile.id === tile.id &&
      (placement.owner === "meld" || placement.owner === "flower"),
  );
  if (!finalPlacement) {
    return [];
  }

  const previousPlacement = previousTiles.find(
    (placement) => placement.tile.id === tile.id,
  );

  return [
    {
      tile,
      event,
      from: previousPlacement?.position ?? finalPlacement.position,
      to: finalPlacement.position,
      fromRotation:
        previousPlacement?.rotation ?? playerHandTileRotation(player),
      toRotation: finalPlacement.rotation,
    },
  ];
}
