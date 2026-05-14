import type { TilePlacement, Vec3 } from "./tableLayout";

export type TableFlipTilePhysics = {
  placement: TilePlacement;
  linearVelocity: Vec3;
  angularVelocity: Vec3;
};

export type TableFlipSettings = {
  seed: string;
  flipDirection: -1 | 1;
  yaw: number;
};

export type TableFlipVariabilityOptions = {
  variability?: number;
};

export function createTableFlipSettings(
  seed: string,
  { variability = 1 }: TableFlipVariabilityOptions = {},
): TableFlipSettings {
  return {
    seed,
    flipDirection: stableUnit(`${seed}:flip-direction`) < 0.5 ? -1 : 1,
    yaw: (stableUnit(`${seed}:flip-yaw`) - 0.5) * 0.46 * variability,
  };
}

export function createTableFlipTilePhysics(
  placements: readonly TilePlacement[],
  seed: string,
  options: TableFlipVariabilityOptions = {},
): TableFlipTilePhysics[] {
  return placements.map((placement) => ({
    placement,
    linearVelocity: tableFlipLinearVelocity(placement, seed, options),
    angularVelocity: tableFlipAngularVelocity(placement, seed, options),
  }));
}

export function tableFlipLinearVelocity(
  placement: TilePlacement,
  seed: string,
  { variability = 1 }: TableFlipVariabilityOptions = {},
): Vec3 {
  const outward = normalizeVec3([
    placement.position[0],
    0,
    placement.position[2],
  ]);
  const jitterAngle =
    (stableUnit(`${seed}:${placement.tile.id}:angle`) - 0.5) *
    1.15 *
    variability;
  const cos = Math.cos(jitterAngle);
  const sin = Math.sin(jitterAngle);
  const x = outward[0] * cos - outward[2] * sin;
  const z = outward[0] * sin + outward[2] * cos;
  const speed =
    0.65 +
    stableUnit(`${seed}:${placement.tile.id}:speed`) * 1.25 * variability;
  const lift =
    0.95 + stableUnit(`${seed}:${placement.tile.id}:lift`) * 1.45 * variability;
  return [x * speed, lift, z * speed];
}

export function tableFlipAngularVelocity(
  placement: TilePlacement,
  seed: string,
  { variability = 1 }: TableFlipVariabilityOptions = {},
): Vec3 {
  return [
    (stableUnit(`${seed}:${placement.tile.id}:spin-x`) - 0.5) *
      12 *
      variability,
    (stableUnit(`${seed}:${placement.tile.id}:spin-y`) - 0.5) *
      16 *
      variability,
    (stableUnit(`${seed}:${placement.tile.id}:spin-z`) - 0.5) *
      12 *
      variability,
  ];
}

function normalizeVec3(vector: Vec3): Vec3 {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length < 0.0001) {
    return [0, 0, 1];
  }
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function stableUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}
