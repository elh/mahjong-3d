import {
  Environment,
  OrbitControls,
  RoundedBox,
  useTexture,
} from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  CuboidCollider,
  Physics,
  type RigidBodyProps,
  type RapierRigidBody,
  RigidBody,
} from "@react-three/rapier";
import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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

type LightingDebugSettings = {
  ambientIntensity: number;
  fillIntensity: number;
  keyIntensity: number;
  keyX: number;
  keyY: number;
  keyZ: number;
  cameraFillIntensity: number;
  handFaceFillIntensity: number;
  fogNear: number;
  fogFar: number;
  environment: boolean;
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

const defaultLightingDebugSettings: LightingDebugSettings = {
  ambientIntensity: 0.42,
  fillIntensity: 0.32,
  keyIntensity: 3.4,
  keyX: -2.8,
  keyY: 5.2,
  keyZ: 3.1,
  cameraFillIntensity: 0.28,
  handFaceFillIntensity: 0.48,
  fogNear: 8.5,
  fogFar: 13,
  environment: false,
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
  const flickDebug = defaultFlickDebugSettings;
  const lightingDebug = defaultLightingDebugSettings;
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
      {!sceneReady ? (
        <div className="three-loading-overlay" aria-live="polite">
          Loading...
        </div>
      ) : null}
      <Canvas
        shadows
        dpr={[1, 1.75]}
        camera={{ position: [0, 3.05, 6.75], fov: 42, near: 0.1, far: 100 }}
      >
        <color attach="background" args={["#131614"]} />
        <fog
          attach="fog"
          args={["#131614", lightingDebug.fogNear, lightingDebug.fogFar]}
        />
        <ambientLight intensity={lightingDebug.ambientIntensity} />
        <hemisphereLight
          intensity={lightingDebug.fillIntensity}
          color="#d9f0e5"
          groundColor="#0b1713"
        />
        <directionalLight
          castShadow
          intensity={lightingDebug.keyIntensity}
          position={[
            lightingDebug.keyX,
            lightingDebug.keyY,
            lightingDebug.keyZ,
          ]}
          shadow-mapSize={[1024, 1024]}
        />
        <CameraShoulderFill intensity={lightingDebug.cameraFillIntensity} />
        <HandFaceFill intensity={lightingDebug.handFaceFillIntensity} />
        <TableSurface />
        <Suspense fallback={null}>
          {lightingDebug.environment ? <Environment preset="studio" /> : null}
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
                drawStaging={animation.drawStaging}
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
      <meshStandardMaterial color="#1c493f" roughness={0.86} metalness={0.02} />
    </mesh>
  );
}

function CameraShoulderFill({ intensity }: { intensity: number }) {
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const { camera } = useThree();

  useFrame(() => {
    if (!lightRef.current) {
      return;
    }
    const cameraRight = new THREE.Vector3(1, 0, 0)
      .applyQuaternion(camera.quaternion)
      .multiplyScalar(-0.85);
    const cameraUp = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(camera.quaternion)
      .multiplyScalar(0.45);
    lightRef.current.position
      .copy(camera.position)
      .add(cameraRight)
      .add(cameraUp);
    lightRef.current.target.position.set(0, 0, 0);
    lightRef.current.target.updateMatrixWorld();
  });

  return (
    <directionalLight ref={lightRef} intensity={intensity} color="#e8fff4" />
  );
}

function HandFaceFill({ intensity }: { intensity: number }) {
  const lightPositions: Vec3[] = [
    [0, 1.3, 4.2],
    [4.2, 1.3, 0],
    [0, 1.3, -4.2],
    [-4.2, 1.3, 0],
  ];

  return (
    <>
      {lightPositions.map((position) => (
        <directionalLight
          key={position.join(",")}
          intensity={intensity}
          position={position}
          color="#fff8e6"
        />
      ))}
    </>
  );
}

