/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import { randomUUID } from 'node:crypto';
import { FeatureStatus, type ChunkProcessor, type ProcessingState, type ProgressInfo, type ReaderOptions, type ShapefileChunk } from '../types';
import { countVertices } from '../utils/geometry';
import { ChunkBuilder } from './chunkBuilder';
import { type IShapefileSource, openShapefile } from './gdalShapefileReader';
import { type IMetricsManager, MetricsManager } from './metricsManager';
import { type IProgressTracker, ProgressTracker } from './progressTracker';

export class ShapefileChunkReader {
  private metricsManager?: IMetricsManager;
  private progressTracker?: IProgressTracker;
  private lastState: ProcessingState | null = null;

  public constructor(private readonly options: ReaderOptions) {}

  /**
   * Reads a shapefile and processes it in chunks.
   * @param shapefilePath Path to the shapefile to read
   * @param processor Processor to handle each chunk of features
   */
  public async readAndProcess(shapefilePath: string, processor: ChunkProcessor): Promise<void> {
    const chunkIndex = await this.initializeReading(shapefilePath);
    let readFeatureIndex = -1;

    const chunkBuilder = new ChunkBuilder(this.options.maxVerticesPerChunk, chunkIndex);
    let reader: IShapefileSource | undefined;
    try {
      reader = await openShapefile(shapefilePath);
      this.options.logger?.info({ msg: 'Reading started' });

      const generateFeatureId = this.options.generateFeatureId ?? false;

      let readStart = performance.now();

      while (true) {
        const { done, value: shapeFeature } = await reader.read();

        if (done) {
          break;
        }

        readFeatureIndex++;

        if (this.shouldSkipFeature(readFeatureIndex)) {
          continue;
        }

        const feature = {
          ...shapeFeature,
          properties: {
            ...shapeFeature.properties,
            ...(generateFeatureId && { id: randomUUID() }),
          },
        };

        if (feature.properties.id !== undefined) {
          this.options.logger?.debug({ msg: `Feature ID: ${feature.properties.id}` });
        }

        const canAddFeature = chunkBuilder.canAddFeature(feature);
        if (canAddFeature === FeatureStatus.SKIPPED) {
          this.options.logger?.warn({
            msg: `Feature skipped due to exceeding max vertices`,
            featureId: feature.properties.id,
          });
          continue;
        }

        if (canAddFeature === FeatureStatus.FULL) {
          const readTime = performance.now() - readStart;
          const chunk = chunkBuilder.build();
          this.options.logger?.info({ msg: 'Chunk reading finished', readTime, chunkIndex: chunk.id, featuresCount: chunk.features.length });

          if (this.hasContentToProcess(chunk)) {
            await this.processChunk(chunk, processor, shapefilePath, readTime);
          }
          chunkBuilder.nextChunk();
          readStart = performance.now();
        }

        chunkBuilder.addFeature(feature);
      }

      // Process any remaining features
      const readTime = performance.now() - readStart;
      const finalChunk = chunkBuilder.build();

      if (this.hasContentToProcess(finalChunk)) {
        this.options.logger?.info({
          msg: 'Final chunk reading finished',
        });
        await this.processChunk(finalChunk, processor, shapefilePath, readTime);
      }

      this.metricsManager?.sendFileMetrics();
    } catch (err) {
      const lastFeatureIndex = (this.progressTracker?.getProcessedFeatures() ?? 0) - 1;
      this.options.logger?.error({ msg: 'Error processing shapefile', shapefilePath, lastFeatureIndex, err });

      await this.saveProcessingState({
        filePath: shapefilePath,
        chunkIndex: chunkBuilder.chunkId,
        lastFeatureIndex,
      });
      throw err;
    } finally {
      reader?.close();
    }
  }

