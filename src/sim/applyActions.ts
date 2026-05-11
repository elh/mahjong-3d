import type { MahjongBot } from "../bots/types";
import type { ClaimAction, DeclareKongAction } from "./actions";
import { eventMeta, type GameEvent } from "./events";
import { resolveRobbingKong } from "./claims";
import type { PlayerId, RoundState } from "./state";
import { removeTile } from "./tileCollections";
import { sortTiles, tileKey, type TileInstance } from "./tiles";

export function applyWinClaims(
  state: RoundState,
  discarder: PlayerId,
  discarded: TileInstance,
  winners: PlayerId[],
  events: GameEvent[],
): void {
  removeTile(state.players[discarder].discards, discarded.id);
  state.winner = winners[0];
  state.winners = winners;
  for (const winner of winners) {
    state.players[winner].winningTile = discarded;
    events.push({
      ...eventMeta("turn", state.turn),
      type: "winDeclared",
      player: winner,
      from: discarder,
      tile: discarded,
    });
  }
  state.ended = true;
}

export function applyMeldClaim(
  state: RoundState,
  playerId: PlayerId,
  action: ClaimAction,
  discarded: TileInstance,
  events: GameEvent[],
): void {
  if (action.claim === "win") {
    throw new Error("Win claims must be resolved through applyWinClaims.");
  }
  const player = state.players[playerId];
  const from = state.currentPlayer;
  const tiles =
    action.claim === "chow"
      ? (action.consumedTileIds?.map((tileId) => {
          const tile = player.hand.find((candidate) => candidate.id === tileId);
          if (!tile) {
            throw new Error(
              `Player ${playerId} tried to claim an illegal chow.`,
            );
          }
          return tile;
        }) ?? [])
      : player.hand
          .filter((tile) => tileKey(tile.kind) === tileKey(discarded.kind))
          .slice(0, action.claim === "kong" ? 3 : 2);
  if (action.claim === "chow" && tiles.length !== 2) {
    throw new Error(`Player ${playerId} tried to claim an illegal chow.`);
  }
  const meldTiles = sortTiles([...tiles, discarded]);

  for (const tile of tiles) {
    removeTile(player.hand, tile.id);
  }
  removeTile(state.players[from].discards, discarded.id);

  player.melds.push({
    type: action.claim,
    tiles: meldTiles,
    claimedFrom: from,
  });
  state.currentPlayer = playerId;
  state.needsDiscard = playerId;
  state.discardSource = action.claim === "kong" ? "draw" : "claim";
  state.needsReplacementDraw = action.claim === "kong" ? playerId : undefined;
  if (action.claim === "kong") {
    events.push({
      ...eventMeta("turn", state.turn),
      type: "kongDeclared",
      player: playerId,
      kong: "claimed",
      from,
      tile: discarded,
      tiles: meldTiles,
    });
  } else {
    events.push({
      ...eventMeta("turn", state.turn),
      type: "claimMade",
      player: playerId,
      from,
      claim: action.claim,
      tile: discarded,
      tiles: meldTiles,
    });
  }
}

export function applyConcealedKong(
  state: RoundState,
  playerId: PlayerId,
  action: Extract<DeclareKongAction, { kong: "concealed" }>,
  events: GameEvent[],
): void {
  const player = state.players[playerId];
  const tiles = action.tileIds.map((tileId) => {
    const tile = removeTile(player.hand, tileId);
    if (!tile) {
      throw new Error(`Player ${playerId} tried to declare an illegal kong.`);
    }
    return tile;
  });
  const meldTiles = sortTiles(tiles);
  player.melds.push({ type: "kong", tiles: meldTiles, concealed: true });
  events.push({
    ...eventMeta("turn", state.turn),
    type: "kongDeclared",
    player: playerId,
    kong: "concealed",
    tiles: meldTiles,
  });
}

export function applyAddedKong(
  state: RoundState,
  playerId: PlayerId,
  action: Extract<DeclareKongAction, { kong: "added" }>,
  bots: [MahjongBot, MahjongBot, MahjongBot, MahjongBot],
  events: GameEvent[],
): void {
  const player = state.players[playerId];
  const meld = player.melds[action.meldIndex];
  const addedTile = player.hand.find((tile) => tile.id === action.tileId);
  if (!meld || meld.type !== "pong" || !addedTile) {
    throw new Error(
      `Player ${playerId} tried to declare an illegal added kong.`,
    );
  }
  const kongKey = tileKey(meld.tiles[0].kind);
  if (tileKey(addedTile.kind) !== kongKey) {
    throw new Error(
      `Player ${playerId} tried to declare an illegal added kong.`,
    );
  }

  const kongTiles = sortTiles([...meld.tiles, addedTile]);
  events.push({
    ...eventMeta("turn", state.turn),
    type: "addedKongDeclared",
    player: playerId,
    tiles: kongTiles,
    addedTile,
  });

  const robbers = resolveRobbingKong(state, bots, playerId, addedTile);
  if (robbers.length > 0) {
    removeTile(player.hand, addedTile.id);
    applyRobbingKongWins(state, playerId, addedTile, robbers, events);
    return;
  }

  removeTile(player.hand, addedTile.id);
  player.melds[action.meldIndex] = {
    ...meld,
    type: "kong",
    tiles: kongTiles,
  };
  events.push({
    ...eventMeta("turn", state.turn),
    type: "kongDeclared",
    player: playerId,
    kong: "added",
    tiles: kongTiles,
    addedTile,
  });
}

function applyRobbingKongWins(
  state: RoundState,
  declarer: PlayerId,
  addedTile: TileInstance,
  winners: PlayerId[],
  events: GameEvent[],
): void {
  state.winner = winners[0];
  state.winners = winners;
  for (const winner of winners) {
    state.players[winner].winningTile = addedTile;
    events.push({
      ...eventMeta("turn", state.turn),
      type: "winDeclared",
      player: winner,
      from: declarer,
      tile: addedTile,
    });
  }
  state.ended = true;
}
