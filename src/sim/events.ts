import type { PlayerId } from "./state";
import type { TileInstance } from "./tiles";

type EventMeta = {
  phase: "setup" | "turn";
  groupId: string;
  turn: number;
};

export type GameEvent =
  | (EventMeta & {
      type: "roundStarted";
      seed: string;
      dealer: PlayerId;
      wallCount: number;
      deadWallCount: number;
      handCounts: [number, number, number, number];
    })
  | (EventMeta & {
      type: "tileDrawn";
      player: PlayerId;
      tile: TileInstance;
      replacement: boolean;
      source: "liveWall" | "deadWall";
      wallCount: number;
      deadWallCount: number;
    })
  | (EventMeta & {
      type: "tileDiscarded";
      player: PlayerId;
      tile: TileInstance;
      handCount: number;
    })
  | (EventMeta & {
      type: "claimMade";
      player: PlayerId;
      from: PlayerId;
      claim: "chow" | "pong" | "kong";
      tile: TileInstance;
      tiles: TileInstance[];
    })
  | (EventMeta & {
      type: "kongDeclared";
      player: PlayerId;
      kong: "concealed";
      tiles: TileInstance[];
    })
  | (EventMeta & {
      type: "winDeclared";
      player: PlayerId;
      from?: PlayerId;
      tile: TileInstance;
    })
  | (EventMeta & {
      type: "drawDeclared";
      reason: "exhaustiveDraw" | "turnLimit";
      wallCount: number;
      deadWallCount: number;
      turn: number;
    })
  | (EventMeta & {
      type: "rulesError";
      message: string;
      player: PlayerId;
      handCount: number;
      expected: number;
    });

export function eventMeta(phase: "setup" | "turn", turn: number): EventMeta {
  return {
    phase,
    turn,
    groupId: phase === "setup" ? "setup" : `turn-${turn}`,
  };
}
