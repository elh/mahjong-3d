import { eventMeta, type GameEvent } from "./events";
import {
  cloneRoundState,
  createPlayers,
  type PlayerId,
  type RoundState,
} from "./state";
import { removeTile } from "./tileCollections";
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
  if (seed === "test-concealed-kong") {
    return createConcealedKongScenario(seed);
  }
  if (seed === "test-added-kong") {
    return createAddedKongScenario(seed);
  }
  if (seed === "test-rob-added-kong") {
    return createRobAddedKongScenario(seed);
  }
  if (seed === "test-self-draw-win") {
    return createSelfDrawWinScenario(seed);
  }
  return undefined;
}

export function createTestScenarioWalls(
  seed: TestScenarioSeed,
): WallState | undefined {
  if (seed === "test-concealed-kong") {
    return createConcealedKongFixture(seed).walls;
  }
  if (seed === "test-added-kong") {
    return createAddedKongFixture(seed).walls;
  }
  if (seed === "test-rob-added-kong") {
    return createRobAddedKongFixture(seed).walls;
  }
  if (seed === "test-self-draw-win") {
    return createSelfDrawWinFixture(seed).walls;
  }
  return undefined;
}

function createConcealedKongScenario(seed: string): TestScenarioRound {
  const fixture = createConcealedKongFixture(seed);
  const { state, events } = createRoundAfterSetup(fixture);

  state.currentPlayer = 0;
  state.needsDiscard = 0;
  state.discardSource = "draw";
  state.turn = 0;

  return {
    state: cloneRoundState(state),
    events,
    maxTurns: 1,
  };
}

function createAddedKongScenario(seed: string): TestScenarioRound {
  const fixture = createAddedKongFixture(seed);
  return createAddedKongScenarioFromFixture(fixture);
}

function createRobAddedKongScenario(seed: string): TestScenarioRound {
  const fixture = createRobAddedKongFixture(seed);
  return createAddedKongScenarioFromFixture(fixture);
}

function createSelfDrawWinScenario(seed: string): TestScenarioRound {
  const fixture = createSelfDrawWinFixture(seed);
  const { state, events } = createRoundAfterSetup(fixture);

  state.currentPlayer = 1;
  state.turn = 1;

  return {
    state: cloneRoundState(state),
    events,
    maxTurns: 2,
  };
}

function createAddedKongScenarioFromFixture(
  fixture: Required<ScenarioFixture>,
): TestScenarioRound {
  const { state, events } = createRoundAfterSetup(fixture);

  discardTile(state, events, 3, fixture.claimedTile, 1);
  claimPong(state, events, 0, 3, fixture.claimedTile, fixture.pongHandTiles, 1);
  discardTile(state, events, 0, fixture.eastDiscardAfterClaim, 1);
  drawLiveTile(state, events, 0, fixture.addedTile, 2);

  state.currentPlayer = 0;
  state.needsDiscard = 0;
  state.discardSource = "draw";
  state.turn = 2;

  return {
    state: cloneRoundState(state),
    events,
    maxTurns: 3,
  };
}

type ScenarioFixture = {
  seed: string;
  dealer: PlayerId;
  hands: [TileInstance[], TileInstance[], TileInstance[], TileInstance[]];
  walls: WallState;
  claimedTile?: TileInstance;
  pongHandTiles?: TileInstance[];
  addedTile?: TileInstance;
  eastDiscardAfterClaim?: TileInstance;
};

function createConcealedKongFixture(seed: string): ScenarioFixture {
  const pool = createTilePool();
  const kongKey = "b2";
  const hands = emptyHands();
  hands[0] = [
    ...pool.take(kongKey, 4),
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
  ];
  fillHands(pool, hands, 0);
  return {
    seed,
    dealer: 0,
    hands,
    walls: createOrderedWalls(seed, pool, hands, 0),
  };
}

