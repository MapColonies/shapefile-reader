import type { ChunkMetrics, FileMetrics, MetricsCollector, ShapefileChunk } from '../types';

export interface IMetricsManager {
  /**
   * Updates metrics with chunk processing information
   * @param chunk The chunk that was processed
   * @param readTime Time spent reading the chunk in milliseconds
   * @param processTime Time spent processing the chunk in milliseconds
   */
  sendChunkMetrics: (chunk: ShapefileChunk, readTime: number, processTime: number) => void;

  /**
   * Finalizes metrics collection and notifies collectors
   * @returns The finalized file metrics
   */
  sendFileMetrics: () => FileMetrics;
}

export class MetricsManager implements IMetricsManager {
  private readonly fileMetrics: FileMetrics;

  public constructor(private readonly metricsCollector?: MetricsCollector) {
    this.fileMetrics = this.initializeFileMetrics();
  }

  public sendChunkMetrics(chunk: ShapefileChunk, readTime: number, processTime: number): void {
    const totalTime = readTime + processTime;

    // Update file metrics
    this.fileMetrics.totalFeatures += chunk.features.length;
    this.fileMetrics.totalSkippedFeatures += chunk.skippedFeatures.length;
    this.fileMetrics.totalVertices += chunk.verticesCount;
    this.fileMetrics.totalChunks++;
    this.fileMetrics.totalReadTimeMs += readTime;
    this.fileMetrics.totalProcessTimeMs += processTime;
    this.fileMetrics.totalTimeMs += totalTime;

    // Create chunk metrics
    const chunkMetrics: ChunkMetrics = {
      chunkIndex: chunk.id,
      featuresCount: chunk.features.length,
      skippedFeaturesCount: chunk.skippedFeatures.length,
      verticesCount: chunk.verticesCount,
      readTimeMs: readTime,
      processTimeMs: processTime,
      totalTimeMs: totalTime,
      timestamp: new Date(),
    };

    // Notify metrics collector
    this.metricsCollector?.onChunkMetrics?.(chunkMetrics);
  }

  public sendFileMetrics(): FileMetrics {
    this.fileMetrics.endTime = new Date();

    this.metricsCollector?.onFileMetrics?.(this.fileMetrics);
    return this.fileMetrics;
  }

  private initializeFileMetrics(): FileMetrics {
    return {
      totalFeatures: 0,
      totalSkippedFeatures: 0,
      totalVertices: 0,
      totalChunks: 0,
      totalReadTimeMs: 0,
      totalProcessTimeMs: 0,
      totalTimeMs: 0,
      startTime: new Date(),
    };
  }
}
