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
  "test-multi-discard-win",
  "test-self-draw-win",
  "test-setup-flowers",
] as const;

export type TestScenarioSeed = (typeof testScenarioSeeds)[number];

export function isTestScenarioSeed(seed: string): seed is TestScenarioSeed {
  return testScenarioSeeds.includes(seed as TestScenarioSeed);
}

export function createTestScenarioRound(
  seed: TestScenarioSeed,
): TestScenarioRound | undefined {
  if (seed === "test-setup-flowers") {
    return createSetupFlowersScenario(seed);
  }
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
  if (seed === "test-multi-discard-win") {
    return createMultiDiscardWinStartingState(seed);
  }
  if (seed === "test-self-draw-win") {
    return createSelfDrawWinStartingState(seed);
  }
  return undefined;
}

export function createTestScenarioWalls(
  seed: TestScenarioSeed,
): WallState | undefined {
  if (seed === "test-setup-flowers") {
    return createSetupFlowersFixture(seed).walls;
  }
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

function createMultiDiscardWinStartingState(seed: string): RoundState {
  const pool = createTilePool();
  const state = emptyRoundState(0, 0);
  const discard = pool.take("c1", 1)[0];

  state.needsDiscard = 0;
  state.discardSource = "draw";
  state.players[0].hand = sortTiles([
    discard,
    ...pool.take("c4", 2),
    ...pool.take("c5", 2),
    ...pool.take("c6", 2),
    ...pool.take("c7", 2),
    ...pool.take("c8", 2),
    ...pool.take("c9", 2),
    ...pool.take("wind-north", 4),
  ]);
  state.players[1].hand = discardWinWait(pool, "wind-east", "dragon-red");
  state.players[2].hand = discardWinWait(pool, "wind-south", "dragon-green");

  fillPlayerHands(pool, state);
  assignWalls(state, createFixtureWalls(seed, state.dealer, pool));
  return state;
}

function discardWinWait(
  pool: TilePool,
  tripletKey: string,
  pairKey: string,
): TileInstance[] {
  return sortTiles([
    ...pool.takeOneEach(["c2", "c3", "d1", "d2", "d3", "d4", "d5", "d6"]),
    ...pool.takeOneEach(["b1", "b2", "b3"]),
    ...pool.take(tripletKey, 3),
    ...pool.take(pairKey, 2),
  ]);
}

function createSetupFlowersScenario(seed: string): TestScenarioRound {
  const fixture = createSetupFlowersFixture(seed);
  const { state, events } = createRoundAfterSetup(fixture);
  state.currentPlayer = fixture.dealer;
  state.needsDiscard = fixture.dealer;
  state.discardSource = "draw";
  return {
    state: cloneRoundState(state),
    events,
    maxTurns: 1,
  };
}

function createSetupFlowersFixture(seed: string): SetupFixture {
  const pool = createTilePool();
  const hands = emptyHands();
  const player0InitialFlower = pool.take("flower-1", 1)[0];
  const player0SupplementFlower = pool.take("season-1", 1)[0];
  const player1InitialFlowers = pool.takeOneEach(["flower-2", "season-2"]);
  const player2InitialFlowers = pool.takeOneEach([
    "flower-3",
    "season-3",
    "flower-4",
  ]);
  const replacementTiles = [
    player0SupplementFlower,
    ...pool.takeOneEach(["c1", "c2"]),
    ...pool.takeOneEach(["d1", "d2", "d3"]),
    ...pool.takeOneEach(["b1"]),
  ];

  hands[0] = [player0InitialFlower];
  hands[1] = [...player1InitialFlowers];
  hands[2] = [...player2InitialFlowers];
  fillSetupHands(pool, hands, 0);

  return {
    seed,
    dealer: 0,
    hands,
    walls: createSetupFixtureWalls(seed, 0, pool, hands, replacementTiles),
  };
}

type SetupFixture = {
  seed: string;
  dealer: PlayerId;
  hands: [TileInstance[], TileInstance[], TileInstance[], TileInstance[]];
  walls: WallState;
};

function createRoundAfterSetup(fixture: SetupFixture): {
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
      drawSetupTiles(state, events, player.id, [
        ...fixture.hands[player.id].slice(packet * 4, packet * 4 + 4),
      ]);
    }
  }
  drawSetupTiles(state, events, fixture.dealer, [
    fixture.hands[fixture.dealer][16],
  ]);
  replaceSetupFlowers(state, events);

  for (const player of state.players) {
    player.hand = sortTiles(player.hand);
  }

  events.push(roundStartedEvent(fixture.seed, state));

  return { state, events };
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

function replaceSetupFlowers(state: RoundState, events: GameEvent[]): void {
  let replacedAny = true;
  while (replacedAny) {
    replacedAny = false;
    for (const player of state.players) {
      const flowers = player.hand.filter(isFlower);
      if (flowers.length === 0) {
        continue;
      }
      replacedAny = true;
      for (const flower of flowers) {
        state.players[player.id].hand = state.players[player.id].hand.filter(
          (tile) => tile.id !== flower.id,
        );
        state.players[player.id].flowers.push(flower);
      }
      events.push({
        ...eventMeta("setup", 0),
        type: "flowerExposed",
        player: player.id,
        tile: flowers[0],
        tiles: flowers,
      });
      drawSetupSupplementTiles(state, events, player.id, flowers.length);
    }
  }
}

function drawSetupSupplementTiles(
  state: RoundState,
  events: GameEvent[],
  player: PlayerId,
  count: number,
): void {
  const tiles: TileInstance[] = [];
  for (let index = 0; index < count; index += 1) {
    const tile = state.deadWall.shift();
    if (!tile) {
      break;
    }
    const replenishment = state.wall.pop();
    if (replenishment) {
      state.deadWall.push(replenishment);
    }
    state.players[player].hand.push(tile);
    tiles.push(tile);
  }
  if (tiles.length === 1) {
    events.push({
      ...eventMeta("setup", 0),
      type: "tileDrawn",
      player,
      tile: tiles[0],
      replacement: true,
      source: "deadWall",
      wallCount: state.wall.length,
      deadWallCount: state.deadWall.length,
    });
  } else if (tiles.length > 1) {
    events.push({
      ...eventMeta("setup", 0),
      type: "tilesDrawn",
      player,
      tiles,
      replacement: true,
      source: "deadWall",
      wallCount: state.wall.length,
      deadWallCount: state.deadWall.length,
    });
  }
}

function createSetupFixtureWalls(
  seed: string,
  dealer: PlayerId,
  pool: TilePool,
  hands: [TileInstance[], TileInstance[], TileInstance[], TileInstance[]],
  replacementTiles: TileInstance[],
): WallState {
  const setupDraws: TileInstance[] = [];
  for (let packet = 0; packet < 4; packet += 1) {
    for (const hand of hands) {
      setupDraws.push(...hand.slice(packet * 4, packet * 4 + 4));
    }
  }
  setupDraws.push(hands[dealer][16]);
  const deadWall = [
    ...replacementTiles,
    ...pool.takeFill(16 - replacementTiles.length),
  ];
  return {
    wall: [
      ...setupDraws,
      ...pool
        .remaining()
        .filter((tile) => !deadWall.some((dead) => dead.id === tile.id)),
    ],
    deadWall,
    wallBreak: createWallBreak(seed, dealer, testScenarioWallBreakDice),
  };
}

function fillSetupHands(
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
