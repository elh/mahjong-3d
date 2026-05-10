import {
  Environment,
  OrbitControls,
  RoundedBox,
  Text,
  useTexture,
} from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  CuboidCollider,
  Physics,
  type RapierRigidBody,
  RigidBody,
} from "@react-three/rapier";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { GameEvent } from "../../sim/events";
import type { ReplayState } from "../../sim/replay";
import type { TileInstance } from "../../sim/tiles";
import { tileImage } from "../tileImages";
import {
  createThreeTableLayout,
  type TilePlacement,
  tileSize,
  type Vec3,
} from "./tableLayout";

const tileBackThickness = tileSize.height * 0.18;
const tileCornerRadius = 0.035;

type ThreeGameViewProps = {
  replay: ReplayState;
  previousReplay: ReplayState | undefined;
  currentEvent: GameEvent | undefined;
  eventIndex: number;
};

export function ThreeGameView({
  replay,
  previousReplay,
  currentEvent,
  eventIndex,
}: ThreeGameViewProps) {
  const layout = useMemo(
    () => createThreeTableLayout(replay, currentEvent, previousReplay),
    [replay, currentEvent, previousReplay],
  );
  const animatedTileIds = new Set(
    layout.animations.map((animation) => animation.tile.id),
  );
  const visibleTiles = layout.tiles.filter(
    (placement) => !animatedTileIds.has(placement.tile.id),
  );
  const staticTiles = visibleTiles.filter((placement) => !placement.physics);
  const discardTiles = visibleTiles.filter((placement) => placement.physics);

  return (
    <section className="three-viewer" aria-label="3D autonomous game viewer">
      <Canvas
        shadows
        dpr={[1, 1.75]}
        camera={{ position: [0, 5.4, 5.15], fov: 42, near: 0.1, far: 100 }}
      >
        <color attach="background" args={["#131614"]} />
        <fog attach="fog" args={["#131614", 6.5, 11]} />
        <ambientLight intensity={0.9} />
        <directionalLight
          castShadow
          intensity={2.4}
          position={[2.5, 5, 3.2]}
          shadow-mapSize={[1024, 1024]}
        />
        <TableSurface />
        <Suspense fallback={null}>
          <Environment preset="studio" />
          <Physics key={`physics-${eventIndex}`} gravity={[0, -9.81, 0]}>
            <CuboidCollider position={[0, -0.05, 0]} args={[4.8, 0.05, 4.8]} />
            {discardTiles.map((placement) => (
              <PhysicsTile
                key={placement.tile.id}
                placement={placement}
                eventIndex={eventIndex}
              />
            ))}
          </Physics>
          {staticTiles.map((placement) => (
            <TileMesh key={placement.tile.id} placement={placement} />
          ))}
          {layout.animations.map((animation) => (
            <AnimatedTile
              key={`${animation.tile.id}-${eventIndex}`}
              tile={animation.tile}
              from={animation.from}
              to={animation.to}
              fromRotation={animation.fromRotation}
              toRotation={animation.toRotation}
              via={animation.via}
            />
          ))}
          <TableLabels />
        </Suspense>
        <OrbitControls
          enablePan={false}
          enableDamping
          minDistance={5.6}
          maxDistance={7.4}
          maxPolarAngle={Math.PI / 2.35}
          minPolarAngle={Math.PI / 4.2}
        />
      </Canvas>
    </section>
  );
}

function TableSurface() {
  return (
    <>
      <mesh
        receiveShadow
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.01, 0]}
      >
        <planeGeometry args={[9.6, 9.6]} />
        <meshStandardMaterial
          color="#1c493f"
          roughness={0.86}
          metalness={0.02}
        />
      </mesh>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <ringGeometry args={[1.46, 1.51, 96]} />
        <meshStandardMaterial
          color="#d2b16f"
          roughness={0.62}
          metalness={0.1}
        />
      </mesh>
    </>
  );
}

