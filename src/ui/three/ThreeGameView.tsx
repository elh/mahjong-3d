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
  useCallback,
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
import { allTileImageUrls, tileImage } from "../tileImages";
import {
  createTableFlipSettings,
  createTableFlipTilePhysics,
  type TableFlipSettings,
  type TableFlipTilePhysics,
} from "./tableFlip";
import {
  createThreeTableLayout,
  type TilePlacement,
  tileSize,
  type Vec3,
} from "./tableLayout";

const tileBackThickness = tileSize.height * 0.18;
const tileCornerRadius = 0.035;
const loadedDiscardSettlingMs = 180;
const enableTileCollisionSound = false;
const showThreeDebugPanel = false;
const tileSoundCooldownMs = 62;
const tableHalfSize = 3.24;
const tableSlabDepth = 0.24;
const tableRailWidth = 0.16;
const tableRailHeight = 0.075;
const tableRailOuterHalfSize = tableHalfSize + tableRailWidth;
const cameraTarget: Vec3 = [0, 0, 0];

type CameraPreset = {
  position: Vec3;
  fov: number;
  minDistance: number;
  maxDistance: number;
  minPolarAngle: number;
  maxPolarAngle: number;
  target: Vec3;
};

const cameraPresets = {
  desktop: {
    position: [0, 2.85, 7.05],
    fov: 40,
    minDistance: 5.6,
    maxDistance: 8.8,
    minPolarAngle: Math.PI / 4.2,
    maxPolarAngle: Math.PI / 2.35,
    target: cameraTarget,
  },
  narrow: {
    position: [0, 4.8, 9.8],
    fov: 48,
    minDistance: 8.2,
    maxDistance: 12.4,
    minPolarAngle: Math.PI / 4.6,
    maxPolarAngle: Math.PI / 2.6,
    target: cameraTarget,
  },
  mobilePortrait: {
    position: [0, 6.8, 9.8],
    fov: 54,
    minDistance: 10,
    maxDistance: 13.8,
    minPolarAngle: Math.PI / 5.8,
    maxPolarAngle: Math.PI / 3,
    target: cameraTarget,
  },
} satisfies Record<string, CameraPreset>;

type TilePose = {
  position: Vec3;
  rotation: Vec3;
};

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
  environment: boolean;
};

type SoundDebugSettings = {
  volume: number;
  chink: number;
  ring: number;
  sustain: number;
  minSpeed: number;
};

type TableFlipDebugSettings = {
  prepDelayMs: number;
  flipDurationSeconds: number;
  flipRange: number;
  variability: number;
  tableLift: number;
  tableSlide: number;
  tileImpulse: number;
  tileLift: number;
  tileSpin: number;
  tileDamping: number;
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
  ambientIntensity: 0.36,
  fillIntensity: 0.48,
  keyIntensity: 3.8,
  keyX: -3.4,
  keyY: 5.8,
  keyZ: 2.6,
  cameraFillIntensity: 0.3,
  handFaceFillIntensity: 0.52,
  environment: false,
};

const defaultSoundDebugSettings: SoundDebugSettings = {
  volume: 17,
  chink: 1.45,
  ring: 1.55,
  sustain: 1.25,
  minSpeed: 0.04,
};

const defaultTableFlipDebugSettings: TableFlipDebugSettings = {
  prepDelayMs: 300,
  flipDurationSeconds: 1.15,
  flipRange: 1.35,
  variability: 0.65,
  tableLift: 0.28,
  tableSlide: 0.32,
  tileImpulse: 0.6,
  tileLift: 0.7,
  tileSpin: 0.7,
  tileDamping: 0.9,
};

type ThreeGameViewProps = {
  replay: ReplayState;
  previousReplay: ReplayState | undefined;
  currentEvent: GameEvent | undefined;
  nextEvent: GameEvent | undefined;
  eventIndex: number;
  roundKey: string;
  loading?: boolean;
  simulatorMode?: boolean;
  cameraAutoRotate?: boolean;
  cameraUserControlled?: boolean;
  onCameraUserControlChange?: (isUserControlled: boolean) => void;
  renderPaused?: boolean;
  suppressLoadingOverlay?: boolean;
  preserveSceneOnRoundChange?: boolean;
  tableFlipDebug?: boolean;
};

