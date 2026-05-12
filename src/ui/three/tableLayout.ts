import type { GameEvent } from "../../sim/events";
import type { ReplayState } from "../../sim/replay";
import type { Meld, PlayerId } from "../../sim/state";
import {
  createTestScenarioWalls,
  isTestScenarioSeed,
} from "../../sim/testScenarios";
import { sortTiles, type TileInstance } from "../../sim/tiles";
import {
  createShuffledWalls,
  physicalWallSlotMap,
  wallStackCount,
  type WallState,
} from "../../sim/wall";

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
        | "tilesDrawn"
        | "tileDiscarded"
        | "flowerExposed"
        | "claimMade"
        | "kongDeclared"
        | "addedKongDeclared"
        | "winDeclared"
        | "drawDeclared";
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
  drawStaging?: {
    position: Vec3;
  };
  flipAxis?: Vec3;
  faceUp?: boolean;
  motion?:
    | "arc"
    | "drawConcealed"
    | "discardToss"
    | "claimToss"
    | "knockdown"
    | "flipReveal";
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
const handRadius = 3.12;
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
const wallCrossingY = tableY + 0.55;

export function createThreeTableLayout(
  replay: ReplayState,
  currentEvent: GameEvent | undefined,
  previousReplay?: ReplayState,
  nextEvent?: GameEvent,
): ThreeTableLayout {
  const tiles = createStaticThreeTableLayout(replay, currentEvent, nextEvent);
  const previousTiles = previousReplay
    ? createStaticThreeTableLayout(
        previousReplay,
        previousReplay.currentEvent,
        currentEvent,
      )
    : [];
  const animations = currentEventAnimations(
    tiles,
    previousTiles,
    replay,
    currentEvent,
    nextEvent,
  );
  return { tiles, animations };
}

function createStaticThreeTableLayout(
  replay: ReplayState,
  currentEvent?: GameEvent,
  nextEvent?: GameEvent,
): TilePlacement[] {
  const stagedDraw = stagedWinningDraw(currentEvent, nextEvent);
  const tiles: TilePlacement[] = [
    ...layoutWall(replay.wall, "wall", replay.seed),
    ...layoutWall(replay.deadWall, "deadWall", replay.seed),
    ...replay.players.flatMap((player) => {
      const revealedWinningTile = winningRevealTile(
        replay,
        currentEvent,
        player.id,
      );
      return [
        ...(revealedWinningTile
          ? [
              ...layoutWinningPlayerArea(
                player.hand,
                revealedWinningTile,
                player.id,
              ),
              ...layoutPlayerAuxiliaryRow(
                player.melds,
                player.flowers,
                player.id,
                replay.ended,
              ),
            ]
          : stagedDraw?.player === player.id
            ? layoutPlayerAreaWithStagedDraw(
                player.hand,
                stagedDraw.tile,
                player.melds,
                player.flowers,
                player.id,
                replay.ended,
              )
            : layoutPlayerArea(
                player.hand,
                player.melds,
                player.flowers,
                player.id,
                replay.ended,
              )),
        ...layoutDiscards(player.discards, player.id),
      ];
    }),
  ];
  return tiles;
}