  /**
   * Count total features and vertices in the shapefile for progress calculation
   * @param shapefilePath Path to the shapefile
   * @returns Total number of features and vertices in the shapefile
   */
  public async getShapefileStats(shapefilePath: string): Promise<Pick<ProgressInfo, 'totalVertices' | 'totalFeatures'>> {
    let reader: IShapefileSource | undefined;
    let totalVertices = 0;
    let totalFeatures = 0;

    try {
      reader = await openShapefile(shapefilePath);

      while (true) {
        const { done, value: feature } = await reader.read();

        if (done) {
          break;
        }

        const vertices = countVertices(feature.geometry);

        if (vertices > this.options.maxVerticesPerChunk) {
          this.options.logger?.warn({
            msg: `Feature exceeds maximum vertices limit: ${vertices} > ${this.options.maxVerticesPerChunk}`,
            featureId: feature.id,
          });
        }
        totalFeatures++;
        totalVertices += vertices;
      }
    } catch (err) {
      this.options.logger?.error({ msg: 'Error counting vertices in shapefile', shapefilePath, err });
      throw err;
    } finally {
      reader?.close();
    }

    if (totalFeatures === 0 || totalVertices === 0) {
      const message = `Shapefile ${shapefilePath} has no valid features or vertices`;
      this.options.logger?.error({ msg: message });
      throw new Error(message);
    }

    return { totalVertices, totalFeatures };
  }

  private async processChunk(chunk: ShapefileChunk, processor: ChunkProcessor, filePath: string, readTime = 0): Promise<void> {
    const processStart = performance.now();

    try {
      this.options.logger?.info({ msg: 'Processing chunk', chunkIndex: chunk.id, featuresCount: chunk.features.length, filePath, readTime });
      await processor.process(chunk);
      this.options.logger?.info({ msg: 'Chunk processing finished', chunkIndex: chunk.id });
    } catch (err) {
      this.options.logger?.error({ msg: `Error processing chunk ${chunk.id}`, err });
      throw err;
    }

    const processTime = performance.now() - processStart;

    this.metricsManager?.sendChunkMetrics(chunk, readTime, processTime);

    const chunkTotalFeatures = chunk.features.length + chunk.skippedFeatures.length;
    const chunkTotalVertices = chunk.verticesCount + chunk.skippedVerticesCount;
    this.progressTracker?.addProcessedFeatures(chunkTotalFeatures, chunkTotalVertices);
    this.progressTracker?.addSkippedFeatures(chunk.skippedFeatures.length);
    this.progressTracker?.incrementChunks();
    const lastFeatureIndex = (this.progressTracker?.getProcessedFeatures() ?? 0) - 1;

    // Save state after successful processing with progress information
    await this.saveProcessingState({
      filePath,
      chunkIndex: chunk.id,
      lastFeatureIndex,
    });
  }

  /**
   * Save processing state if state manager is available
   * @param state State object containing the required state information
   */
  private async saveProcessingState(state: { filePath: string; chunkIndex: number; lastFeatureIndex: number }): Promise<void> {
    if (!this.options.stateManager) {
      return;
    }

    const currentState: ProcessingState = {
      filePath: state.filePath,
      lastProcessedChunkIndex: state.chunkIndex,
      lastProcessedFeatureIndex: state.lastFeatureIndex,
      timestamp: new Date(),
      progress: this.progressTracker?.calculateProgress(),
    };
    await this.options.stateManager.saveState(currentState);
  }

  private async initializeReading(shapefilePath: string): Promise<number> {
    try {
      if (this.options.metricsCollector) {
        this.metricsManager = new MetricsManager(this.options.metricsCollector);
      }
      this.lastState = (await this.options.stateManager?.loadState()) ?? null;
      const { totalFeatures, totalVertices } = this.lastState?.progress ?? (await this.getShapefileStats(shapefilePath));
      this.progressTracker = new ProgressTracker({
        totalVertices,
        totalFeatures,
        maxVerticesPerChunk: this.options.maxVerticesPerChunk,
        initialProgress: this.lastState?.progress,
      });

      const chunkIndex = this.lastState?.lastProcessedChunkIndex ?? 0;

      return chunkIndex;
    } catch (err) {
      this.options.logger?.error({ msg: 'Failed to initialize reading', err });
      throw err;
    }
  }

  private shouldSkipFeature(featureIndex: number): boolean {
    return this.lastState !== null && featureIndex <= this.lastState.lastProcessedFeatureIndex;
  }

  private hasContentToProcess(chunk: ShapefileChunk): boolean {
    return chunk.features.length > 0 || chunk.skippedFeatures.length > 0;
  }
}
