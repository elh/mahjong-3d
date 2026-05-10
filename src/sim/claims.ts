import type { MahjongBot } from "../bots/types";
import type { ClaimAction, LegalAction } from "./actions";
import { botContext, chooseLegalAction } from "./botDecision";
import { claimPriority } from "./claimPriority";
import { legalClaimActions } from "./legalActions";
import { nextPlayer, type PlayerId, type RoundState } from "./state";
import type { TileInstance } from "./tiles";
import { isWinningHand } from "./win";

export type ClaimResolution =
  | { type: "none" }
  | { type: "win"; winners: PlayerId[] }
  | { type: "meld"; player: PlayerId; action: ClaimAction };

export function resolveClaim(
  state: RoundState,
  bots: [MahjongBot, MahjongBot, MahjongBot, MahjongBot],
  discarder: PlayerId,
  discarded: TileInstance,
): ClaimResolution {
  const contenders = claimOrder(discarder);
  const winClaims: PlayerId[] = [];
  const meldClaims: { player: PlayerId; action: ClaimAction }[] = [];

  for (const playerId of contenders) {
    const legalActions = legalClaimActions(
      state,
      playerId,
      discarder,
      discarded,
    );
    if (legalActions.length === 1) {
      continue;
    }

    const action = chooseLegalAction(
      bots[playerId],
      botContext(state, playerId, legalActions),
    );

    if (action.type !== "claim") {
      continue;
    }

    if (action.claim === "win") {
      winClaims.push(playerId);
    } else {
      meldClaims.push({ player: playerId, action });
    }
  }

  if (winClaims.length > 0) {
    return { type: "win", winners: winClaims };
  }

  const meld = meldClaims.sort(
    (left, right) =>
      claimPriority(right.action.claim) - claimPriority(left.action.claim) ||
      contenders.indexOf(left.player) - contenders.indexOf(right.player),
  )[0];
  return meld ? { type: "meld", ...meld } : { type: "none" };
}

export function resolveRobbingKong(
  state: RoundState,
  bots: [MahjongBot, MahjongBot, MahjongBot, MahjongBot],
  declarer: PlayerId,
  addedTile: TileInstance,
): PlayerId[] {
  const winners: PlayerId[] = [];
  for (const playerId of claimOrder(declarer)) {
    const player = state.players[playerId];
    if (!isWinningHand([...player.hand, addedTile], player.melds)) {
      continue;
    }
    const legalActions: LegalAction[] = [
      { type: "pass" },
      { type: "claim", claim: "win", tileId: addedTile.id },
    ];
    const action = chooseLegalAction(
      bots[playerId],
      botContext(state, playerId, legalActions),
    );
    if (action.type === "claim" && action.claim === "win") {
      winners.push(playerId);
    }
  }
  return winners;
}

function claimOrder(discarder: PlayerId): PlayerId[] {
  return [
    nextPlayer(discarder),
    nextPlayer(nextPlayer(discarder)),
    nextPlayer(nextPlayer(nextPlayer(discarder))),
  ];
}
