import { Environment, OrbitControls, RoundedBox } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  type ContactForcePayload,
  CuboidCollider,
  Physics,
  type RapierRigidBody,
  RigidBody,
  type RigidBodyProps,
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
const loadedDiscardSettlingMs = 180;
const enableTileCollisionSound = false;
const showThreeDebugPanel = false;
const tileSoundCooldownMs = 62;
const tableHalfSize = 3.24;
const tableSlabDepth = 0.24;
const tableRailWidth = 0.16;
const tableRailHeight = 0.075;
const tableRailOuterHalfSize = tableHalfSize + tableRailWidth;
type TileTextureEntry = {
  texture?: THREE.Texture;
  isLoading: boolean;
  didFail?: boolean;
  listeners: Set<(texture: THREE.Texture | undefined) => void>;
};

const tileTextureCache = new Map<string, TileTextureEntry>();
let tileAudioContext: AudioContext | undefined;
let lastTileSoundAt = 0;
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

type SoundDebugSettings = {
  volume: number;
  chink: number;
  ring: number;
  sustain: number;
  minSpeed: number;
};

const defaultFlickDebugSettings: FlickDebugSettings = {
  force: 1.5,
  lift: 1,
  spin: 5.4,
  tableFriction: 1.35,
  tileFriction: 1.2,
  linearDamping: 1.05,
  angularDamping: 0.85,
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

const defaultSoundDebugSettings: SoundDebugSettings = {
  volume: 17,
  chink: 1.45,
  ring: 1.55,
  sustain: 1.25,
  minSpeed: 0.04,
};

type ThreeGameViewProps = {
  replay: ReplayState;
  previousReplay: ReplayState | undefined;
  currentEvent: GameEvent | undefined;
  eventIndex: number;
  roundKey: string;
  loading?: boolean;
};

export function ThreeGameView({
  replay,
  previousReplay,
  currentEvent,
  eventIndex,
  roundKey,
  loading = false,
}: ThreeGameViewProps) {
  const [flickDebug, setFlickDebug] = useState(defaultFlickDebugSettings);
  const [lightingDebug, setLightingDebug] = useState(
    defaultLightingDebugSettings,
  );
  const [soundDebug, setSoundDebug] = useState(defaultSoundDebugSettings);
  const [sceneReady, setSceneReady] = useState(false);
  const lastEventIndexRef = useRef(eventIndex);
  const initialEventIndexRef = useRef(eventIndex);
  const lastRoundKeyRef = useRef(roundKey);
  const didMountRef = useRef(false);
  const roundChanged = roundKey !== lastRoundKeyRef.current;
  if (roundChanged) {
    lastRoundKeyRef.current = roundKey;
    initialEventIndexRef.current = eventIndex;
    lastEventIndexRef.current = eventIndex;
    didMountRef.current = false;
  }
  const layout = useMemo(
    () => createThreeTableLayout(replay, currentEvent, previousReplay),
    [replay, currentEvent, previousReplay],
  );
  const requiredTileTextureUrls = useMemo(() => {
    const urls = new Set<string>();
    for (const placement of layout.tiles) {
      if (placement.faceUp) {
        urls.add(tileImage(placement.tile));
      }
    }
    for (const animation of layout.animations) {
      if (animation.faceUp !== false) {
        urls.add(tileImage(animation.tile));
      }
    }
    return [...urls].sort();
  }, [layout]);
  const tileFacesReady = useTileTexturesReady(requiredTileTextureUrls);
  const sceneVisible =
    sceneReady && tileFacesReady && !roundChanged && !loading;
  const shouldAnimateEvent =
    didMountRef.current && eventIndex !== lastEventIndexRef.current;
  const shouldAnimateInitialEvent =
    sceneVisible && eventIndex === initialEventIndexRef.current;
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
  const playContactSound = useMemo(
    () => createContactSoundHandler(soundDebug),
    [soundDebug],
  );

  useEffect(() => {
    if (!enableTileCollisionSound) {
      return;
    }

    function unlockAudio() {
      void ensureTileAudioContext()?.resume();
    }

    window.addEventListener("pointerdown", unlockAudio, { once: true });
    window.addEventListener("keydown", unlockAudio, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, []);

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
      {showThreeDebugPanel ? (
        <ThreeDebugPanel
          flickSettings={flickDebug}
          lightingSettings={lightingDebug}
          soundSettings={soundDebug}
          onFlickChange={setFlickDebug}
          onLightingChange={setLightingDebug}
          onSoundChange={setSoundDebug}
        />
      ) : null}
      {!sceneVisible ? (
        <div className="three-loading-overlay" aria-live="polite">
          Loading...
        </div>
      ) : null}
      <Canvas
        shadows="percentage"
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
          <Physics gravity={[0, -9.81, 0]}>
            <CuboidCollider
              position={[0, -tableSlabDepth / 2, 0]}
              args={[tableHalfSize, tableSlabDepth / 2, tableHalfSize]}
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
                onContactSound={playContactSound}
                visible={sceneVisible}
              />
            ))}
          </Physics>
          <group visible={sceneVisible}>
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
                flipAxis={animation.flipAxis}
                faceUp={animation.faceUp}
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
    <group>
      <RoundedBox
        receiveShadow
        args={[tableHalfSize * 2, tableSlabDepth, tableHalfSize * 2]}
        radius={0.055}
        smoothness={8}
        position={[0, -tableSlabDepth / 2, 0]}
      >
        <meshStandardMaterial
          color="#173e35"
          roughness={0.94}
          metalness={0.01}
        />
      </RoundedBox>
      <CenterTableMark />
      <TableRail />
    </group>
  );
}

