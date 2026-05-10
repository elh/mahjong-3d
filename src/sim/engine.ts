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

export function simulateRound(options: SimulateRoundOptions): SimulateRoundResult {
  const { state, events } = createInitialRound(options.seed);
  const maxTurns = options.maxTurns ?? 400;

  while (!state.ended && state.turn < maxTurns) {
    playTurn(state, options.bots, events);
  }

  if (!state.ended) {
    appendInvariantErrors(state, events);
    state.ended = true;
    events.push({
      ...eventMeta("turn", state.turn),
      type: "roundEnded",
      reason: "turnLimit",
      winner: state.winner,
      winners: state.winners,
      wallCount: state.wall.length,
      deadWallCount: state.deadWall.length,
      turn: state.turn,
    });
  }

  return {
    seed: options.seed,
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
  const needsReplacementDraw = state.needsReplacementDraw === playerId;
  let drawn: TileInstance | undefined;

  if (needsReplacementDraw) {
    drawn = drawUntilNonFlower(state, playerId, events, true, state.turn);
  } else if (!mustDiscard) {
    drawn = drawUntilNonFlower(state, playerId, events, false, state.turn);
  }
  state.needsDiscard = undefined;
  state.needsReplacementDraw = undefined;

  while (!state.ended) {
    if (drawn && isWinningHand(player.hand, player.melds)) {
      state.winner = playerId;
      state.winners = [playerId];
      events.push({
        ...eventMeta("turn", state.turn),
        type: "winDeclared",
        player: playerId,
        tile: drawn,
      });
      endRound(state, events, "win");
      break;
    }

    if (!drawn && !mustDiscard && player.hand.length % 3 !== 2) {
      endRound(state, events, "exhaustiveDraw");
      break;
    }

    const legalActions = legalTurnActions(player);
    if (legalActions.length === 0) {
      endRound(state, events, "exhaustiveDraw");
      break;
    }
    const action = chooseLegalAction(
      bots[playerId],
      botContext(state, playerId, legalActions),
    );

    if (action.type === "declareKong") {
      applyConcealedKong(state, playerId, action, events);
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
      throw new Error(`Bot ${bots[playerId].name} failed to discard a legal tile.`);
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

  while (state.wall.length > 0 || state.deadWall.length > 0) {
    const tile = drawFromDeadWall ? drawSupplementTile(state) : drawLiveTile(state);
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
      drawFromDeadWall = true;
      continue;
    }

    state.players[playerId].hand = sortTiles([...state.players[playerId].hand, tile]);
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

function legalTurnActions(player: RoundState["players"][number]): LegalAction[] {
  return [
    ...concealedKongActions(player.hand),
    ...player.hand.filter((tile) => !isFlower(tile)).map((tile) => ({
      type: "discard" as const,
      tileId: tile.id,
    })),
  ];
}

function concealedKongActions(hand: readonly TileInstance[]): DeclareKongAction[] {
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
      tileIds: sortTiles(tiles).map((tile) => tile.id) as [
        string,
        string,
        string,
        string,
      ],
    }));
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
    const legalActions = legalClaimActions(state, playerId, discarder, discarded);
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

  if (nextPlayer(discarder) === playerId && discarded.kind.category === "suited") {
    const chow = findChowTiles(player.hand, discarded);
    if (chow.length === 2) {
      actions.push({ type: "claim", claim: "chow", tileId: discarded.id });
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
    state.players[winner].hand = sortTiles([...state.players[winner].hand, discarded]);
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
      ? findChowTiles(player.hand, discarded)
      : player.hand
          .filter((tile) => tileKey(tile.kind) === tileKey(discarded.kind))
          .slice(0, action.claim === "kong" ? 3 : 2);
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
  action: DeclareKongAction,
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

function endRound(
  state: RoundState,
  events: GameEvent[],
  reason: "win" | "exhaustiveDraw" | "turnLimit",
): void {
  state.ended = true;
  events.push({
    ...eventMeta("turn", state.turn),
    type: "roundEnded",
    reason,
    winner: state.winner,
    winners: state.winners,
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
  const legal = context.legalActions.some((candidate) => actionsEqual(candidate, action));

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
    return left.tileId === right.tileId && left.claim === right.claim;
  }
  if (left.type === "declareKong" && right.type === "declareKong") {
    return left.tileIds.join("|") === right.tileIds.join("|");
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

function findChowTiles(
  hand: readonly TileInstance[],
  discarded: TileInstance,
): TileInstance[] {
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
      return [firstTile, secondTile];
    }
  }

  return [];
}

function removeTile(tiles: TileInstance[], tileId: string): TileInstance | undefined {
  const index = tiles.findIndex((tile) => tile.id === tileId);
  if (index === -1) {
    return undefined;
  }
  return tiles.splice(index, 1)[0];
}
