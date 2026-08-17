import { describe, expect, test } from "bun:test";
import { createBaselineBot, createBaselineBots } from "../bots/baselineBot";
import type { MahjongBot } from "../bots/types";
import { claimPriority } from "./claimPriority";
import {
  createInitialRound,
  simulateRound,
  simulateRoundFromState,
  simulateTestScenarioRound,
} from "./engine";
import { analyzeHand, evaluateDiscard } from "./handAnalysis";
import { validateBetweenTurns } from "./invariants";
import { legalClaimActions } from "./legalActions";
import { replayEvents } from "./replay";
import { createSeededRng, shuffle } from "./rng";
import type { RoundState } from "./state";
import { createTestScenarioStartingState } from "./testScenarios";
import { createTileSet, type TileInstance, tileKey } from "./tiles";
import {
  createShuffledWalls,
  createWallBreak,
  physicalWallSlotMap,
  wallSideStacks,
  wallStackCount,
} from "./wall";
import { isWinningHand } from "./win";

describe("tile set", () => {
  test("generates a Taiwanese wall with unique tile instances", () => {
    const tiles = createTileSet();
    const ids = new Set(tiles.map((tile) => tile.id));
    const flowerCount = tiles.filter(
      (tile) => tile.kind.category === "flower",
    ).length;

    expect(tiles).toHaveLength(144);
    expect(ids.size).toBe(144);
    expect(flowerCount).toBe(8);
  });
});

describe("rng", () => {
  test("shuffles deterministically for a fixed seed", () => {
    const tiles = createTileSet();
    const left = shuffle(tiles, createSeededRng("fixed-seed")).map(
      (tile) => tile.id,
    );
    const right = shuffle(tiles, createSeededRng("fixed-seed")).map(
      (tile) => tile.id,
    );

    expect(left.slice(0, 12)).toEqual(right.slice(0, 12));
  });
});

describe("round setup", () => {
  test("derives the wall break from a deterministic three-dice roll", () => {
    const wallBreak = createWallBreak("wall-break-test", 0, [1, 2, 3]);

    expect(wallBreak).toEqual({
      dice: [1, 2, 3],
      diceTotal: 6,
      wallOwner: 1,
      cutStack: wallSideStacks + 6,
    });
  });

  test("starts live draws left of the counted cut stack", () => {
    const seed = "wall-cut-order";
    const { wall, deadWall, wallBreak } = createShuffledWalls(
      seed,
      0,
      [1, 2, 3],
    );
    const slots = physicalWallSlotMap(seed);
    const firstLiveSlot = slots.get(wall[0].id);
    const firstDeadSlot = slots.get(deadWall[0].id);
    const previousCutStack =
      (wallBreak.cutStack + wallStackCount - 1) % wallStackCount;

    expect(firstLiveSlot).toBe(previousCutStack + wallStackCount);
    expect(firstDeadSlot).toBe(wallBreak.cutStack + wallStackCount);
  });

  test("deals East 17 tiles, others 16 tiles, and reserves a dead wall", () => {
    const { state } = createInitialRound("deal-test");

    expect(state.players.map((player) => player.hand.length)).toEqual([
      17, 16, 16, 16,
    ]);
    expect(validateBetweenTurns(state)).toEqual([]);
    expect(state.deadWall).toHaveLength(16);
    expect(state.wall.length).toBeLessThanOrEqual(63);
    expect(state.wall.length).toBeGreaterThan(40);
  });

  test("uses the dead wall for flower supplements during setup", () => {
    const { events } = createInitialRound("stable-log");
    const supplement = events.find(
      (event) =>
        event.type === "tileDrawn" &&
        event.phase === "setup" &&
        event.replacement,
    );

    expect(supplement?.type).toBe("tileDrawn");
    if (supplement?.type === "tileDrawn") {
      expect(supplement.source).toBe("deadWall");
      expect(supplement.deadWallCount).toBe(16);
    }
  });
});

describe("bots", () => {
  test("baseline bot returns a legal discard", () => {
    const { state } = createInitialRound("bot-test");
    const player = state.players[0];
    const legalActions = player.hand.map((tile) => ({
      type: "discard" as const,
      tileId: tile.id,
    }));

    const action = createBaselineBot().chooseAction({
      player: 0,
      legalActions,
      visibleTiles: [],
      hand: player.hand,
      melds: player.melds,
      wallCount: state.wall.length,
      turn: 0,
    });

    expect(action.type).toBe("discard");
    if (action.type === "discard") {
      expect(legalActions).toContainEqual(action);
    }
  });

  test("baseline bot discards the tile that preserves better shanten and waits", () => {
    const hand = tilesByKinds([
      ["c1", 1],
      ["c2", 1],
      ["c3", 1],
      ["c4", 1],
      ["c5", 1],
      ["c6", 1],
      ["d1", 1],
      ["d2", 1],
      ["d3", 1],
      ["b1", 1],
      ["b2", 1],
      ["b3", 1],
      ["c7", 1],
      ["c8", 1],
      ["dragon-red", 2],
      ["wind-east", 1],
    ]);
    const legalActions = hand.map((tile) => ({
      type: "discard" as const,
      tileId: tile.id,
    }));

    const action = createBaselineBot().chooseAction({
      player: 0,
      legalActions,
      visibleTiles: [],
      hand,
      melds: [],
      wallCount: 60,
      turn: 0,
    });

    expect(action.type).toBe("discard");
    if (action.type === "discard") {
      const discarded = hand.find((tile) => tile.id === action.tileId);
      expect(discarded && tileKey(discarded.kind)).toBe("wind-east");
    }
  });

  test("baseline bot prefers disposable isolated terminals in discard ties", () => {
    const hand = tilesByKinds([
      ["c1", 1],
      ["c2", 1],
      ["c3", 1],
      ["c5", 1],
      ["c6", 1],
      ["c7", 1],
      ["d1", 1],
      ["d2", 1],
      ["d3", 1],
      ["b1", 1],
      ["b2", 1],
      ["b3", 1],
      ["dragon-red", 2],
      ["c9", 1],
      ["d5", 1],
    ]);
    const legalActions = hand.map((tile) => ({
      type: "discard" as const,
      tileId: tile.id,
    }));

    const action = createBaselineBot().chooseAction({
      player: 0,
      legalActions,
      visibleTiles: [],
      hand,
      melds: [],
      wallCount: 60,
      turn: 0,
    });

    expect(action.type).toBe("discard");
    if (action.type === "discard") {
      const discarded = hand.find((tile) => tile.id === action.tileId);
      expect(discarded && tileKey(discarded.kind)).toBe("c9");
    }
  });

  test("baseline bot chooses the strongest chow option", () => {
    const hand = tilesByKinds([
      ["c3", 1],
      ["c4", 1],
      ["c6", 1],
      ["c7", 1],
      ["d1", 1],
      ["d2", 1],
      ["d3", 1],
      ["b1", 1],
      ["b2", 1],
      ["b3", 1],
      ["wind-east", 2],
      ["dragon-red", 2],
      ["dragon-green", 2],
    ]);
    const discarded = tilesByKinds([["c5", 1]])[0];
    const c3 = hand.find((tile) => tileKey(tile.kind) === "c3");
    const c4 = hand.find((tile) => tileKey(tile.kind) === "c4");
    const c6 = hand.find((tile) => tileKey(tile.kind) === "c6");
    const c7 = hand.find((tile) => tileKey(tile.kind) === "c7");
    if (!c3 || !c4 || !c6 || !c7) {
      throw new Error("missing chow test tiles");
    }

    const action = createBaselineBot().chooseAction({
      player: 1,
      legalActions: [
        { type: "pass" },
        {
          type: "claim",
          claim: "chow",
          tileId: discarded.id,
          consumedTileIds: [c4.id, c6.id],
        },
        {
          type: "claim",
          claim: "chow",
          tileId: discarded.id,
          consumedTileIds: [c6.id, c7.id],
        },
        {
          type: "claim",
          claim: "chow",
          tileId: discarded.id,
          consumedTileIds: [c3.id, c4.id],
        },
      ],
      visibleTiles: [discarded],
      hand,
      melds: [],
      wallCount: 60,
      turn: 0,
    });

    expect(action).toEqual({
      type: "claim",
      claim: "chow",
      tileId: discarded.id,
      consumedTileIds: [c3.id, c4.id],
    });
  });

  test("baseline bot skips claimed kongs that reduce live waits", () => {
    const c5Tiles = tilesByKinds([["c5", 4]]);
    const hand = [
      ...tilesByKinds([
        ["c3", 1],
        ["c4", 1],
        ["c6", 1],
        ["c7", 1],
        ["d1", 1],
        ["d2", 1],
        ["d3", 1],
        ["b1", 1],
        ["b2", 1],
        ["b3", 1],
        ["wind-east", 2],
        ["dragon-red", 1],
      ]),
      ...c5Tiles.slice(0, 3),
    ];
    const discarded = c5Tiles[3];

    const action = createBaselineBot().chooseAction({
      player: 1,
      legalActions: [
        { type: "pass" },
        { type: "claim", claim: "kong", tileId: discarded.id },
      ],
      visibleTiles: [discarded],
      hand,
      melds: [],
      wallCount: 60,
      turn: 0,
    });

    expect(action).toEqual({ type: "pass" });
  });
});

