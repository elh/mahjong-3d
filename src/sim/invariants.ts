import type { PlayerId, RoundState } from "./state";

export type InvariantViolation = {
  player: PlayerId;
  handCount: number;
  expected: number;
  message: string;
};

export function validateBetweenTurns(state: RoundState): InvariantViolation[] {
  return state.players.flatMap((player) => {
    const expected = expectedConcealedCount(state, player.id);
    if (player.hand.length === expected) {
      return [];
    }
    return [
      {
        player: player.id,
        handCount: player.hand.length,
        expected,
        message: `Player ${player.id} has ${player.hand.length} concealed tiles; expected ${expected}.`,
      },
    ];
  });
}

export function expectedConcealedCount(
  state: RoundState,
  player: PlayerId,
): number {
  const meldPenalty = state.players[player].melds.reduce(
    (total, meld) => total + (meld.type === "kong" ? 3 : meld.tiles.length),
    0,
  );
  const base =
    state.needsReplacementDraw === player
      ? 16
      : state.needsDiscard === player
        ? 17
        : 16;
  return base - meldPenalty;
}
