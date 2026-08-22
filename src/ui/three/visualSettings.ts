export type VisualDebugSettings = {
  filmGrade: boolean;
  filmStock: "neutral" | "tungsten" | "faded";
  filmStrength: number;
  colorFinishing: boolean;
  finishingStrength: number;
  softDiffusion: boolean;
  diffusionStrength: number;
  enhancedTileMaterial: boolean;
  ditheredShadows: boolean;
  ditherStrength: number;
  ambientOcclusion: boolean;
  aoIntensity: number;
  aoRadius: number;
  warmHalation: boolean;
  halationStrength: number;
};

export const materialVisualDebugSettings: VisualDebugSettings = {
  filmGrade: false,
  filmStock: "neutral",
  filmStrength: 0.2,
  colorFinishing: false,
  finishingStrength: 0.1,
  softDiffusion: false,
  diffusionStrength: 0.24,
  enhancedTileMaterial: true,
  ditheredShadows: false,
  ditherStrength: 0.2,
  ambientOcclusion: false,
  aoIntensity: 0.78,
  aoRadius: 0.22,
  warmHalation: false,
  halationStrength: 0.18,
};

export const neutralVisualDebugSettings: VisualDebugSettings = {
  ...materialVisualDebugSettings,
  filmGrade: true,
  colorFinishing: true,
  ditheredShadows: true,
};

export const tungstenVisualDebugSettings: VisualDebugSettings = {
  ...materialVisualDebugSettings,
  filmGrade: true,
  filmStock: "tungsten",
  filmStrength: 0.5,
  colorFinishing: true,
  finishingStrength: 0.4,
  ditheredShadows: true,
};

export const fadedVisualDebugSettings: VisualDebugSettings = {
  ...materialVisualDebugSettings,
  filmGrade: true,
  filmStock: "faded",
  filmStrength: 0.55,
  colorFinishing: true,
  finishingStrength: 0.3,
  ditheredShadows: true,
};

export const defaultVisualDebugSettings: VisualDebugSettings = {
  ...neutralVisualDebugSettings,
};
