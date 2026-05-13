import { eventMeta, type GameEvent } from "./events";
import {
  cloneRoundState,
  createPlayers,
  type PlayerId,
  type RoundState,
} from "./state";
import {
  createTileSet,
  isFlower,
  sortTiles,
  type TileInstance,
  tileKey,
} from "./tiles";
import { createWallBreak, type WallState } from "./wall";

export type TestScenarioRound = {
  state: RoundState;
  events: GameEvent[];
  maxTurns: number;
};

const testScenarioWallBreakDice: [number, number, number] = [1, 2, 3];

/**
 * Scripted demonstration fixture seeds for replay/UI testing.
 *
 * These are not normal RNG seeds. Callers that want these scenarios must opt
 * into the fixture path explicitly; the normal simulation API should continue
 * to respect caller-provided bots for every seed string.
 */
export const testScenarioSeeds = [
  "test-concealed-kong",
  "test-added-kong",
  "test-rob-added-kong",
  "test-self-draw-win",
] as const;

export type TestScenarioSeed = (typeof testScenarioSeeds)[number];

export function isTestScenarioSeed(seed: string): seed is TestScenarioSeed {
  return testScenarioSeeds.includes(seed as TestScenarioSeed);
}

export function createTestScenarioRound(
  seed: TestScenarioSeed,
): TestScenarioRound | undefined {
  const state = createTestScenarioStartingState(seed);
  if (!state) {
    return undefined;
  }
  return {
    state: cloneRoundState(state),
    events: [roundStartedEvent(seed, state)],
    maxTurns: state.turn + 1,
  };
}

export function createTestScenarioStartingState(
  seed: TestScenarioSeed,
): RoundState | undefined {
  if (seed === "test-concealed-kong") {
    return createConcealedKongStartingState(seed);
  }
  if (seed === "test-added-kong") {
    return createAddedKongStartingState(seed, false);
  }
  if (seed === "test-rob-added-kong") {
    return createAddedKongStartingState(seed, true);
  }
  if (seed === "test-self-draw-win") {
    return createSelfDrawWinStartingState(seed);
  }
  return undefined;
}

export function createTestScenarioWalls(
  seed: TestScenarioSeed,
): WallState | undefined {
  const state = createTestScenarioStartingState(seed);
  if (!state) {
    return undefined;
  }
  return {
    wall: [...state.wall],
    deadWall: [...state.deadWall],
    wallBreak: createWallBreak(seed, state.dealer, testScenarioWallBreakDice),
  };
}

function createConcealedKongStartingState(seed: string): RoundState {
  const pool = createTilePool();
  const state = emptyRoundState(0, 0);
  state.needsDiscard = 0;
  state.discardSource = "draw";
  state.players[0].hand = sortTiles([
    ...pool.take("b2", 4),
    ...pool.takeOneEach([
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
    ]),
  ]);
  fillPlayerHands(pool, state);
  assignWalls(state, createFixtureWalls(seed, state.dealer, pool));
  return state;
}

function createAddedKongStartingState(
  seed: string,
  robbable: boolean,
): RoundState {
  const pool = createTilePool();
  const state = emptyRoundState(0, 0);
  const pongTiles = pool.take("b2", 3);
  const addedTile = pool.take("b2", 1)[0];

  state.needsDiscard = 0;
  state.discardSource = "draw";
  state.players[0].melds.push({
    type: "pong",
    tiles: sortTiles(pongTiles),
    claimedFrom: 3,
  });
  state.players[0].hand = sortTiles([
    addedTile,
    ...pool.takeOneEach([
      "c4",
      "c5",
      "c6",
      "c7",
      "c8",
      "c9",
      "d7",
      "d8",
      "d9",
      "wind-south",
      "wind-west",
      "wind-north",
      "dragon-green",
    ]),
  ]);

  if (robbable) {
    state.players[1].hand = sortTiles([
      ...pool.takeOneEach(["b3", "b4", "c1", "c2", "c3", "d1", "d2", "d3"]),
      ...pool.takeOneEach(["d4", "d5", "d6"]),
      ...pool.take("wind-east", 3),
      ...pool.take("dragon-red", 2),
    ]);
  }

  fillPlayerHands(pool, state);
  assignWalls(state, createFixtureWalls(seed, state.dealer, pool));
  return state;
}