export function ThreeDebugPanel({
  flickSettings,
  lightingSettings,
  onFlickChange,
  onLightingChange,
}: {
  flickSettings: FlickDebugSettings;
  lightingSettings: LightingDebugSettings;
  onFlickChange: (settings: FlickDebugSettings) => void;
  onLightingChange: (settings: LightingDebugSettings) => void;
}) {
  const [mode, setMode] = useState<"flick" | "lighting">("lighting");

  return (
    <aside className="three-debug-panel" aria-label="3D debug settings">
      <header>
        <span>Debug</span>
        <button
          type="button"
          onClick={() =>
            mode === "flick"
              ? onFlickChange(defaultFlickDebugSettings)
              : onLightingChange(defaultLightingDebugSettings)
          }
        >
          Reset
        </button>
      </header>
      <div className="three-debug-tabs" role="tablist" aria-label="Debug mode">
        <button
          type="button"
          className={mode === "flick" ? "active" : ""}
          onClick={() => setMode("flick")}
        >
          Flick
        </button>
        <button
          type="button"
          className={mode === "lighting" ? "active" : ""}
          onClick={() => setMode("lighting")}
        >
          Lighting
        </button>
      </div>
      {mode === "flick" ? (
        <FlickDebugControls settings={flickSettings} onChange={onFlickChange} />
      ) : (
        <LightingDebugControls
          settings={lightingSettings}
          onChange={onLightingChange}
        />
      )}
    </aside>
  );
}

function FlickDebugControls({
  settings,
  onChange,
}: {
  settings: FlickDebugSettings;
  onChange: (settings: FlickDebugSettings) => void;
}) {
  return (
    <>
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
    </>
  );
}

function LightingDebugControls({
  settings,
  onChange,
}: {
  settings: LightingDebugSettings;
  onChange: (settings: LightingDebugSettings) => void;
}) {
  return (
    <>
      <DebugToggle
        label="Studio environment"
        checked={settings.environment}
        onChange={(environment) => onChange({ ...settings, environment })}
      />
      <DebugSlider
        label="Ambient"
        value={settings.ambientIntensity}
        min={0}
        max={1.2}
        step={0.02}
        onChange={(ambientIntensity) =>
          onChange({ ...settings, ambientIntensity })
        }
      />
      <DebugSlider
        label="Fill"
        value={settings.fillIntensity}
        min={0}
        max={1}
        step={0.02}
        onChange={(fillIntensity) => onChange({ ...settings, fillIntensity })}
      />
      <DebugSlider
        label="Key"
        value={settings.keyIntensity}
        min={0}
        max={6}
        step={0.05}
        onChange={(keyIntensity) => onChange({ ...settings, keyIntensity })}
      />
      <DebugSlider
        label="Key X"
        value={settings.keyX}
        min={-6}
        max={6}
        step={0.1}
        onChange={(keyX) => onChange({ ...settings, keyX })}
      />
      <DebugSlider
        label="Key Y"
        value={settings.keyY}
        min={1}
        max={8}
        step={0.1}
        onChange={(keyY) => onChange({ ...settings, keyY })}
      />
      <DebugSlider
        label="Key Z"
        value={settings.keyZ}
        min={-6}
        max={6}
        step={0.1}
        onChange={(keyZ) => onChange({ ...settings, keyZ })}
      />
      <DebugSlider
        label="Camera fill"
        value={settings.cameraFillIntensity}
        min={0}
        max={1.5}
        step={0.02}
        onChange={(cameraFillIntensity) =>
          onChange({ ...settings, cameraFillIntensity })
        }
      />
      <DebugSlider
        label="Hand face fill"
        value={settings.handFaceFillIntensity}
        min={0}
        max={1.2}
        step={0.02}
        onChange={(handFaceFillIntensity) =>
          onChange({ ...settings, handFaceFillIntensity })
        }
      />
      <DebugSlider
        label="Fog near"
        value={settings.fogNear}
        min={4}
        max={14}
        step={0.1}
        onChange={(fogNear) => onChange({ ...settings, fogNear })}
      />
      <DebugSlider
        label="Fog far"
        value={settings.fogFar}
        min={7}
        max={20}
        step={0.1}
        onChange={(fogFar) => onChange({ ...settings, fogFar })}
      />
    </>
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

function DebugToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="three-debug-toggle">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
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
  drawStaging,
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
  drawStaging?: {
    position: Vec3;
  };
  motion?: "arc" | "drawConcealed" | "knockdown";
  hideAfterMs?: number;
}) {
  const ref = useRef<THREE.Group>(null);
  const elapsedRef = useRef(0);
  const [isVisible, setIsVisible] = useState(true);
  const [isDrawFaceHidden, setIsDrawFaceHidden] = useState(
    motion === "drawConcealed",
  );

  useLayoutEffect(() => {
    if (motion !== "drawConcealed") {
      return;
    }
    applyDrawTransform(
      ref.current,
      from,
      from,
      drawFaceDownWallRotation(fromRotation),
      drawFaceDownWallRotation(fromRotation),
      0,
      0,
    );
  }, [from, fromRotation, motion]);

  useFrame((_, delta) => {
    const holdSeconds = (via?.holdMs ?? 0) / 1000;
    const firstDuration = via ? 0.38 : motion === "drawConcealed" ? 0.42 : 0.64;
    const secondDuration = via ? 0.46 : motion === "drawConcealed" ? 0.26 : 0;
    const thirdDuration = motion === "drawConcealed" ? 0.08 : 0;
    const totalDuration = firstDuration + holdSeconds + secondDuration;
    const fullDuration = totalDuration + thirdDuration;
    elapsedRef.current = Math.min(elapsedRef.current + delta, fullDuration);
    const elapsed = elapsedRef.current;
    if (
      motion === "drawConcealed" &&
      isDrawFaceHidden &&
      elapsed >= firstDuration
    ) {
      setIsDrawFaceHidden(false);
    }
    if (
      isVisible &&
      hideAfterMs !== undefined &&
      elapsed >= hideAfterMs / 1000
    ) {
      setIsVisible(false);
      return;
    }

    if (motion === "drawConcealed") {
      const staging = drawStaging?.position ?? to;
      if (elapsed <= firstDuration) {
        const t = elapsed / firstDuration;
        const arc = Math.sin(t * Math.PI) * 0.24;
        applyDrawTransform(
          ref.current,
          from,
          staging,
          drawFaceDownWallRotation(fromRotation),
          drawFaceDownWallRotation(fromRotation),
          t,
          arc,
        );
        return;
      }

      if (elapsed <= firstDuration + secondDuration) {
        const t = (elapsed - firstDuration) / secondDuration;
        const alignmentShare = 0.28;
        const startRotation = drawFaceDownWallRotation(fromRotation);
        const alignedRotation = drawFaceDownHandRotation(toRotation);
        const finalRotation = eulerToQuaternion(toRotation);
        const rotation =
          t < alignmentShare
            ? slerpQuaternions(
                startRotation,
                alignedRotation,
                t / alignmentShare,
              )
            : slerpQuaternions(
                alignedRotation,
                finalRotation,
                easeInOutCubic((t - alignmentShare) / (1 - alignmentShare)),
              );
        applyDrawTransform(
          ref.current,
          staging,
          staging,
          rotation,
          rotation,
          1,
          0,
        );
        return;
      }

      const t = easeInOutCubic(
        (elapsed - firstDuration - secondDuration) / thirdDuration,
      );
      applyDrawTransform(
        ref.current,
        staging,
        to,
        eulerToQuaternion(toRotation),
        eulerToQuaternion(toRotation),
        t,
        0,
      );
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
      {motion === "drawConcealed" ? (
        <FaceUpTileBlock tile={tile} faceVisible={!isDrawFaceHidden} />
      ) : (
        <TileBlock tile={tile} faceUp />
      )}
    </group>
  );
}

function drawFaceDownWallRotation(rotation: Vec3): THREE.Quaternion {
  return eulerToQuaternion(rotation).multiply(
    new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      Math.PI,
    ),
  );
}

function drawFaceDownHandRotation(rotation: Vec3): THREE.Quaternion {
  return eulerToQuaternion(rotation).multiply(
    new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      Math.PI / 2,
    ),
  );
}

