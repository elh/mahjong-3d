import type { MahjongBot } from "../bots/types";
import type {
  BotContext,
  ClaimAction,
  DeclareKongAction,
  LegalAction,
} from "./actions";
import { claimPriority } from "./claimPriority";
import { eventMeta, type GameEvent } from "./events";
import { validateBetweenTurns } from "./invariants";
import { createSeededRng, shuffle } from "./rng";
import {
  cloneRoundState,
  createPlayers,
  nextPlayer,
  type PlayerId,
  type RoundState,
} from "./state";
import {
  createTileSet,
  isFlower,
  sortTiles,
  tileKey,
  type TileInstance,
} from "./tiles";
import { isWinningHand } from "./win";

export type SimulateRoundOptions = {
  seed: string;
  bots: [MahjongBot, MahjongBot, MahjongBot, MahjongBot];
  maxTurns?: number;
};

export type SimulateRoundResult = {
  seed: string;
  events: GameEvent[];
  finalState: RoundState;
};

export type SimulateRoundFromStateOptions = SimulateRoundOptions & {
  state: RoundState;
  events?: GameEvent[];
};

type ClaimResolution =
  | { type: "none" }
  | { type: "win"; winners: PlayerId[] }
  | { type: "meld"; player: PlayerId; action: ClaimAction };

export function createInitialRound(seed: string): {
  state: RoundState;
  events: GameEvent[];
} {
  const rng = createSeededRng(seed);
  const shuffledTiles = shuffle(createTileSet(), rng);
  const state: RoundState = {
    players: createPlayers(),
    wall: shuffledTiles.slice(0, -16),
    deadWall: shuffledTiles.slice(-16),
    currentPlayer: 0,
    needsDiscard: 0,
    discardSource: "draw",
    dealer: 0,
    turn: 0,
    ended: false,
  };
  const events: GameEvent[] = [];

  for (let handSize = 0; handSize < 16; handSize += 1) {
    for (const player of state.players) {
      drawLiveTileIntoHand(state, player.id, events, "setup", 0);
    }
  }
  drawLiveTileIntoHand(state, state.dealer, events, "setup", 0);
  replaceDealtFlowers(state, events);

  for (const player of state.players) {
    player.hand = sortTiles(player.hand);
  }

  events.push({
    ...eventMeta("setup", 0),
    type: "roundStarted",
    seed,
    dealer: state.dealer,
    wallCount: state.wall.length,
    deadWallCount: state.deadWall.length,
    handCounts: state.players.map((player) => player.hand.length) as [
      number,
      number,
      number,
      number,
    ],
  });

  return { state, events };
}

export function simulateRound(
  options: SimulateRoundOptions,
): SimulateRoundResult {
  const { state, events } = createInitialRound(options.seed);
  return runRound({
    seed: options.seed,
    state,
    events,
    bots: options.bots,
    maxTurns: options.maxTurns,
  });
}

export function simulateRoundFromState(
  options: SimulateRoundFromStateOptions,
): SimulateRoundResult {
  return runRound({
    seed: options.seed,
    state: options.state,
    events: options.events ?? [],
    bots: options.bots,
    maxTurns: options.maxTurns,
  });
}

function runRound({
  seed,
  state,
  events,
  bots,
  maxTurns,
}: {
  seed: string;
  state: RoundState;
  events: GameEvent[];
  bots: [MahjongBot, MahjongBot, MahjongBot, MahjongBot];
  maxTurns?: number;
}): SimulateRoundResult {
  const turnLimit = maxTurns ?? 400;

  while (!state.ended && state.turn < turnLimit) {
    playTurn(state, bots, events);
  }

  if (!state.ended) {
    appendInvariantErrors(state, events);
    endRound(state, events, "turnLimit");
  }

  return {
    seed,
    events,
    finalState: cloneRoundState(state),
  };
}