function createSelfDrawWinStartingState(seed: string): RoundState {
  const pool = createTilePool();
  const state = emptyRoundState(0, 1);
  const winningTile = pool.take("c1", 1)[0];

  state.players[1].hand = sortTiles([
    ...pool.takeOneEach(["c2", "c3", "d1", "d2", "d3", "d4", "d5", "d6"]),
    ...pool.takeOneEach(["b1", "b2", "b3"]),
    ...pool.take("wind-east", 3),
    ...pool.take("dragon-red", 2),
  ]);
  fillPlayerHands(pool, state);
  assignWalls(
    state,
    createFixtureWalls(seed, state.dealer, pool, [winningTile]),
  );
  return state;
}

function emptyRoundState(
  dealer: PlayerId,
  currentPlayer: PlayerId,
): RoundState {
  return {
    players: createPlayers(),
    wall: [],
    deadWall: [],
    currentPlayer,
    dealer,
    turn: 0,
    ended: false,
  };
}

function fillPlayerHands(pool: TilePool, state: RoundState): void {
  for (const player of state.players) {
    const openTileCount = player.melds.reduce(
      (count, meld) => count + meld.tiles.length,
      0,
    );
    const targetCount =
      16 - openTileCount + (player.id === state.needsDiscard ? 1 : 0);
    if (player.hand.length > targetCount) {
      throw new Error(`Test scenario hand ${player.id} has too many tiles.`);
    }
    player.hand = sortTiles([
      ...player.hand,
      ...pool.takeFill(targetCount - player.hand.length),
    ]);
  }
}

function createFixtureWalls(
  seed: string,
  dealer: PlayerId,
  pool: TilePool,
  liveDraws: TileInstance[] = [],
): WallState {
  const supplement = pool.takeFill(1)[0];
  const deadWall = [supplement, ...pool.takeFill(15)];
  const liveWall = [
    ...liveDraws,
    ...pool
      .remaining()
      .filter((tile) => !deadWall.some((dead) => dead.id === tile.id)),
  ];
  return {
    wall: liveWall,
    deadWall,
    wallBreak: createWallBreak(seed, dealer, testScenarioWallBreakDice),
  };
}

function assignWalls(state: RoundState, walls: WallState): void {
  state.wall = [...walls.wall];
  state.deadWall = [...walls.deadWall];
}

function roundStartedEvent(
  seed: string,
  state: RoundState,
): Extract<GameEvent, { type: "roundStarted" }> {
  return {
    ...eventMeta("setup", 0),
    type: "roundStarted",
    seed,
    dealer: state.dealer,
    wallBreak: createWallBreak(seed, state.dealer, testScenarioWallBreakDice),
    wallCount: state.wall.length,
    deadWallCount: state.deadWall.length,
    handCounts: state.players.map((player) => player.hand.length) as [
      number,
      number,
      number,
      number,
    ],
  };
}

type TilePool = {
  take(key: string, count: number): TileInstance[];
  takeOneEach(keys: string[]): TileInstance[];
  takeFill(count: number, excludedKeys?: Set<string>): TileInstance[];
  remaining(): TileInstance[];
};

function createTilePool(): TilePool {
  const tiles = createTileSet();
  return {
    take(key, count) {
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
        throw new Error(`Test scenario could not pick ${count} ${key} tiles.`);
      }
      return picked;
    },
    takeOneEach(keys) {
      return keys.map((key) => this.take(key, 1)[0]);
    },
    takeFill(count, excludedKeys = new Set()) {
      const picked: TileInstance[] = [];
      for (
        let index = tiles.length - 1;
        index >= 0 && picked.length < count;
        index -= 1
      ) {
        const tile = tiles[index];
        if (isFlower(tile) || excludedKeys.has(tileKey(tile.kind))) {
          continue;
        }
        picked.push(tiles.splice(index, 1)[0]);
      }
      if (picked.length !== count) {
        throw new Error(`Test scenario could not pick ${count} filler tiles.`);
      }
      return picked;
    },
    remaining() {
      return [...tiles];
    },
  };
}
