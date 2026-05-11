import {
  Environment,
  OrbitControls,
  RoundedBox,
  useTexture,
} from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  CuboidCollider,
  Physics,
  type RigidBodyProps,
  type RapierRigidBody,
  RigidBody,
} from "@react-three/rapier";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
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
const flickHandoffOverlapMs = 48;
const tableHalfSize = 3.24;
type FlickDebugSettings = {
  force: number;
  lift: number;
  spin: number;
  tableFriction: number;
  tileFriction: number;
  linearDamping: number;
  angularDamping: number;
};

const defaultFlickDebugSettings: FlickDebugSettings = {
  force: 1.5,
  lift: 1,
  spin: 1,
  tableFriction: 1.35,
  tileFriction: 1.2,
  linearDamping: 1.05,
  angularDamping: 1.45,
};

type ThreeGameViewProps = {
  replay: ReplayState;
  previousReplay: ReplayState | undefined;
  currentEvent: GameEvent | undefined;
  eventIndex: number;
  roundKey: string;
};

export function ThreeGameView({
  replay,
  previousReplay,
  currentEvent,
  eventIndex,
  roundKey,
}: ThreeGameViewProps) {
  const [flickDebug, setFlickDebug] = useState(defaultFlickDebugSettings);
  const [sceneReady, setSceneReady] = useState(false);
  const lastEventIndexRef = useRef(eventIndex);
  const initialEventIndexRef = useRef(eventIndex);
  const lastRoundKeyRef = useRef(roundKey);
  const didMountRef = useRef(false);
  if (roundKey !== lastRoundKeyRef.current) {
    lastRoundKeyRef.current = roundKey;
    initialEventIndexRef.current = eventIndex;
    lastEventIndexRef.current = eventIndex;
    didMountRef.current = false;
  }
  const shouldAnimateEvent =
    didMountRef.current && eventIndex !== lastEventIndexRef.current;
  const shouldAnimateInitialEvent =
    sceneReady && eventIndex === initialEventIndexRef.current;
  const layout = useMemo(
    () => createThreeTableLayout(replay, currentEvent, previousReplay),
    [replay, currentEvent, previousReplay],
  );
  const animations =
    shouldAnimateEvent || shouldAnimateInitialEvent ? layout.animations : [];
  const animatedTileIds = new Set(
    animations.map((animation) => animation.tile.id),
  );
  const flickByTileId = new Map(
    animations
      .filter((animation) => animation.flick)
      .map((animation) => [animation.tile.id, animation.flick!]),
  );
  const nonPhysicsAnimatedTileIds = new Set(
    animations
      .filter((animation) => !animation.flick)
      .map((animation) => animation.tile.id),
  );
  const visibleTiles = layout.tiles.filter(
    (placement) => !animatedTileIds.has(placement.tile.id),
  );
  const staticTiles = visibleTiles.filter((placement) => !placement.physics);
  const discardTiles = layout.tiles.filter(
    (placement) =>
      placement.physics && !nonPhysicsAnimatedTileIds.has(placement.tile.id),
  );

  useEffect(() => {
    didMountRef.current = true;
    lastEventIndexRef.current = eventIndex;
  });

  useEffect(() => {
    void roundKey;
    setSceneReady(false);
    let timeout: number | undefined;
    const frame = window.requestAnimationFrame(() => {
      timeout = window.setTimeout(() => setSceneReady(true), 120);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (timeout !== undefined) {
        window.clearTimeout(timeout);
      }
    };
  }, [roundKey]);

  return (
    <section className="three-viewer" aria-label="3D autonomous game viewer">
      <FlickDebugPanel settings={flickDebug} onChange={setFlickDebug} />
      <Canvas
        shadows
        dpr={[1, 1.75]}
        camera={{ position: [0, 3.05, 6.75], fov: 42, near: 0.1, far: 100 }}
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
          <Physics key={`physics-${roundKey}`} gravity={[0, -9.81, 0]}>
            <CuboidCollider
              position={[0, -0.05, 0]}
              args={[tableHalfSize, 0.05, tableHalfSize]}
              friction={flickDebug.tableFriction}
              restitution={0.02}
            />
            {discardTiles.map((placement) => (
              <DiscardPhysicsTile
                key={placement.tile.id}
                placement={
                  flickByTileId.has(placement.tile.id)
                    ? {
                        ...placement,
                        position: flickByTileId.get(placement.tile.id)!
                          .position,
                        rotation: flickByTileId.get(placement.tile.id)!
                          .rotation,
                      }
                    : placement
                }
                flick={flickByTileId.get(placement.tile.id)}
                settings={flickDebug}
                startsDynamic={flickByTileId.has(placement.tile.id)}
                visible={sceneReady}
              />
            ))}
          </Physics>
          <group visible={sceneReady}>
            {staticTiles.map((placement) => (
              <TileMesh key={placement.tile.id} placement={placement} />
            ))}
            {animations.map((animation) => (
              <AnimatedTile
                key={`${animation.tile.id}-${eventIndex}`}
                tile={animation.tile}
                from={animation.from}
                to={animation.to}
                fromRotation={animation.fromRotation}
                toRotation={animation.toRotation}
                via={animation.via}
                motion={animation.motion}
                hideAfterMs={
                  animation.flick
                    ? animation.flick.delayMs + flickHandoffOverlapMs
                    : undefined
                }
              />
            ))}
          </group>
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
    <mesh
      receiveShadow
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, -0.01, 0]}
    >
      <planeGeometry args={[tableHalfSize * 2, tableHalfSize * 2]} />
      <meshStandardMaterial
        color="#1c493f"
        roughness={0.86}
        metalness={0.02}
      />
    </mesh>
  );
}

