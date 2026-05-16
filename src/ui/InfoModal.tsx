export function InfoModal({
  modalRef,
  seed,
  links = [],
}: {
  modalRef: React.RefObject<HTMLElement | null>;
  seed: string;
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
        <p className="info-modal-subtitle">Infinite Taiwanese Mahjong sim</p>
      </header>
      <p className="info-modal-meta">
        Github: <a href="https://github.com/elh/mahjong-3d">elh/mahjong-3d</a>
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
      <p className="info-modal-meta">Seed: {seed}</p>
    </section>
  );
}

export type InfoModalLink = {
  href: string;
  label: string;
};