function PhysicsTile({
  placement,
  target,
}: {
  placement: TilePlacement;
  target?: Vec3;
  eventIndex: number;
}) {
  const bodyRef = useRef<RapierRigidBody>(null);

  useEffect(() => {
    if (!target || !bodyRef.current) {
      return;
    }
    const direction = new THREE.Vector3(
      target[0] - placement.position[0],
      0,
      target[2] - placement.position[2],
    ).normalize();
    bodyRef.current.setLinvel(
      { x: direction.x * 2.2, y: 0.15, z: direction.z * 2.2 },
      true,
    );
    bodyRef.current.setAngvel({ x: 0.3, y: 1.1, z: -0.5 }, true);
  }, [placement.position, target]);

  return (
    <RigidBody
      ref={bodyRef}
      colliders={false}
      position={placement.position}
      rotation={placement.rotation}
      restitution={0.04}
      friction={1.4}
      linearDamping={1.9}
      angularDamping={2.4}
      canSleep
    >
      <CuboidCollider
        args={[tileSize.width / 2, tileSize.height / 2, tileSize.depth / 2]}
      />
      <TileBlock tile={placement.tile} faceUp={placement.faceUp} />
    </RigidBody>
  );
}

function AnimatedTile({
  tile,
  from,
  to,
  fromRotation,
  toRotation,
  via,
}: {
  tile: TileInstance;
  from: Vec3;
  to: Vec3;
  fromRotation: Vec3;
  toRotation: Vec3;
  via?: {
    position: Vec3;
    rotation: Vec3;
    holdMs?: number;
  };
}) {
  const ref = useRef<THREE.Group>(null);
  const elapsedRef = useRef(0);

  useFrame((_, delta) => {
    const holdSeconds = (via?.holdMs ?? 0) / 1000;
    const firstDuration = via ? 0.38 : 0.64;
    const secondDuration = via ? 0.46 : 0;
    const totalDuration = firstDuration + holdSeconds + secondDuration;
    elapsedRef.current = Math.min(elapsedRef.current + delta, totalDuration);
    const elapsed = elapsedRef.current;

    if (!via) {
      const t = easeOutCubic(elapsed / firstDuration);
      const arc = Math.sin(t * Math.PI) * 0.32;
      applyAnimatedTransform(
        ref.current,
        from,
        to,
        fromRotation,
        toRotation,
        t,
        arc,
      );
      return;
    }

    if (elapsed <= firstDuration) {
      const t = easeOutCubic(elapsed / firstDuration);
      const arc = Math.sin(t * Math.PI) * 0.08;
      applyAnimatedTransform(
        ref.current,
        from,
        via.position,
        fromRotation,
        via.rotation,
        t,
        arc,
      );
      return;
    }

    if (elapsed <= firstDuration + holdSeconds) {
      applyAnimatedTransform(
        ref.current,
        via.position,
        via.position,
        via.rotation,
        via.rotation,
        1,
        0,
      );
      return;
    }

    const t = easeInOutCubic(
      (elapsed - firstDuration - holdSeconds) / secondDuration,
    );
    applyAnimatedTransform(
      ref.current,
      via.position,
      to,
      via.rotation,
      toRotation,
      t,
      0,
    );
  });

  return (
    <group ref={ref} position={from} rotation={fromRotation}>
      <TileBlock tile={tile} faceUp />
    </group>
  );
}

function applyAnimatedTransform(
  group: THREE.Group | null,
  from: Vec3,
  to: Vec3,
  fromRotation: Vec3,
  toRotation: Vec3,
  progress: number,
  arc: number,
) {
  group?.position.set(
    THREE.MathUtils.lerp(from[0], to[0], progress),
    THREE.MathUtils.lerp(from[1], to[1], progress) + arc,
    THREE.MathUtils.lerp(from[2], to[2], progress),
  );
  group?.rotation.set(
    THREE.MathUtils.lerp(fromRotation[0], toRotation[0], progress),
    THREE.MathUtils.lerp(fromRotation[1], toRotation[1], progress),
    THREE.MathUtils.lerp(fromRotation[2], toRotation[2], progress),
  );
}

