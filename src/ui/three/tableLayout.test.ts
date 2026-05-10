import { describe, expect, test } from "bun:test";
import { createBaselineBots } from "../../bots/baselineBot";
import { simulateRound } from "../../sim/engine";
import { replayEvents } from "../../sim/replay";
import {
  createThreeTableLayout,
  discardDropPosition,
  playerRowPosition,
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
});