function winningRevealTile(
  replay: ReplayState,
  currentEvent: GameEvent | undefined,
  player: PlayerId,
): TileInstance | undefined {
  if (currentEvent?.type === "winDeclared" && currentEvent.player === player) {
    return replay.players[player].winningTile ?? currentEvent.tile;
  }

  const replayPlayer = replay.players[player];
  if (
    replay.ended &&
    replayPlayer.winningTile !== undefined &&
    currentEvent?.type !== "winDeclared"
  ) {
    return replayPlayer.winningTile;
  }
  return undefined;
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

export function playerDrawStagingPosition(
  player: PlayerId,
  handPosition: Vec3,
): Vec3 {
  const forward = playerForward(player);
  return [
    handPosition[0] - forward[0] * tileSize.depth * 0.9,
    handPosition[1],
    handPosition[2] - forward[2] * tileSize.depth * 0.9,
  ];
}

export function playerRevealedHandPosition(
  player: PlayerId,
  index: number,
  total: number,
): Vec3 {
  return playerRowPosition(player, index, total, handRadius, 0);
}

export function playerWinningTilePosition(
  player: PlayerId,
  revealedHandCount: number,
): Vec3 {
  const right = playerRight(player);
  const forward = playerForward(player);
  const rightOffset =
    revealedHandCount === 0
      ? 0
      : ((revealedHandCount - 1) / 2 + 2) * tileSize.width;
  return [
    forward[0] * handRadius + right[0] * rightOffset,
    tableY,
    forward[2] * handRadius + right[2] * rightOffset,
  ];
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
  _player: PlayerId,
): Vec3 {
  const yaw = (stableUnit(`${tile.id}:yaw`) - 0.5) * 13.5;
  return [0, yaw, 0];
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
  melds: readonly Meld[],
  flowers: readonly TileInstance[],
  player: PlayerId,
  revealConcealedKongs: boolean,
): TilePlacement[] {
  return [
    ...layoutPlayerRow(hand, player, "hand", handRadius, 0),
    ...layoutPlayerAuxiliaryRow(melds, flowers, player, revealConcealedKongs),
  ];
}

function layoutPlayerAreaWithStagedDraw(
  hand: readonly TileInstance[],
  stagedTile: TileInstance,
  melds: readonly Meld[],
  flowers: readonly TileInstance[],
  player: PlayerId,
  revealConcealedKongs: boolean,
): TilePlacement[] {
  const concealedHand = removeFirstTileById(hand, stagedTile.id);
  const sortedHand = sortTiles(hand);
  const sortedIndex = sortedHand.findIndex((tile) => tile.id === stagedTile.id);
  const finalHandPosition = playerHandRowPosition(
    player,
    sortedIndex === -1 ? sortedHand.length : sortedIndex,
    sortedHand.length,
    handRadius,
  );
  return [
    ...layoutPlayerRow(concealedHand, player, "hand", handRadius, 0),
    {
      tile: stagedTile,
      owner: "hand",
      player,
      position: playerDrawStagingPosition(player, finalHandPosition),
      rotation: playerHandTileRotation(player),
      faceUp: true,
      physics: false,
    },
    ...layoutPlayerAuxiliaryRow(melds, flowers, player, revealConcealedKongs),
  ];
}

function layoutWinningPlayerArea(
  hand: readonly TileInstance[],
  winningTile: TileInstance,
  player: PlayerId,
): TilePlacement[] {
  const revealedHand = removeFirstTileById(hand, winningTile.id);
  return [
    ...revealedHand.map((tile, index) => ({
      tile,
      owner: "hand" as const,
      player,
      position: playerRevealedHandPosition(player, index, revealedHand.length),
      rotation: playerTileRotation(player),
      faceUp: true,
      physics: false,
    })),
    {
      tile: winningTile,
      owner: "hand",
      player,
      position: playerWinningTilePosition(player, revealedHand.length),
      rotation: playerTileRotation(player),
      faceUp: true,
      physics: false,
    },
  ];
}

function layoutPlayerAuxiliaryRow(
  melds: readonly Meld[],
  flowers: readonly TileInstance[],
  player: PlayerId,
  revealConcealedKongs: boolean,
): TilePlacement[] {
  const meldTiles = melds.flatMap((meld) =>
    meld.tiles.map((tile) => ({
      tile,
      faceUp: !meld.concealed || revealConcealedKongs,
    })),
  );

  if (meldTiles.length === 0 && flowers.length === 0) {
    return [];
  }

  const gap =
    meldTiles.length > 0 && flowers.length > 0 ? playerAuxiliaryGap : 0;
  const auxiliaryWidth =
    (meldTiles.length + flowers.length) * tileSize.width + gap;
  const leftEdge = playerAuxiliaryRightEdge - auxiliaryWidth;
  const placements: TilePlacement[] = [];

  for (const [index, meldTile] of meldTiles.entries()) {
    placements.push(
      playerAuxiliaryPlacement(
        meldTile.tile,
        "meld",
        player,
        leftEdge + tileSize.width / 2 + index * tileSize.width,
        meldTile.faceUp,
      ),
    );
  }

  const flowerLeftEdge = leftEdge + meldTiles.length * tileSize.width + gap;
  for (const [index, tile] of flowers.entries()) {
    placements.push(
      playerAuxiliaryPlacement(
        tile,
        "flower",
        player,
        flowerLeftEdge + tileSize.width / 2 + index * tileSize.width,
        true,
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
  faceUp: boolean,
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
    faceUp,
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
    tableY,
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
  seed?: string,
): TilePlacement[] {
  const offset = seed ? 0 : owner === "wall" ? 0 : wallSideTiles * 3 + 4;
  const wallSlots = seed ? wallSlotMap(seed) : undefined;

  return tiles.map((tile, index) => {
    const wallIndex = wallSlots?.get(tile.id) ?? index;
    const pathIndex = (wallIndex + offset) % (wallSideTiles * 4);
    const side = Math.floor(pathIndex / wallSideTiles);
    const sideIndex = pathIndex % wallSideTiles;
    const line = -wallRunRadius + sideIndex * tileSize.width;
    const stack = Math.floor(wallIndex / (wallSideTiles * 4));
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

const wallSlotCache = new Map<string, Map<string, number>>();

function wallSlotMap(seed: string): Map<string, number> {
  const cached = wallSlotCache.get(seed);
  if (cached) {
    return cached;
  }

  if (!isTestScenarioSeed(seed)) {
    const slots = physicalWallSlotMap(seed);
    wallSlotCache.set(seed, slots);
    return slots;
  }

  const shuffledWalls =
    createTestScenarioWalls(seed) ?? createShuffledWalls(seed);
  const slots = new Map<string, number>();
  applyWallStateSlots(slots, shuffledWalls);
  wallSlotCache.set(seed, slots);
  return slots;
}

function applyWallStateSlots(
  slots: Map<string, number>,
  wallState: WallState,
): void {
  const firstLiveStack =
    (wallState.wallBreak.cutStack + wallStackCount - 1) % wallStackCount;
  for (const [index, tile] of wallState.wall.entries()) {
    const stackIndex =
      (firstLiveStack - Math.floor(index / 2) + wallStackCount) %
      wallStackCount;
    slots.set(tile.id, stackIndex + (index % 2 === 0 ? wallStackCount : 0));
  }
  for (const [index, tile] of wallState.deadWall.entries()) {
    const stackIndex =
      (wallState.wallBreak.cutStack + Math.floor(index / 2)) % wallStackCount;
    slots.set(tile.id, stackIndex + (index % 2 === 0 ? wallStackCount : 0));
  }
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
  nextEvent: GameEvent | undefined,
): TileAnimation[] {
  if (event?.type === "tileDrawn" || event?.type === "tilesDrawn") {
    const eventTiles = event.type === "tileDrawn" ? [event.tile] : event.tiles;
    return eventTiles.map((tile) => {
      const finalPlacement = tiles.find(
        (placement) => placement.tile.id === tile.id,
      );
      const previousPlacement = previousTiles.find(
        (placement) => placement.tile.id === tile.id,
      );
      const finalPosition =
        finalPlacement?.position ??
        playerHandRowPosition(event.player, 0, 1, handRadius);
      const drawStaging = playerDrawStagingPosition(
        event.player,
        finalPosition,
      );
      const stagesWinningDraw =
        event.type === "tileDrawn" &&
        stagedWinningDraw(event, nextEvent)?.tile.id === tile.id;
      return {
        tile,
        event,
        from:
          previousPlacement?.position ??
          sourcePosition(
            event.type === "tileDrawn" ? event.source : "liveWall",
          ),
        to: finalPosition,
        fromRotation: previousPlacement?.rotation ?? playerTileRotation(0),
        toRotation:
          finalPlacement?.rotation ?? playerHandTileRotation(event.player),
        drawStaging: {
          position: stagesWinningDraw ? finalPosition : drawStaging,
        },
        motion: "drawConcealed",
      };
    });
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
        to: discardFallPosition(event.player),
        fromRotation: previousPlacement.rotation,
        toRotation:
          finalPlacement?.rotation ?? playerTileRotation(event.player),
        via: {
          position: raisedPosition(discardFallPosition(event.player)),
          rotation: playerTileRotation(event.player),
        },
        motion: "discardToss",
        flick: {
          position: discardFallPosition(event.player),
          rotation: playerTileRotation(event.player),
          linearVelocity: discardFlickVelocity(event.tile, event.player),
          angularVelocity: discardFlickAngularVelocity(
            event.tile,
            event.player,
          ),
          delayMs: 420,
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

  if (event?.type === "addedKongDeclared") {
    return event.tiles.flatMap((tile) =>
      meldTileAnimation(tile, event, tiles, previousTiles, event.player),
    );
  }

  if (event?.type === "kongDeclared") {
    return event.tiles.flatMap((tile) =>
      meldTileAnimation(tile, event, tiles, previousTiles, event.player),
    );
  }

  if (event?.type === "winDeclared") {
    return [
      ...winningTileAnimations(event, tiles, previousTiles),
      ...concealedKongRevealAnimations(event, tiles, previousTiles),
    ];
  }

  if (event?.type === "drawDeclared") {
    return concealedKongRevealAnimations(event, tiles, previousTiles);
  }

  return [];
}

function sourcePosition(source: "liveWall" | "deadWall"): Vec3 {
  return source === "deadWall"
    ? [-wallPerpendicularRadius, tableY + 0.28, -wallPerpendicularRadius]
    : [0, tableY + 0.28, wallPerpendicularRadius];
}

function raisedPosition(position: Vec3): Vec3 {
  return [position[0], wallCrossingY, position[2]];
}

function raisedMidpoint(from: Vec3, to: Vec3): Vec3 {
  return [(from[0] + to[0]) / 2, wallCrossingY, (from[2] + to[2]) / 2];
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
    {
      type:
        | "flowerExposed"
        | "claimMade"
        | "kongDeclared"
        | "addedKongDeclared";
    }
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
  const crossesWallFromDiscard = previousPlacement?.owner === "discard";

  return [
    {
      tile,
      event,
      from: previousPlacement?.position ?? finalPlacement.position,
      to: finalPlacement.position,
      fromRotation:
        previousPlacement?.rotation ?? playerHandTileRotation(player),
      toRotation: finalPlacement.rotation,
      via: crossesWallFromDiscard
        ? {
            position: raisedMidpoint(
              previousPlacement.position,
              finalPlacement.position,
            ),
            rotation: finalPlacement.rotation,
          }
        : undefined,
      motion: crossesWallFromDiscard ? "claimToss" : undefined,
      faceUp: finalPlacement.faceUp,
    },
  ];
}

function concealedKongRevealAnimations(
  event: Extract<GameEvent, { type: "winDeclared" | "drawDeclared" }>,
  tiles: readonly TilePlacement[],
  previousTiles: readonly TilePlacement[],
): TileAnimation[] {
  return tiles
    .filter((placement) => {
      const previousPlacement = previousTiles.find(
        (candidate) => candidate.tile.id === placement.tile.id,
      );
      return (
        placement.owner === "meld" &&
        placement.faceUp &&
        previousPlacement?.owner === "meld" &&
        previousPlacement.faceUp === false
      );
    })
    .map((placement) => {
      const previousPlacement = previousTiles.find(
        (candidate) => candidate.tile.id === placement.tile.id,
      );
      return {
        tile: placement.tile,
        event,
        from: previousPlacement?.position ?? placement.position,
        to: placement.position,
        fromRotation: previousPlacement?.rotation ?? placement.rotation,
        toRotation: placement.rotation,
        flipAxis: playerRight(placement.player ?? 0),
        faceUp: true,
        motion: "flipReveal",
      };
    });
}

function winningTileAnimations(
  event: Extract<GameEvent, { type: "winDeclared" }>,
  tiles: readonly TilePlacement[],
  previousTiles: readonly TilePlacement[],
): TileAnimation[] {
  const winningTiles = tiles.filter(
    (placement) =>
      placement.owner === "hand" && placement.player === event.player,
  );

  return winningTiles.map((placement) => {
    const previousPlacement = previousTiles.find(
      (candidate) => candidate.tile.id === placement.tile.id,
    );
    const claimsWinningDiscard = previousPlacement?.owner === "discard";
    return {
      tile: placement.tile,
      event,
      from: previousPlacement?.position ?? placement.position,
      to: placement.position,
      fromRotation:
        previousPlacement?.rotation ?? playerHandTileRotation(event.player),
      toRotation: placement.rotation,
      via:
        claimsWinningDiscard && previousPlacement
          ? {
              position: raisedMidpoint(
                previousPlacement.position,
                placement.position,
              ),
              rotation: placement.rotation,
            }
          : undefined,
      motion: claimsWinningDiscard ? "claimToss" : "knockdown",
    };
  });
}

function stagedWinningDraw(
  event: GameEvent | undefined,
  nextEvent: GameEvent | undefined,
): Extract<GameEvent, { type: "tileDrawn" }> | undefined {
  if (
    event?.type !== "tileDrawn" ||
    nextEvent?.type !== "winDeclared" ||
    nextEvent.player !== event.player ||
    nextEvent.from !== undefined ||
    nextEvent.tile.id !== event.tile.id
  ) {
    return undefined;
  }
  return event;
}

function removeFirstTileById(
  tiles: readonly TileInstance[],
  tileId: string,
): TileInstance[] {
  let removed = false;
  return tiles.filter((tile) => {
    if (!removed && tile.id === tileId) {
      removed = true;
      return false;
    }
    return true;
  });
}
