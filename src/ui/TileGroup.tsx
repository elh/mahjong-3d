import type { TileInstance } from "../sim/tiles";
import { tileAlt, tileImage } from "./tileImages";

export function TileGroup({
  title,
  tiles,
  highlightedTileIds,
  className,
}: {
  title: string;
  tiles: readonly TileInstance[];
  highlightedTileIds: ReadonlySet<string>;
  className?: string;
}) {
  if (tiles.length === 0) {
    return null;
  }

  return (
    <section className={className ? `tile-group ${className}` : "tile-group"}>
      <h3>{title}</h3>
      <div className="tiles">
        {tiles.map((tile) => (
          <span
            className={
              highlightedTileIds.has(tile.id) ? "tile highlighted" : "tile"
            }
            key={tile.id}
            title={tile.id}
          >
            <img src={tileImage(tile)} alt={tileAlt(tile)} loading="lazy" />
          </span>
        ))}
      </div>
    </section>
  );
}

export function InlineTile({ tile }: { tile: TileInstance }) {
  return (
    <span className="inline-tile" title={tile.id}>
      <img src={tileImage(tile)} alt={tileAlt(tile)} loading="lazy" />
    </span>
  );
}
