import type { ReactNode } from "react";
import type { GameEvent } from "../sim/events";
import type { TileInstance } from "../sim/tiles";
import { playerNames } from "./playerNames";
import { InlineTile } from "./TileGroup";
import { tileAlt } from "./tileImages";

export function eventTitle(event: GameEvent | undefined): ReactNode {
  if (!event) {
    return "No event";
  }
  switch (event.type) {
    case "roundStarted":
      return "Round started";
    case "tileDrawn":
      return (
        <>
          {playerNames[event.player]} drew <InlineTile tile={event.tile} />
        </>
      );
    case "tileDiscarded":
      return (
        <>
          {playerNames[event.player]} discarded <InlineTile tile={event.tile} />
        </>
      );
    case "flowerExposed":
      return (
        <>
          {playerNames[event.player]} exposed flower{" "}
          <InlineTile tile={event.tile} />
        </>
      );
    case "claimMade":
      return (
        <>
          {playerNames[event.player]} claimed {event.claim}{" "}
          <InlineTile tile={event.tile} />
        </>
      );
    case "kongDeclared": {
      const tile = eventKongTile(event);
      return tile ? (
        <>
          {playerNames[event.player]} {eventKongAction(event)}{" "}
          <InlineTile tile={tile} />
        </>
      ) : (
        `${playerNames[event.player]} ${eventKongAction(event)}`
      );
    }
    case "winDeclared":
      return (
        <>
          {playerNames[event.player]} declared win{" "}
          <InlineTile tile={event.tile} />
        </>
      );
    case "drawDeclared":
      return event.reason === "turnLimit"
        ? "Turn limit draw"
        : "Exhaustive draw";
    case "rulesError":
      return `Rules error for ${playerNames[event.player]}`;
  }
}

export function eventLogTitle(event: GameEvent): string {
  switch (event.type) {
    case "roundStarted":
      return "Round started";
    case "tileDrawn":
      return `${playerNames[event.player]} drew ${tileAlt(event.tile)}`;
    case "tileDiscarded":
      return `${playerNames[event.player]} discarded ${tileAlt(event.tile)}`;
    case "flowerExposed":
      return `${playerNames[event.player]} exposed flower ${tileAlt(event.tile)}`;
    case "claimMade":
      return `${playerNames[event.player]} claimed ${event.claim} ${tileAlt(event.tile)}`;
    case "kongDeclared": {
      const tile = eventKongTile(event);
      return tile
        ? `${playerNames[event.player]} ${eventKongAction(event)} ${tileAlt(tile)}`
        : `${playerNames[event.player]} ${eventKongAction(event)}`;
    }
    case "winDeclared":
      return `${playerNames[event.player]} declared win ${tileAlt(event.tile)}`;
    case "drawDeclared":
      return event.reason === "turnLimit"
        ? "Turn limit draw"
        : "Exhaustive draw";
    case "rulesError":
      return `Rules error for ${playerNames[event.player]}`;
  }
}

export function eventDetail(event: GameEvent | undefined): ReactNode {
  if (!event) {
    return "Start a game to create an event log.";
  }
  switch (event.type) {
    case "roundStarted":
      return `${playerNames[event.dealer]} is dealer. Each player has ${event.handCounts.join(", ")} concealed tiles.`;
    case "tileDrawn":
      return `${event.replacement ? "Supplement draw" : "Turn draw"} from ${event.source === "deadWall" ? "dead wall" : "live wall"} with ${event.wallCount} live tiles left.`;
    case "tileDiscarded":
      return `${playerNames[event.player]} now has ${event.handCount} concealed tiles.`;
    case "flowerExposed":
      return `${playerNames[event.player]} exposed a flower and will draw a supplement tile.`;
    case "claimMade":
      return (
        <>
          {playerNames[event.player]} took <InlineTile tile={event.tile} /> from{" "}
          {playerNames[event.from]} for a {event.claim}.
        </>
      );
    case "kongDeclared": {
      const tile = eventKongTile(event);
      return event.kong === "claimed" && event.from !== undefined && event.tile
        ? `${playerNames[event.player]} took ${tileAlt(event.tile)} from ${playerNames[event.from]} for a claimed kong and must draw a supplement tile before discarding.`
        : tile
          ? `${playerNames[event.player]} declared ${eventKongArticle(event)} ${event.kong} kong of ${tileAlt(tile)} and must draw a supplement tile before discarding.`
          : `${playerNames[event.player]} declared a ${event.kong} kong and must draw a supplement tile before discarding.`;
    }
    case "winDeclared":
      return event.from === undefined ? (
        <>
          {playerNames[event.player]} won by self draw on{" "}
          <InlineTile tile={event.tile} />.
        </>
      ) : (
        <>
          {playerNames[event.player]} won on {playerNames[event.from]}'s{" "}
          <InlineTile tile={event.tile} />.
        </>
      );
    case "drawDeclared":
      return event.reason === "turnLimit"
        ? `No winner before the turn limit after ${event.turn} turns.`
        : `No winner after the wall was exhausted in ${event.turn} turns.`;
    case "rulesError":
      return event.message;
  }
}

function eventKongTile(
  event: Extract<GameEvent, { type: "kongDeclared" }>,
): TileInstance | undefined {
  return event.tile ?? event.addedTile ?? event.tiles[0];
}

function eventKongAction(
  event: Extract<GameEvent, { type: "kongDeclared" }>,
): string {
  return event.kong === "claimed"
    ? "claimed kong"
    : `declared ${event.kong} kong`;
}

function eventKongArticle(
  event: Extract<GameEvent, { type: "kongDeclared" }>,
): "a" | "an" {
  return event.kong === "added" ? "an" : "a";
}