describe("Taiwanese rule expectations", () => {
  test("claim precedence is win, kong, pong, then chow", () => {
    expect(
      ["win", "kong", "pong", "chow"].map((claim) =>
        claimPriority(claim as Parameters<typeof claimPriority>[0]),
      ),
    ).toEqual([4, 3, 2, 1]);
  });

  test("offers both pong and kong when holding three matching tiles", () => {
    const { state } = createInitialRound("pong-or-kong");
    const matchingTiles = tilesByKinds([["c5", 4]]);
    state.players[1].hand = matchingTiles.slice(0, 3);

    const actions = legalClaimActions(state, 1, 0, matchingTiles[3]).filter(
      (action) => action.type === "claim",
    );

    expect(actions).toContainEqual({
      type: "claim",
      claim: "pong",
      tileId: matchingTiles[3].id,
    });
    expect(actions).toContainEqual({
      type: "claim",
      claim: "kong",
      tileId: matchingTiles[3].id,
    });
  });

  test("hand analysis counts live waits after an improving discard", () => {
    const hand = tilesByKinds([
      ["c1", 1],
      ["c2", 1],
      ["c3", 1],
      ["c4", 1],
      ["c5", 1],
      ["c6", 1],
      ["d1", 1],
      ["d2", 1],
      ["d3", 1],
      ["b1", 1],
      ["b2", 1],
      ["b3", 1],
      ["c7", 1],
      ["c8", 1],
      ["dragon-red", 2],
      ["wind-east", 1],
    ]);
    const wind = hand.find((tile) => tileKey(tile.kind) === "wind-east");
    if (!wind) {
      throw new Error("missing wind tile");
    }

    const analysis = evaluateDiscard(hand, [], [], wind);

    expect(analysis.shanten).toBe(0);
    expect(analysis.waitKeys).toEqual(["c3", "c6", "c9"]);
    expect(analysis.liveWaits).toBe(10);
    expect(analyzeHand(hand, [], []).shanten).toBeGreaterThanOrEqual(
      analysis.shanten,
    );
  });
});

