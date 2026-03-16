import type { Feature } from 'geojson';
import type { StateManager } from '../types';
import type { MetricsCollector } from './metrics';
import type { Logger } from './logger';

export * from './logger';
export * from './metrics';
export * from './state';

export interface ShapefileChunk {
  id: number;
  features: Feature[];
  verticesCount: number;
  skippedFeatures: Feature[];
  skippedVerticesCount: number;
}

export interface ChunkProcessor {
  process: (chunk: ShapefileChunk) => Promise<void>;
}

export interface ReaderOptions {
  /** Maximum vertices per chunk to control memory usage */
  maxVerticesPerChunk: number;
  /** Determines whether a unique feature identifier should be automatically generated for each feature missing an indentifier */
  generateFeatureId?: boolean;
  /** Logger for debugging and monitoring */
  logger?: Logger;
  /** State manager for resumable processing */
  stateManager?: StateManager;
  /** Metrics collector for performance monitoring */
  metricsCollector?: MetricsCollector;
}

/* eslint-disable @typescript-eslint/naming-convention */
export const FeatureStatus = {
  ADD: 'ADD',
  FULL: 'FULL',
  SKIPPED: 'SKIPPED',
} as const;
/* eslint-enable @typescript-eslint/naming-convention */

export type FeatureStatus = keyof typeof FeatureStatus;