function FlickDebugPanel({
  settings,
  onChange,
}: {
  settings: FlickDebugSettings;
  onChange: (settings: FlickDebugSettings) => void;
}) {
  return (
    <aside className="three-debug-panel" aria-label="3D flick physics settings">
      <header>
        <span>Flick</span>
        <button
          type="button"
          onClick={() => onChange(defaultFlickDebugSettings)}
        >
          Reset
        </button>
      </header>
      <DebugSlider
        label="Force"
        value={settings.force}
        min={0.4}
        max={2.6}
        step={0.05}
        onChange={(force) => onChange({ ...settings, force })}
      />
      <DebugSlider
        label="Lift"
        value={settings.lift}
        min={0}
        max={2.4}
        step={0.05}
        onChange={(lift) => onChange({ ...settings, lift })}
      />
      <DebugSlider
        label="Spin"
        value={settings.spin}
        min={0}
        max={2.5}
        step={0.05}
        onChange={(spin) => onChange({ ...settings, spin })}
      />
      <DebugSlider
        label="Table friction"
        value={settings.tableFriction}
        min={0.2}
        max={3}
        step={0.05}
        onChange={(tableFriction) => onChange({ ...settings, tableFriction })}
      />
      <DebugSlider
        label="Tile friction"
        value={settings.tileFriction}
        min={0.2}
        max={3}
        step={0.05}
        onChange={(tileFriction) => onChange({ ...settings, tileFriction })}
      />
      <DebugSlider
        label="Linear damp"
        value={settings.linearDamping}
        min={0}
        max={3}
        step={0.05}
        onChange={(linearDamping) => onChange({ ...settings, linearDamping })}
      />
      <DebugSlider
        label="Angular damp"
        value={settings.angularDamping}
        min={0}
        max={3}
        step={0.05}
        onChange={(angularDamping) => onChange({ ...settings, angularDamping })}
      />
    </aside>
  );
}

function DebugSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      <span>
        {label}
        <strong>{value.toFixed(2)}</strong>
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}