describe("simulation", () => {
  test("advances without illegal concealed hand sizes", () => {
    const result = simulateRound({
      seed: "size-invariant",
      bots: createBaselineBots(),
      maxTurns: 120,
    });

    for (const player of result.finalState.players) {
      expect(player.hand.length).toBeGreaterThanOrEqual(1);
      expect(player.hand.length).toBeLessThanOrEqual(17);
    }
    expect(
      result.events.filter((event) => event.type === "rulesError"),
    ).toEqual([]);
  });

  test("dealer discards on the first actual turn instead of drawing again", () => {
    const result = simulateRound({
      seed: "dealer-first-turn",
      bots: createBaselineBots(),
      maxTurns: 1,
    });
    const firstTurnEvents = result.events.filter(
      (event) => event.phase === "turn" && event.turn === 0,
    );

    expect(firstTurnEvents[0]?.type).toBe("tileDiscarded");
    if (firstTurnEvents[0]?.type === "tileDiscarded") {
      expect(firstTurnEvents[0].player).toBe(0);
      expect(firstTurnEvents[0].handCount).toBe(16);
    }
    expect(firstTurnEvents.some((event) => event.type === "tileDrawn")).toBe(
      false,
    );
    expect(firstTurnEvents.some((event) => event.type === "rulesError")).toBe(
      false,
    );
  });

  test("every turn boundary keeps concealed hand counts valid", () => {
    const result = simulateRound({
      seed: "turn-boundaries",
      bots: createBaselineBots(),
      maxTurns: 120,
    });

    expect(
      result.events.filter((event) => event.type === "rulesError"),
    ).toEqual([]);
  });

  test("keeps fixed-seed event logs stable", () => {
    const result = simulateRound({
      seed: "stable-log",
      bots: createBaselineBots(),
      maxTurns: 40,
    });
    const compactLog = result.events.slice(0, 10).map((event) => {
      if ("tile" in event && event.tile) {
        return `${event.type}:${event.player}:${tileKey(event.tile.kind)}`;
      }
      if (event.type === "tilesDrawn") {
        return `${event.type}:${event.player}:${event.tiles.map((tile) => tileKey(tile.kind)).join(",")}`;
      }
      return "wallCount" in event
        ? `${event.type}:${event.wallCount}`
        : event.type;
    });

    expect(compactLog).toEqual([
      "tilesDrawn:0:b8,dragon-red,d3,b5",
      "tilesDrawn:1:c3,d7,d1,b3",
      "tilesDrawn:2:c2,b8,c1,c9",
      "tilesDrawn:3:b4,season-3,c8,d4",
      "tilesDrawn:0:c8,c2,wind-north,c7",
      "tilesDrawn:1:d1,b3,d4,b5",
      "tilesDrawn:2:season-2,c6,flower-3,c3",
      "tilesDrawn:3:season-4,c8,b2,d2",
      "tilesDrawn:0:b9,d8,wind-east,b1",
      "tilesDrawn:1:d5,wind-south,dragon-white,b4",
    ]);
  });

  test("deals setup tiles in four-tile packets plus East opening tile", () => {
    const { events } = createInitialRound("setup-packets");
    const setupDraws = events.filter(
      (event) => event.type === "tilesDrawn" || event.type === "tileDrawn",
    );
    const packets = setupDraws.filter(
      (event) => event.type === "tilesDrawn" && event.source === "liveWall",
    );
    const openingDraw = [...setupDraws]
      .reverse()
      .find(
        (event) => event.type === "tileDrawn" && event.source === "liveWall",
      );

    expect(packets).toHaveLength(16);
    expect(
      packets.every(
        (event) => event.type === "tilesDrawn" && event.tiles.length === 4,
      ),
    ).toBe(true);
    expect(packets.map((event) => event.player)).toEqual([
      0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3,
    ]);
    expect(openingDraw?.type).toBe("tileDrawn");
    if (openingDraw?.type === "tileDrawn") {
      expect(openingDraw.player).toBe(0);
      expect(openingDraw.replacement).toBe(false);
    }
  });

  test("runs to a meaningful terminal event", () => {
    const result = simulateRound({
      seed: "smoke",
      bots: createBaselineBots(),
    });
    const finalEvent = result.events.at(-1);

    expect(finalEvent).toBeDefined();
    if (!finalEvent) {
      throw new Error("missing final event");
    }
    expect(["winDeclared", "drawDeclared"]).toContain(finalEvent.type);
    expect(result.finalState.ended).toBe(true);
  });

  test("marks setup and turn event groups", () => {
    const result = simulateRound({
      seed: "groups",
      bots: createBaselineBots(),
      maxTurns: 8,
    });
    const setupEvents = result.events.filter(
      (event) => event.phase === "setup",
    );
    const turnEvents = result.events.filter((event) => event.phase === "turn");

    expect(setupEvents.length).toBeGreaterThan(0);
    expect(setupEvents.every((event) => event.groupId === "setup")).toBe(true);
    expect(turnEvents.length).toBeGreaterThan(0);
    expect(
      turnEvents.every((event) => event.groupId === `turn-${event.turn}`),
    ).toBe(true);
  });

  test("declares concealed kongs and draws a supplement before discard", () => {
    const result = simulateRound({
      seed: "smart-concealed-9",
      bots: createBaselineBots(),
      maxTurns: 300,
    });
    const kongIndex = result.events.findIndex(
      (event) => event.type === "kongDeclared",
    );

    expect(kongIndex).toBeGreaterThan(-1);
    const kong = result.events[kongIndex];
    const replacement = result.events[kongIndex + 1];
    const discard = result.events[kongIndex + 2];

    expect(kong.type).toBe("kongDeclared");
    expect(replacement.type).toBe("tileDrawn");
    if (kong.type === "kongDeclared" && replacement.type === "tileDrawn") {
      expect(replacement.player).toBe(kong.player);
      expect(replacement.replacement).toBe(true);
      expect(replacement.source).toBe("deadWall");
    }
    expect(discard.type).toBe("tileDiscarded");
    if (kong.type === "kongDeclared" && discard.type === "tileDiscarded") {
      expect(discard.player).toBe(kong.player);
    }
  });

  test("test-concealed-kong demonstrates a concealed kong immediately after setup", () => {
    const result = simulateTestScenarioRound("test-concealed-kong");
    const kongIndex = result.events.findIndex(
      (event) => event.type === "kongDeclared",
    );
    const kong = result.events[kongIndex];
    const replacement = result.events[kongIndex + 1];
    const discard = result.events[kongIndex + 2];

    expect(result.events.some((event) => event.type === "rulesError")).toBe(
      false,
    );
    expect(kong?.type).toBe("kongDeclared");
    if (kong?.type === "kongDeclared") {
      expect(kong.kong).toBe("concealed");
      expect(kong.tiles).toHaveLength(4);
    }
    expect(replacement?.type).toBe("tileDrawn");
    if (replacement?.type === "tileDrawn") {
      expect(replacement.source).toBe("deadWall");
      expect(replacement.replacement).toBe(true);
    }
    expect(discard?.type).toBe("tileDiscarded");
  });

  test("claimed kongs wait for a supplement draw without a rules error", () => {
    const pick = tilePicker();
    const state = emptyRoundState();
    const discard = pick("c1", 1)[0];
    const supplement = pick("c9", 1)[0];
    state.currentPlayer = 0;
    state.turn = 1;
    state.needsDiscard = 0;
    state.discardSource = "draw";
    state.players[1].hand = [
      ...pick("c1", 3),
      ...[
        "c2",
        "c4",
        "c6",
        "c8",
        "d2",
        "d4",
        "d6",
        "d8",
        "b2",
        "b4",
        "b6",
        "b8",
        "dragon-red",
      ].flatMap((key) => pick(key, 1)),
    ];
    state.players[0].hand = [discard, ...pickFillerTiles(pick, 16, ["c1"])];
    state.players[2].hand = pickFillerTiles(pick, 16, ["c1"]);
    state.players[3].hand = pickFillerTiles(pick, 16, ["c1"]);
    state.deadWall = [supplement];

    const result = simulateRoundFromState({
      seed: "claimed-kong",
      state,
      bots: [
        discardSpecificBot(discard.id),
        claimKongBot(),
        passBot(),
        passBot(),
      ],
      maxTurns: 80,
    });
    const kongIndex = result.events.findIndex(
      (event) => event.type === "kongDeclared" && event.kong === "claimed",
    );

    expect(kongIndex).toBeGreaterThan(-1);
    expect(
      result.events.filter((event) => event.type === "rulesError"),
    ).toEqual([]);

    const kong = result.events[kongIndex];
    const replacement = result.events[kongIndex + 1];
    expect(kong.type).toBe("kongDeclared");
    if (kong.type !== "kongDeclared") {
      throw new Error("missing claimed kong event");
    }
    const discardEvent = result.events.find(
      (event, index) =>
        index > kongIndex &&
        event.type === "tileDiscarded" &&
        event.player === kong.player,
    );

    expect(kong.kong).toBe("claimed");
    expect(kong.from).toBeDefined();
    expect(kong.tile).toBeDefined();
    expect(replacement.type).toBe("tileDrawn");
    if (kong.type === "kongDeclared" && replacement.type === "tileDrawn") {
      expect(replacement.player).toBe(kong.player);
      expect(replacement.replacement).toBe(true);
      expect(replacement.source).toBe("deadWall");
    }
    expect(discardEvent?.type).toBe("tileDiscarded");
    if (
      kong.type === "kongDeclared" &&
      discardEvent?.type === "tileDiscarded"
    ) {
      expect(discardEvent.player).toBe(kong.player);
    }
  });

  test("simulateRound treats test scenario names as normal seeds", () => {
    const discardOnlyBot: MahjongBot = {
      name: "Discard only",
      chooseAction(context) {
        return (
          context.legalActions.find((action) => action.type === "discard") ??
          context.legalActions.find((action) => action.type === "pass") ??
          context.legalActions[0]
        );
      },
    };
    const result = simulateRound({
      seed: "test-concealed-kong",
      bots: [discardOnlyBot, discardOnlyBot, discardOnlyBot, discardOnlyBot],
      maxTurns: 1,
    });

    expect(result.events.some((event) => event.type === "kongDeclared")).toBe(
      false,
    );
  });

  test("allows multiple winners on the same discard", () => {
    const pick = tilePicker();
    const state = emptyRoundState();
    const discard = pick("c1", 1)[0];
    state.currentPlayer = 0;
    state.needsDiscard = 0;
    state.discardSource = "draw";
    state.players[0].hand = [
      discard,
      ...pick("c4", 2),
      ...pick("c5", 2),
      ...pick("c6", 2),
      ...pick("c7", 2),
      ...pick("c8", 2),
      ...pick("c9", 2),
      ...pick("wind-north", 4),
    ];
    state.players[1].hand = discardWinWait(pick, "wind-east", "dragon-red");
    state.players[2].hand = discardWinWait(pick, "wind-south", "dragon-green");

    const result = simulateRoundFromState({
      seed: "multi-discard-win",
      state,
      bots: [
        discardSpecificBot(discard.id),
        createBaselineBot(),
        createBaselineBot(),
        firstLegalBot(),
      ],
      maxTurns: 400,
    });
    const finalEvent = result.events.at(-1);

    expect(finalEvent?.type).toBe("winDeclared");
    expect(result.finalState.winners?.length).toBeGreaterThan(1);
    expect(result.finalState.players[1].winningTile?.id).toBe(discard.id);
    expect(result.finalState.players[2].winningTile?.id).toBe(discard.id);

    const replay = replayEvents(result.events);
    expect(replay.players[0].discards.map((tile) => tile.id)).not.toContain(
      discard.id,
    );
    expect(replay.players[1].hand.map((tile) => tile.id)).not.toContain(
      discard.id,
    );
    expect(replay.players[2].hand.map((tile) => tile.id)).not.toContain(
      discard.id,
    );
    expect(replay.players[1].winningTile?.id).toBe(discard.id);
    expect(replay.players[2].winningTile?.id).toBe(discard.id);
  });

  test("uses a draw event as the final event for non-winning rounds", () => {
    const result = simulateRound({
      seed: "turn-limit-draw",
      bots: createBaselineBots(),
      maxTurns: 1,
    });
    const finalEvent = result.events.at(-1);

    expect(finalEvent?.type).toBe("drawDeclared");
    if (finalEvent?.type === "drawDeclared") {
      expect(finalEvent.reason).toBe("turnLimit");
    }
  });

  test("recognizes Taiwanese seven pairs plus a triplet as a winning hand", () => {
    const hand = tilesByKinds([
      ["c1", 2],
      ["c2", 2],
      ["c3", 2],
      ["d4", 2],
      ["d5", 2],
      ["b6", 2],
      ["b7", 2],
      ["dragon-red", 3],
    ]);

    expect(isWinningHand(hand)).toBe(true);
  });

  test("replays the event log into matching visible player state", () => {
    const result = simulateRound({
      seed: "replay",
      bots: createBaselineBots(),
      maxTurns: 120,
    });
    const replay = replayEvents(result.events);

    expect(replay.wallCount).toBe(result.finalState.wall.length);
    expect(replay.wall.map((tile) => tile.id)).toEqual(
      result.finalState.wall.map((tile) => tile.id),
    );
    expect(replay.deadWall.map((tile) => tile.id)).toEqual(
      result.finalState.deadWall.map((tile) => tile.id),
    );
    for (const player of result.finalState.players) {
      const replayPlayer = replay.players[player.id];
      expect(replayPlayer.hand.map((tile) => tile.id).sort()).toEqual(
        expectedReplayHandIds(player).sort(),
      );
      expect(replayPlayer.discards.map((tile) => tile.id)).toEqual(
        player.discards.map((tile) => tile.id),
      );
      expect(replayPlayer.flowers.map((tile) => tile.id)).toEqual(
        player.flowers.map((tile) => tile.id),
      );
      expect(
        replayPlayer.melds.map((meld) => meld.tiles.map((tile) => tile.id)),
      ).toEqual(player.melds.map((meld) => meld.tiles.map((tile) => tile.id)));
      expect(replayPlayer.winningTile?.id).toBe(player.winningTile?.id);
    }
  });

  test("does not allow concealed kong declarations while discarding after a chow or pong claim", () => {
    const pick = tilePicker();
    const state = emptyRoundState();
    state.currentPlayer = 1;
    state.needsDiscard = 1;
    state.discardSource = "claim";
    state.players[1].melds.push({
      type: "pong",
      tiles: pick("d1", 3),
      claimedFrom: 0,
    });
    state.players[1].hand = [
      ...pick("c1", 4),
      ...pick("b1", 3),
      ...pick("b2", 3),
      ...pick("b3", 3),
      ...pick("wind-east", 1),
    ];

    const result = simulateRoundFromState({
      seed: "claim-discard-no-kong",
      state,
      bots: [
        firstLegalBot(),
        kongSeekingBot(),
        firstLegalBot(),
        firstLegalBot(),
      ],
      maxTurns: 1,
    });

    expect(result.events.some((event) => event.type === "kongDeclared")).toBe(
      false,
    );
    expect(result.events.at(0)?.type).toBe("tileDiscarded");
  });

  test("allows the dealer to win on the initial 17-tile hand", () => {
    const pick = tilePicker();
    const state = emptyRoundState();
    state.currentPlayer = 0;
    state.needsDiscard = 0;
    state.discardSource = "draw";
    state.players[0].hand = tilesForStartingWin(pick);

    const result = simulateRoundFromState({
      seed: "dealer-starting-win",
      state,
      bots: createBaselineBots(),
      maxTurns: 1,
    });

    expect(result.events.at(0)?.type).toBe("winDeclared");
    expect(result.finalState.winners).toEqual([0]);
    expect(result.events.some((event) => event.type === "tileDiscarded")).toBe(
      false,
    );
    expect(
      result.finalState.players[0].hand.map((tile) => tile.id),
    ).not.toContain(result.finalState.players[0].winningTile?.id);
  });

  test("separates a self-drawn winning tile from the replayed hand", () => {
    const pick = tilePicker();
    const state = emptyRoundState();
    const drawn = pick("c1", 1)[0];
    state.currentPlayer = 1;
    state.players[1].hand = discardWinWait(pick, "wind-east", "dragon-red");
    state.wall = [drawn];

    const result = simulateRoundFromState({
      seed: "self-draw-win",
      state,
      bots: createBaselineBots(),
      maxTurns: 1,
    });
    const win = result.events.at(-1);
    const replay = replayEvents(result.events);

    expect(win?.type).toBe("winDeclared");
    expect(result.finalState.players[1].winningTile?.id).toBe(drawn.id);
    expect(
      result.finalState.players[1].hand.map((tile) => tile.id),
    ).not.toContain(drawn.id);
    expect(replay.players[1].winningTile?.id).toBe(drawn.id);
    expect(replay.players[1].hand.map((tile) => tile.id)).not.toContain(
      drawn.id,
    );
  });

  test("uses the chow tile pair selected by the claiming action", () => {
    const pick = tilePicker();
    const state = emptyRoundState();
    const discard = pick("c5", 1)[0];
    state.currentPlayer = 0;
    state.needsDiscard = 0;
    state.discardSource = "draw";
    state.players[0].hand = [
      discard,
      ...pick("d1", 3),
      ...pick("d2", 3),
      ...pick("d3", 3),
      ...pick("b1", 3),
      ...pick("b2", 3),
      ...pick("wind-east", 1),
    ];
    const lowChow = pick("c3", 1);
    const lowChowSecond = pick("c4", 1);
    const chosenChow = pick("c6", 1);
    const chosenChowSecond = pick("c7", 1);
    state.players[1].hand = [
      ...lowChow,
      ...lowChowSecond,
      ...chosenChow,
      ...chosenChowSecond,
      ...pick("b4", 3),
      ...pick("b5", 3),
      ...pick("b6", 3),
      ...pick("dragon-red", 3),
    ];

    const result = simulateRoundFromState({
      seed: "chosen-chow",
      state,
      bots: [
        discardSpecificBot(discard.id),
        chowChoosingBot([chosenChow[0].id, chosenChowSecond[0].id]),
        firstLegalBot(),
        firstLegalBot(),
      ],
      maxTurns: 1,
    });

    const claim = result.events.find((event) => event.type === "claimMade");
    expect(claim?.type).toBe("claimMade");
    if (claim?.type === "claimMade") {
      expect(claim.claim).toBe("chow");
      expect(claim.tiles.map((tile) => tile.id).sort()).toEqual(
        [discard.id, chosenChow[0].id, chosenChowSecond[0].id].sort(),
      );
    }
  });

  test("does not replenish the dead wall when no supplement tile exists", () => {
    const pick = tilePicker();
    const state = emptyRoundState();
    state.currentPlayer = 0;
    state.needsReplacementDraw = 0;
    state.wall = pick("c9", 1);
    state.deadWall = [];
    state.players[0].hand = fillerTiles(pick, 13);

    const result = simulateRoundFromState({
      seed: "empty-dead-wall",
      state,
      bots: createBaselineBots(),
      maxTurns: 1,
    });

    expect(result.finalState.wall.map((tile) => tile.id)).toEqual(
      state.wall.map((tile) => tile.id),
    );
    expect(result.finalState.deadWall).toEqual([]);
    expect(result.events.at(-1)?.type).toBe("drawDeclared");
  });

  test("declares added kongs and draws a supplement before discarding", () => {
    const pick = tilePicker();
    const state = emptyRoundState();
    const addedTile = pick("c1", 1)[0];
    const supplement = pick("c9", 1)[0];
    state.currentPlayer = 0;
    state.needsDiscard = 0;
    state.discardSource = "draw";
    state.deadWall = [supplement];
    state.players[0].melds.push({
      type: "pong",
      tiles: pick("c1", 3),
      claimedFrom: 3,
    });
    state.players[0].hand = [
      addedTile,
      ...pick("d1", 3),
      ...pick("d2", 3),
      ...pick("d3", 3),
      ...pick("b1", 3),
      ...pick("wind-east", 1),
    ];

    const result = simulateRoundFromState({
      seed: "added-kong",
      state,
      bots: [
        kongSeekingBot(),
        firstLegalBot(),
        firstLegalBot(),
        firstLegalBot(),
      ],
      maxTurns: 1,
    });
    const intent = result.events[0];
    const kong = result.events[1];
    const draw = result.events[2];
    const discardEvent = result.events[3];

    expect(intent?.type).toBe("addedKongDeclared");
    expect(kong?.type).toBe("kongDeclared");
    if (kong?.type === "kongDeclared") {
      expect(kong.kong).toBe("added");
      expect(kong.addedTile?.id).toBe(addedTile.id);
    }
    expect(draw?.type).toBe("tileDrawn");
    if (draw?.type === "tileDrawn") {
      expect(draw.tile.id).toBe(supplement.id);
      expect(draw.replacement).toBe(true);
    }
    expect(discardEvent?.type).toBe("tileDiscarded");
    expect(result.finalState.players[0].melds[0].type).toBe("kong");
  });

  test("test-added-kong demonstrates adding a fourth tile to an exposed pong", () => {
    const result = simulateTestScenarioRound("test-added-kong");
    const kongIndex = result.events.findIndex(
      (event) => event.type === "kongDeclared" && event.kong === "added",
    );
    const intentIndex = result.events.findIndex(
      (event) => event.type === "addedKongDeclared",
    );
    const intent = result.events[intentIndex];
    const kong = result.events[kongIndex];
    const replacement = result.events[kongIndex + 1];

    expect(result.events.some((event) => event.type === "rulesError")).toBe(
      false,
    );
    expect(result.events[0]?.type).toBe("roundStarted");
    expect(intent?.type).toBe("addedKongDeclared");
    expect(kongIndex).toBeGreaterThan(intentIndex);
    expect(kong?.type).toBe("kongDeclared");
    if (kong?.type === "kongDeclared") {
      expect(kong.kong).toBe("added");
      expect(kong.addedTile).toBeDefined();
      expect(kong.tiles).toHaveLength(4);
    }
    expect(replacement?.type).toBe("tileDrawn");
    if (replacement?.type === "tileDrawn") {
      expect(replacement.source).toBe("deadWall");
      expect(replacement.replacement).toBe(true);
    }
  });

  test("allows opponents to rob an added kong before it is finalized", () => {
    const pick = tilePicker();
    const state = emptyRoundState();
    const robbedTile = pick("c1", 1)[0];
    state.currentPlayer = 0;
    state.needsDiscard = 0;
    state.discardSource = "draw";
    state.players[0].melds.push({
      type: "pong",
      tiles: pick("c1", 3),
      claimedFrom: 3,
    });
    state.players[0].hand = [
      robbedTile,
      ...pick("d7", 3),
      ...pick("d8", 3),
      ...pick("d9", 3),
      ...pick("b7", 3),
      ...pick("wind-north", 1),
    ];
    state.players[1].hand = [
      ...pick("c2", 1),
      ...pick("c3", 1),
      ...pick("d1", 1),
      ...pick("d2", 1),
      ...pick("d3", 1),
      ...pick("d4", 1),
      ...pick("d5", 1),
      ...pick("d6", 1),
      ...pick("b1", 1),
      ...pick("b2", 1),
      ...pick("b3", 1),
      ...pick("wind-east", 3),
      ...pick("dragon-red", 2),
    ];

    const result = simulateRoundFromState({
      seed: "rob-added-kong",
      state,
      bots: [
        kongSeekingBot(),
        createBaselineBot(),
        firstLegalBot(),
        firstLegalBot(),
      ],
      maxTurns: 1,
    });

    const intent = result.events.find(
      (event) => event.type === "addedKongDeclared",
    );
    expect(intent?.type).toBe("addedKongDeclared");
    expect(result.events.some((event) => event.type === "kongDeclared")).toBe(
      false,
    );
    const win = result.events.at(-1);
    expect(win?.type).toBe("winDeclared");
    if (win?.type === "winDeclared") {
      expect(win.player).toBe(1);
      expect(win.from).toBe(0);
      expect(win.tile.id).toBe(robbedTile.id);
    }
    expect(result.finalState.players[1].winningTile?.id).toBe(robbedTile.id);
    const replay = replayEvents(result.events);
    expect(replay.players[1].winningTile?.id).toBe(robbedTile.id);
    expect(replay.players[1].hand.map((tile) => tile.id)).not.toContain(
      robbedTile.id,
    );
  });

  test("test-rob-added-kong demonstrates robbing an added kong", () => {
    const result = simulateTestScenarioRound("test-rob-added-kong");
    const winIndex = result.events.findIndex(
      (event) => event.type === "winDeclared",
    );
    const intentIndex = result.events.findIndex(
      (event) => event.type === "addedKongDeclared",
    );
    const intent = result.events[intentIndex];
    const win = result.events[winIndex];

    expect(result.events.some((event) => event.type === "rulesError")).toBe(
      false,
    );
    expect(result.events.some((event) => event.type === "kongDeclared")).toBe(
      false,
    );
    expect(result.events[0]?.type).toBe("roundStarted");
    expect(intent?.type).toBe("addedKongDeclared");
    expect(winIndex).toBeGreaterThan(intentIndex);
    expect(win?.type).toBe("winDeclared");
    if (win?.type === "winDeclared") {
      expect(win.player).toBe(1);
      expect(win.from).toBe(0);
    }
    expect(result.finalState.players[1].winningTile).toBeDefined();
  });

  test("test-multi-discard-win demonstrates two winners on one discard", () => {
    const result = simulateTestScenarioRound("test-multi-discard-win");
    const discard = result.events.find(
      (event) => event.type === "tileDiscarded",
    );
    const wins = result.events.filter((event) => event.type === "winDeclared");

    expect(result.events.some((event) => event.type === "rulesError")).toBe(
      false,
    );
    expect(discard?.type).toBe("tileDiscarded");
    expect(wins).toHaveLength(2);
    expect(result.finalState.winners).toEqual([1, 2]);
    if (discard?.type === "tileDiscarded") {
      expect(wins.every((event) => event.tile.id === discard.tile.id)).toBe(
        true,
      );
    }
  });

  test("test-eight-flower-win demonstrates an eight-flower win", () => {
    const result = simulateTestScenarioRound("test-eight-flower-win");
    const flowerExposure = result.events.find(
      (event) => event.type === "flowerExposed",
    );
    const win = result.events.at(-1);
    const replay = replayEvents(result.events);

    expect(result.events.some((event) => event.type === "rulesError")).toBe(
      false,
    );
    expect(flowerExposure?.type).toBe("flowerExposed");
    expect(win?.type).toBe("winDeclared");
    if (
      flowerExposure?.type === "flowerExposed" &&
      win?.type === "winDeclared"
    ) {
      expect(win.player).toBe(0);
      expect(win.from).toBe(0);
      expect(win.tile.id).toBe(flowerExposure.tiles[0].id);
    }
    expect(result.finalState.players[0].flowers).toHaveLength(7);
    expect(result.finalState.players[0].winningTile).toBeDefined();
    expect(replay.players[0].flowers).toHaveLength(7);
    expect(replay.players[0].winningTile?.id).toBe(
      result.finalState.players[0].winningTile?.id,
    );
  });

  test("test-seven-flowers-rob-one demonstrates robbing an exposed flower", () => {
    const result = simulateTestScenarioRound("test-seven-flowers-rob-one");
    const flowerExposure = result.events.find(
      (event) => event.type === "flowerExposed",
    );
    const win = result.events.at(-1);
    const replay = replayEvents(result.events);

    expect(result.events.some((event) => event.type === "rulesError")).toBe(
      false,
    );
    expect(flowerExposure?.type).toBe("flowerExposed");
    expect(win?.type).toBe("winDeclared");
    if (
      flowerExposure?.type === "flowerExposed" &&
      win?.type === "winDeclared"
    ) {
      expect(win.player).toBe(1);
      expect(win.from).toBe(0);
      expect(win.tile.id).toBe(flowerExposure.tiles[0].id);
    }
    expect(result.finalState.players[0].flowers).toHaveLength(0);
    expect(result.finalState.players[1].flowers).toHaveLength(7);
    expect(result.finalState.players[1].winningTile).toBeDefined();
    expect(replay.players[0].flowers).toHaveLength(0);
    expect(replay.players[1].flowers).toHaveLength(7);
    expect(replay.players[1].winningTile?.id).toBe(
      result.finalState.players[1].winningTile?.id,
    );
  });

  test("test-anthony aliases the seven-flowers-robs-one fixture", () => {
    const result = simulateTestScenarioRound("test-anthony");
    const flowerExposure = result.events.find(
      (event) => event.type === "flowerExposed",
    );
    const win = result.events.at(-1);

    expect(flowerExposure?.type).toBe("flowerExposed");
    expect(win?.type).toBe("winDeclared");
    if (win?.type === "winDeclared") {
      expect(win.player).toBe(1);
      expect(win.from).toBe(0);
    }
    expect(result.finalState.players[1].flowers).toHaveLength(7);
    expect(result.finalState.players[1].winningTile).toBeDefined();
  });

  test("test-self-draw-win demonstrates a self-drawn win", () => {
    const result = simulateTestScenarioRound("test-self-draw-win");
    const drawIndex = result.events.findIndex(
      (event) =>
        event.type === "tileDrawn" &&
        event.phase === "turn" &&
        event.player === 1,
    );
    const draw = result.events[drawIndex];
    const win = result.events[drawIndex + 1];
    const replay = replayEvents(result.events);

    expect(draw?.type).toBe("tileDrawn");
    expect(win?.type).toBe("winDeclared");
    if (draw?.type === "tileDrawn" && win?.type === "winDeclared") {
      expect(win.player).toBe(1);
      expect(win.from).toBeUndefined();
      expect(win.tile.id).toBe(draw.tile.id);
      expect(replay.players[1].winningTile?.id).toBe(draw.tile.id);
      expect(replay.players[1].hand.map((tile) => tile.id)).not.toContain(
        draw.tile.id,
      );
    }
  });

  test("test scenario draws consume the expected fixture wall tiles", () => {
    const concealedStart = createTestScenarioStartingState(
      "test-concealed-kong",
    );
    const concealed = simulateTestScenarioRound("test-concealed-kong");
    const concealedReplacement = concealed.events.find(
      (event) => event.type === "tileDrawn" && event.replacement,
    );

    const addedStart = createTestScenarioStartingState("test-added-kong");
    const added = simulateTestScenarioRound("test-added-kong");
    const addedReplacement = added.events.find(
      (event) => event.type === "tileDrawn" && event.replacement,
    );

    const selfDrawStart = createTestScenarioStartingState("test-self-draw-win");
    const selfDraw = simulateTestScenarioRound("test-self-draw-win");
    const winningDraw = selfDraw.events.find(
      (event) => event.type === "tileDrawn" && !event.replacement,
    );

    expect(concealedReplacement?.type).toBe("tileDrawn");
    expect(addedReplacement?.type).toBe("tileDrawn");
    expect(winningDraw?.type).toBe("tileDrawn");
    if (
      concealedStart &&
      addedStart &&
      selfDrawStart &&
      concealedReplacement?.type === "tileDrawn" &&
      addedReplacement?.type === "tileDrawn" &&
      winningDraw?.type === "tileDrawn"
    ) {
      expect(concealedReplacement.source).toBe("deadWall");
      expect(concealedReplacement.tile.id).toBe(concealedStart.deadWall[0].id);
      expect(addedReplacement.source).toBe("deadWall");
      expect(addedReplacement.tile.id).toBe(addedStart.deadWall[0].id);
      expect(winningDraw.source).toBe("liveWall");
      expect(winningDraw.tile.id).toBe(selfDrawStart.wall[0].id);
    }
  });

  test("test-setup-flowers batches initial flower supplement draws", () => {
    const result = simulateTestScenarioRound("test-setup-flowers");
    const roundStartedIndex = result.events.findIndex(
      (event) => event.type === "roundStarted",
    );
    const setupSupplements = result.events.filter(
      (event) =>
        event.phase === "setup" &&
        ((event.type === "tileDrawn" && event.replacement) ||
          (event.type === "tilesDrawn" && event.replacement)),
    );
    const player1Supplement = setupSupplements.find(
      (event) => event.type === "tilesDrawn" && event.player === 1,
    );
    const player2Supplement = setupSupplements.find(
      (event) => event.type === "tilesDrawn" && event.player === 2,
    );
    const player0Supplements = setupSupplements.filter(
      (event) =>
        (event.type === "tileDrawn" || event.type === "tilesDrawn") &&
        event.player === 0,
    );
    const replay = replayEvents(result.events, roundStartedIndex);

    expect(roundStartedIndex).toBeGreaterThan(0);
    expect(
      result.events
        .slice(0, roundStartedIndex)
        .filter((event) => event.type === "flowerExposed")
        .map((event) => [event.player, event.tiles.length]),
    ).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
      [0, 1],
    ]);
    expect(player0Supplements).toHaveLength(2);
    expect(
      player0Supplements.every((event) => event.type === "tileDrawn"),
    ).toBe(true);
    expect(player1Supplement?.type).toBe("tilesDrawn");
    expect(player2Supplement?.type).toBe("tilesDrawn");
    if (
      player1Supplement?.type === "tilesDrawn" &&
      player2Supplement?.type === "tilesDrawn"
    ) {
      expect(player1Supplement.source).toBe("deadWall");
      expect(player1Supplement.tiles).toHaveLength(2);
      expect(player2Supplement.source).toBe("deadWall");
      expect(player2Supplement.tiles).toHaveLength(3);
    }
    expect(replay.players[0].flowers).toHaveLength(2);
    expect(replay.players[1].flowers).toHaveLength(2);
    expect(replay.players[2].flowers).toHaveLength(3);
  });

  test("records flower exposure explicitly and replays it", () => {
    const pick = tilePicker();
    const state = emptyRoundState();
    const flower = pick("flower-1", 1)[0];
    const supplement = pick("c9", 1)[0];
    state.currentPlayer = 0;
    state.wall = [flower];
    state.deadWall = [supplement];
    state.players[0].hand = [
      ...pick("d1", 3),
      ...pick("d2", 3),
      ...pick("d3", 3),
      ...pick("b1", 3),
      ...pick("b2", 3),
      ...pick("wind-east", 1),
    ];

    const result = simulateRoundFromState({
      seed: "flower-event",
      state,
      bots: createBaselineBots(),
      maxTurns: 1,
    });
    const replay = replayEvents(result.events);

    expect(result.events.slice(0, 3).map((event) => event.type)).toEqual([
      "tileDrawn",
      "flowerExposed",
      "tileDrawn",
    ]);
    expect(replay.players[0].flowers.map((tile) => tile.id)).toEqual([
      flower.id,
    ]);
    expect(replay.players[0].hand.some((tile) => tile.id === flower.id)).toBe(
      false,
    );
  });

  test("declares an eight-flower win when a player exposes the last flower", () => {
    const pick = tilePicker();
    const state = emptyRoundState();
    const flowers = [
      ...pick("flower-1", 1),
      ...pick("flower-2", 1),
      ...pick("flower-3", 1),
      ...pick("flower-4", 1),
      ...pick("season-1", 1),
      ...pick("season-2", 1),
      ...pick("season-3", 1),
      ...pick("season-4", 1),
    ];
    const finalFlower = flowers.at(-1)!;
    state.currentPlayer = 0;
    state.players[0].flowers = flowers.slice(0, 7);
    state.players[0].hand = fillerTiles(pick, 16);
    state.wall = [finalFlower];
    state.deadWall = fillerTiles(pick, 16);

    const result = simulateRoundFromState({
      seed: "eight-flower-win",
      state,
      bots: [passBot(), passBot(), passBot(), passBot()],
      maxTurns: 1,
    });
    const flowerExposure = result.events.find(
      (event) => event.type === "flowerExposed",
    );
    const win = result.events.at(-1);
    const replay = replayEvents(result.events);

    expect(flowerExposure?.type).toBe("flowerExposed");
    expect(win?.type).toBe("winDeclared");
    if (win?.type === "winDeclared") {
      expect(win.player).toBe(0);
      expect(win.from).toBe(0);
      expect(win.tile.id).toBe(finalFlower.id);
    }
    expect(result.finalState.players[0].flowers).toHaveLength(7);
    expect(result.finalState.players[0].winningTile?.id).toBe(finalFlower.id);
    expect(replay.players[0].winningTile?.id).toBe(finalFlower.id);
  });

  test("declares a seven-flowers-robs-one win from another exposed flower", () => {
    const pick = tilePicker();
    const state = emptyRoundState();
    const flowers = [
      ...pick("flower-1", 1),
      ...pick("flower-2", 1),
      ...pick("flower-3", 1),
      ...pick("flower-4", 1),
      ...pick("season-1", 1),
      ...pick("season-2", 1),
      ...pick("season-3", 1),
      ...pick("season-4", 1),
    ];
    const robbedFlower = flowers.at(-1)!;
    state.currentPlayer = 0;
    state.players[0].hand = fillerTiles(pick, 16);
    state.players[1].hand = fillerTiles(pick, 16);
    state.players[1].flowers = flowers.slice(0, 7);
    state.wall = [robbedFlower];
    state.deadWall = fillerTiles(pick, 16);

    const result = simulateRoundFromState({
      seed: "seven-flowers-rob-one",
      state,
      bots: [passBot(), passBot(), passBot(), passBot()],
      maxTurns: 1,
    });
    const win = result.events.at(-1);
    const replay = replayEvents(result.events);

    expect(win?.type).toBe("winDeclared");
    if (win?.type === "winDeclared") {
      expect(win.player).toBe(1);
      expect(win.from).toBe(0);
      expect(win.tile.id).toBe(robbedFlower.id);
    }
    expect(result.finalState.players[0].flowers).toHaveLength(0);
    expect(result.finalState.players[1].flowers).toHaveLength(7);
    expect(result.finalState.players[1].winningTile?.id).toBe(robbedFlower.id);
    expect(replay.players[0].flowers).toHaveLength(0);
    expect(replay.players[1].winningTile?.id).toBe(robbedFlower.id);
  });
});

