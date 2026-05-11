import { describe, expect, test } from "bun:test";
import { createBaselineBots } from "../../bots/baselineBot";
import { simulateRound } from "../../sim/engine";
import type { GameEvent } from "../../sim/events";
import { replayEvents, type ReplayState } from "../../sim/replay";
import { createTileSet } from "../../sim/tiles";
import { createShuffledWalls } from "../../sim/wall";
import {
  createThreeTableLayout,
  discardFallPosition,
  discardFlickAngularVelocity,
  discardFlickVelocity,
  discardDropPosition,
  playerHandRowPosition,
  playerHandTileRotation,
  playerDrawStagingPosition,
  playerRight,
  playerRevealedHandPosition,
  playerWinningTilePosition,
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
      expect(drawAnimation?.fromRotation).toEqual(
        previousWallPlacement!.rotation,
      );
      expect(drawAnimation?.motion).toBe("drawConcealed");
      expect(drawAnimation?.drawStaging).toEqual({
        position: playerDrawStagingPosition(
          drawEvent.player,
          drawAnimation!.to,
        ),
      });
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
        holdMs: 10,
      });
      expect(discardAnimation.flick).toEqual({
        position: discardFallPosition(discardEvent.player),
        rotation: [0, discardEvent.player * (Math.PI / 2), 0],
        linearVelocity: discardFlickVelocity(
          discardEvent.tile,
          discardEvent.player,
        ),
        angularVelocity: discardFlickAngularVelocity(
          discardEvent.tile,
          discardEvent.player,
        ),
        delayMs: 390,
      });
      expect(discardAnimation.flick!.angularVelocity[0]).toBe(0);
      expect(discardAnimation.flick!.angularVelocity[2]).toBe(0);
      expect(discardAnimation.flick!.linearVelocity[1]).toBeGreaterThan(0);
      expect(
        Math.hypot(
          discardAnimation.flick!.linearVelocity[0],
          discardAnimation.flick!.linearVelocity[2],
        ),
      ).toBeGreaterThan(5.5);
      expect(discardAnimation.via!.position[1]).toBeCloseTo(
        tileSize.height / 2 + 0.01,
        5,
      );
      expect(discardAnimation.to[1]).toBeLessThan(
        playerHandRowPosition(discardEvent.player, 0, 1, 3.45)[1],
      );
      expect(discardDropPosition(discardEvent.player)[1]).toBeGreaterThan(
        discardAnimation.to[1],
      );
    }
  });

  test("keeps live wall draw origins in their seeded physical slots", () => {
    const result = simulateRound({
      seed: "three-wall-origin",
      bots: createBaselineBots(),
      maxTurns: 4,
    });
    const drawIndex = result.events.findIndex(
      (event) => event.type === "tileDrawn" && event.phase === "turn",
    );
    const drawEvent = result.events[drawIndex];
    const replay = replayEvents(result.events, drawIndex);
    const previousReplay = replayEvents(result.events, drawIndex - 1);
    const layout = createThreeTableLayout(replay, drawEvent, previousReplay);
    const compressedPreviousReplay: ReplayState = { ...previousReplay };
    delete compressedPreviousReplay.seed;

    expect(drawEvent?.type).toBe("tileDrawn");
    if (drawEvent?.type === "tileDrawn") {
      const stablePreviousPlacement = createThreeTableLayout(
        previousReplay,
        undefined,
      ).tiles.find((placement) => placement.tile.id === drawEvent.tile.id);
      const compressedPreviousPlacement = createThreeTableLayout(
        compressedPreviousReplay,
        undefined,
      ).tiles.find((placement) => placement.tile.id === drawEvent.tile.id);
      const drawAnimation = layout.animations[0];

      expect(stablePreviousPlacement).toBeDefined();
      expect(compressedPreviousPlacement).toBeDefined();
      expect(drawAnimation?.from).toEqual(stablePreviousPlacement!.position);
      expect(drawAnimation?.from).not.toEqual(
        compressedPreviousPlacement!.position,
      );
    }
  });

  test("lays live wall draw order as top then bottom of each stack", () => {
    const seed = "three-wall-stack-order";
    const { wall, deadWall } = createShuffledWalls(seed);
    const replay = emptyReplayState();
    replay.seed = seed;
    replay.wall = wall;
    replay.deadWall = deadWall;
    const layout = createThreeTableLayout(replay, undefined);
    const firstTile = layout.tiles.find(
      (placement) => placement.tile.id === wall[0].id,
    );
    const secondTile = layout.tiles.find(
      (placement) => placement.tile.id === wall[1].id,
    );

    expect(firstTile).toBeDefined();
    expect(secondTile).toBeDefined();
    expect(firstTile!.position[0]).toBeCloseTo(secondTile!.position[0], 5);
    expect(firstTile!.position[2]).toBeCloseTo(secondTile!.position[2], 5);
    expect(firstTile!.position[1]).toBeGreaterThan(secondTile!.position[1]);
  });

  test("positions live and dead wall tiles as one contiguous two-high square", () => {
    const seed = "three-contiguous-wall";
    const { wall, deadWall } = createShuffledWalls(seed);
    const replay = emptyReplayState();
    replay.seed = seed;
    replay.wall = wall;
    replay.deadWall = deadWall;
    const layout = createThreeTableLayout(replay, undefined);
    const wallPlacements = layout.tiles.filter(
      (placement) =>
        placement.owner === "wall" || placement.owner === "deadWall",
    );
    const stackCounts = new Map<string, number>();

    for (const placement of wallPlacements) {
      const key = `${placement.position[0].toFixed(5)},${placement.position[2].toFixed(5)}`;
      stackCounts.set(key, (stackCounts.get(key) ?? 0) + 1);
    }

    expect(wallPlacements).toHaveLength(144);
    expect(stackCounts).toHaveLength(72);
    expect([...stackCounts.values()].every((count) => count === 2)).toBe(true);
  });

  test("draws dead wall visually from the opposite end top then bottom", () => {
    const seed = "three-dead-wall-end";
    const { wall, deadWall } = createShuffledWalls(seed);
    const replay = emptyReplayState();
    replay.seed = seed;
    replay.wall = wall;
    replay.deadWall = deadWall;
    const layout = createThreeTableLayout(replay, undefined);
    const firstLive = layout.tiles.find(
      (placement) => placement.tile.id === wall[0].id,
    );
    const firstDead = layout.tiles.find(
      (placement) => placement.tile.id === deadWall[0].id,
    );
    const secondDead = layout.tiles.find(
      (placement) => placement.tile.id === deadWall[1].id,
    );

    expect(firstLive).toBeDefined();
    expect(firstDead).toBeDefined();
    expect(secondDead).toBeDefined();
    expect(firstDead!.position[0]).toBeCloseTo(secondDead!.position[0], 5);
    expect(firstDead!.position[2]).toBeCloseTo(secondDead!.position[2], 5);
    expect(firstDead!.position[1]).toBeGreaterThan(secondDead!.position[1]);
    expect(distance(firstLive!.position, firstDead!.position)).toBeGreaterThan(
      tileSize.width,
    );
    expect(distance(firstLive!.position, firstDead!.position)).toBeLessThan(
      tileSize.width + tileSize.depth,
    );
  });

  test("packs player rows and wall sides edge to edge without corner overlap", () => {
    const replay = emptyReplayState();
    replay.wall = createTileSet().slice(0, 72);
    replay.players[0].hand = createTileSet().slice(72, 74);
    const layout = createThreeTableLayout(replay, undefined);
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

  test("animates a test-seed concealed kong from hand into melds", () => {
    const result = simulateRound({
      seed: "test-concealed-kong",
      bots: createBaselineBots(),
    });
    const kongIndex = result.events.findIndex(
      (event) => event.type === "kongDeclared" && event.kong === "concealed",
    );
    const kongEvent = result.events[kongIndex];
    const previousReplay = replayEvents(result.events, kongIndex - 1);
    const replay = replayEvents(result.events, kongIndex);
    const previousLayout = createThreeTableLayout(previousReplay, undefined);
    const layout = createThreeTableLayout(replay, kongEvent, previousReplay);

    expect(kongEvent?.type).toBe("kongDeclared");
    expect(layout.animations).toHaveLength(4);
    if (kongEvent?.type === "kongDeclared") {
      for (const tile of kongEvent.tiles) {
        const animation = layout.animations.find(
          (candidate) => candidate.tile.id === tile.id,
        );
        const previousPlacement = previousLayout.tiles.find(
          (placement) => placement.tile.id === tile.id,
        );
        const finalPlacement = layout.tiles.find(
          (placement) => placement.tile.id === tile.id,
        );

        expect(previousPlacement?.owner).toBe("hand");
        expect(finalPlacement?.owner).toBe("meld");
        expect(finalPlacement?.faceUp).toBe(false);
        expect(animation?.from).toEqual(previousPlacement?.position);
        expect(animation?.to).toEqual(finalPlacement?.position);
        expect(animation?.faceUp).toBe(false);
      }
    }
  });

  test("reveals concealed kong melds when a test fixture ends in a draw", () => {
    const result = simulateRound({
      seed: "test-concealed-kong",
      bots: createBaselineBots(),
    });
    const drawIndex = result.events.findIndex(
      (event) => event.type === "drawDeclared",
    );
    const previousReplay = replayEvents(result.events, drawIndex - 1);
    const replay = replayEvents(result.events, drawIndex);
    const drawEvent = result.events[drawIndex];
    const previousLayout = createThreeTableLayout(previousReplay, undefined);
    const layout = createThreeTableLayout(replay, drawEvent, previousReplay);
    const previousConcealedMelds = previousLayout.tiles.filter(
      (placement) => placement.owner === "meld" && !placement.faceUp,
    );
    const revealedMelds = layout.tiles.filter(
      (placement) =>
        placement.owner === "meld" &&
        previousConcealedMelds.some(
          (tile) => tile.tile.id === placement.tile.id,
        ),
    );

    expect(previousConcealedMelds).toHaveLength(4);
    expect(revealedMelds.every((placement) => placement.faceUp)).toBe(true);
    expect(layout.animations).toHaveLength(4);
    expect(
      layout.animations.every(
        (animation) =>
          animation.motion === "flipReveal" &&
          animation.faceUp === true &&
          animation.flipAxis !== undefined,
      ),
    ).toBe(true);
  });

  test("animates a test-seed added kong by moving the fourth tile from hand", () => {
    const result = simulateRound({
      seed: "test-added-kong",
      bots: createBaselineBots(),
    });
    const intentIndex = result.events.findIndex(
      (event) => event.type === "addedKongDeclared",
    );
    const intentEvent = result.events[intentIndex];
    const previousReplay = replayEvents(result.events, intentIndex - 1);
    const replay = replayEvents(result.events, intentIndex);
    const previousLayout = createThreeTableLayout(previousReplay, undefined);
    const layout = createThreeTableLayout(replay, intentEvent, previousReplay);

    expect(intentEvent?.type).toBe("addedKongDeclared");
    expect(layout.animations).toHaveLength(4);
    if (intentEvent?.type === "addedKongDeclared") {
      const addedAnimation = layout.animations.find(
        (animation) => animation.tile.id === intentEvent.addedTile.id,
      );
      const previousAddedPlacement = previousLayout.tiles.find(
        (placement) => placement.tile.id === intentEvent.addedTile.id,
      );
      const finalAddedPlacement = layout.tiles.find(
        (placement) => placement.tile.id === intentEvent.addedTile.id,
      );
      const existingMeldTiles = intentEvent.tiles.filter(
        (tile) => tile.id !== intentEvent.addedTile.id,
      );

      expect(previousAddedPlacement?.owner).toBe("hand");
      expect(finalAddedPlacement?.owner).toBe("meld");
      expect(addedAnimation?.from).toEqual(previousAddedPlacement?.position);
      expect(addedAnimation?.to).toEqual(finalAddedPlacement?.position);
      for (const tile of existingMeldTiles) {
        expect(
          previousLayout.tiles.find(
            (placement) => placement.tile.id === tile.id,
          )?.owner,
        ).toBe("meld");
      }
    }
  });

  test("reveals a winning hand flat with the winning tile to the right", () => {
    const tiles = createTileSet();
    const handTiles = tiles.slice(0, 3);
    const winningTile = tiles[3];
    const previousReplay = emptyReplayState();
    previousReplay.players[0].hand = handTiles;
    previousReplay.players[1].discards = [winningTile];

    const replay = emptyReplayState();
    replay.players[0].hand = [...handTiles, winningTile];
    replay.players[0].melds = [{ type: "pong", tiles: tiles.slice(4, 7) }];
    replay.players[0].flowers = tiles.slice(7, 9);
    const event: GameEvent = {
      type: "winDeclared",
      phase: "turn",
      groupId: "turn-1",
      turn: 1,
      player: 0,
      from: 1,
      tile: winningTile,
    };

    const previousLayout = createThreeTableLayout(previousReplay, undefined);
    const layout = createThreeTableLayout(replay, event, previousReplay);
    const winnerHand = layout.tiles
      .filter(
        (placement) => placement.owner === "hand" && placement.player === 0,
      )
      .sort((left, right) => left.position[0] - right.position[0]);
    const winningPlacement = winnerHand.find(
      (placement) => placement.tile.id === winningTile.id,
    );
    const winningAnimation = layout.animations.find(
      (animation) => animation.tile.id === winningTile.id,
    );
    const melds = layout.tiles.filter(
      (placement) => placement.owner === "meld" && placement.player === 0,
    );
    const flowers = layout.tiles.filter(
      (placement) => placement.owner === "flower" && placement.player === 0,
    );
    const previousDiscard = previousLayout.tiles.find(
      (placement) => placement.tile.id === winningTile.id,
    );

    expect(layout.animations).toHaveLength(4);
    expect(melds).toHaveLength(3);
    expect(flowers).toHaveLength(2);
    expect(winningPlacement?.position).toEqual(playerWinningTilePosition(0, 3));
    expect(winnerHand[0].position).toEqual(playerRevealedHandPosition(0, 0, 3));
    expect(winnerHand[0].rotation).toEqual([0, 0, 0]);
    expect(
      winningPlacement!.position[0] -
        (winnerHand[2].position[0] + tileSize.width),
    ).toBeCloseTo(tileSize.width, 5);
    expect(previousDiscard).toBeDefined();
    expect(winningAnimation?.from).toEqual(previousDiscard!.position);
    expect(winningAnimation?.to).toEqual(winningPlacement?.position);
    expect(winningAnimation?.motion).toBe("knockdown");
  });

  test("reveals concealed kong melds when a player wins", () => {
    const tiles = createTileSet();
    const concealedKongTiles = tiles.slice(20, 24);
    const previousReplay = emptyReplayState();
    previousReplay.players[0].hand = tiles.slice(0, 3);
    previousReplay.players[1].discards = [tiles[3]];
    previousReplay.players[2].melds = [
      { type: "kong", tiles: concealedKongTiles, concealed: true },
    ];

    const replay = emptyReplayState();
    replay.ended = true;
    replay.players[0].hand = tiles.slice(0, 4);
    replay.players[2].melds = [
      { type: "kong", tiles: concealedKongTiles, concealed: true },
    ];
    const event: GameEvent = {
      type: "winDeclared",
      phase: "turn",
      groupId: "turn-1",
      turn: 1,
      player: 0,
      from: 1,
      tile: tiles[3],
    };

    const previousLayout = createThreeTableLayout(previousReplay, undefined);
    const layout = createThreeTableLayout(replay, event, previousReplay);
    const previousConcealedMelds = previousLayout.tiles.filter(
      (placement) =>
        placement.owner === "meld" &&
        concealedKongTiles.some((tile) => tile.id === placement.tile.id),
    );
    const revealedMelds = layout.tiles.filter(
      (placement) =>
        placement.owner === "meld" &&
        concealedKongTiles.some((tile) => tile.id === placement.tile.id),
    );
    const revealAnimations = layout.animations.filter(
      (animation) => animation.motion === "flipReveal",
    );

    expect(previousConcealedMelds.every((placement) => !placement.faceUp)).toBe(
      true,
    );
    expect(revealedMelds.every((placement) => placement.faceUp)).toBe(true);
    expect(revealAnimations).toHaveLength(4);
    expect(revealAnimations.map((animation) => animation.flipAxis)).toEqual(
      Array.from({ length: 4 }, () => playerRight(2)),
    );
  });

  test("animates a test-seed robbed kong as a win from the declarer hand", () => {
    const result = simulateRound({
      seed: "test-rob-added-kong",
      bots: createBaselineBots(),
    });
    const winIndex = result.events.findIndex(
      (event) => event.type === "winDeclared",
    );
    const intentIndex = result.events.findIndex(
      (event) => event.type === "addedKongDeclared",
    );
    const winEvent = result.events[winIndex];
    const previousReplay = replayEvents(result.events, winIndex - 1);
    const replay = replayEvents(result.events, winIndex);
    const previousLayout = createThreeTableLayout(previousReplay, undefined);
    const layout = createThreeTableLayout(replay, winEvent, previousReplay);

    expect(result.events.some((event) => event.type === "kongDeclared")).toBe(
      false,
    );
    expect(intentIndex).toBe(winIndex - 1);
    expect(winEvent?.type).toBe("winDeclared");
    if (winEvent?.type === "winDeclared") {
      const previousRobbedTile = previousLayout.tiles.find(
        (placement) => placement.tile.id === winEvent.tile.id,
      );
      const winningPlacement = layout.tiles.find(
        (placement) =>
          placement.owner === "hand" &&
          placement.player === winEvent.player &&
          placement.tile.id === winEvent.tile.id,
      );
      const winningAnimation = layout.animations.find(
        (animation) => animation.tile.id === winEvent.tile.id,
      );

      expect(previousRobbedTile?.owner).toBe("meld");
      expect(previousRobbedTile?.player).toBe(winEvent.from);
      expect(winningPlacement).toBeDefined();
      expect(winningAnimation?.from).toEqual(previousRobbedTile?.position);
      expect(winningAnimation?.to).toEqual(winningPlacement?.position);
      expect(winningAnimation?.motion).toBe("knockdown");
    }
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