export function ThreeGameView({
  replay,
  previousReplay,
  currentEvent,
  nextEvent,
  eventIndex,
  roundKey,
  loading = false,
  simulatorMode = false,
  cameraAutoRotate = true,
  cameraUserControlled,
  onCameraUserControlChange,
  renderPaused = false,
  suppressLoadingOverlay = false,
  preserveSceneOnRoundChange = false,
  tableFlipDebug = false,
}: ThreeGameViewProps) {
  const [flickDebug, setFlickDebug] = useState(defaultFlickDebugSettings);
  const [lightingDebug, setLightingDebug] = useState(
    defaultLightingDebugSettings,
  );
  const [soundDebug, setSoundDebug] = useState(defaultSoundDebugSettings);
  const [tableFlipDebugSettings, setTableFlipDebugSettings] = useState(
    defaultTableFlipDebugSettings,
  );
  const [sceneReady, setSceneReady] = useState(false);
  const [tableFlipRun, setTableFlipRun] = useState(0);
  const [tableFlipPhysicsKey, setTableFlipPhysicsKey] = useState(0);
  const [tableFlipSnapshot, setTableFlipSnapshot] = useState<
    TableFlipTilePhysics[] | undefined
  >();
  const [isTableFlipMotionActive, setIsTableFlipMotionActive] = useState(false);
  const [isTableFlipResetting, setIsTableFlipResetting] = useState(false);
  const [internalCameraUserControlled, setInternalCameraUserControlled] =
    useState(false);
  const cameraPreset = useResponsiveCameraPreset();
  const lastEventIndexRef = useRef(eventIndex);
  const initialEventIndexRef = useRef(eventIndex);
  const lastRoundKeyRef = useRef(roundKey);
  const preserveSceneOnRoundChangeRef = useRef(preserveSceneOnRoundChange);
  const tableFlipRoundKeyRef = useRef(roundKey);
  const tableFlipDelayTimeoutRef = useRef<number | undefined>(undefined);
  const tableFlipResetFrameRef = useRef<number | undefined>(undefined);
  const didMountRef = useRef(false);
  const animatedTileHandoffsRef = useRef(new Map<string, () => void>());
  const discardPoseByTileIdRef = useRef(new Map<string, TilePose>());
  const roundChanged = roundKey !== lastRoundKeyRef.current;
  preserveSceneOnRoundChangeRef.current = preserveSceneOnRoundChange;
  if (roundChanged) {
    lastRoundKeyRef.current = roundKey;
    initialEventIndexRef.current = eventIndex;
    lastEventIndexRef.current = eventIndex;
    didMountRef.current = false;
    discardPoseByTileIdRef.current.clear();
  }
  const isCameraUserControlled =
    cameraUserControlled ?? internalCameraUserControlled;
  const setIsCameraUserControlled = useCallback(
    (isUserControlled: boolean) => {
      if (cameraUserControlled === undefined) {
        setInternalCameraUserControlled(isUserControlled);
      }
      onCameraUserControlChange?.(isUserControlled);
    },
    [cameraUserControlled, onCameraUserControlChange],
  );
  const layout = useMemo(
    () =>
      createThreeTableLayout(replay, currentEvent, previousReplay, nextEvent),
    [replay, currentEvent, previousReplay, nextEvent],
  );
  const requiredTileTextureUrls = useMemo(() => allTileImageUrls(), []);
  const tileFacesReady = useTileTexturesReady(requiredTileTextureUrls);
  const sceneVisible =
    sceneReady &&
    tileFacesReady &&
    (!roundChanged || preserveSceneOnRoundChange) &&
    !loading;
  const shouldAnimateEvent =
    didMountRef.current && eventIndex !== lastEventIndexRef.current;
  const shouldAnimateInitialEvent =
    !tableFlipDebug &&
    sceneVisible &&
    eventIndex === initialEventIndexRef.current;
  const animations =
    shouldAnimateEvent || shouldAnimateInitialEvent ? layout.animations : [];
  const renderedAnimations = animations.map((animation) => {
    if (
      animation.event.type !== "winDeclared" ||
      animation.motion !== "claimToss"
    ) {
      return animation;
    }
    const discardPose = discardPoseByTileIdRef.current.get(animation.tile.id);
    if (!discardPose) {
      return animation;
    }
    return {
      ...animation,
      from: discardPose.position,
      fromRotation: discardPose.rotation,
      via: animation.via
        ? {
            ...animation.via,
            position: winningPickupControlPoint(
              discardPose.position,
              animation.to,
            ),
          }
        : animation.via,
    };
  });
  const animatedTileIds = new Set(
    renderedAnimations.map((animation) => animation.tile.id),
  );
  const flickByTileId = new Map(
    renderedAnimations
      .filter((animation) => animation.flick)
      .map((animation) => [animation.tile.id, animation.flick!]),
  );
  const nonPhysicsAnimatedTileIds = new Set(
    renderedAnimations
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
  const tableFlipSettings = useMemo(
    () =>
      createTableFlipSettings(roundKey, {
        variability: tableFlipDebugSettings.variability,
      }),
    [roundKey, tableFlipDebugSettings.variability],
  );
  const isTableFlipped = tableFlipSnapshot !== undefined;
  const isTableFlipPhysicsPaused =
    tableFlipDebug &&
    ((isTableFlipped && !isTableFlipMotionActive) || isTableFlipResetting);
  const playContactSound = useMemo(
    () => createContactSoundHandler(soundDebug),
    [soundDebug],
  );
  const registerAnimatedTileHandoff = useCallback(
    (handoffKey: string, hideAnimatedTile: (() => void) | undefined) => {
      if (hideAnimatedTile) {
        animatedTileHandoffsRef.current.set(handoffKey, hideAnimatedTile);
        return;
      }
      animatedTileHandoffsRef.current.delete(handoffKey);
    },
    [],
  );
  const hideAnimatedTileForHandoff = useCallback((handoffKey: string) => {
    animatedTileHandoffsRef.current.get(handoffKey)?.();
  }, []);
  const recordDiscardPose = useCallback((tileId: string, pose: TilePose) => {
    discardPoseByTileIdRef.current.set(tileId, pose);
  }, []);
  const startTableFlip = useCallback(() => {
    if (tableFlipDelayTimeoutRef.current !== undefined) {
      window.clearTimeout(tableFlipDelayTimeoutRef.current);
      tableFlipDelayTimeoutRef.current = undefined;
    }
    if (tableFlipResetFrameRef.current !== undefined) {
      window.cancelAnimationFrame(tableFlipResetFrameRef.current);
      tableFlipResetFrameRef.current = undefined;
    }
    setIsTableFlipResetting(false);
    setIsTableFlipMotionActive(false);
    setTableFlipSnapshot(
      createTableFlipTilePhysics(layout.tiles, roundKey, {
        variability: tableFlipDebugSettings.variability,
      }),
    );
    setTableFlipRun((run) => run + 1);
    tableFlipDelayTimeoutRef.current = window.setTimeout(() => {
      tableFlipDelayTimeoutRef.current = undefined;
      setIsTableFlipMotionActive(true);
    }, tableFlipDebugSettings.prepDelayMs);
  }, [
    layout.tiles,
    roundKey,
    tableFlipDebugSettings.prepDelayMs,
    tableFlipDebugSettings.variability,
  ]);
  const resetTableFlip = useCallback(() => {
    if (tableFlipDelayTimeoutRef.current !== undefined) {
      window.clearTimeout(tableFlipDelayTimeoutRef.current);
      tableFlipDelayTimeoutRef.current = undefined;
    }
    if (tableFlipResetFrameRef.current !== undefined) {
      window.cancelAnimationFrame(tableFlipResetFrameRef.current);
      tableFlipResetFrameRef.current = undefined;
    }
    setIsTableFlipMotionActive(false);
    setIsTableFlipResetting(true);
    tableFlipResetFrameRef.current = window.requestAnimationFrame(() => {
      tableFlipResetFrameRef.current = undefined;
      setTableFlipSnapshot(undefined);
      setTableFlipPhysicsKey((key) => key + 1);
      setTableFlipRun((run) => run + 1);
      setIsTableFlipResetting(false);
    });
  }, []);

  useEffect(() => {
    if (tableFlipRoundKeyRef.current === roundKey) {
      return;
    }
    tableFlipRoundKeyRef.current = roundKey;
    setIsTableFlipMotionActive(false);
    setIsTableFlipResetting(false);
    setTableFlipSnapshot(undefined);
    setTableFlipPhysicsKey((key) => key + 1);
  });

  useEffect(
    () => () => {
      if (tableFlipDelayTimeoutRef.current !== undefined) {
        window.clearTimeout(tableFlipDelayTimeoutRef.current);
      }
      if (tableFlipResetFrameRef.current !== undefined) {
        window.cancelAnimationFrame(tableFlipResetFrameRef.current);
      }
    },
    [],
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
    if (preserveSceneOnRoundChangeRef.current) {
      return;
    }
    setSceneReady(false);
    setInternalCameraUserControlled(false);
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
      {tableFlipDebug ? (
        <>
          <fieldset
            className="table-flip-controls"
            aria-label="Table flip controls"
          >
            <button
              type="button"
              className="primary-button"
              onClick={startTableFlip}
              disabled={!sceneVisible || isTableFlipped}
            >
              Flip
            </button>
            <button
              type="button"
              onClick={resetTableFlip}
              disabled={!isTableFlipped}
            >
              Reset
            </button>
          </fieldset>
          <TableFlipDebugPanel
            settings={tableFlipDebugSettings}
            onChange={setTableFlipDebugSettings}
          />
        </>
      ) : null}
      {!sceneVisible && !suppressLoadingOverlay ? (
        <div className="three-loading-overlay" aria-live="polite">
          Loading...
        </div>
      ) : null}
      <Canvas
        frameloop={renderPaused ? "never" : "always"}
        shadows="percentage"
        dpr={[1, 1.75]}
        camera={{
          position: cameraPreset.position,
          fov: cameraPreset.fov,
          near: 0.1,
          far: 100,
        }}
      >
        <CameraPresetSync preset={cameraPreset} />
        <color attach="background" args={["#0f1112"]} />
        <ambientLight intensity={lightingDebug.ambientIntensity} />
        <hemisphereLight
          intensity={lightingDebug.fillIntensity}
          color="#ececeb"
          groundColor="#181b1a"
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
          shadow-camera-left={-4.2}
          shadow-camera-right={4.2}
          shadow-camera-top={4.2}
          shadow-camera-bottom={-4.2}
          shadow-camera-near={0.5}
          shadow-camera-far={12}
          shadow-bias={-0.00025}
        />
        <pointLight
          intensity={0.26}
          distance={7.5}
          decay={2}
          position={[2.8, 2.4, -3.2]}
          color="#c2c7c4"
        />
        <CameraShoulderFill intensity={lightingDebug.cameraFillIntensity} />
        <HandFaceFill intensity={lightingDebug.handFaceFillIntensity} />
        {tableFlipDebug ? null : <TableSurface />}
        <Suspense fallback={null}>
          {lightingDebug.environment ? <Environment preset="studio" /> : null}
          <Physics
            key={tableFlipDebug ? tableFlipPhysicsKey : "main"}
            gravity={[0, -9.81, 0]}
            timeStep={tableFlipDebug ? 1 / 90 : undefined}
            numSolverIterations={tableFlipDebug ? 10 : undefined}
            numInternalPgsIterations={tableFlipDebug ? 2 : undefined}
            maxCcdSubsteps={tableFlipDebug ? 4 : undefined}
            paused={isTableFlipPhysicsPaused}
          >
            {tableFlipDebug ? (
              <FlipTable
                key={tableFlipRun}
                active={isTableFlipMotionActive}
                settings={tableFlipSettings}
                debugSettings={tableFlipDebugSettings}
                tableFriction={flickDebug.tableFriction}
              />
            ) : (
              <CuboidCollider
                position={[0, -tableSlabDepth / 2, 0]}
                args={[tableHalfSize, tableSlabDepth / 2, tableHalfSize]}
                friction={flickDebug.tableFriction}
                restitution={0.02}
              />
            )}
            {isTableFlipped
              ? tableFlipSnapshot?.map((tilePhysics) => (
                  <TableFlipPhysicsTile
                    key={`${tableFlipRun}:${tilePhysics.placement.tile.id}`}
                    tilePhysics={tilePhysics}
                    settings={tableFlipDebugSettings}
                    onContactSound={playContactSound}
                    visible={sceneVisible}
                  />
                ))
              : discardTiles.map((placement) => (
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
                    handoffKey={
                      flickByTileId.has(placement.tile.id)
                        ? `${roundKey}:${eventIndex}:${placement.tile.id}`
                        : undefined
                    }
                    settings={flickDebug}
                    onContactSound={playContactSound}
                    onFlickStarted={hideAnimatedTileForHandoff}
                    onPoseChange={recordDiscardPose}
                    visible={sceneVisible}
                  />
                ))}
          </Physics>
          <group visible={sceneVisible && !isTableFlipped}>
            {staticTiles.map((placement) => (
              <TileMesh key={placement.tile.id} placement={placement} />
            ))}
            {renderedAnimations.map((animation) => (
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
                handoffKey={
                  animation.flick
                    ? `${roundKey}:${eventIndex}:${animation.tile.id}`
                    : undefined
                }
                registerHandoff={registerAnimatedTileHandoff}
              />
            ))}
          </group>
        </Suspense>
        <OrbitControls
          autoRotate={
            simulatorMode && cameraAutoRotate && !isCameraUserControlled
          }
          autoRotateSpeed={0.14}
          enablePan={false}
          enableDamping
          target={cameraPreset.target}
          minDistance={cameraPreset.minDistance}
          maxDistance={cameraPreset.maxDistance}
          maxPolarAngle={cameraPreset.maxPolarAngle}
          minPolarAngle={cameraPreset.minPolarAngle}
          onStart={() => setIsCameraUserControlled(true)}
        />
      </Canvas>
    </section>
  );
}

function useResponsiveCameraPreset(): CameraPreset {
  const [presetName, setPresetName] = useState<keyof typeof cameraPresets>(() =>
    currentCameraPresetName(),
  );

  useEffect(() => {
    const mobilePortraitQuery = window.matchMedia(
      "(max-width: 640px) and (orientation: portrait)",
    );
    const narrowQuery = window.matchMedia("(max-width: 860px)");
    const updatePreset = () => setPresetName(currentCameraPresetName());

    updatePreset();
    mobilePortraitQuery.addEventListener("change", updatePreset);
    narrowQuery.addEventListener("change", updatePreset);
    return () => {
      mobilePortraitQuery.removeEventListener("change", updatePreset);
      narrowQuery.removeEventListener("change", updatePreset);
    };
  }, []);

  return cameraPresets[presetName];
}

function currentCameraPresetName(): keyof typeof cameraPresets {
  if (typeof window === "undefined") {
    return "desktop";
  }
  if (
    window.matchMedia("(max-width: 640px) and (orientation: portrait)").matches
  ) {
    return "mobilePortrait";
  }
  if (window.matchMedia("(max-width: 860px)").matches) {
    return "narrow";
  }
  return "desktop";
}

function CameraPresetSync({ preset }: { preset: CameraPreset }) {
  const { camera } = useThree();

  useLayoutEffect(() => {
    camera.position.set(...preset.position);
    camera.lookAt(...preset.target);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = preset.fov;
      camera.updateProjectionMatrix();
    }
  }, [camera, preset]);

  return null;
}