function DiscardPhysicsTile({
  placement,
  flick,
  settings,
  startsDynamic,
  visible,
}: {
  placement: TilePlacement;
  flick?: {
    position: Vec3;
    rotation: Vec3;
    linearVelocity: Vec3;
    angularVelocity: Vec3;
    delayMs: number;
  };
  settings: FlickDebugSettings;
  startsDynamic: boolean;
  visible: boolean;
}) {
  const [isActive, setIsActive] = useState(!flick);
  const [bodyType, setBodyType] = useState<RigidBodyProps["type"]>(
    startsDynamic ? "dynamic" : "fixed",
  );
  const didApplyFlickRef = useRef(false);
  const pendingFlickRef = useRef(flick);
  const latestPlacementRef = useRef(placement);
  const initialPlacementRef = useRef(placement);
  const bodyRef = useRef<RapierRigidBody>(null);
  latestPlacementRef.current = placement;

  useEffect(() => {
    if (flick) {
      pendingFlickRef.current = flick;
      initialPlacementRef.current = latestPlacementRef.current;
      setBodyType("dynamic");
      setIsActive(false);
      didApplyFlickRef.current = false;
      const timeout = window.setTimeout(
        () => setIsActive(true),
        Math.max(0, flick.delayMs - flickHandoffOverlapMs),
      );
      return () => window.clearTimeout(timeout);
    }

    if (pendingFlickRef.current && !didApplyFlickRef.current) {
      setIsActive(true);
      return;
    }

    pendingFlickRef.current = undefined;
    if (!didApplyFlickRef.current) {
      initialPlacementRef.current = latestPlacementRef.current;
    }
    setIsActive(true);
    return;
  }, [flick]);

  useFrame(() => {
    const activeFlick = flick ?? pendingFlickRef.current;
    if (
      !activeFlick ||
      !isActive ||
      !bodyRef.current ||
      didApplyFlickRef.current
    ) {
      return;
    }
    didApplyFlickRef.current = true;
    pendingFlickRef.current = undefined;
    setBodyType("dynamic");
    bodyRef.current.setAngvel(
      {
        x: activeFlick.angularVelocity[0] * settings.spin,
        y: activeFlick.angularVelocity[1] * settings.spin,
        z: activeFlick.angularVelocity[2] * settings.spin,
      },
      true,
    );
    bodyRef.current.setLinvel(
      {
        x: activeFlick.linearVelocity[0] * settings.force,
        y: activeFlick.linearVelocity[1] * settings.lift,
        z: activeFlick.linearVelocity[2] * settings.force,
      },
      true,
    );
  });

  if (!isActive) {
    return null;
  }

  return (
    <RigidBody
      ref={bodyRef}
      type={bodyType}
      colliders={false}
      position={initialPlacementRef.current.position}
      rotation={initialPlacementRef.current.rotation}
      restitution={0.02}
      friction={settings.tileFriction}
      linearDamping={settings.linearDamping}
      angularDamping={settings.angularDamping}
      canSleep
    >
      <CuboidCollider
        args={[tileSize.width / 2, tileSize.height / 2, tileSize.depth / 2]}
      />
      <group visible={visible}>
        <TileBlock tile={initialPlacementRef.current.tile} faceUp />
      </group>
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
  motion = "arc",
  hideAfterMs,
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
  motion?: "arc" | "knockdown";
  hideAfterMs?: number;
}) {
  const ref = useRef<THREE.Group>(null);
  const elapsedRef = useRef(0);
  const [isVisible, setIsVisible] = useState(true);

  useFrame((_, delta) => {
    const holdSeconds = (via?.holdMs ?? 0) / 1000;
    const firstDuration = via ? 0.38 : 0.64;
    const secondDuration = via ? 0.46 : 0;
    const totalDuration = firstDuration + holdSeconds + secondDuration;
    elapsedRef.current = Math.min(elapsedRef.current + delta, totalDuration);
    const elapsed = elapsedRef.current;
    if (
      isVisible &&
      hideAfterMs !== undefined &&
      elapsed >= hideAfterMs / 1000
    ) {
      setIsVisible(false);
      return;
    }

    if (!via) {
      const t = easeOutCubic(elapsed / firstDuration);
      const arc =
        motion === "knockdown"
          ? Math.sin(t * Math.PI) * 0.035
          : Math.sin(t * Math.PI) * 0.32;
      applyAnimatedTransform(
        ref.current,
        from,
        to,
        fromRotation,
        toRotation,
        t,
        arc,
        motion,
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

  if (!isVisible) {
    return null;
  }

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
  motion: "arc" | "knockdown" = "arc",
) {
  if (!group) {
    return;
  }
  group.position.set(
    THREE.MathUtils.lerp(from[0], to[0], progress),
    THREE.MathUtils.lerp(from[1], to[1], progress) + arc,
    THREE.MathUtils.lerp(from[2], to[2], progress),
  );
  if (motion === "knockdown") {
    const fromQuaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(fromRotation[0], fromRotation[1], fromRotation[2]),
    );
    const toQuaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(toRotation[0], toRotation[1], toRotation[2]),
    );
    group.quaternion.copy(fromQuaternion).slerp(toQuaternion, progress);
    return;
  }
  group.rotation.set(
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

function easeOutCubic(value: number): number {
  return 1 - (1 - value) ** 3;
}

function easeInOutCubic(value: number): number {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - (-2 * value + 2) ** 3 / 2;
}
