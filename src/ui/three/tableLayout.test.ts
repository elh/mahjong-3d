import { describe, expect, test } from "bun:test";
import { createBaselineBots } from "../../bots/baselineBot";
import { simulateRound } from "../../sim/engine";
import { replayEvents } from "../../sim/replay";
import {
  createThreeTableLayout,
  discardDropPosition,
  playerRowPosition,
  tileSize,
} from "./tableLayout";

describe("3D table layout", () => {
  test("maps replay tiles into stable wall, hand, and discard placements", () => {
    const result = simulateRound({
      seed: "three-layout",
      bots: createBaselineBots(),
      maxTurns: 2,
    });
    const discardIndex = result.events.findIndex(
      (event) => event.type === "tileDiscarded",
    );
    const replay = replayEvents(result.events, discardIndex);
    const layout = createThreeTableLayout(replay, result.events[discardIndex]);

    expect(layout.tiles.filter((tile) => tile.owner === "wall").length).toBe(
      replay.wall.length,
    );
    expect(
      layout.tiles.filter((tile) => tile.owner === "deadWall").length,
    ).toBe(replay.deadWall.length);
    expect(layout.tiles.filter((tile) => tile.owner === "hand").length).toBe(
      replay.players.reduce((total, player) => total + player.hand.length, 0),
    );
    expect(
      layout.tiles.filter((tile) => tile.owner === "discard" && tile.physics),
    ).toHaveLength(1);
  });

  test("creates draw and discard animation endpoints from replay events", () => {
    const result = simulateRound({
      seed: "three-animation",
      bots: createBaselineBots(),
      maxTurns: 8,
    });
    const drawIndex = result.events.findIndex(
      (event) => event.type === "tileDrawn" && event.phase === "turn",
    );
    const discardIndex = result.events.findIndex(
      (event) => event.type === "tileDiscarded",
    );

    const drawEvent = result.events[drawIndex];
    const drawReplay = replayEvents(result.events, drawIndex);
    const drawLayout = createThreeTableLayout(drawReplay, drawEvent);
    expect(drawLayout.animation?.event.type).toBe("tileDrawn");
    if (drawEvent?.type === "tileDrawn") {
      expect(drawLayout.animation?.to).toEqual(
        expect.arrayContaining([expect.any(Number)]),
      );
    }

    const discardEvent = result.events[discardIndex];
    const discardReplay = replayEvents(result.events, discardIndex);
    const discardLayout = createThreeTableLayout(discardReplay, discardEvent);
    expect(discardLayout.animation?.event.type).toBe("tileDiscarded");
    if (
      discardEvent?.type === "tileDiscarded" &&
      discardLayout.animation?.event.type === "tileDiscarded"
    ) {
      expect(discardLayout.animation?.from).toEqual(
        playerRowPosition(discardEvent.player, 0, 1, 3.45, 0),
      );
      expect(discardDropPosition(discardEvent.player)[1]).toBeGreaterThan(
        discardLayout.animation.to[1],
      );
    }
  });

  test("packs player rows and wall sides edge to edge without corner overlap", () => {
    const result = simulateRound({
      seed: "three-spacing",
      bots: createBaselineBots(),
      maxTurns: 1,
    });
    const replay = replayEvents(result.events);
    const layout = createThreeTableLayout(replay, replay.currentEvent);
    const eastHand = layout.tiles
      .filter(
        (placement) => placement.owner === "hand" && placement.player === 0,
      )
      .sort((left, right) => left.position[0] - right.position[0]);
    const wall = layout.tiles.filter((placement) => placement.owner === "wall");
    const southWallSide = wall.slice(0, 18);
    const eastWallSide = wall.slice(18, 36);

    expect(distance(eastHand[0].position, eastHand[1].position)).toBeCloseTo(
      tileSize.width,
      5,
    );
    expect(
      distance(southWallSide[0].position, southWallSide[1].position),
    ).toBeCloseTo(tileSize.width, 5);
    expect(
      distance(eastWallSide[0].position, eastWallSide[1].position),
    ).toBeCloseTo(tileSize.width, 5);
    expect(southWallSide.at(-1)!.position[0] + tileSize.width / 2).toBeCloseTo(
      eastWallSide[0].position[0] - tileSize.depth / 2,
      5,
    );
  });
});

function distance(
  left: [number, number, number],
  right: [number, number, number],
) {
  return Math.hypot(left[0] - right[0], left[2] - right[2]);
}
