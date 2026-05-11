import type { GameEvent } from "./events";
import type { Meld, PlayerId } from "./state";
import { createTestScenarioWalls, isTestScenarioSeed } from "./testScenarios";
import { removeTile } from "./tileCollections";
import type { TileInstance } from "./tiles";
import { sortTiles } from "./tiles";
import { createShuffledWalls, replenishDeadWall } from "./wall";

export type ReplayPlayer = {
  id: PlayerId;
  hand: TileInstance[];
  flowers: TileInstance[];
  discards: TileInstance[];
  melds: Meld[];
  winningTile?: TileInstance;
};

export type ReplayState = {
  seed?: string;
  players: [ReplayPlayer, ReplayPlayer, ReplayPlayer, ReplayPlayer];
  wall: TileInstance[];
  deadWall: TileInstance[];
  wallCount: number;
  deadWallCount: number;
  dealer: PlayerId;
  currentEvent?: GameEvent;
  eventIndex: number;
  ended: boolean;
  winner?: PlayerId;
  winners?: PlayerId[];
  rulesErrors: Extract<GameEvent, { type: "rulesError" }>[];
};

export function replayEvents(
  events: readonly GameEvent[],
  eventIndex = events.length - 1,
): ReplayState {
  const roundStart = events.find((event) => event.type === "roundStarted");
  const state: ReplayState = {
    players: [
      { id: 0, hand: [], flowers: [], discards: [], melds: [] },
      { id: 1, hand: [], flowers: [], discards: [], melds: [] },
      { id: 2, hand: [], flowers: [], discards: [], melds: [] },
      { id: 3, hand: [], flowers: [], discards: [], melds: [] },
    ],
    wall: [],
    deadWall: [],
    wallCount: 144,
    deadWallCount: 0,
    dealer: 0,
    eventIndex: Math.min(
      Math.max(eventIndex, 0),
      Math.max(events.length - 1, 0),
    ),
    ended: false,
    rulesErrors: [],
  };
  if (roundStart?.type === "roundStarted") {
    state.seed = roundStart.seed;
    initializeWalls(state, roundStart.seed);
  }

  for (
    let index = 0;
    index <= state.eventIndex && index < events.length;
    index += 1
  ) {
    applyEvent(state, events[index]);
    state.currentEvent = events[index];
  }

  return state;
}

function applyEvent(state: ReplayState, event: GameEvent): void {
  switch (event.type) {
    case "roundStarted":
      state.dealer = event.dealer;
      state.wallCount = event.wallCount;
      state.deadWallCount = event.deadWallCount;
      return;
    case "tileDrawn":
      removeTile(
        event.source === "deadWall" ? state.deadWall : state.wall,
        event.tile.id,
      );
      if (event.source === "deadWall") {
        replenishDeadWall(state);
      }
      state.wallCount = event.wallCount;
      state.deadWallCount = event.deadWallCount;
      state.players[event.player].hand = sortTiles([
        ...state.players[event.player].hand,
        event.tile,
      ]);
      return;
    case "tilesDrawn":
      for (const tile of event.tiles) {
        removeTile(state.wall, tile.id);
      }
      state.wallCount = event.wallCount;
      state.deadWallCount = event.deadWallCount;
      state.players[event.player].hand = sortTiles([
        ...state.players[event.player].hand,
        ...event.tiles,
      ]);
      return;
    case "flowerExposed": {
      const exposed =
        removeTile(state.players[event.player].hand, event.tile.id) ??
        event.tile;
      state.players[event.player].flowers.push(exposed);
      return;
    }
    case "tileDiscarded":
      removeTile(state.players[event.player].hand, event.tile.id);
      state.players[event.player].discards.push(event.tile);
      return;
    case "claimMade":
      removeTile(state.players[event.from].discards, event.tile.id);
      for (const tile of event.tiles) {
        if (tile.id !== event.tile.id) {
          removeTile(state.players[event.player].hand, tile.id);
        }
      }
      state.players[event.player].melds.push({
        type: event.claim,
        tiles: [...event.tiles],
        claimedFrom: event.from,
      });
      return;
    case "kongDeclared":
      if (event.kong === "claimed") {
        if (event.from !== undefined && event.tile) {
          removeTile(state.players[event.from].discards, event.tile.id);
        }
        for (const tile of event.tiles) {
          if (tile.id !== event.tile?.id) {
            removeTile(state.players[event.player].hand, tile.id);
          }
        }
        state.players[event.player].melds.push({
          type: "kong",
          tiles: [...event.tiles],
          claimedFrom: event.from,
        });
        return;
      }
      if (event.kong === "concealed") {
        for (const tile of event.tiles) {
          removeTile(state.players[event.player].hand, tile.id);
        }
        state.players[event.player].melds.push({
          type: "kong",
          tiles: [...event.tiles],
          concealed: true,
        });
        return;
      }
      if (event.addedTile) {
        removeTile(state.players[event.player].hand, event.addedTile.id);
      }
      state.players[event.player].melds = state.players[event.player].melds.map(
        (meld) =>
          (meld.type === "pong" || meld.type === "kong") &&
          meld.tiles.every((tile) =>
            event.tiles.some((eventTile) => eventTile.id === tile.id),
          )
            ? { ...meld, type: "kong", tiles: [...event.tiles] }
            : meld,
      );
      return;
    case "addedKongDeclared":
      removeTile(state.players[event.player].hand, event.addedTile.id);
      state.players[event.player].melds = state.players[event.player].melds.map(
        (meld) =>
          meld.type === "pong" &&
          meld.tiles.every((tile) =>
            event.tiles.some((eventTile) => eventTile.id === tile.id),
          )
            ? { ...meld, type: "kong", tiles: [...event.tiles] }
            : meld,
      );
      return;
    case "winDeclared":
      state.ended = true;
      state.winner = event.player;
      state.winners = Array.from(
        new Set([...(state.winners ?? []), event.player]),
      );
      if (event.from !== undefined) {
        const wonTile = removeWonTileFromSource(state, event.from, event.tile);
        state.players[event.player].hand = sortTiles([
          ...state.players[event.player].hand,
          wonTile,
        ]);
        state.players[event.player].winningTile = wonTile;
      }
      return;
    case "drawDeclared":
      state.ended = true;
      state.wallCount = event.wallCount;
      state.deadWallCount = event.deadWallCount;
      return;
    case "rulesError":
      state.rulesErrors.push(event);
      return;
  }
}

function initializeWalls(state: ReplayState, seed: string): void {
  const { wall, deadWall } = isTestScenarioSeed(seed)
    ? (createTestScenarioWalls(seed) ?? createShuffledWalls(seed))
    : createShuffledWalls(seed);
  state.wall = wall;
  state.deadWall = deadWall;
}

function removeWonTileFromSource(
  state: ReplayState,
  player: PlayerId,
  tile: TileInstance,
): TileInstance {
  const discarded = removeTile(state.players[player].discards, tile.id);
  if (discarded) {
    return discarded;
  }

  const concealed = removeTile(state.players[player].hand, tile.id);
  if (concealed) {
    return concealed;
  }

  for (const meld of state.players[player].melds) {
    const meldTile = removeTile(meld.tiles, tile.id);
    if (!meldTile) {
      continue;
    }
    if (meld.type === "kong" && meld.tiles.length === 3) {
      meld.type = "pong";
    }
    return meldTile;
  }

  return tile;
}