function TableSurface() {
  const feltTextures = useMemo(() => createFeltTextures(), []);
  useEffect(
    () => () => {
      feltTextures.color.dispose();
      feltTextures.bump.dispose();
    },
    [feltTextures],
  );

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
          color="#245f50"
          map={feltTextures.color}
          bumpMap={feltTextures.bump}
          bumpScale={0.032}
          roughness={0.98}
          metalness={0.01}
        />
      </RoundedBox>
      <CenterTableMark />
      <TableRail />
    </group>
  );
}

function createFeltTextures(): {
  color: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
} {
  const size = 512;
  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = size;
  colorCanvas.height = size;
  const bumpCanvas = document.createElement("canvas");
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const colorContext = colorCanvas.getContext("2d");
  const bumpContext = bumpCanvas.getContext("2d");
  if (!colorContext || !bumpContext) {
    return {
      color: configureRepeatingTexture(new THREE.CanvasTexture(colorCanvas), 4),
      bump: configureRepeatingTexture(new THREE.CanvasTexture(bumpCanvas), 4),
    };
  }

  colorContext.fillStyle = "#266454";
  colorContext.fillRect(0, 0, size, size);
  const image = colorContext.getImageData(0, 0, size, size);
  const bumpImage = bumpContext.createImageData(size, size);
  for (let index = 0; index < image.data.length; index += 4) {
    const pixel = index / 4;
    const x = pixel % size;
    const y = Math.floor(pixel / size);
    const weave =
      Math.sin(x * 0.58) * 7 +
      Math.sin(y * 0.72) * 6 +
      (stableFeltNoise(x, y) - 0.5) * 28;
    image.data[index] = clampColor(37 + weave * 1.05);
    image.data[index + 1] = clampColor(96 + weave * 0.95);
    image.data[index + 2] = clampColor(80 + weave * 0.85);
    image.data[index + 3] = 255;

    const bumpValue = clampColor(124 + weave * 2.1);
    bumpImage.data[index] = bumpValue;
    bumpImage.data[index + 1] = bumpValue;
    bumpImage.data[index + 2] = bumpValue;
    bumpImage.data[index + 3] = 255;
  }
  colorContext.putImageData(image, 0, 0);
  bumpContext.putImageData(bumpImage, 0, 0);

  colorContext.globalAlpha = 0.14;
  colorContext.strokeStyle = "#d9f2df";
  colorContext.lineWidth = 0.5;
  for (let index = 0; index < 160; index += 1) {
    const x = stableFeltNoise(index, 3) * size;
    const y = stableFeltNoise(index, 7) * size;
    const length = 22 + stableFeltNoise(index, 11) * 58;
    colorContext.beginPath();
    colorContext.moveTo(x, y);
    colorContext.lineTo(x + length, y + (stableFeltNoise(index, 17) - 0.5) * 6);
    colorContext.stroke();
  }

  const colorTexture = configureRepeatingTexture(
    new THREE.CanvasTexture(colorCanvas),
    4,
  );
  colorTexture.colorSpace = THREE.SRGBColorSpace;
  const bumpTexture = configureRepeatingTexture(
    new THREE.CanvasTexture(bumpCanvas),
    4,
  );
  return { color: colorTexture, bump: bumpTexture };
}