function tilesByKinds(requested: [string, number][]): TileInstance[] {
  const tiles = createTileSet();
  return requested.flatMap(([key, count]) =>
    tiles.filter((tile) => tileKey(tile.kind) === key).slice(0, count),
  );
}

type TilePicker = (key: string, count: number) => TileInstance[];

function tilePicker(): TilePicker {
  const tiles = createTileSet();
  return (key, count) => {
    const picked: TileInstance[] = [];
    for (
      let index = tiles.length - 1;
      index >= 0 && picked.length < count;
      index -= 1
    ) {
      if (tileKey(tiles[index].kind) !== key) {
        continue;
      }
      picked.push(tiles.splice(index, 1)[0]);
    }
    if (picked.length !== count) {
      throw new Error(`Could not pick ${count} tiles for ${key}.`);
    }
    return picked;
  };
}

function emptyRoundState(): RoundState {
  return {
    players: [
      { id: 0, hand: [], flowers: [], discards: [], melds: [] },
      { id: 1, hand: [], flowers: [], discards: [], melds: [] },
      { id: 2, hand: [], flowers: [], discards: [], melds: [] },
      { id: 3, hand: [], flowers: [], discards: [], melds: [] },
    ],
    wall: [],
    deadWall: [],
    currentPlayer: 0,
    dealer: 0,
    turn: 0,
    ended: false,
  };
}

