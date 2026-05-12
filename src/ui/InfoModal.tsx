import { tileAttributionUrl } from "./tileImages";

export function InfoModal({
  modalRef,
  summary,
  routeLink,
}: {
  modalRef: React.RefObject<HTMLElement | null>;
  summary?: {
    title: string;
    detail: string;
  };
  routeLink: {
    href: string;
    label: string;
  };
}) {
  return (
    <section
      className="info-modal"
      ref={modalRef}
      role="dialog"
      aria-labelledby="info-modal-title"
    >
      <header>
        <h2 id="info-modal-title">{summary?.title ?? "About"}</h2>
        {summary ? <p>{summary.detail}</p> : null}
      </header>
      <p>
        A Taiwanese Mahjong 3d viz, game debug UI, rules implementation, and
        basic bot.
      </p>
      <p>
        Github: <a href="https://github.com/elh/mahjong-3d">elh/mahjong-3d</a>
      </p>
      <p>
        Alternative view: <a href={routeLink.href}>{routeLink.label}</a>
      </p>
      <p>
        Tile art adapted from{" "}
        <a href="https://demching.itch.io/mahjong">DemChing/Cangjie6</a>,{" "}
        <a href={tileAttributionUrl()}>CC BY-SA 4.0</a>.
      </p>
    </section>
  );
}
