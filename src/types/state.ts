export interface StateManager {
  saveState: (state: ProcessingState) => Promise<void> | void;
  loadState: () => (ProcessingState | null) | Promise<ProcessingState | null>;
}

export interface ProgressInfo {
  startTime: number;
  endTime?: number;
  processedFeatures: number;
  totalFeatures: number;
  processedChunks: number;
  processedVertices: number;
  totalVertices: number;
  skippedFeatures: number;
  percentage: number;
  elapsedTimeMs: number;
  estimatedRemainingTimeMs: number;
  featuresPerSecond: number;
  verticesPerSecond: number;
  chunksPerSecond: number;
}

export type InitialProgress = Pick<ProgressInfo, 'startTime' | 'processedVertices' | 'processedFeatures' | 'processedChunks' | 'skippedFeatures'>;

export interface ProcessingState {
  filePath: string;
  lastProcessedChunkIndex: number;
  lastProcessedFeatureIndex: number;
  timestamp: Date;
  progress?: ProgressInfo;
}