function playTurn(
  state: RoundState,
  bots: [MahjongBot, MahjongBot, MahjongBot, MahjongBot],
  events: GameEvent[],
): void {
  const playerId = state.currentPlayer;
  const player = state.players[playerId];
  const mustDiscard = state.needsDiscard === playerId;
  const canDeclareKong = state.discardSource !== "claim";
  const needsReplacementDraw = state.needsReplacementDraw === playerId;
  let drawn: TileInstance | undefined;

  if (needsReplacementDraw) {
    drawn = drawUntilNonFlower(state, playerId, events, true, state.turn);
  } else if (!mustDiscard) {
    drawn = drawUntilNonFlower(state, playerId, events, false, state.turn);
  }
  state.needsDiscard = undefined;
  state.discardSource = undefined;
  state.needsReplacementDraw = undefined;

  while (!state.ended) {
    if (
      (drawn ||
        (state.turn === 0 && mustDiscard && playerId === state.dealer)) &&
      isWinningHand(player.hand, player.melds)
    ) {
      state.winner = playerId;
      state.winners = [playerId];
      events.push({
        ...eventMeta("turn", state.turn),
        type: "winDeclared",
        player: playerId,
        tile: drawn ?? startingHandWinTile(player.hand),
      });
      endRound(state, events, "win");
      break;
    }

    if (!drawn && !mustDiscard && player.hand.length % 3 !== 2) {
      endRound(state, events, "exhaustiveDraw");
      break;
    }

    const legalActions = legalTurnActions(player, canDeclareKong);
    if (legalActions.length === 0) {
      endRound(state, events, "exhaustiveDraw");
      break;
    }
    const action = chooseLegalAction(
      bots[playerId],
      botContext(state, playerId, legalActions),
    );

    if (action.type === "declareKong") {
      if (action.kong === "added") {
        applyAddedKong(state, playerId, action, bots, events);
        if (state.ended) {
          break;
        }
      } else {
        applyConcealedKong(state, playerId, action, events);
      }
      drawn = drawUntilNonFlower(state, playerId, events, true, state.turn);
      if (!drawn) {
        endRound(state, events, "exhaustiveDraw");
        break;
      }
      continue;
    }

    const discarded = removeTile(
      player.hand,
      action.type === "discard" ? action.tileId : "",
    );
    if (!discarded) {
      throw new Error(
        `Bot ${bots[playerId].name} failed to discard a legal tile.`,
      );
    }

    player.discards.push(discarded);
    events.push({
      ...eventMeta("turn", state.turn),
      type: "tileDiscarded",
      player: playerId,
      tile: discarded,
      handCount: player.hand.length,
    });

    const claim = resolveClaim(state, bots, playerId, discarded);
    if (claim.type === "win") {
      applyWinClaims(state, playerId, discarded, claim.winners, events);
    } else if (claim.type === "meld") {
      applyMeldClaim(state, claim.player, claim.action, discarded, events);
    } else {
      state.currentPlayer = nextPlayer(playerId);
      state.needsDiscard = undefined;
      state.discardSource = undefined;
    }
    if (!state.ended) {
      appendInvariantErrors(state, events);
    }
    break;
  }

  state.turn += 1;
}

function appendInvariantErrors(state: RoundState, events: GameEvent[]): void {
  for (const violation of validateBetweenTurns(state)) {
    events.push({
      ...eventMeta("turn", state.turn),
      type: "rulesError",
      message: violation.message,
      player: violation.player,
      handCount: violation.handCount,
      expected: violation.expected,
    });
  }
}

function startingHandWinTile(hand: readonly TileInstance[]): TileInstance {
  const tile = hand.at(-1);
  if (!tile) {
    throw new Error("Cannot declare a starting-hand win without a tile.");
  }
  return tile;
}

function drawLiveTileIntoHand(
  state: RoundState,
  playerId: PlayerId,
  events: GameEvent[],
  phase: "setup" | "turn",
  turn: number,
): TileInstance | undefined {
  const tile = drawLiveTile(state);
  if (!tile) {
    return undefined;
  }
  state.players[playerId].hand.push(tile);
  events.push(drawEvent(state, playerId, tile, false, "liveWall", phase, turn));
  return tile;
}

function replaceDealtFlowers(state: RoundState, events: GameEvent[]): void {
  let replacedAny = true;
  while (replacedAny) {
    replacedAny = false;
    for (const player of state.players) {
      const flowers = player.hand.filter(isFlower);
      if (flowers.length === 0) {
        continue;
      }
      replacedAny = true;
      for (const flower of flowers) {
        removeTile(player.hand, flower.id);
        player.flowers.push(flower);
        events.push({
          ...eventMeta("setup", 0),
          type: "flowerExposed",
          player: player.id,
          tile: flower,
        });
        drawSupplementTileIntoHand(state, player.id, events, "setup", 0);
      }
    }
  }
}

