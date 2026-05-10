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
  discardDropPosition,
  type TilePlacement,
  tileSize,
  type Vec3,
} from "./tableLayout";

const tileBackThickness = tileSize.height * 0.18;
const tileCornerRadius = 0.035;

type ThreeGameViewProps = {
  replay: ReplayState;
  currentEvent: GameEvent | undefined;
  eventIndex: number;
};

export function ThreeGameView({
  replay,
  currentEvent,
  eventIndex,
}: ThreeGameViewProps) {
  const layout = useMemo(
    () => createThreeTableLayout(replay, currentEvent),
    [replay, currentEvent],
  );
  const animatedTileId = layout.animation?.event.tile.id;
  const visibleTiles = layout.tiles.filter(
    (placement) => placement.tile.id !== animatedTileId,
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
            {layout.animation?.event.type === "tileDiscarded" && (
              <PhysicsTile
                key={`${layout.animation.event.tile.id}-active-${eventIndex}`}
                placement={{
                  tile: layout.animation.event.tile,
                  owner: "discard",
                  player: layout.animation.event.player,
                  position: layout.animation.from,
                  rotation: layout.animation.rotation,
                  faceUp: true,
                  physics: true,
                }}
                target={discardDropPosition(layout.animation.event.player)}
                eventIndex={eventIndex}
              />
            )}
          </Physics>
          {staticTiles.map((placement) => (
            <TileMesh key={placement.tile.id} placement={placement} />
          ))}
          {layout.animation?.event.type === "tileDrawn" && (
            <AnimatedTile
              key={`${layout.animation.event.tile.id}-${eventIndex}`}
              tile={layout.animation.event.tile}
              from={layout.animation.from}
              to={layout.animation.to}
              rotation={layout.animation.rotation}
            />
          )}
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
  rotation,
}: {
  tile: TileInstance;
  from: Vec3;
  to: Vec3;
  rotation: Vec3;
}) {
  const ref = useRef<THREE.Group>(null);
  const elapsedRef = useRef(0);

  useFrame((_, delta) => {
    elapsedRef.current = Math.min(elapsedRef.current + delta, 0.64);
    const t = easeOutCubic(elapsedRef.current / 0.64);
    const arc = Math.sin(t * Math.PI) * 0.32;
    ref.current?.position.set(
      THREE.MathUtils.lerp(from[0], to[0], t),
      THREE.MathUtils.lerp(from[1], to[1], t) + arc,
      THREE.MathUtils.lerp(from[2], to[2], t),
    );
  });

  return (
    <group ref={ref} position={from} rotation={rotation}>
      <TileBlock tile={tile} faceUp />
    </group>
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
