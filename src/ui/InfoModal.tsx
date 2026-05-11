import { tileAttributionUrl } from "./tileImages";

export function InfoModal({
  modalRef,
}: {
  modalRef: React.RefObject<HTMLElement | null>;
}) {
  return (
    <section
      className="info-modal"
      ref={modalRef}
      role="dialog"
      aria-labelledby="info-modal-title"
    >
      <header>
        <h2 id="info-modal-title">About</h2>
      </header>
      <p>
        A Taiwanese Mahjong 3d viz, game debug UI, rules implementation, and basic bot.
      </p>
      <p>
        Github:{" "}
        <a href="https://github.com/elh/concealed-gang">elh/concealed-gang</a>
      </p>
      <p>
        Tile art adapted from{" "}
        <a href="https://demching.itch.io/mahjong">DemChing/Cangjie6</a>,{" "}
        <a href={tileAttributionUrl()}>CC BY-SA 4.0</a>.
      </p>
    </section>
  );
}
