import type { PlayerId } from "./state";
import type { Meld } from "./state";
import type { TileInstance } from "./tiles";

export type DiscardAction = {
  type: "discard";
  tileId: string;
};

export type ClaimAction = {
  type: "claim";
  claim: "chow" | "pong" | "kong" | "win";
  tileId: string;
};

export type DeclareKongAction = {
  type: "declareKong";
  tileIds: [string, string, string, string];
};

export type PassAction = {
  type: "pass";
};

export type LegalAction =
  | DiscardAction
  | ClaimAction
  | DeclareKongAction
  | PassAction;

export type BotContext = {
  player: PlayerId;
  legalActions: LegalAction[];
  visibleTiles: TileInstance[];
  hand: TileInstance[];
  melds: Meld[];
  wallCount: number;
  turn: number;
};
