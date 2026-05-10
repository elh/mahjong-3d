import { memo, type RefObject, useMemo } from "react";
import type { GameEvent } from "../sim/events";
import { eventLogTitle } from "./eventText";
import type { EventGroup } from "./useSimulationController";

type EventLogGroup = {
  id: string;
  phase: "setup" | "turn";
  label: string;
  events: EventLogEntry[];
};

type EventLogEntry = {
  index: number;
  label: string;
};

export const EventLog = memo(function EventLog({
  eventGroups,
  activeEvent,
  eventIndex,
  eventLogRef,
  activeEventRef,
  onJump,
  onStep,
}: {
  eventGroups: readonly EventGroup[];
  activeEvent: GameEvent | undefined;
  eventIndex: number;
  eventLogRef: RefObject<HTMLElement | null>;
  activeEventRef: RefObject<HTMLButtonElement | null>;
  onJump: (index: number) => void;
  onStep: (direction: -1 | 1) => void;
}) {
  const logGroups = useMemo(
    () =>
      eventGroups.map((group) => ({
        id: group.id,
        phase: group.phase,
        label: group.label,
        events: group.events.map(({ event, index }) => ({
          index,
          label: eventLogTitle(event),
        })),
      })),
    [eventGroups],
  );
  const activeGroupId = activeEvent?.groupId;

  return (
    <section
      ref={eventLogRef}
      className="event-list"
      aria-label="Event log"
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          onStep(1);
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          onStep(-1);
        }
      }}
    >
      {logGroups.map((group) => (
        <EventLogGroupSection
          key={group.id}
          group={group}
          activeEventRef={activeEventRef}
          eventIndex={eventIndex}
          isActiveGroup={group.id === activeGroupId}
          onJump={onJump}
        />
      ))}
    </section>
  );
});

const EventLogGroupSection = memo(function EventLogGroupSection({
  group,
  activeEventRef,
  eventIndex,
  isActiveGroup,
  onJump,
}: {
  group: EventLogGroup;
  activeEventRef: RefObject<HTMLButtonElement | null>;
  eventIndex: number;
  isActiveGroup: boolean;
  onJump: (index: number) => void;
}) {
  return (
    <section className="event-group">
      <button
        type="button"
        ref={isActiveGroup && group.phase === "setup" ? activeEventRef : null}
        className={
          isActiveGroup ? "event-group-header active" : "event-group-header"
        }
        onClick={() => onJump(group.events[0]?.index ?? 0)}
      >
        <strong>{group.label}</strong>
        {group.phase === "setup" && <span>{group.events.length} events</span>}
      </button>
      {group.phase === "turn" &&
        group.events.map((event) => (
          <EventLogRow
            key={event.index}
            event={event}
            activeEventRef={activeEventRef}
            isActive={event.index === eventIndex}
            onJump={onJump}
          />
        ))}
    </section>
  );
});

const EventLogRow = memo(function EventLogRow({
  event,
  activeEventRef,
  isActive,
  onJump,
}: {
  event: EventLogEntry;
  activeEventRef: RefObject<HTMLButtonElement | null>;
  isActive: boolean;
  onJump: (index: number) => void;
}) {
  return (
    <button
      type="button"
      ref={isActive ? activeEventRef : null}
      className={isActive ? "event-row active" : "event-row"}
      onClick={() => onJump(event.index)}
    >
      <span>{String(event.index + 1).padStart(3, "0")}</span>
      <strong>{event.label}</strong>
    </button>
  );
});
