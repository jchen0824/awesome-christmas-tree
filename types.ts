export interface PhotoData {
  id: string;
  url: string;
  position: [number, number, number];
  rotation: [number, number, number];
}

export interface TreeState {
  dispersion: number; // 0 to 1 (Tree to Galaxy)
  rotationSpeed: number;
}

export enum InteractionMode {
  MOUSE = 'MOUSE',
  GESTURE = 'GESTURE'
}