function expectedReplayHandIds(
  player: RoundState["players"][number],
): string[] {
  return player.hand.map((tile) => tile.id);
}

function tilesForStartingWin(pick: TilePicker): TileInstance[] {
  return [
    ...pick("c1", 1),
    ...pick("c2", 1),
    ...pick("c3", 1),
    ...pick("c4", 1),
    ...pick("c5", 1),
    ...pick("c6", 1),
    ...pick("d1", 1),
    ...pick("d2", 1),
    ...pick("d3", 1),
    ...pick("b1", 1),
    ...pick("b2", 1),
    ...pick("b3", 1),
    ...pick("wind-east", 3),
    ...pick("dragon-red", 2),
  ];
}

function discardWinWait(
  pick: TilePicker,
  tripletKey: string,
  pairKey: string,
): TileInstance[] {
  return [
    ...pick("c2", 1),
    ...pick("c3", 1),
    ...pick("d1", 1),
    ...pick("d2", 1),
    ...pick("d3", 1),
    ...pick("d4", 1),
    ...pick("d5", 1),
    ...pick("d6", 1),
    ...pick("b1", 1),
    ...pick("b2", 1),
    ...pick("b3", 1),
    ...pick(tripletKey, 3),
    ...pick(pairKey, 2),
  ];
}

