import type { DeclareKongAction, LegalAction } from "./actions";
import { nextPlayer, type PlayerId, type RoundState } from "./state";
import { isFlower, sortTiles, tileKey, type TileInstance } from "./tiles";
import { isWinningHand } from "./win";

export function legalTurnActions(
  player: RoundState["players"][number],
  allowKongs: boolean,
): LegalAction[] {
  return [
    ...(allowKongs
      ? [...concealedKongActions(player.hand), ...addedKongActions(player)]
      : []),
    ...player.hand
      .filter((tile) => !isFlower(tile))
      .map((tile) => ({
        type: "discard" as const,
        tileId: tile.id,
      })),
  ];
}

export function legalClaimActions(
  state: RoundState,
  playerId: PlayerId,
  discarder: PlayerId,
  discarded: TileInstance,
): LegalAction[] {
  const player = state.players[playerId];
  const actions: LegalAction[] = [{ type: "pass" }];
  const withDiscard = [...player.hand, discarded];

  if (isWinningHand(withDiscard, player.melds)) {
    actions.push({ type: "claim", claim: "win", tileId: discarded.id });
  }

  const matching = player.hand.filter(
    (tile) => tileKey(tile.kind) === tileKey(discarded.kind),
  );
  if (matching.length >= 3) {
    actions.push({ type: "claim", claim: "kong", tileId: discarded.id });
  } else if (matching.length >= 2) {
    actions.push({ type: "claim", claim: "pong", tileId: discarded.id });
  }

  if (
    nextPlayer(discarder) === playerId &&
    discarded.kind.category === "suited"
  ) {
    for (const chow of findChowOptions(player.hand, discarded)) {
      actions.push({
        type: "claim",
        claim: "chow",
        tileId: discarded.id,
        consumedTileIds: [chow[0].id, chow[1].id],
      });
    }
  }

  return actions;
}

function concealedKongActions(
  hand: readonly TileInstance[],
): DeclareKongAction[] {
  const byKind = new Map<string, TileInstance[]>();
  for (const tile of hand) {
    if (isFlower(tile)) {
      continue;
    }
    const key = tileKey(tile.kind);
    byKind.set(key, [...(byKind.get(key) ?? []), tile]);
  }
  return [...byKind.values()]
    .filter((tiles) => tiles.length === 4)
    .map((tiles) => ({
      type: "declareKong",
      kong: "concealed",
      tileIds: sortTiles(tiles).map((tile) => tile.id) as [
        string,
        string,
        string,
        string,
      ],
    }));
}

function addedKongActions(
  player: RoundState["players"][number],
): DeclareKongAction[] {
  return player.melds.flatMap((meld, meldIndex) => {
    if (meld.type !== "pong") {
      return [];
    }
    const key = tileKey(meld.tiles[0].kind);
    const tile = player.hand.find(
      (candidate) => tileKey(candidate.kind) === key,
    );
    return tile
      ? [
          {
            type: "declareKong" as const,
            kong: "added" as const,
            meldIndex,
            tileId: tile.id,
          },
        ]
      : [];
  });
}

function findChowOptions(
  hand: readonly TileInstance[],
  discarded: TileInstance,
): [TileInstance, TileInstance][] {
  if (discarded.kind.category !== "suited") {
    return [];
  }
  const suit = discarded.kind.suit;
  const rank = discarded.kind.rank;
  const options = [
    [rank - 2, rank - 1],
    [rank - 1, rank + 1],
    [rank + 1, rank + 2],
  ];

  const chowOptions: [TileInstance, TileInstance][] = [];
  for (const [first, second] of options) {
    if (first < 1 || second > 9) {
      continue;
    }
    const firstTile = hand.find(
      (tile) =>
        tile.kind.category === "suited" &&
        tile.kind.suit === suit &&
        tile.kind.rank === first,
    );
    const secondTile = hand.find(
      (tile) =>
        tile.kind.category === "suited" &&
        tile.kind.suit === suit &&
        tile.kind.rank === second,
    );
    if (firstTile && secondTile && firstTile.id !== secondTile.id) {
      chowOptions.push([firstTile, secondTile]);
    }
  }

  return chowOptions;
}