function configureRepeatingTexture(
  texture: THREE.CanvasTexture,
  repeat: number,
): THREE.CanvasTexture {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

function stableFeltNoise(left: number, right: number): number {
  const value = Math.sin(left * 12.9898 + right * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function clampColor(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function CenterTableMark() {
  const [texture, setTexture] = useState<THREE.Texture>();

  useEffect(() => {
    let isMounted = true;
    const loader = new THREE.TextureLoader();
    loader.load(`${import.meta.env.BASE_URL ?? "/"}marks/huang.svg`, (mark) => {
      if (!isMounted) {
        mark.dispose();
        return;
      }
      mark.colorSpace = THREE.SRGBColorSpace;
      mark.anisotropy = 4;
      mark.needsUpdate = true;
      setTexture(mark);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => () => texture?.dispose(), [texture]);

  if (!texture) {
    return null;
  }

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, -0.12]}>
      <planeGeometry args={[3.44, 3.44]} />
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
    <directionalLight ref={lightRef} intensity={intensity} color="#eef6ff" />
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
          color="#fff6e8"
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

function TableFlipDebugPanel({
  settings,
  onChange,
}: {
  settings: TableFlipDebugSettings;
  onChange: (settings: TableFlipDebugSettings) => void;
}) {
  return (
    <aside
      className="three-debug-panel table-flip-debug-panel"
      aria-label="Table flip debug settings"
    >
      <header>
        <span>Table flip</span>
        <button
          type="button"
          onClick={() => onChange(defaultTableFlipDebugSettings)}
        >
          Defaults
        </button>
      </header>
      <DebugSlider
        label="Prep delay ms"
        value={settings.prepDelayMs}
        min={0}
        max={1200}
        step={25}
        onChange={(prepDelayMs) => onChange({ ...settings, prepDelayMs })}
      />
      <DebugSlider
        label="Flip seconds"
        value={settings.flipDurationSeconds}
        min={0.35}
        max={2.6}
        step={0.05}
        onChange={(flipDurationSeconds) =>
          onChange({ ...settings, flipDurationSeconds })
        }
      />
      <DebugSlider
        label="Flip range"
        value={settings.flipRange}
        min={0.35}
        max={2.4}
        step={0.05}
        onChange={(flipRange) => onChange({ ...settings, flipRange })}
      />
      <DebugSlider
        label="Variability"
        value={settings.variability}
        min={0}
        max={1.8}
        step={0.05}
        onChange={(variability) => onChange({ ...settings, variability })}
      />
      <DebugSlider
        label="Table lift"
        value={settings.tableLift}
        min={0}
        max={0.8}
        step={0.02}
        onChange={(tableLift) => onChange({ ...settings, tableLift })}
      />
      <DebugSlider
        label="Table slide"
        value={settings.tableSlide}
        min={0}
        max={0.9}
        step={0.02}
        onChange={(tableSlide) => onChange({ ...settings, tableSlide })}
      />
      <DebugSlider
        label="Tile impulse"
        value={settings.tileImpulse}
        min={0}
        max={1.8}
        step={0.05}
        onChange={(tileImpulse) => onChange({ ...settings, tileImpulse })}
      />
      <DebugSlider
        label="Tile lift"
        value={settings.tileLift}
        min={0}
        max={1.8}
        step={0.05}
        onChange={(tileLift) => onChange({ ...settings, tileLift })}
      />
      <DebugSlider
        label="Tile spin"
        value={settings.tileSpin}
        min={0}
        max={1.8}
        step={0.05}
        onChange={(tileSpin) => onChange({ ...settings, tileSpin })}
      />
      <DebugSlider
        label="Tile damping"
        value={settings.tileDamping}
        min={0}
        max={2.5}
        step={0.05}
        onChange={(tileDamping) => onChange({ ...settings, tileDamping })}
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

function winningPickupControlPoint(from: Vec3, to: Vec3): Vec3 {
  return [
    (from[0] + to[0]) / 2,
    Math.max(from[1], to[1]) + 0.55,
    (from[2] + to[2]) / 2,
  ];
}

function FlipTable({
  active,
  settings,
  debugSettings,
  tableFriction,
}: {
  active: boolean;
  settings: TableFlipSettings;
  debugSettings: TableFlipDebugSettings;
  tableFriction: number;
}) {
  const bodyRef = useRef<RapierRigidBody>(null);
  const elapsedRef = useRef(0);

  useFrame((_, delta) => {
    if (!bodyRef.current) {
      return;
    }
    if (!active) {
      bodyRef.current.setNextKinematicTranslation({
        x: 0,
        y: -tableSlabDepth / 2,
        z: 0,
      });
      bodyRef.current.setNextKinematicRotation(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0)),
      );
      return;
    }

    elapsedRef.current = Math.min(
      elapsedRef.current + delta,
      debugSettings.flipDurationSeconds + 0.2,
    );
    const progress = easeInOutCubic(
      Math.min(elapsedRef.current / debugSettings.flipDurationSeconds, 1),
    );
    const lift =
      Math.sin(progress * Math.PI) * 0.18 + progress * debugSettings.tableLift;
    const slide = settings.flipDirection * progress * debugSettings.tableSlide;
    const pitch = -settings.flipDirection * progress * debugSettings.flipRange;
    const roll =
      settings.flipDirection * progress * debugSettings.flipRange * 0.24;
    const yaw = settings.yaw * progress;
    bodyRef.current.setNextKinematicTranslation({
      x: slide,
      y: -tableSlabDepth / 2 + lift,
      z: -progress * 0.22,
    });
    bodyRef.current.setNextKinematicRotation(
      new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll)),
    );
  });

  return (
    <RigidBody
      ref={bodyRef}
      type="kinematicPosition"
      colliders={false}
      position={[0, -tableSlabDepth / 2, 0]}
      rotation={[0, 0, 0]}
      friction={tableFriction}
      restitution={0.02}
    >
      <CuboidCollider
        args={[tableHalfSize, tableSlabDepth / 2, tableHalfSize]}
        friction={tableFriction}
        restitution={0.02}
      />
      <group position={[0, tableSlabDepth / 2, 0]}>
        <TableSurface />
      </group>
    </RigidBody>
  );
}

function TableFlipPhysicsTile({
  tilePhysics,
  settings,
  onContactSound,
  visible,
}: {
  tilePhysics: TableFlipTilePhysics;
  settings: TableFlipDebugSettings;
  onContactSound: (payload: ContactForcePayload) => void;
  visible: boolean;
}) {
  const bodyRef = useRef<RapierRigidBody>(null);
  const didApplyImpulseRef = useRef(false);

  useFrame(() => {
    if (!bodyRef.current || didApplyImpulseRef.current) {
      return;
    }
    didApplyImpulseRef.current = true;
    bodyRef.current.setLinvel(
      {
        x: tilePhysics.linearVelocity[0] * settings.tileImpulse,
        y: tilePhysics.linearVelocity[1] * settings.tileLift,
        z: tilePhysics.linearVelocity[2] * settings.tileImpulse,
      },
      true,
    );
    bodyRef.current.setAngvel(
      {
        x: tilePhysics.angularVelocity[0] * settings.tileSpin,
        y: tilePhysics.angularVelocity[1] * settings.tileSpin,
        z: tilePhysics.angularVelocity[2] * settings.tileSpin,
      },
      true,
    );
  });

  return (
    <RigidBody
      ref={bodyRef}
      type="dynamic"
      userData={{ kind: "discardTile", tileId: tilePhysics.placement.tile.id }}
      colliders={false}
      position={[
        tilePhysics.placement.position[0],
        tilePhysics.placement.position[1],
        tilePhysics.placement.position[2],
      ]}
      rotation={[
        tilePhysics.placement.rotation[0],
        tilePhysics.placement.rotation[1],
        tilePhysics.placement.rotation[2],
      ]}
      restitution={0.02}
      friction={1.2}
      linearDamping={settings.tileDamping}
      angularDamping={settings.tileDamping}
      ccd
      softCcdPrediction={0.12}
      additionalSolverIterations={8}
      canSleep
      onContactForce={onContactSound}
    >
      <CuboidCollider
        args={[tileSize.width / 2, tileSize.height / 2, tileSize.depth / 2]}
      />
      <group visible={visible}>
        <TileBlock
          tile={tilePhysics.placement.tile}
          faceUp={tilePhysics.placement.faceUp}
        />
      </group>
    </RigidBody>
  );
}

function DiscardPhysicsTile({
  placement,
  flick,
  handoffKey,
  settings,
  onContactSound,
  onFlickStarted,
  onPoseChange,
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
  handoffKey?: string;
  settings: FlickDebugSettings;
  onContactSound: (payload: ContactForcePayload) => void;
  onFlickStarted: (handoffKey: string) => void;
  onPoseChange: (tileId: string, pose: TilePose) => void;
  visible: boolean;
}) {
  const [isActive, setIsActive] = useState(!flick);
  const [bodyType, setBodyType] = useState<RigidBodyProps["type"]>(
    flick ? "dynamic" : "kinematicPosition",
  );
  const didApplyFlickRef = useRef(false);
  const pendingFlickRef = useRef(flick);
  const pendingHandoffKeyRef = useRef(handoffKey);
  const latestPlacementRef = useRef(placement);
  const initialPlacementRef = useRef(placement);
  const bodyRef = useRef<RapierRigidBody>(null);
  const meshGroupRef = useRef<THREE.Group>(null);
  latestPlacementRef.current = placement;

  useEffect(() => {
    if (flick) {
      pendingFlickRef.current = flick;
      pendingHandoffKeyRef.current = handoffKey;
      initialPlacementRef.current = latestPlacementRef.current;
      setBodyType("dynamic");
      setIsActive(false);
      if (meshGroupRef.current) {
        meshGroupRef.current.visible = false;
      }
      didApplyFlickRef.current = false;
      const timeout = window.setTimeout(() => {
        setIsActive(true);
      }, flick.delayMs);
      return () => window.clearTimeout(timeout);
    }

    if (pendingFlickRef.current && !didApplyFlickRef.current) {
      setIsActive(true);
      return;
    }

    pendingFlickRef.current = undefined;
    pendingHandoffKeyRef.current = undefined;
    if (!didApplyFlickRef.current) {
      initialPlacementRef.current = latestPlacementRef.current;
    }
    setBodyType("kinematicPosition");
    setIsActive(true);
    if (meshGroupRef.current) {
      meshGroupRef.current.visible = true;
    }
    const timeout = window.setTimeout(
      () => setBodyType("dynamic"),
      loadedDiscardSettlingMs,
    );
    return () => window.clearTimeout(timeout);
  }, [flick, handoffKey]);

  useFrame(() => {
    if (bodyRef.current && isActive) {
      const position = bodyRef.current.translation();
      const rotation = bodyRef.current.rotation();
      const euler = new THREE.Euler().setFromQuaternion(
        new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
      );
      onPoseChange(placement.tile.id, {
        position: [position.x, position.y, position.z],
        rotation: [euler.x, euler.y, euler.z],
      });
    }

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
    if (meshGroupRef.current) {
      meshGroupRef.current.visible = true;
    }
    if (pendingHandoffKeyRef.current) {
      onFlickStarted(pendingHandoffKeyRef.current);
      pendingHandoffKeyRef.current = undefined;
    }
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
      <group ref={meshGroupRef} visible={visible && !flick}>
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
  handoffKey,
  registerHandoff,
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
  motion?:
    | "arc"
    | "drawConcealed"
    | "discardToss"
    | "claimToss"
    | "knockdown"
    | "flipReveal";
  handoffKey?: string;
  registerHandoff?: (
    handoffKey: string,
    hideAnimatedTile: (() => void) | undefined,
  ) => void;
}) {
  const ref = useRef<THREE.Group>(null);
  const elapsedRef = useRef(0);
  const [isDrawFaceHidden, setIsDrawFaceHidden] = useState(
    motion === "drawConcealed",
  );
  const [isFlipFaceUp, setIsFlipFaceUp] = useState(motion !== "flipReveal");

  useLayoutEffect(() => {
    if (!handoffKey || !registerHandoff) {
      return;
    }
    const hideAnimatedTile = () => {
      if (ref.current) {
        ref.current.visible = false;
      }
    };
    registerHandoff(handoffKey, hideAnimatedTile);
    return () => registerHandoff(handoffKey, undefined);
  }, [handoffKey, registerHandoff]);

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
    const firstDuration =
      motion === "discardToss"
        ? 0.46
        : motion === "claimToss"
          ? 0.58
          : via
            ? 0.42
            : motion === "drawConcealed"
              ? 0.46
              : motion === "knockdown"
                ? 0.72
                : 0.64;
    const secondDuration =
      motion === "discardToss" || motion === "claimToss"
        ? 0
        : via
          ? 0.5
          : motion === "drawConcealed"
            ? 0.38
            : 0;
    const thirdDuration = 0;
    const drawBlendDuration = motion === "drawConcealed" ? 0.14 : 0;
    const totalDuration =
      firstDuration + holdSeconds + secondDuration - drawBlendDuration;
    const fullDuration = totalDuration + thirdDuration;
    elapsedRef.current = Math.min(elapsedRef.current + delta, fullDuration);
    const elapsed = elapsedRef.current;
    if (
      motion === "drawConcealed" &&
      isDrawFaceHidden &&
      elapsed >= firstDuration - drawBlendDuration
    ) {
      setIsDrawFaceHidden(false);
    }
    if (motion === "flipReveal" && !isFlipFaceUp && elapsed >= 0.32) {
      setIsFlipFaceUp(true);
    }
    if (motion === "drawConcealed") {
      const staging = drawStaging?.position ?? to;
      const settleStart = firstDuration - drawBlendDuration;
      if (elapsed <= settleStart) {
        const t = easeOutCubic(elapsed / firstDuration);
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

      if (elapsed <= settleStart + secondDuration) {
        const t = clamp01((elapsed - settleStart) / secondDuration);
        const rotationProgress = clamp01(t / 0.7);
        const startRotation = drawFaceDownWallRotation(fromRotation);
        const finalRotation = eulerToQuaternion(toRotation);
        const rotation = slerpQuaternions(
          startRotation,
          finalRotation,
          rotationProgress,
        );
        if (elapsed < firstDuration) {
          const approachT = easeOutCubic(elapsed / firstDuration);
          const approachArc = Math.sin(approachT * Math.PI) * 0.24;
          const approachPosition = drawPosition(
            from,
            staging,
            approachT,
            approachArc,
          );
          const settlePosition = drawPosition(staging, to, t, 0);
          const blend = smoothstep(
            clamp01((elapsed - settleStart) / drawBlendDuration),
          );
          const position = lerpVec3(approachPosition, settlePosition, blend);
          applyDrawTransform(
            ref.current,
            position,
            position,
            rotation,
            rotation,
            1,
            0,
          );
          return;
        }
        applyDrawTransform(ref.current, staging, to, rotation, rotation, t, 0);
        return;
      }

      applyDrawTransform(
        ref.current,
        to,
        to,
        eulerToQuaternion(toRotation),
        eulerToQuaternion(toRotation),
        1,
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

    if ((motion === "discardToss" || motion === "claimToss") && via) {
      const duration = motion === "discardToss" ? 0.46 : 0.58;
      const progress = clamp01(elapsed / duration);
      const t =
        motion === "discardToss"
          ? easeOutCubic(progress)
          : easeInOutCubic(progress);
      applyBezierAnimatedTransform(
        ref.current,
        from,
        via.position,
        to,
        fromRotation,
        toRotation,
        t,
      );
      return;
    }

    if (!via) {
      const progress = clamp01(elapsed / firstDuration);
      const t =
        motion === "knockdown"
          ? easeInOutCubic(progress)
          : easeOutCubic(progress);
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
      const progress = elapsed / firstDuration;
      const t = easeOutCubic(progress);
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

    const progress = (elapsed - firstDuration - holdSeconds) / secondDuration;
    const t = easeInOutCubic(progress);
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

function drawPosition(
  from: Vec3,
  to: Vec3,
  progress: number,
  arc: number,
): Vec3 {
  return [
    THREE.MathUtils.lerp(from[0], to[0], progress),
    THREE.MathUtils.lerp(from[1], to[1], progress) + arc,
    THREE.MathUtils.lerp(from[2], to[2], progress),
  ];
}

function lerpVec3(from: Vec3, to: Vec3, progress: number): Vec3 {
  return [
    THREE.MathUtils.lerp(from[0], to[0], progress),
    THREE.MathUtils.lerp(from[1], to[1], progress),
    THREE.MathUtils.lerp(from[2], to[2], progress),
  ];
}

function applyBezierAnimatedTransform(
  group: THREE.Group | null,
  from: Vec3,
  control: Vec3,
  to: Vec3,
  fromRotation: Vec3,
  toRotation: Vec3,
  progress: number,
) {
  if (!group) {
    return;
  }
  const position = bezierPoint(from, control, to, progress);
  group.position.set(position[0], position[1], position[2]);
  group.quaternion
    .copy(eulerToQuaternion(fromRotation))
    .slerp(eulerToQuaternion(toRotation), progress);
}

function bezierPoint(
  from: Vec3,
  control: Vec3,
  to: Vec3,
  progress: number,
): Vec3 {
  const inverse = 1 - progress;
  return [
    inverse * inverse * from[0] +
      2 * inverse * progress * control[0] +
      progress * progress * to[0],
    inverse * inverse * from[1] +
      2 * inverse * progress * control[1] +
      progress * progress * to[1],
    inverse * inverse * from[2] +
      2 * inverse * progress * control[2] +
      progress * progress * to[2],
  ];
}

function applyAnimatedTransform(
  group: THREE.Group | null,
  from: Vec3,
  to: Vec3,
  fromRotation: Vec3,
  toRotation: Vec3,
  progress: number,
  arc: number,
  motion:
    | "arc"
    | "drawConcealed"
    | "discardToss"
    | "claimToss"
    | "knockdown"
    | "flipReveal" = "arc",
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
        color="#efe2c5"
        roughness={orientation === "faceUp" ? 0.5 : 0.46}
        metalness={0.01}
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
            vec3 tileIvory = vec3(0.93, 0.875, 0.74);
            vec3 tileGreen = vec3(0.0, 0.28, 0.075);
            float backMask = step(${backThreshold.toFixed(5)}, ${backDirection.toFixed(1)} * vTileLocalPosition.y);
            vec3 tileColor = mix(tileIvory, tileGreen, backMask);
            tileColor = mix(tileColor, vec3(0.965, 0.925, 0.82), 0.16 * (1.0 - backMask));
            vec4 diffuseColor = vec4(tileColor, opacity);
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

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}