function fillerTiles(pick: TilePicker, count: number): TileInstance[] {
  const keys = [
    "c1",
    "c2",
    "c3",
    "c4",
    "c5",
    "c6",
    "c7",
    "c8",
    "c9",
    "d1",
    "d2",
    "d3",
    "d4",
    "d5",
    "d6",
    "d7",
    "d8",
    "d9",
    "b1",
    "b2",
    "b3",
    "b4",
    "b5",
    "b6",
    "b7",
    "b8",
    "b9",
  ];
  const tiles: TileInstance[] = [];
  for (const key of keys) {
    while (tiles.length < count) {
      try {
        tiles.push(...pick(key, 1));
      } catch {
        break;
      }
    }
    if (tiles.length === count) {
      return tiles;
    }
  }
  throw new Error(`Could not pick ${count} filler tiles.`);
}

function firstLegalBot(name = "First Legal"): MahjongBot {
  return {
    name,
    chooseAction(context) {
      return context.legalActions[0];
    },
  };
}

function passBot(): MahjongBot {
  return {
    name: "Pass",
    chooseAction(context) {
      return (
        context.legalActions.find((action) => action.type === "pass") ??
        context.legalActions[0]
      );
    },
  };
}

function claimKongBot(): MahjongBot {
  return {
    name: "Claim Kong",
    chooseAction(context) {
      return (
        context.legalActions.find(
          (action) => action.type === "claim" && action.claim === "kong",
        ) ??
        context.legalActions.find((action) => action.type === "discard") ??
        context.legalActions[0]
      );
    },
  };
}