function eulerToQuaternion(rotation: Vec3): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rotation[0], rotation[1], rotation[2]),
  );
}

function slerpQuaternions(
  from: THREE.Quaternion,
  to: THREE.Quaternion,
  progress: number,
): THREE.Quaternion {
  return from.clone().slerp(to, progress);
}

function applyDrawTransform(
  group: THREE.Group | null,
  from: Vec3,
  to: Vec3,
  fromRotation: THREE.Quaternion,
  toRotation: THREE.Quaternion,
  progress: number,
  arc: number,
) {
  if (!group) {
    return;
  }
  group.position.set(
    THREE.MathUtils.lerp(from[0], to[0], progress),
    THREE.MathUtils.lerp(from[1], to[1], progress) + arc,
    THREE.MathUtils.lerp(from[2], to[2], progress),
  );
  group.quaternion.copy(fromRotation).slerp(toRotation, progress);
}

function applyAnimatedTransform(
  group: THREE.Group | null,
  from: Vec3,
  to: Vec3,
  fromRotation: Vec3,
  toRotation: Vec3,
  progress: number,
  arc: number,
  motion: "arc" | "drawConcealed" | "knockdown" = "arc",
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

function FaceUpTileBlock({
  tile,
  faceVisible = true,
}: {
  tile: TileInstance;
  faceVisible?: boolean;
}) {
  const texture = useTexture(tileImage(tile));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return (
    <group>
      <TileBody orientation="faceUp" />
      <mesh
        visible={faceVisible}
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
