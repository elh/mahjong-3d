import { macScreenSaverDownloadHref } from "./downloadLinks";

export function InfoModal({
  modalRef,
  seed,
  showSeed = false,
  links = [],
}: {
  modalRef: React.RefObject<HTMLElement | null>;
  seed: string;
  showSeed?: boolean;
  links?: readonly InfoModalLink[];
}) {
  return (
    <section
      className="info-modal"
      ref={modalRef}
      role="dialog"
      aria-labelledby="info-modal-title"
    >
      <header>
        <h2 id="info-modal-title">Mahjong 3D</h2>
        <p className="info-modal-subtitle">
          Taiwanese Mahjong 3D infinite simulator
        </p>
      </header>
      <p className="info-modal-meta">
        Download: <a href={macScreenSaverDownloadHref}>Mac screen saver</a>
      </p>
      <p className="info-modal-meta">
        GitHub: <a href="https://github.com/elh/mahjong-3d">elh/mahjong-3d</a>
      </p>
      {links.length > 0 ? (
        <p className="info-modal-meta">
          {links.map((link, index) => (
            <span key={link.href}>
              {index > 0 ? " · " : null}
              <a href={link.href}>{link.label}</a>
            </span>
          ))}
        </p>
      ) : null}
      {showSeed ? <p className="info-modal-meta">Seed: {seed}</p> : null}
    </section>
  );
}

export type InfoModalLink = {
  href: string;
  label: string;
};
