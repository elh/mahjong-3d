import { describe, expect, test } from "bun:test";
import { createBaselineBots } from "../../bots/baselineBot";
import { simulateRound } from "../../sim/engine";
import type { GameEvent } from "../../sim/events";
import { replayEvents, type ReplayState } from "../../sim/replay";
import { createTileSet } from "../../sim/tiles";
import {
  createThreeTableLayout,
  discardFallPosition,
  discardDropPosition,
  playerHandRowPosition,
  playerHandTileRotation,
  playerRight,
  tileSize,
} from "./tableLayout";

describe("3D table layout", () => {
  test("maps replay tiles into stable wall, hand, and discard placements", () => {
    const result = simulateRound({
      seed: "three-layout",
      bots: createBaselineBots(),
      maxTurns: 2,
    });
    const discardIndex = result.events.findIndex(
      (event) => event.type === "tileDiscarded",
    );
    const replay = replayEvents(result.events, discardIndex);
    const layout = createThreeTableLayout(replay, result.events[discardIndex]);

    expect(layout.tiles.filter((tile) => tile.owner === "wall").length).toBe(
      replay.wall.length,
    );
    expect(
      layout.tiles.filter((tile) => tile.owner === "deadWall").length,
    ).toBe(replay.deadWall.length);
    expect(layout.tiles.filter((tile) => tile.owner === "hand").length).toBe(
      replay.players.reduce((total, player) => total + player.hand.length, 0),
    );
    expect(
      layout.tiles.filter((tile) => tile.owner === "discard" && tile.physics),
    ).toHaveLength(1);
  });

  test("creates draw and discard animation endpoints from replay events", () => {
    const result = simulateRound({
      seed: "three-animation",
      bots: createBaselineBots(),
      maxTurns: 8,
    });
    const drawIndex = result.events.findIndex(
      (event) => event.type === "tileDrawn" && event.phase === "turn",
    );
    const discardIndex = result.events.findIndex(
      (event) => event.type === "tileDiscarded",
    );

    const drawEvent = result.events[drawIndex];
    const drawReplay = replayEvents(result.events, drawIndex);
    const drawPreviousReplay = replayEvents(result.events, drawIndex - 1);
    const drawLayout = createThreeTableLayout(
      drawReplay,
      drawEvent,
      drawPreviousReplay,
    );
    const drawAnimation = drawLayout.animations[0];
    expect(drawAnimation?.event.type).toBe("tileDrawn");
    if (drawEvent?.type === "tileDrawn") {
      const previousWallPlacement = createThreeTableLayout(
        drawPreviousReplay,
        undefined,
      ).tiles.find((placement) => placement.tile.id === drawEvent.tile.id);
      expect(previousWallPlacement).toBeDefined();
      expect(drawAnimation?.from).toEqual(previousWallPlacement!.position);
      expect(drawAnimation?.to).toEqual(
        expect.arrayContaining([expect.any(Number)]),
      );
    }

    const discardEvent = result.events[discardIndex];
    const discardReplay = replayEvents(result.events, discardIndex);
    const discardPreviousReplay = replayEvents(result.events, discardIndex - 1);
    const discardLayout = createThreeTableLayout(
      discardReplay,
      discardEvent,
      discardPreviousReplay,
    );
    const discardAnimation = discardLayout.animations[0];
    expect(discardAnimation?.event.type).toBe("tileDiscarded");
    if (
      discardEvent?.type === "tileDiscarded" &&
      discardAnimation?.event.type === "tileDiscarded"
    ) {
      const previousHandPlacement = createThreeTableLayout(
        discardPreviousReplay,
        undefined,
      ).tiles.find((placement) => placement.tile.id === discardEvent.tile.id);
      expect(previousHandPlacement).toBeDefined();
      expect(discardAnimation.from).toEqual(previousHandPlacement!.position);
      expect(discardAnimation.fromRotation).toEqual(
        playerHandTileRotation(discardEvent.player),
      );
      expect(discardAnimation.via).toEqual({
        position: discardFallPosition(discardEvent.player),
        rotation: [0, discardEvent.player * (Math.PI / 2), 0],
        holdMs: 500,
      });
      expect(discardAnimation.to[1]).toBeLessThan(
        playerHandRowPosition(discardEvent.player, 0, 1, 3.45)[1],
      );
      expect(discardDropPosition(discardEvent.player)[1]).toBeGreaterThan(
        discardAnimation.to[1],
      );
    }
  });

  test("packs player rows and wall sides edge to edge without corner overlap", () => {
    const result = simulateRound({
      seed: "three-spacing",
      bots: createBaselineBots(),
      maxTurns: 1,
    });
    const replay = replayEvents(result.events);
    const layout = createThreeTableLayout(replay, replay.currentEvent);
    const eastHand = layout.tiles
      .filter(
        (placement) => placement.owner === "hand" && placement.player === 0,
      )
      .sort((left, right) => left.position[0] - right.position[0]);
    const wall = layout.tiles.filter((placement) => placement.owner === "wall");
    const southWallSide = wall.slice(0, 18);
    const eastWallSide = wall.slice(18, 36);

    expect(distance(eastHand[0].position, eastHand[1].position)).toBeCloseTo(
      tileSize.width,
      5,
    );
    expect(eastHand[0].position[1]).toBeCloseTo(tileSize.depth / 2 + 0.01, 5);
    expect(eastHand[0].rotation).toEqual(playerHandTileRotation(0));
    expect(
      distance(southWallSide[0].position, southWallSide[1].position),
    ).toBeCloseTo(tileSize.width, 5);
    expect(
      distance(eastWallSide[0].position, eastWallSide[1].position),
    ).toBeCloseTo(tileSize.width, 5);
    expect(southWallSide.at(-1)!.position[0] + tileSize.width / 2).toBeCloseTo(
      eastWallSide[0].position[0] - tileSize.depth / 2,
      5,
    );
  });

  test("orients every concealed hand upright toward its player", () => {
    const tiles = createTileSet();
    const replay = emptyReplayState();
    for (const player of replay.players) {
      player.hand = tiles.slice(player.id * 2, player.id * 2 + 2);
    }

    const layout = createThreeTableLayout(replay, undefined);

    for (const player of replay.players) {
      const hand = layout.tiles
        .filter(
          (placement) =>
            placement.owner === "hand" && placement.player === player.id,
        )
        .sort((left, right) => left.tile.id.localeCompare(right.tile.id));
      const right = playerRight(player.id);

      expect(hand[0].rotation).toEqual(playerHandTileRotation(player.id));
      expect(hand[0].position[1]).toBeCloseTo(tileSize.depth / 2 + 0.01, 5);
      expect(hand[1].position[0] - hand[0].position[0]).toBeCloseTo(
        right[0] * tileSize.width,
        5,
      );
      expect(hand[1].position[2] - hand[0].position[2]).toBeCloseTo(
        right[2] * tileSize.width,
        5,
      );
    }
  });

  test("animates claimed tiles from previous discard and hand positions into melds", () => {
    const tiles = createTileSet();
    const claimed = tiles[0];
    const handTiles = tiles.slice(1, 3);
    const previousReplay = emptyReplayState();
    previousReplay.players[0].hand = handTiles;
    previousReplay.players[1].discards = [claimed];

    const replay = emptyReplayState();
    replay.players[0].melds = [
      { type: "chow", tiles: [claimed, ...handTiles], claimedFrom: 1 },
    ];
    const event: GameEvent = {
      type: "claimMade",
      phase: "turn",
      groupId: "turn-1",
      turn: 1,
      player: 0,
      from: 1,
      claim: "chow",
      tile: claimed,
      tiles: [claimed, ...handTiles],
    };

    const previousLayout = createThreeTableLayout(previousReplay, undefined);
    const layout = createThreeTableLayout(replay, event, previousReplay);
    const claimedAnimation = layout.animations.find(
      (animation) => animation.tile.id === claimed.id,
    );
    const handAnimation = layout.animations.find(
      (animation) => animation.tile.id === handTiles[0].id,
    );
    const previousDiscard = previousLayout.tiles.find(
      (placement) => placement.tile.id === claimed.id,
    );
    const previousHand = previousLayout.tiles.find(
      (placement) => placement.tile.id === handTiles[0].id,
    );

    expect(layout.animations).toHaveLength(3);
    expect(previousDiscard).toBeDefined();
    expect(previousHand).toBeDefined();
    expect(claimedAnimation?.from).toEqual(previousDiscard!.position);
    expect(handAnimation?.from).toEqual(previousHand!.position);
    expect(claimedAnimation?.to).toEqual(
      layout.tiles.find((placement) => placement.tile.id === claimed.id)
        ?.position,
    );
  });

  test("keeps melds and flowers on one fixed auxiliary row", () => {
    const tiles = createTileSet();
    const replay = emptyReplayState();
    replay.players[0].hand = tiles.slice(0, 6);
    replay.players[0].melds = [{ type: "pong", tiles: tiles.slice(6, 9) }];
    replay.players[0].flowers = tiles.slice(9, 11);

    const layout = createThreeTableLayout(replay, undefined);
    const hand = layout.tiles
      .filter(
        (placement) => placement.owner === "hand" && placement.player === 0,
      )
      .sort((left, right) => left.position[0] - right.position[0]);
    const melds = layout.tiles
      .filter(
        (placement) => placement.owner === "meld" && placement.player === 0,
      )
      .sort((left, right) => left.position[0] - right.position[0]);
    const flowers = layout.tiles
      .filter(
        (placement) => placement.owner === "flower" && placement.player === 0,
      )
      .sort((left, right) => left.position[0] - right.position[0]);

    expect(
      new Set([...melds, ...flowers].map((tile) => tile.position[2])),
    ).toHaveLength(1);
    expect(melds[0].position[2]).toBeLessThan(hand[0].position[2]);
    expect(flowers.at(-1)!.position[0] + tileSize.width / 2).toBeCloseTo(
      (16 * tileSize.width) / 2,
      5,
    );
    expect(
      flowers[0].position[0] -
        tileSize.width / 2 -
        (melds.at(-1)!.position[0] + tileSize.width / 2),
    ).toBeCloseTo(tileSize.width * 0.5, 5);

    replay.players[0].hand = tiles.slice(0, 12);
    const longerHandLayout = createThreeTableLayout(replay, undefined);
    const longerHandMelds = longerHandLayout.tiles
      .filter(
        (placement) => placement.owner === "meld" && placement.player === 0,
      )
      .sort((left, right) => left.position[0] - right.position[0]);
    expect(longerHandMelds[0].position[0]).toBeCloseTo(melds[0].position[0], 5);
  });
});

function distance(
  left: [number, number, number],
  right: [number, number, number],
) {
  return Math.hypot(left[0] - right[0], left[2] - right[2]);
}

function emptyReplayState(): ReplayState {
  return {
    players: [
      { id: 0, hand: [], flowers: [], discards: [], melds: [] },
      { id: 1, hand: [], flowers: [], discards: [], melds: [] },
      { id: 2, hand: [], flowers: [], discards: [], melds: [] },
      { id: 3, hand: [], flowers: [], discards: [], melds: [] },
    ],
    wall: [],
    deadWall: [],
    wallCount: 0,
    deadWallCount: 0,
    dealer: 0,
    eventIndex: 0,
    ended: false,
    rulesErrors: [],
  };
}
