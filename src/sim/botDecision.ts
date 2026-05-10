import type { MahjongBot } from "../bots/types";
import type { BotContext, LegalAction } from "./actions";
import type { PlayerId, RoundState } from "./state";
import type { TileInstance } from "./tiles";

export function botContext(
  state: RoundState,
  playerId: PlayerId,
  legalActions: LegalAction[],
): BotContext {
  return {
    player: playerId,
    legalActions,
    visibleTiles: visibleTiles(state),
    hand: [...state.players[playerId].hand],
    melds: state.players[playerId].melds.map((meld) => ({
      ...meld,
      tiles: [...meld.tiles],
    })),
    wallCount: state.wall.length,
    turn: state.turn,
  };
}

export function chooseLegalAction(
  bot: MahjongBot,
  context: BotContext,
): LegalAction {
  const action = bot.chooseAction(context);
  const legal = context.legalActions.some((candidate) =>
    actionsEqual(candidate, action),
  );

  if (!legal) {
    return context.legalActions[0];
  }
  return action;
}

function actionsEqual(left: LegalAction, right: LegalAction): boolean {
  if (left.type !== right.type) {
    return false;
  }
  if (left.type === "discard" && right.type === "discard") {
    return left.tileId === right.tileId;
  }
  if (left.type === "claim" && right.type === "claim") {
    return (
      left.tileId === right.tileId &&
      left.claim === right.claim &&
      (left.consumedTileIds?.join("|") ?? "") ===
        (right.consumedTileIds?.join("|") ?? "")
    );
  }
  if (left.type === "declareKong" && right.type === "declareKong") {
    if (left.kong !== right.kong) {
      return false;
    }
    return left.kong === "concealed" && right.kong === "concealed"
      ? left.tileIds.join("|") === right.tileIds.join("|")
      : left.kong === "added" &&
          right.kong === "added" &&
          left.meldIndex === right.meldIndex &&
          left.tileId === right.tileId;
  }
  return true;
}

function visibleTiles(state: RoundState): TileInstance[] {
  return state.players.flatMap((player) => [
    ...player.discards,
    ...player.flowers,
    ...player.melds.flatMap((meld) => meld.tiles),
  ]);
}
