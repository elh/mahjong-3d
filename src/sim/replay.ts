import type { GameEvent } from "./events";
import { createSeededRng, shuffle } from "./rng";
import type { Meld, PlayerId } from "./state";
import type { TileInstance } from "./tiles";
import { createTileSet, isFlower, sortTiles } from "./tiles";

export type ReplayPlayer = {
  id: PlayerId;
  hand: TileInstance[];
  flowers: TileInstance[];
  discards: TileInstance[];
  melds: Meld[];
};

export type ReplayState = {
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
    eventIndex: Math.min(Math.max(eventIndex, 0), Math.max(events.length - 1, 0)),
    ended: false,
    rulesErrors: [],
  };
  if (roundStart?.type === "roundStarted") {
    initializeWalls(state, roundStart.seed);
  }

  for (let index = 0; index <= state.eventIndex && index < events.length; index += 1) {
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
      if (isFlower(event.tile)) {
        state.players[event.player].flowers.push(event.tile);
      } else {
        state.players[event.player].hand = sortTiles([
          ...state.players[event.player].hand,
          event.tile,
        ]);
      }
      return;
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
        tiles: event.tiles,
        claimedFrom: event.from,
      });
      return;
    case "kongDeclared":
      for (const tile of event.tiles) {
        removeTile(state.players[event.player].hand, tile.id);
      }
      state.players[event.player].melds.push({
        type: "kong",
        tiles: event.tiles,
        concealed: true,
      });
      return;
    case "winDeclared":
      state.ended = true;
      state.winner = event.player;
      state.winners = Array.from(new Set([...(state.winners ?? []), event.player]));
      if (event.from !== undefined) {
        const discarded = removeTile(state.players[event.from].discards, event.tile.id);
        state.players[event.player].hand = sortTiles([
          ...state.players[event.player].hand,
          discarded ?? event.tile,
        ]);
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
  const shuffledTiles = shuffle(createTileSet(), createSeededRng(seed));
  state.wall = shuffledTiles.slice(0, -16);
  state.deadWall = shuffledTiles.slice(-16);
}

function replenishDeadWall(state: ReplayState): void {
  const replenishment = state.wall.pop();
  if (replenishment) {
    state.deadWall.push(replenishment);
  }
}

function removeTile(tiles: TileInstance[], tileId: string): TileInstance | undefined {
  const index = tiles.findIndex((tile) => tile.id === tileId);
  if (index === -1) {
    return undefined;
  }
  return tiles.splice(index, 1)[0];
}
