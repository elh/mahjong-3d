import type { MahjongBot } from "../bots/types";
import {
  applyAddedKong,
  applyConcealedKong,
  applyMeldClaim,
  applyWinClaims,
} from "./applyActions";
import { botContext, chooseLegalAction } from "./botDecision";
import { resolveClaim } from "./claims";
import { eventMeta, type GameEvent } from "./events";
import { validateBetweenTurns } from "./invariants";
import { legalTurnActions } from "./legalActions";
import {
  cloneRoundState,
  createPlayers,
  nextPlayer,
  type PlayerId,
  type RoundState,
} from "./state";
import { removeTile } from "./tileCollections";
import { createTestScenarioRound } from "./testScenarios";
import { isFlower, sortTiles, type TileInstance } from "./tiles";
import { createShuffledWalls, drawLiveTile, drawSupplementTile } from "./wall";
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

export function createInitialRound(seed: string): {
  state: RoundState;
  events: GameEvent[];
} {
  const { wall, deadWall } = createShuffledWalls(seed);
  const state: RoundState = {
    players: createPlayers(),
    wall,
    deadWall,
    currentPlayer: 0,
    needsDiscard: 0,
    discardSource: "draw",
    dealer: 0,
    turn: 0,
    ended: false,
  };
  const events: GameEvent[] = [];

  for (let packet = 0; packet < 4; packet += 1) {
    for (const player of state.players) {
      drawLiveTilesIntoHand(state, player.id, 4, events);
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
  const testScenario = createTestScenarioRound(options.seed);
  if (testScenario) {
    return runRound({
      seed: options.seed,
      state: testScenario.state,
      events: testScenario.events,
      bots: testScenarioBots(options.seed),
      maxTurns: options.maxTurns ?? testScenario.maxTurns,
    });
  }

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

function testScenarioBots(
  seed: string,
): [MahjongBot, MahjongBot, MahjongBot, MahjongBot] {
  const kongThenDiscard: MahjongBot = {
    name: "Test Kong",
    chooseAction(context) {
      return (
        context.legalActions.find((action) => action.type === "declareKong") ??
        context.legalActions.find((action) => action.type === "discard") ??
        context.legalActions[0]
      );
    },
  };
  const passClaims: MahjongBot = {
    name: "Test Pass",
    chooseAction(context) {
      return (
        context.legalActions.find((action) => action.type === "pass") ??
        context.legalActions.find((action) => action.type === "discard") ??
        context.legalActions[0]
      );
    },
  };
  const winClaims: MahjongBot = {
    name: "Test Win",
    chooseAction(context) {
      return (
        context.legalActions.find(
          (action) => action.type === "claim" && action.claim === "win",
        ) ??
        context.legalActions.find((action) => action.type === "pass") ??
        context.legalActions[0]
      );
    },
  };
  return seed === "test-rob-added-kong"
    ? [kongThenDiscard, winClaims, passClaims, passClaims]
    : [kongThenDiscard, passClaims, passClaims, passClaims];
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

function drawLiveTilesIntoHand(
  state: RoundState,
  playerId: PlayerId,
  count: number,
  events: GameEvent[],
): TileInstance[] {
  const tiles: TileInstance[] = [];
  for (let index = 0; index < count; index += 1) {
    const tile = drawLiveTile(state);
    if (!tile) {
      break;
    }
    state.players[playerId].hand.push(tile);
    tiles.push(tile);
  }

  if (tiles.length > 0) {
    events.push({
      ...eventMeta("setup", 0),
      type: "tilesDrawn",
      player: playerId,
      tiles,
      source: "liveWall",
      wallCount: state.wall.length,
      deadWallCount: state.deadWall.length,
    });
  }

  return tiles;
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