function kongSeekingBot(): MahjongBot {
  return {
    name: "Kong Seeking",
    chooseAction(context) {
      return (
        context.legalActions.find((action) => action.type === "declareKong") ??
        context.legalActions.find((action) => action.type === "discard") ??
        context.legalActions[0]
      );
    },
  };
}

function pickFillerTiles(
  pick: TilePicker,
  count: number,
  excludedKeys: string[] = [],
): TileInstance[] {
  const tiles: TileInstance[] = [];
  for (const key of fillerTileKeys) {
    if (excludedKeys.includes(key)) {
      continue;
    }
    while (tiles.length < count) {
      try {
        tiles.push(...pick(key, 1));
      } catch {
        break;
      }
    }
    if (tiles.length === count) {
      return tiles;
    }
  }
  throw new Error(`Could not pick ${count} filler tiles.`);
}

const fillerTileKeys = [
  "c1",
  "c2",
  "c3",
  "c4",
  "c5",
  "c6",
  "c7",
  "c8",
  "c9",
  "d1",
  "d2",
  "d3",
  "d4",
  "d5",
  "d6",
  "d7",
  "d8",
  "d9",
  "b1",
  "b2",
  "b3",
  "b4",
  "b5",
  "b6",
  "b7",
  "b8",
  "b9",
  "wind-east",
  "wind-south",
  "wind-west",
  "wind-north",
  "dragon-red",
  "dragon-green",
  "dragon-white",
];

function discardSpecificBot(tileId: string): MahjongBot {
  return {
    name: "Specific Discard",
    chooseAction(context) {
      return (
        context.legalActions.find(
          (action) => action.type === "discard" && action.tileId === tileId,
        ) ?? context.legalActions[0]
      );
    },
  };
}

function chowChoosingBot(consumedTileIds: [string, string]): MahjongBot {
  return {
    name: "Chow Choosing",
    chooseAction(context) {
      return (
        context.legalActions.find(
          (action) =>
            action.type === "claim" &&
            action.claim === "chow" &&
            action.consumedTileIds?.join("|") === consumedTileIds.join("|"),
        ) ?? { type: "pass" }
      );
    },
  };
}