function TileMesh({ placement }: { placement: TilePlacement }) {
  return (
    <group position={placement.position} rotation={placement.rotation}>
      <TileBlock tile={placement.tile} faceUp={placement.faceUp} />
    </group>
  );
}

function TileBlock({ tile, faceUp }: { tile: TileInstance; faceUp: boolean }) {
  return faceUp ? <FaceUpTileBlock tile={tile} /> : <FaceDownTileBlock />;
}

function FaceUpTileBlock({ tile }: { tile: TileInstance }) {
  const texture = useTexture(tileImage(tile));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return (
    <group>
      <TileBody orientation="faceUp" />
      <mesh
        position={[0, tileSize.height / 2 + 0.003, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[tileSize.width * 0.82, tileSize.depth * 0.86]} />
        <meshBasicMaterial
          map={texture}
          transparent
          alphaTest={0.02}
          toneMapped={false}
          side={THREE.FrontSide}
        />
      </mesh>
    </group>
  );
}

function FaceDownTileBlock() {
  return (
    <group>
      <TileBody orientation="faceDown" />
    </group>
  );
}

function TileBody({ orientation }: { orientation: "faceUp" | "faceDown" }) {
  const backDirection = orientation === "faceUp" ? -1 : 1;
  const backThreshold = tileSize.height / 2 - tileBackThickness;

  return (
    <RoundedBox
      castShadow
      receiveShadow
      args={[tileSize.width, tileSize.height, tileSize.depth]}
      radius={tileCornerRadius}
      smoothness={8}
    >
      <meshStandardMaterial
        color="#ffffff"
        roughness={0.58}
        metalness={0.02}
        customProgramCacheKey={() => `mahjong-tile-body-${orientation}`}
        onBeforeCompile={(shader) => {
          shader.vertexShader = shader.vertexShader.replace(
            "#include <common>",
            "#include <common>\nvarying vec3 vTileLocalPosition;",
          );
          shader.vertexShader = shader.vertexShader.replace(
            "#include <begin_vertex>",
            "#include <begin_vertex>\nvTileLocalPosition = position;",
          );
          shader.fragmentShader = shader.fragmentShader.replace(
            "#include <common>",
            "#include <common>\nvarying vec3 vTileLocalPosition;",
          );
          shader.fragmentShader = shader.fragmentShader.replace(
            "vec4 diffuseColor = vec4( diffuse, opacity );",
            `
            vec3 tileIvory = vec3(0.953, 0.918, 0.839);
            vec3 tileGreen = vec3(0.000, 0.502, 0.341);
            float backMask = step(${backThreshold.toFixed(5)}, ${backDirection.toFixed(1)} * vTileLocalPosition.y);
            vec4 diffuseColor = vec4(mix(tileIvory, tileGreen, backMask), opacity);
            `,
          );
        }}
      />
    </RoundedBox>
  );
}

function TableLabels() {
  const labels: { label: string; position: Vec3; rotation: Vec3 }[] = [
    { label: "E", position: [0, 0.03, 4.05], rotation: [-Math.PI / 2, 0, 0] },
    { label: "S", position: [4.05, 0.03, 0], rotation: [-Math.PI / 2, 0, 0] },
    { label: "W", position: [0, 0.03, -4.05], rotation: [-Math.PI / 2, 0, 0] },
    { label: "N", position: [-4.05, 0.03, 0], rotation: [-Math.PI / 2, 0, 0] },
  ];
  return labels.map((label) => (
    <Text
      key={label.label}
      position={label.position}
      rotation={label.rotation}
      fontSize={0.18}
      color="#d2b16f"
      anchorX="center"
      anchorY="middle"
    >
      {label.label}
    </Text>
  ));
}

function easeOutCubic(value: number): number {
  return 1 - (1 - value) ** 3;
}

function easeInOutCubic(value: number): number {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - (-2 * value + 2) ** 3 / 2;
}
