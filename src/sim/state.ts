import type { TileInstance } from "./tiles";

export type PlayerId = 0 | 1 | 2 | 3;

export type MeldType = "chow" | "pong" | "kong";

export type Meld = {
  type: MeldType;
  tiles: TileInstance[];
  claimedFrom?: PlayerId;
  concealed?: boolean;
};

export type PlayerState = {
  id: PlayerId;
  hand: TileInstance[];
  flowers: TileInstance[];
  discards: TileInstance[];
  melds: Meld[];
};

export type RoundState = {
  players: [PlayerState, PlayerState, PlayerState, PlayerState];
  wall: TileInstance[];
  deadWall: TileInstance[];
  currentPlayer: PlayerId;
  needsDiscard?: PlayerId;
  needsReplacementDraw?: PlayerId;
  dealer: PlayerId;
  turn: number;
  ended: boolean;
  winner?: PlayerId;
  winners?: PlayerId[];
};

export function nextPlayer(player: PlayerId): PlayerId {
  return ((player + 1) % 4) as PlayerId;
}

export function createPlayers(): RoundState["players"] {
  return [
    { id: 0, hand: [], flowers: [], discards: [], melds: [] },
    { id: 1, hand: [], flowers: [], discards: [], melds: [] },
    { id: 2, hand: [], flowers: [], discards: [], melds: [] },
    { id: 3, hand: [], flowers: [], discards: [], melds: [] },
  ];
}

export function cloneRoundState(state: RoundState): RoundState {
  return {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      hand: [...player.hand],
      flowers: [...player.flowers],
      discards: [...player.discards],
      melds: player.melds.map((meld) => ({ ...meld, tiles: [...meld.tiles] })),
    })) as RoundState["players"],
    wall: [...state.wall],
    deadWall: [...state.deadWall],
  };
}