function CenterTableMark() {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext("2d");
    if (!context) {
      return undefined;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(255, 255, 244, 0.22)";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font =
      '410px "Kaiti TC", "Songti TC", "STKaiti", "PMingLiU", "MingLiU", serif';
    context.fillText("黃", canvas.width / 2, canvas.height / 2 + 8);

    const canvasTexture = new THREE.CanvasTexture(canvas);
    canvasTexture.colorSpace = THREE.SRGBColorSpace;
    canvasTexture.anisotropy = 4;
    canvasTexture.needsUpdate = true;
    return canvasTexture;
  }, []);

  useEffect(() => () => texture?.dispose(), [texture]);

  if (!texture) {
    return null;
  }

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, -0.28]}>
      <planeGeometry args={[3.12, 3.12]} />
      <meshBasicMaterial
        map={texture}
        transparent
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

function TableRail() {
  const railY = tableRailHeight / 2;
  const railLength = tableRailOuterHalfSize * 2;
  const railMaterial = (
    <meshStandardMaterial color="#102d28" roughness={0.9} metalness={0.01} />
  );

  return (
    <group>
      <RoundedBox
        castShadow
        receiveShadow
        args={[railLength, tableRailHeight, tableRailWidth]}
        radius={0.035}
        smoothness={6}
        position={[0, railY, tableRailOuterHalfSize - tableRailWidth / 2]}
      >
        {railMaterial}
      </RoundedBox>
      <RoundedBox
        castShadow
        receiveShadow
        args={[railLength, tableRailHeight, tableRailWidth]}
        radius={0.035}
        smoothness={6}
        position={[0, railY, -tableRailOuterHalfSize + tableRailWidth / 2]}
      >
        {railMaterial}
      </RoundedBox>
      <RoundedBox
        castShadow
        receiveShadow
        args={[tableRailWidth, tableRailHeight, railLength]}
        radius={0.035}
        smoothness={6}
        position={[tableRailOuterHalfSize - tableRailWidth / 2, railY, 0]}
      >
        {railMaterial}
      </RoundedBox>
      <RoundedBox
        castShadow
        receiveShadow
        args={[tableRailWidth, tableRailHeight, railLength]}
        radius={0.035}
        smoothness={6}
        position={[-tableRailOuterHalfSize + tableRailWidth / 2, railY, 0]}
      >
        {railMaterial}
      </RoundedBox>
    </group>
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
  soundSettings,
  onFlickChange,
  onLightingChange,
  onSoundChange,
}: {
  flickSettings: FlickDebugSettings;
  lightingSettings: LightingDebugSettings;
  soundSettings: SoundDebugSettings;
  onFlickChange: (settings: FlickDebugSettings) => void;
  onLightingChange: (settings: LightingDebugSettings) => void;
  onSoundChange: (settings: SoundDebugSettings) => void;
}) {
  const [mode, setMode] = useState<"flick" | "lighting" | "sound">("sound");

  return (
    <aside className="three-debug-panel" aria-label="3D debug settings">
      <header>
        <span>Debug</span>
        <button
          type="button"
          onClick={() =>
            mode === "flick"
              ? onFlickChange(defaultFlickDebugSettings)
              : mode === "lighting"
                ? onLightingChange(defaultLightingDebugSettings)
                : onSoundChange(defaultSoundDebugSettings)
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
        <button
          type="button"
          className={mode === "sound" ? "active" : ""}
          onClick={() => setMode("sound")}
        >
          Sound
        </button>
      </div>
      {mode === "flick" ? (
        <FlickDebugControls settings={flickSettings} onChange={onFlickChange} />
      ) : mode === "lighting" ? (
        <LightingDebugControls
          settings={lightingSettings}
          onChange={onLightingChange}
        />
      ) : (
        <SoundDebugControls settings={soundSettings} onChange={onSoundChange} />
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

function SoundDebugControls({
  settings,
  onChange,
}: {
  settings: SoundDebugSettings;
  onChange: (settings: SoundDebugSettings) => void;
}) {
  return (
    <>
      <DebugSlider
        label="Volume"
        value={settings.volume}
        min={0}
        max={30}
        step={0.05}
        onChange={(volume) => onChange({ ...settings, volume })}
      />
      <DebugSlider
        label="Chink"
        value={settings.chink}
        min={0}
        max={2.5}
        step={0.05}
        onChange={(chink) => onChange({ ...settings, chink })}
      />
      <DebugSlider
        label="Ring"
        value={settings.ring}
        min={0}
        max={2.5}
        step={0.05}
        onChange={(ring) => onChange({ ...settings, ring })}
      />
      <DebugSlider
        label="Sustain"
        value={settings.sustain}
        min={0.4}
        max={2.2}
        step={0.05}
        onChange={(sustain) => onChange({ ...settings, sustain })}
      />
      <DebugSlider
        label="Min speed"
        value={settings.minSpeed}
        min={0}
        max={0.2}
        step={0.01}
        onChange={(minSpeed) => onChange({ ...settings, minSpeed })}
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

function ensureTileAudioContext(): AudioContext | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  if (!tileAudioContext) {
    tileAudioContext = new window.AudioContext();
  }
  return tileAudioContext;
}

function createContactSoundHandler(settings: SoundDebugSettings) {
  return (payload: ContactForcePayload) => {
    if (!enableTileCollisionSound) {
      return;
    }

    if (!isTileContact(payload)) {
      return;
    }
    const targetVelocity = payload.target.rigidBody?.linvel();
    const otherVelocity = payload.other.rigidBody?.linvel();
    const relativeSpeed =
      targetVelocity && otherVelocity
        ? Math.hypot(
            targetVelocity.x - otherVelocity.x,
            targetVelocity.y - otherVelocity.y,
            targetVelocity.z - otherVelocity.z,
          )
        : 0;
    playTileContactSound(payload.maxForceMagnitude, relativeSpeed, settings);
  };
}

function isTileContact(payload: ContactForcePayload): boolean {
  return (
    isDiscardTileUserData(payload.target.rigidBody?.userData) &&
    isDiscardTileUserData(payload.other.rigidBody?.userData)
  );
}

function isDiscardTileUserData(
  value: unknown,
): value is { kind: "discardTile"; tileId: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "discardTile"
  );
}

function playTileContactSound(
  forceMagnitude: number,
  relativeSpeed: number,
  settings: SoundDebugSettings,
): void {
  const now = performance.now();
  if (
    now - lastTileSoundAt < tileSoundCooldownMs ||
    forceMagnitude < 0.18 ||
    relativeSpeed < settings.minSpeed
  ) {
    return;
  }

  const context = ensureTileAudioContext();
  if (!context || context.state !== "running") {
    return;
  }

  lastTileSoundAt = now;
  const impact = Math.min(1, Math.max(0, (forceMagnitude - 0.18) / 3.2));
  const start = context.currentTime;
  const duration = (0.16 + impact * 0.08) * settings.sustain;
  const output = context.createDynamicsCompressor();
  output.threshold.setValueAtTime(-10, start);
  output.knee.setValueAtTime(8, start);
  output.ratio.setValueAtTime(8, start);
  output.attack.setValueAtTime(0.001, start);
  output.release.setValueAtTime(0.08, start);
  const browserGain = context.createGain();
  const outputVolume = Math.max(0, settings.volume / 3.5);
  browserGain.gain.setValueAtTime(outputVolume * outputVolume, start);
  output.connect(browserGain);
  browserGain.connect(context.destination);

  const master = context.createGain();
  const driveVolume = Math.min(settings.volume, 12);
  master.gain.setValueAtTime(0.0001, start);
  master.gain.exponentialRampToValueAtTime(
    driveVolume * (0.055 + impact * 0.08),
    start + 0.001,
  );
  master.gain.exponentialRampToValueAtTime(
    driveVolume * (0.018 + impact * 0.025),
    start + 0.026,
  );
  master.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  master.connect(output);

  const noise = context.createBufferSource();
  noise.buffer = acrylicNoiseBuffer(context);
  const highpass = context.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 1250;
  const bandpass = context.createBiquadFilter();
  bandpass.type = "bandpass";
  bandpass.frequency.value =
    (2050 + impact * 1150) * (0.8 + settings.chink * 0.2);
  bandpass.Q.value = 6.5;
  const noiseGain = context.createGain();
  noiseGain.gain.setValueAtTime(settings.chink * (0.12 + impact * 0.18), start);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.008);
  noise.connect(highpass);
  highpass.connect(bandpass);
  bandpass.connect(noiseGain);
  noiseGain.connect(master);
  noise.start(start);
  noise.stop(start + 0.012);

  for (const [frequency, gain, decay] of [
    [240, 0.092, 0.44],
    [480, 0.076, 0.36],
    [960, 0.036, 0.26],
  ] satisfies [number, number, number][]) {
    const body = context.createOscillator();
    const bodyGain = context.createGain();
    body.type = "sine";
    body.frequency.setValueAtTime(frequency * (0.96 + impact * 0.08), start);
    bodyGain.gain.setValueAtTime(gain * (0.8 + impact * 0.8), start);
    bodyGain.gain.exponentialRampToValueAtTime(
      0.0001,
      start + duration * decay,
    );
    body.connect(bodyGain);
    bodyGain.connect(master);
    body.start(start);
    body.stop(start + duration * decay * 1.2);
  }

  for (const [frequency, gain, decay] of [
    [860, 0.054, 1.1],
    [1420, 0.09, 1.0],
    [2240, 0.12, 0.88],
    [3300, 0.098, 0.74],
    [4650, 0.06, 0.56],
    [6200, 0.024, 0.38],
  ] satisfies [number, number, number][]) {
    const resonance = context.createBiquadFilter();
    resonance.type = "bandpass";
    resonance.frequency.setValueAtTime(
      frequency * (0.99 + impact * 0.025),
      start,
    );
    resonance.Q.setValueAtTime(13 + impact * 7, start);
    const impulse = context.createBufferSource();
    impulse.buffer = ceramicImpulseBuffer(context);
    const impulseGain = context.createGain();
    impulseGain.gain.setValueAtTime(
      settings.ring * gain * (0.9 + impact * 0.7),
      start,
    );
    impulseGain.gain.exponentialRampToValueAtTime(
      0.0001,
      start + duration * decay,
    );
    impulse.connect(resonance);
    resonance.connect(impulseGain);
    impulseGain.connect(master);
    impulse.start(start);
    impulse.stop(start + 0.018);
  }

  for (const [offset, frequency, gain] of [
    [0, 3200, 0.18],
    [0.004, 4700, 0.105],
  ] satisfies [number, number, number][]) {
    const click = context.createOscillator();
    const clickGain = context.createGain();
    click.type = "sine";
    click.frequency.setValueAtTime(frequency + impact * 1200, start + offset);
    clickGain.gain.setValueAtTime(
      settings.chink * gain * (0.95 + impact * 0.7),
      start + offset,
    );
    clickGain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.014);
    click.connect(clickGain);
    clickGain.connect(master);
    click.start(start + offset);
    click.stop(start + offset + 0.018);
  }
}

function acrylicNoiseBuffer(context: AudioContext): AudioBuffer {
  const sampleCount = Math.max(1, Math.floor(context.sampleRate * 0.08));
  const buffer = context.createBuffer(1, sampleCount, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < sampleCount; index += 1) {
    const envelope = 1 - index / sampleCount;
    data[index] = (Math.random() * 2 - 1) * envelope * envelope;
  }
  return buffer;
}

function ceramicImpulseBuffer(context: AudioContext): AudioBuffer {
  const sampleCount = Math.max(1, Math.floor(context.sampleRate * 0.018));
  const buffer = context.createBuffer(1, sampleCount, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < sampleCount; index += 1) {
    const envelope = Math.exp(-index / (sampleCount * 0.14));
    const brightGrain = index % 2 === 0 ? 1 : -1;
    data[index] = brightGrain * envelope * (0.65 + Math.random() * 0.35);
  }
  return buffer;
}

function DiscardPhysicsTile({
  placement,
  flick,
  settings,
  onContactSound,
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
  onContactSound: (payload: ContactForcePayload) => void;
  visible: boolean;
}) {
  const [isActive, setIsActive] = useState(!flick);
  const [bodyType, setBodyType] = useState<RigidBodyProps["type"]>(
    flick ? "dynamic" : "kinematicPosition",
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
    setBodyType("kinematicPosition");
    setIsActive(true);
    const timeout = window.setTimeout(
      () => setBodyType("dynamic"),
      loadedDiscardSettlingMs,
    );
    return () => window.clearTimeout(timeout);
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
      userData={{ kind: "discardTile", tileId: placement.tile.id }}
      colliders={false}
      position={initialPlacementRef.current.position}
      rotation={initialPlacementRef.current.rotation}
      restitution={0.02}
      friction={settings.tileFriction}
      linearDamping={settings.linearDamping}
      angularDamping={settings.angularDamping}
      enabledRotations={[false, true, false]}
      onContactForce={onContactSound}
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
  flipAxis,
  faceUp = true,
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
  flipAxis?: Vec3;
  faceUp?: boolean;
  motion?: "arc" | "drawConcealed" | "knockdown" | "flipReveal";
  hideAfterMs?: number;
}) {
  const ref = useRef<THREE.Group>(null);
  const elapsedRef = useRef(0);
  const [isVisible, setIsVisible] = useState(true);
  const [isDrawFaceHidden, setIsDrawFaceHidden] = useState(
    motion === "drawConcealed",
  );
  const [isFlipFaceUp, setIsFlipFaceUp] = useState(motion !== "flipReveal");

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
    if (motion === "flipReveal" && !isFlipFaceUp && elapsed >= 0.32) {
      setIsFlipFaceUp(true);
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

    if (motion === "flipReveal") {
      const duration = 0.64;
      const t = easeInOutCubic(elapsed / duration);
      const firstHalf = Math.min(t / 0.5, 1);
      const secondHalf = Math.max((t - 0.5) / 0.5, 0);
      const axis = new THREE.Vector3(
        ...(flipAxis ?? ([1, 0, 0] satisfies Vec3)),
      ).normalize();
      const baseRotation = eulerToQuaternion(toRotation);
      const edgeRotation = new THREE.Quaternion()
        .setFromAxisAngle(axis, Math.PI / 2)
        .multiply(baseRotation);
      const rotation =
        t < 0.5
          ? slerpQuaternions(
              eulerToQuaternion(fromRotation),
              edgeRotation,
              firstHalf,
            )
          : slerpQuaternions(edgeRotation, baseRotation, secondHalf);
      applyDrawTransform(ref.current, from, to, rotation, rotation, 1, 0);
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
      ) : motion === "flipReveal" ? (
        <TileBlock tile={tile} faceUp={isFlipFaceUp} />
      ) : (
        <TileBlock tile={tile} faceUp={faceUp} />
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
  motion: "arc" | "drawConcealed" | "knockdown" | "flipReveal" = "arc",
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
  const texture = useTileTexture(tileImage(tile));
  return (
    <group>
      <TileBody orientation="faceUp" />
      {texture ? (
        <mesh
          visible={faceVisible}
          position={[0, tileSize.height / 2 + 0.003, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry
            args={[tileSize.width * 0.82, tileSize.depth * 0.86]}
          />
          <meshBasicMaterial
            map={texture}
            transparent
            alphaTest={0.02}
            toneMapped={false}
            side={THREE.FrontSide}
          />
        </mesh>
      ) : null}
    </group>
  );
}

function useTileTexture(url: string): THREE.Texture | undefined {
  const [texture, setTexture] = useState(
    () => tileTextureCache.get(url)?.texture,
  );

  useEffect(() => {
    const entry = ensureTileTextureLoading(url);
    if (entry.texture) {
      setTexture(entry.texture);
      return;
    }
    if (entry.didFail) {
      setTexture(undefined);
      return;
    }

    setTexture(undefined);
    const listener = (loadedTexture: THREE.Texture | undefined) =>
      setTexture(loadedTexture);
    entry.listeners.add(listener);

    return () => {
      entry.listeners.delete(listener);
    };
  }, [url]);

  return texture;
}

function useTileTexturesReady(urls: string[]): boolean {
  const [isReady, setIsReady] = useState(() => areTileTexturesReady(urls));

  useEffect(() => {
    if (urls.length === 0) {
      setIsReady(true);
      return;
    }

    let isMounted = true;
    const updateReady = () => {
      if (isMounted) {
        setIsReady(areTileTexturesReady(urls));
      }
    };
    const subscriptions: Array<{
      entry: TileTextureEntry;
      listener: (texture: THREE.Texture | undefined) => void;
    }> = [];

    for (const url of urls) {
      const entry = ensureTileTextureLoading(url);
      if (!entry.texture && !entry.didFail) {
        entry.listeners.add(updateReady);
        subscriptions.push({ entry, listener: updateReady });
      }
    }

    updateReady();
    return () => {
      isMounted = false;
      for (const { entry, listener } of subscriptions) {
        entry.listeners.delete(listener);
      }
    };
  }, [urls]);

  return isReady;
}

function areTileTexturesReady(urls: string[]): boolean {
  return urls.every((url) => {
    const entry = tileTextureCache.get(url);
    return Boolean(entry?.texture || entry?.didFail);
  });
}

function ensureTileTextureLoading(url: string): TileTextureEntry {
  let entry = tileTextureCache.get(url);
  if (!entry) {
    entry = { isLoading: false, listeners: new Set() };
    tileTextureCache.set(url, entry);
  }

  if (entry.texture || entry.didFail || entry.isLoading) {
    return entry;
  }

  entry.isLoading = true;
  new THREE.TextureLoader().load(
    url,
    (loadedTexture) => {
      configureTileTexture(loadedTexture);
      const loadedEntry = tileTextureCache.get(url);
      if (!loadedEntry) {
        return;
      }
      loadedEntry.texture = loadedTexture;
      loadedEntry.isLoading = false;
      for (const listener of loadedEntry.listeners) {
        listener(loadedTexture);
      }
    },
    undefined,
    () => {
      const failedEntry = tileTextureCache.get(url);
      if (!failedEntry) {
        return;
      }
      failedEntry.isLoading = false;
      failedEntry.didFail = true;
      for (const listener of failedEntry.listeners) {
        listener(undefined);
      }
    },
  );

  return entry;
}

function configureTileTexture(texture: THREE.Texture): void {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
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
            vec3 tileGreen = vec3(0.024, 0.439, 0.106);
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
