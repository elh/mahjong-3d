import { describe, expect, test } from "bun:test";
import { createBaselineBot, createBaselineBots } from "../bots/baselineBot";
import { claimPriority } from "./claimPriority";
import { createInitialRound, simulateRound } from "./engine";
import { analyzeHand, evaluateDiscard } from "./handAnalysis";
import { validateBetweenTurns } from "./invariants";
import { createSeededRng, shuffle } from "./rng";
import { replayEvents } from "./replay";
import { createTileSet, tileKey, type TileInstance } from "./tiles";
import { isWinningHand } from "./win";

describe("tile set", () => {
  test("generates a Taiwanese wall with unique tile instances", () => {
    const tiles = createTileSet();
    const ids = new Set(tiles.map((tile) => tile.id));
    const flowerCount = tiles.filter((tile) => tile.kind.category === "flower").length;

    expect(tiles).toHaveLength(144);
    expect(ids.size).toBe(144);
    expect(flowerCount).toBe(8);
  });
});

describe("rng", () => {
  test("shuffles deterministically for a fixed seed", () => {
    const tiles = createTileSet();
    const left = shuffle(tiles, createSeededRng("fixed-seed")).map((tile) => tile.id);
    const right = shuffle(tiles, createSeededRng("fixed-seed")).map((tile) => tile.id);

    expect(left.slice(0, 12)).toEqual(right.slice(0, 12));
  });
});

describe("round setup", () => {
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
      (event) => event.type === "tileDrawn" && event.phase === "setup" && event.replacement,
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
});

describe("Taiwanese rule expectations", () => {
  test("claim precedence is win, kong, pong, then chow", () => {
    expect(
      ["win", "kong", "pong", "chow"].map((claim) =>
        claimPriority(claim as Parameters<typeof claimPriority>[0]),
      ),
    ).toEqual([4, 3, 2, 1]);
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
    expect(analyzeHand(hand, [], []).shanten).toBeGreaterThanOrEqual(analysis.shanten);
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
    expect(result.events.filter((event) => event.type === "rulesError")).toEqual([]);
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
    expect(firstTurnEvents.some((event) => event.type === "tileDrawn")).toBe(false);
    expect(firstTurnEvents.some((event) => event.type === "rulesError")).toBe(false);
  });

  test("every turn boundary keeps concealed hand counts valid", () => {
    const result = simulateRound({
      seed: "turn-boundaries",
      bots: createBaselineBots(),
      maxTurns: 120,
    });

    expect(result.events.filter((event) => event.type === "rulesError")).toEqual([]);
  });

  test("keeps fixed-seed event logs stable", () => {
    const result = simulateRound({
      seed: "stable-log",
      bots: createBaselineBots(),
      maxTurns: 40,
    });
    const compactLog = result.events.slice(0, 10).map((event) => {
      if ("tile" in event) {
        return `${event.type}:${event.player}:${tileKey(event.tile.kind)}`;
      }
      return "wallCount" in event ? `${event.type}:${event.wallCount}` : event.type;
    });

    expect(compactLog).toEqual([
      "tileDrawn:0:d5",
      "tileDrawn:1:b1",
      "tileDrawn:2:c3",
      "tileDrawn:3:dragon-green",
      "tileDrawn:0:d4",
      "tileDrawn:1:wind-east",
      "tileDrawn:2:b3",
      "tileDrawn:3:c2",
      "tileDrawn:0:d9",
      "tileDrawn:1:d6",
    ]);
  });

  test("runs to a terminal round event", () => {
    const result = simulateRound({
      seed: "smoke",
      bots: createBaselineBots(),
    });
    const finalEvent = result.events.at(-1);

    expect(finalEvent?.type).toBe("roundEnded");
    expect(result.finalState.ended).toBe(true);
  });

  test("marks setup and turn event groups", () => {
    const result = simulateRound({
      seed: "groups",
      bots: createBaselineBots(),
      maxTurns: 8,
    });
    const setupEvents = result.events.filter((event) => event.phase === "setup");
    const turnEvents = result.events.filter((event) => event.phase === "turn");

    expect(setupEvents.length).toBeGreaterThan(0);
    expect(setupEvents.every((event) => event.groupId === "setup")).toBe(true);
    expect(turnEvents.length).toBeGreaterThan(0);
    expect(turnEvents.every((event) => event.groupId === `turn-${event.turn}`)).toBe(
      true,
    );
  });

  test("declares concealed kongs and draws a supplement before discard", () => {
    const result = simulateRound({
      seed: "smart-concealed-4",
      bots: createBaselineBots(),
      maxTurns: 300,
    });
    const kongIndex = result.events.findIndex((event) => event.type === "kongDeclared");

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

  test("claimed kongs wait for a supplement draw without a rules error", () => {
    const result = simulateRound({
      seed: "kong-bug-1",
      bots: createBaselineBots(),
      maxTurns: 80,
    });
    const kongIndex = result.events.findIndex(
      (event) => event.type === "claimMade" && event.claim === "kong",
    );

    expect(kongIndex).toBeGreaterThan(-1);
    expect(result.events.filter((event) => event.type === "rulesError")).toEqual([]);

    const kong = result.events[kongIndex];
    const replacement = result.events[kongIndex + 1];
    const discard = result.events[kongIndex + 2];

    expect(kong.type).toBe("claimMade");
    expect(replacement.type).toBe("tileDrawn");
    if (kong.type === "claimMade" && replacement.type === "tileDrawn") {
      expect(replacement.player).toBe(kong.player);
      expect(replacement.replacement).toBe(true);
      expect(replacement.source).toBe("deadWall");
    }
    expect(discard.type).toBe("tileDiscarded");
    if (kong.type === "claimMade" && discard.type === "tileDiscarded") {
      expect(discard.player).toBe(kong.player);
      expect(discard.handCount).toBe(13);
    }
  });

  test("allows multiple winners on the same discard", () => {
    const result = simulateRound({
      seed: "smart-multi-12",
      bots: createBaselineBots(),
      maxTurns: 400,
    });
    const finalEvent = result.events.at(-1);

    expect(finalEvent?.type).toBe("roundEnded");
    if (finalEvent?.type === "roundEnded") {
      expect(finalEvent.reason).toBe("win");
      expect(finalEvent.winners?.length).toBeGreaterThan(1);
    }
    expect(result.finalState.winners?.length).toBeGreaterThan(1);
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
        player.hand.map((tile) => tile.id).sort(),
      );
      expect(replayPlayer.discards.map((tile) => tile.id)).toEqual(
        player.discards.map((tile) => tile.id),
      );
      expect(replayPlayer.flowers.map((tile) => tile.id)).toEqual(
        player.flowers.map((tile) => tile.id),
      );
      expect(replayPlayer.melds.map((meld) => meld.tiles.map((tile) => tile.id))).toEqual(
        player.melds.map((meld) => meld.tiles.map((tile) => tile.id)),
      );
    }
  });
});

function tilesByKinds(requested: [string, number][]): TileInstance[] {
  const tiles = createTileSet();
  return requested.flatMap(([key, count]) =>
    tiles.filter((tile) => tileKey(tile.kind) === key).slice(0, count),
  );
}