function createAddedKongFixture(seed: string): Required<ScenarioFixture> {
  const pool = createTilePool();
  const kongKey = "b2";
  const hands = emptyHands();
  const pongHandTiles = pool.take(kongKey, 2);
  const claimedTile = pool.take(kongKey, 1)[0];
  const addedTile = pool.take(kongKey, 1)[0];
  const eastDiscardAfterClaim = pool.takeFill(1, new Set([kongKey]))[0];

  hands[0] = [
    ...pongHandTiles,
    eastDiscardAfterClaim,
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
  ];
  hands[3] = [claimedTile, ...pool.takeFill(16, new Set([kongKey]))];
  fillHands(pool, hands, 3);

  return {
    seed,
    dealer: 3,
    hands,
    walls: createOrderedWalls(seed, pool, hands, 3, [addedTile]),
    claimedTile,
    pongHandTiles,
    addedTile,
    eastDiscardAfterClaim,
  };
}

function createRobAddedKongFixture(seed: string): Required<ScenarioFixture> {
  const pool = createTilePool();
  const kongKey = "b2";
  const hands = emptyHands();
  const pongHandTiles = pool.take(kongKey, 2);
  const claimedTile = pool.take(kongKey, 1)[0];
  const addedTile = pool.take(kongKey, 1)[0];
  const eastDiscardAfterClaim = pool.takeFill(1, new Set([kongKey]))[0];

  hands[0] = [
    ...pongHandTiles,
    eastDiscardAfterClaim,
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
  ];
  hands[1] = [
    ...pool.takeOneEach(["b3", "b4", "c1", "c2", "c3", "d1", "d2", "d3"]),
    ...pool.take("d4", 1),
    ...pool.take("d5", 1),
    ...pool.take("d6", 1),
    ...pool.take("wind-east", 3),
    ...pool.take("dragon-red", 2),
  ];
  hands[3] = [claimedTile, ...pool.takeFill(16, new Set([kongKey]))];
  fillHands(pool, hands, 3);

  return {
    seed,
    dealer: 3,
    hands,
    walls: createOrderedWalls(seed, pool, hands, 3, [addedTile]),
    claimedTile,
    pongHandTiles,
    addedTile,
    eastDiscardAfterClaim,
  };
}

function createSelfDrawWinFixture(seed: string): ScenarioFixture {
  const pool = createTilePool();
  const hands = emptyHands();
  const winningTile = pool.take("c1", 1)[0];

  hands[1] = [
    ...pool.takeOneEach(["c2", "c3", "d1", "d2", "d3", "d4", "d5", "d6"]),
    ...pool.takeOneEach(["b1", "b2", "b3"]),
    ...pool.take("wind-east", 3),
    ...pool.take("dragon-red", 2),
  ];
  fillHands(pool, hands, 0);

  return {
    seed,
    dealer: 0,
    hands,
    walls: createOrderedWalls(seed, pool, hands, 0, [winningTile]),
  };
}

function createRoundAfterSetup(fixture: ScenarioFixture): {
  state: RoundState;
  events: GameEvent[];
} {
  const state: RoundState = {
    players: createPlayers(),
    wall: [...fixture.walls.wall],
    deadWall: [...fixture.walls.deadWall],
    currentPlayer: fixture.dealer,
    dealer: fixture.dealer,
    turn: 0,
    ended: false,
  };
  const events: GameEvent[] = [];

  for (let packet = 0; packet < 4; packet += 1) {
    for (const player of state.players) {
      const tiles = fixture.hands[player.id].slice(packet * 4, packet * 4 + 4);
      drawSetupTiles(state, events, player.id, tiles);
    }
  }

  drawSetupTiles(state, events, fixture.dealer, [
    fixture.hands[fixture.dealer][16],
  ]);

  for (const player of state.players) {
    player.hand = sortTiles(player.hand);
  }

  events.push({
    ...eventMeta("setup", 0),
    type: "roundStarted",
    seed: fixture.seed,
    dealer: state.dealer,
    wallBreak: fixture.walls.wallBreak,
    wallCount: state.wall.length,
    deadWallCount: state.deadWall.length,
    handCounts: state.players.map((player) => player.hand.length) as [
      number,
      number,
      number,
      number,
    ],
  });

  return { state, events };
}