function drawUntilNonFlower(
  state: RoundState,
  playerId: PlayerId,
  events: GameEvent[],
  replacement: boolean,
  turn: number,
): TileInstance | undefined {
  let drawFromDeadWall = replacement;

  while (drawFromDeadWall ? state.deadWall.length > 0 : state.wall.length > 0) {
    const tile = drawFromDeadWall
      ? drawSupplementTile(state)
      : drawLiveTile(state);
    if (!tile) {
      return undefined;
    }

    events.push(
      drawEvent(
        state,
        playerId,
        tile,
        drawFromDeadWall,
        drawFromDeadWall ? "deadWall" : "liveWall",
        "turn",
        turn,
      ),
    );

    if (isFlower(tile)) {
      state.players[playerId].flowers.push(tile);
      events.push({
        ...eventMeta("turn", turn),
        type: "flowerExposed",
        player: playerId,
        tile,
      });
      drawFromDeadWall = true;
      continue;
    }

    state.players[playerId].hand = sortTiles([
      ...state.players[playerId].hand,
      tile,
    ]);
    return tile;
  }

  return undefined;
}

function drawSupplementTileIntoHand(
  state: RoundState,
  playerId: PlayerId,
  events: GameEvent[],
  phase: "setup" | "turn",
  turn: number,
): TileInstance | undefined {
  const tile = drawSupplementTile(state);
  if (!tile) {
    return undefined;
  }
  state.players[playerId].hand.push(tile);
  events.push(drawEvent(state, playerId, tile, true, "deadWall", phase, turn));
  return tile;
}

function drawLiveTile(state: RoundState): TileInstance | undefined {
  return state.wall.shift();
}

function drawSupplementTile(state: RoundState): TileInstance | undefined {
  const tile = state.deadWall.shift();
  if (!tile) {
    return undefined;
  }
  const replenishment = state.wall.pop();
  if (replenishment) {
    state.deadWall.push(replenishment);
  }
  return tile;
}

function drawEvent(
  state: RoundState,
  player: PlayerId,
  tile: TileInstance,
  replacement: boolean,
  source: "liveWall" | "deadWall",
  phase: "setup" | "turn",
  turn: number,
): Extract<GameEvent, { type: "tileDrawn" }> {
  return {
    ...eventMeta(phase, turn),
    type: "tileDrawn",
    player,
    tile,
    replacement,
    source,
    wallCount: state.wall.length,
    deadWallCount: state.deadWall.length,
  };
}

function legalTurnActions(
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

function resolveClaim(
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

function legalClaimActions(
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

function applyWinClaims(
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
  endRound(state, events, "win");
}

function applyMeldClaim(
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

function applyConcealedKong(
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

function applyAddedKong(
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

  const robbers = resolveRobbingKong(state, bots, playerId, addedTile);
  if (robbers.length > 0) {
    removeTile(player.hand, addedTile.id);
    applyRobbingKongWins(state, playerId, addedTile, robbers, events);
    return;
  }

  removeTile(player.hand, addedTile.id);
  const kongTiles = sortTiles([...meld.tiles, addedTile]);
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

function resolveRobbingKong(
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
  endRound(state, events, "win");
}

function endRound(
  state: RoundState,
  events: GameEvent[],
  reason: "win" | "exhaustiveDraw" | "turnLimit",
): void {
  state.ended = true;
  if (reason === "win") {
    return;
  }
  events.push({
    ...eventMeta("turn", state.turn),
    type: "drawDeclared",
    reason,
    wallCount: state.wall.length,
    deadWallCount: state.deadWall.length,
    turn: state.turn,
  });
}

function botContext(
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

function chooseLegalAction(bot: MahjongBot, context: BotContext): LegalAction {
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

function claimOrder(discarder: PlayerId): PlayerId[] {
  return [
    nextPlayer(discarder),
    nextPlayer(nextPlayer(discarder)),
    nextPlayer(nextPlayer(nextPlayer(discarder))),
  ];
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

function removeTile(
  tiles: TileInstance[],
  tileId: string,
): TileInstance | undefined {
  const index = tiles.findIndex((tile) => tile.id === tileId);
  if (index === -1) {
    return undefined;
  }
  return tiles.splice(index, 1)[0];
}
