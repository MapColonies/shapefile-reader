import type { InitialProgress, ProgressInfo } from '../types';

/**
 * Interface for progress tracking functionality
 */
export interface IProgressTracker {
  /**
   * Increments the features counter vertices processed
   * @param featuresCount Number of features processed in the current operation
   * @param processedVertices Number of vertices processed in the current operation
   */
  addProcessedFeatures: (featuresCount: number, processedVertices: number) => void;

  /**
   * Increments the skipped features counter
   * @param count Number of skipped features
   */
  addSkippedFeatures: (count: number) => void;

  /**
   * Increments the chunks counter
   */
  incrementChunks: () => void;

  /**
   * Gets the number of processed features
   * @returns Number of processed features
   */
  getProcessedFeatures: () => number;

  /**
   * Calculates and returns current progress information
   * @returns Current progress information
   */
  calculateProgress: () => ProgressInfo;
}

/**
 * Configuration options for ProgressTracker constructor
 */
export interface ProgressTrackerOptions {
  totalVertices: number;
  totalFeatures: number;
  maxVerticesPerChunk: number;
  initialProgress?: InitialProgress;
}

/**
 * Implementation of progress tracking for shapefile processing
 */
export class ProgressTracker implements IProgressTracker {
  private readonly startTime: number;
  private readonly totalVertices: number;
  private readonly totalFeatures: number;
  private readonly maxVerticesPerChunk: number;
  private processedVertices: number;
  private processedFeatures: number;
  private skippedFeatures: number;
  private processedChunks: number;

  public constructor(options: ProgressTrackerOptions) {
    this.totalVertices = options.totalVertices;
    this.totalFeatures = options.totalFeatures;
    this.maxVerticesPerChunk = options.maxVerticesPerChunk;

    const initialProgress = options.initialProgress ?? {
      processedChunks: 0,
      processedFeatures: 0,
      processedVertices: 0,
      skippedFeatures: 0,
      startTime: Date.now(),
    };

    this.startTime = initialProgress.startTime;
    this.processedVertices = initialProgress.processedVertices;
    this.processedFeatures = initialProgress.processedFeatures;
    this.processedChunks = initialProgress.processedChunks;
    this.skippedFeatures = initialProgress.skippedFeatures;
  }

  public addProcessedFeatures(featuresCount: number, processedVertices: number): void {
    this.processedVertices += processedVertices;
    this.processedFeatures += featuresCount;
  }

  public addSkippedFeatures(count: number): void {
    this.skippedFeatures += count;
  }

  public getProcessedFeatures(): number {
    return this.processedFeatures;
  }

  public incrementChunks(): void {
    this.processedChunks++;
  }

  public calculateProgress(): ProgressInfo {
    const currentTime = Date.now();
    const elapsedTimeMs = currentTime - this.startTime;

    // Calculate percentage based on vertices processed
    let percentage = 0;
    const maxPercentage = 100;
    if (this.totalVertices > 0) {
      percentage = Math.min((this.processedVertices / this.totalVertices) * maxPercentage, maxPercentage);
    }

    // Calculate processing speeds
    const millisecondsPerSecond = 1000;
    const elapsedSeconds = elapsedTimeMs / millisecondsPerSecond;
    const featuresPerSecond = elapsedSeconds > 0 ? this.processedFeatures / elapsedSeconds : 0;
    const verticesPerSecond = elapsedSeconds > 0 ? this.processedVertices / elapsedSeconds : 0;
    const chunksPerSecond = elapsedSeconds > 0 ? this.processedChunks / elapsedSeconds : 0;

    // Estimate remaining time
    let estimatedRemainingTimeMs = 0;
    if (percentage > 0 && percentage < maxPercentage) {
      const totalEstimatedTimeMs = (elapsedTimeMs / percentage) * maxPercentage;
      estimatedRemainingTimeMs = totalEstimatedTimeMs - elapsedTimeMs;
    }

    const endTime = this.processedFeatures === this.totalFeatures ? currentTime : undefined;

    return {
      processedFeatures: this.processedFeatures,
      totalFeatures: this.totalFeatures,
      processedChunks: this.processedChunks,
      processedVertices: this.processedVertices,
      totalVertices: this.totalVertices,
      skippedFeatures: this.skippedFeatures,
      percentage,
      elapsedTimeMs,
      estimatedRemainingTimeMs,
      featuresPerSecond,
      verticesPerSecond,
      chunksPerSecond,
      startTime: this.startTime,
      endTime,
    };
  }
}