function drawSetupTiles(
  state: RoundState,
  events: GameEvent[],
  player: PlayerId,
  tiles: TileInstance[],
): void {
  for (const tile of tiles) {
    const drawn = state.wall.shift();
    if (drawn?.id !== tile.id) {
      throw new Error(`Test scenario wall order mismatch for ${tile.id}.`);
    }
    state.players[player].hand.push(drawn);
  }
  events.push({
    ...eventMeta("setup", 0),
    type: tiles.length === 1 ? "tileDrawn" : "tilesDrawn",
    player,
    ...(tiles.length === 1
      ? {
          tile: tiles[0],
          replacement: false,
          source: "liveWall" as const,
        }
      : { tiles, source: "liveWall" as const }),
    wallCount: state.wall.length,
    deadWallCount: state.deadWall.length,
  } as GameEvent);
}

function discardTile(
  state: RoundState,
  events: GameEvent[],
  player: PlayerId,
  tile: TileInstance,
  turn: number,
): void {
  const discarded = removeTile(state.players[player].hand, tile.id);
  if (!discarded) {
    throw new Error(`Test scenario could not discard ${tile.id}.`);
  }
  state.players[player].discards.push(discarded);
  events.push({
    ...eventMeta("turn", turn),
    type: "tileDiscarded",
    player,
    tile: discarded,
    handCount: state.players[player].hand.length,
  });
}

function claimPong(
  state: RoundState,
  events: GameEvent[],
  player: PlayerId,
  from: PlayerId,
  claimedTile: TileInstance,
  consumedTiles: TileInstance[],
  turn: number,
): void {
  for (const tile of consumedTiles) {
    removeTile(state.players[player].hand, tile.id);
  }
  removeTile(state.players[from].discards, claimedTile.id);
  const tiles = sortTiles([...consumedTiles, claimedTile]);
  state.players[player].melds.push({ type: "pong", tiles, claimedFrom: from });
  events.push({
    ...eventMeta("turn", turn),
    type: "claimMade",
    player,
    from,
    claim: "pong",
    tile: claimedTile,
    tiles,
  });
}

function drawLiveTile(
  state: RoundState,
  events: GameEvent[],
  player: PlayerId,
  tile: TileInstance,
  turn: number,
): void {
  const drawn = state.wall.shift();
  if (drawn?.id !== tile.id) {
    throw new Error(`Test scenario wall order mismatch for ${tile.id}.`);
  }
  state.players[player].hand = sortTiles([
    ...state.players[player].hand,
    drawn,
  ]);
  events.push({
    ...eventMeta("turn", turn),
    type: "tileDrawn",
    player,
    tile: drawn,
    replacement: false,
    source: "liveWall",
    wallCount: state.wall.length,
    deadWallCount: state.deadWall.length,
  });
}

function createOrderedWalls(
  seed: string,
  pool: TilePool,
  hands: [TileInstance[], TileInstance[], TileInstance[], TileInstance[]],
  dealer: PlayerId,
  turnDraws: TileInstance[] = [],
): WallState {
  const setupDraws: TileInstance[] = [];
  for (let packet = 0; packet < 4; packet += 1) {
    for (const hand of hands) {
      setupDraws.push(...hand.slice(packet * 4, packet * 4 + 4));
    }
  }
  setupDraws.push(hands[dealer][16]);

  const deadWall = pool.takeFill(16);
  const liveWall = [
    ...setupDraws,
    ...turnDraws,
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

function fillHands(
  pool: TilePool,
  hands: [TileInstance[], TileInstance[], TileInstance[], TileInstance[]],
  dealer: PlayerId,
): void {
  for (const [index, hand] of hands.entries()) {
    const targetCount = index === dealer ? 17 : 16;
    if (hand.length > targetCount) {
      throw new Error(`Test scenario hand ${index} has too many tiles.`);
    }
    hand.push(...pool.takeFill(targetCount - hand.length));
  }
}

function emptyHands(): [
  TileInstance[],
  TileInstance[],
  TileInstance[],
  TileInstance[],
] {
  return [[], [], [], []];
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
