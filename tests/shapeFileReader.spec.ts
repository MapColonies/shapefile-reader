/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/naming-convention */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mocked, MockedFunction, MockedClass } from 'vitest';
import { jsLogger } from '@map-colonies/js-logger';
import type { Feature } from 'geojson';
import * as gdalShapefileReader from '../src/core/gdalShapefileReader';
import { ShapefileChunkReader } from '../src';
import { ChunkBuilder } from '../src/core/chunkBuilder';
import { MetricsManager } from '../src/core/metricsManager';
import { ProgressTracker } from '../src/core/progressTracker';
import { FeatureStatus, type ChunkProcessor, type ProcessingState, type ReaderOptions, type ShapefileChunk } from '../src/types/index';
import * as vertices from '../src/utils/geometry';

const shapefilePath = '/path/to/shapefile.shp';

const mockRandomUUID = vi.hoisted(() => vi.fn<() => string>());

// Mock all dependencies
vi.mock('node:crypto', async () => {
  const originalModule = await vi.importActual('node:crypto');

  return {
    ...(originalModule as object),
    randomUUID: vi.fn(() => {
      return mockRandomUUID();
    }),
  };
});
vi.mock('../src/core/gdalShapefileReader');
vi.mock('../src/core/chunkBuilder');
vi.mock('../src/core/progressTracker');
vi.mock('../src/core/metricsManager');
vi.mock('../src/utils/geometry');

// Import mocked modules
const mockGdalShapefileReader = vi.mocked(gdalShapefileReader);
const MockChunkBuilder = ChunkBuilder as MockedClass<typeof ChunkBuilder>;
const MockProgressTracker = ProgressTracker as MockedClass<typeof ProgressTracker>;
const MockMetricsManager = MetricsManager as MockedClass<typeof MetricsManager>;

const mockFeature: Feature = {
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [[]] },
  properties: {},
};

describe('ShapefileChunkReader', () => {
  let reader: ShapefileChunkReader;
  let mockOptions: ReaderOptions;
  let mockProcessor: MockedFunction<ChunkProcessor['process']>;
  let mockSource: Mocked<gdalShapefileReader.IShapefileSource>;
  let mockChunkBuilder: Mocked<ChunkBuilder>;
  let mockProgressTracker: Mocked<ProgressTracker>;
  let mockMetricsManager: Mocked<MetricsManager>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock options
    mockOptions = {
      maxVerticesPerChunk: 1000,
      logger: jsLogger({ enabled: false }),
      stateManager: {
        loadState: vi.fn(),
        saveState: vi.fn(),
      },
      metricsCollector: {
        onChunkMetrics: vi.fn(),
        onFileMetrics: vi.fn(),
      },
    };

    // Setup mock processor
    mockProcessor = vi.fn().mockResolvedValue(undefined);

    // Setup mock shapefile source
    mockSource = {
      read: vi.fn(),
      close: vi.fn(),
    } as unknown as Mocked<gdalShapefileReader.IShapefileSource>;

    mockGdalShapefileReader.openShapefile.mockResolvedValue(mockSource);

    // Setup mock chunk builder
    mockChunkBuilder = {
      addFeature: vi.fn(),
      canAddFeature: vi.fn(),
      isEmpty: vi.fn(),
      build: vi.fn(),
      nextChunk: vi.fn(),
    } as unknown as Mocked<ChunkBuilder>;

    MockChunkBuilder.mockImplementation(function () {
      return mockChunkBuilder;
    });

    // Setup mock progress tracker
    mockProgressTracker = {
      addProcessedFeatures: vi.fn(),
      addSkippedFeatures: vi.fn(),
      incrementChunks: vi.fn(),
      calculateProgress: vi.fn(),
      getProcessedFeatures: vi.fn(),
    } as unknown as Mocked<ProgressTracker>;
    MockProgressTracker.mockImplementation(function () {
      return mockProgressTracker;
    });

    // Setup mock metrics manager
    mockMetricsManager = {
      sendChunkMetrics: vi.fn(),
      sendFileMetrics: vi.fn(),
    } as unknown as Mocked<MetricsManager>;
    MockMetricsManager.mockImplementation(function () {
      return mockMetricsManager;
    });

    reader = new ShapefileChunkReader(mockOptions);
  });

  describe('readAndProcess', () => {
    beforeEach(() => {
      vi.spyOn(reader, 'getShapefileStats').mockResolvedValue({
        totalVertices: 5000,
        totalFeatures: 10,
      });
    });

    it('should successfully read and process a shapefile with single chunk', async () => {
      mockSource.read
        .mockResolvedValueOnce({ done: false, value: mockFeature })
        .mockResolvedValueOnce({ done: false, value: mockFeature })
        .mockResolvedValueOnce({ done: true, value: mockFeature });

      mockChunkBuilder.canAddFeature.mockReturnValue(FeatureStatus.ADD);
      mockChunkBuilder.build.mockReturnValue({
        id: 0,
        features: [mockFeature, mockFeature],
        verticesCount: 100,
        skippedFeatures: [],
        skippedVerticesCount: 0,
      });

      await reader.readAndProcess(shapefilePath, { process: mockProcessor });

      expect(mockGdalShapefileReader.openShapefile).toHaveBeenCalledWith(shapefilePath);
      expect(mockChunkBuilder.addFeature).toHaveBeenCalledTimes(2);
      expect(mockProcessor).toHaveBeenCalledTimes(1);
      expect(mockOptions.stateManager?.saveState).toHaveBeenCalled();
    });

    it('should process multiple chunks when features exceed chunk capacity', async () => {
      mockSource.read
        .mockResolvedValueOnce({ done: false, value: mockFeature })
        .mockResolvedValueOnce({ done: false, value: mockFeature })
        .mockResolvedValueOnce({ done: false, value: mockFeature })
        .mockResolvedValueOnce({ done: true, value: mockFeature });

      mockChunkBuilder.canAddFeature
        .mockReturnValueOnce(FeatureStatus.ADD)
        .mockReturnValueOnce(FeatureStatus.FULL)
        .mockReturnValueOnce(FeatureStatus.ADD);

      const chunk1: ShapefileChunk = { id: 0, features: [mockFeature], skippedFeatures: [], verticesCount: 50, skippedVerticesCount: 0 };
      const chunk2: ShapefileChunk = {
        id: 1,
        features: [mockFeature, mockFeature],
        skippedFeatures: [],
        verticesCount: 100,
        skippedVerticesCount: 0,
      };
      mockChunkBuilder.build.mockReturnValueOnce(chunk1).mockReturnValueOnce(chunk2);

      await reader.readAndProcess(shapefilePath, { process: mockProcessor });

      expect(mockProcessor).toHaveBeenCalledTimes(2);
      expect(mockProcessor).toHaveBeenCalledWith(chunk1);
      expect(mockProcessor).toHaveBeenCalledWith(chunk2);
      expect(mockChunkBuilder.nextChunk).toHaveBeenCalledTimes(1);
    });

    it('should resume from last processed state', async () => {
      const lastState: ProcessingState = {
        filePath: shapefilePath,
        lastProcessedChunkIndex: 2,
        lastProcessedFeatureIndex: 3,
        timestamp: new Date(),
      };

      mockOptions.stateManager!.loadState = vi.fn().mockResolvedValue(lastState);

      // Features 0-3 should be skipped
      mockSource.read
        .mockResolvedValueOnce({ done: false, value: mockFeature }) // index 0 - skip
        .mockResolvedValueOnce({ done: false, value: mockFeature }) // index 1 - skip
        .mockResolvedValueOnce({ done: false, value: mockFeature }) // index 2 - skip
        .mockResolvedValueOnce({ done: false, value: mockFeature }) // index 3 - skip
        .mockResolvedValueOnce({ done: false, value: mockFeature }) // index 4 - process
        .mockResolvedValueOnce({ done: true, value: mockFeature });

      mockChunkBuilder.canAddFeature.mockReturnValue(FeatureStatus.ADD);
      mockChunkBuilder.build.mockReturnValue({
        id: 3,
        features: [mockFeature],
        verticesCount: 50,
        skippedFeatures: [],
        skippedVerticesCount: 0,
      });

      await reader.readAndProcess(shapefilePath, { process: mockProcessor });

      expect(mockChunkBuilder.addFeature).toHaveBeenCalledTimes(1); // Only feature at index 4
      expect(MockChunkBuilder).toHaveBeenCalledWith(mockOptions.maxVerticesPerChunk, 2); // Resume from chunk 2
    });

    it('should handle feature with exceeding vertex count', async () => {
      const largeFeature: Feature = {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-1, -1],
              [-1, 1],
              [1, 1],
              [1, -1],
              [-1, -1],
              [-1, -1],
              [-1, -1],
              [-1, -1],
            ],
          ],
        },
        properties: {},
      };
      const chunk: ShapefileChunk = {
        id: 0,
        features: [],
        verticesCount: 0,
        skippedFeatures: [largeFeature],
        skippedVerticesCount: 8,
      };

      mockSource.read.mockResolvedValueOnce({ done: false, value: largeFeature }).mockResolvedValueOnce({ done: true, value: largeFeature });
      mockChunkBuilder.canAddFeature.mockReturnValue(FeatureStatus.SKIPPED);
      mockChunkBuilder.build.mockReturnValue(chunk);
      await reader.readAndProcess(shapefilePath, { process: mockProcessor });

      expect(mockChunkBuilder.canAddFeature).toHaveBeenCalledWith(largeFeature);
      expect(mockChunkBuilder.build).toHaveBeenCalled();
      expect(mockChunkBuilder.addFeature).not.toHaveBeenCalled();
      expect(mockProcessor).toHaveBeenCalledWith(chunk);
    });

    it('should handle processing errors and save state', async () => {
      mockSource.read.mockResolvedValueOnce({ done: false, value: mockFeature }).mockResolvedValueOnce({ done: false, value: mockFeature });

      mockChunkBuilder.canAddFeature.mockReturnValue(FeatureStatus.FULL);
      mockChunkBuilder.build.mockReturnValue({
        id: 0,
        features: [mockFeature],
        verticesCount: 50,
        skippedFeatures: [],
        skippedVerticesCount: 0,
      });

      Object.defineProperty(mockChunkBuilder, 'chunkId', { value: 0, writable: true });
      mockProcessor.mockRejectedValue(new Error());
      mockProgressTracker.getProcessedFeatures.mockReturnValue(1);

      await expect(reader.readAndProcess(shapefilePath, { process: mockProcessor })).rejects.toThrow();
      expect(mockOptions.stateManager?.saveState).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath: shapefilePath,
          lastProcessedChunkIndex: 0,
          lastProcessedFeatureIndex: 0,
        })
      );
    });

    it('should send metrics for each chunk', async () => {
      mockSource.read.mockResolvedValueOnce({ done: false, value: mockFeature }).mockResolvedValueOnce({ done: true, value: mockFeature });

      mockChunkBuilder.canAddFeature.mockReturnValue(FeatureStatus.ADD);
      const chunk = { id: 0, features: [mockFeature], verticesCount: 50, skippedFeatures: [], skippedVerticesCount: 0 } as ShapefileChunk;
      mockChunkBuilder.build.mockReturnValue(chunk);

      await reader.readAndProcess(shapefilePath, { process: mockProcessor });

      expect(mockMetricsManager.sendChunkMetrics).toHaveBeenCalledWith(chunk, expect.any(Number), expect.any(Number));
      expect(mockMetricsManager.sendFileMetrics).toHaveBeenCalled();
    });

    it('should handle feature with exceeding vertex count, when feature ids are generated', async () => {
      const largeFeature: Feature = {
        type: 'Feature',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        id: expect.stringMatching(/^[A-F\d]{8}-[A-F\d]{4}-4[A-F\d]{3}-[89AB][A-F\d]{3}-[A-F\d]{12}$/i),
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-1, -1],
              [-1, 1],
              [1, 1],
              [1, -1],
              [-1, -1],
              [-1, -1],
              [-1, -1],
              [-1, -1],
            ],
          ],
        },
        properties: {},
      };
      const chunk: ShapefileChunk = {
        id: 0,
        features: [],
        verticesCount: 0,
        skippedFeatures: [largeFeature],
        skippedVerticesCount: 8,
      };
      const finalChunk: ShapefileChunk = {
        id: 1,
        features: [],
        skippedFeatures: [],
        verticesCount: 0,
        skippedVerticesCount: 0,
      };
      mockSource.read.mockResolvedValueOnce({ done: false, value: largeFeature }).mockResolvedValueOnce({ done: true, value: largeFeature });
      mockChunkBuilder.canAddFeature.mockReturnValue(FeatureStatus.SKIPPED);
      mockChunkBuilder.build.mockReturnValueOnce(chunk).mockReturnValueOnce(finalChunk);
      mockOptions.generateFeatureId = true;

      await reader.readAndProcess(shapefilePath, { process: mockProcessor });

      expect(mockRandomUUID).toHaveBeenCalledTimes(1);
      expect(mockChunkBuilder.canAddFeature).toHaveBeenCalledWith(largeFeature);
      expect(mockChunkBuilder.build).toHaveBeenCalled();
      expect(mockChunkBuilder.addFeature).not.toHaveBeenCalled();
      expect(mockProcessor).toHaveBeenCalledWith(chunk);
      expect(mockProcessor).toHaveBeenCalledTimes(1);
    });

    it('should not add skipped feature to chunk when it exceeds max vertices and chunk is full', async () => {
      // This test covers the bug where a skipped feature (exceeding max vertices) could be
      // incorrectly added to the features array after calling nextChunk() because the
      // skippedFeatures array was cleared.
      const normalFeature: Feature = {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[]] },
        properties: { id: 'normal-feature' },
      };
      const largeFeature: Feature = {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-1, -1],
              [-1, 1],
              [1, 1],
              [1, -1],
              [-1, -1],
              [-1, -1],
              [-1, -1],
              [-1, -1],
            ],
          ],
        },
        properties: { id: 'large-feature' },
      };

      // Scenario: First feature fills chunk, second feature exceeds max vertices
      mockSource.read
        .mockResolvedValueOnce({ done: false, value: normalFeature })
        .mockResolvedValueOnce({ done: false, value: largeFeature })
        .mockResolvedValueOnce({ done: true, value: undefined as unknown as Feature });

      // First feature: chunk is full after adding it
      // Second feature: exceeds max vertices, should be SKIPPED
      mockChunkBuilder.canAddFeature.mockReturnValueOnce(FeatureStatus.FULL).mockReturnValueOnce(FeatureStatus.SKIPPED);

      const chunk1: ShapefileChunk = { id: 0, features: [normalFeature], verticesCount: 50, skippedFeatures: [], skippedVerticesCount: 0 };
      const chunk2: ShapefileChunk = { id: 1, features: [], verticesCount: 0, skippedFeatures: [largeFeature], skippedVerticesCount: 8 };
      mockChunkBuilder.build.mockReturnValueOnce(chunk1).mockReturnValueOnce(chunk2);

      await reader.readAndProcess(shapefilePath, { process: mockProcessor });

      // Verify the skipped feature was NOT added via addFeature
      expect(mockChunkBuilder.addFeature).toHaveBeenCalledTimes(1);
      expect(mockChunkBuilder.addFeature).toHaveBeenCalledWith(normalFeature);
      expect(mockChunkBuilder.addFeature).not.toHaveBeenCalledWith(largeFeature);

      // Verify both chunks were processed
      expect(mockProcessor).toHaveBeenCalledTimes(2);
      expect(mockChunkBuilder.nextChunk).toHaveBeenCalledTimes(1);
    });

    it('should close the reader after successful processing', async () => {
      mockSource.read.mockResolvedValueOnce({ done: true, value: undefined as unknown as Feature });
      mockChunkBuilder.canAddFeature.mockReturnValue(FeatureStatus.ADD);
      mockChunkBuilder.build.mockReturnValue({
        id: 0,
        features: [],
        verticesCount: 0,
        skippedFeatures: [],
        skippedVerticesCount: 0,
      });

      await reader.readAndProcess(shapefilePath, { process: mockProcessor });

      expect(mockSource.close).toHaveBeenCalledTimes(1);
    });

    it('should close the reader even when an error occurs', async () => {
      const error = new Error('Processing failed');
      mockSource.read.mockResolvedValueOnce({ done: false, value: mockFeature });
      mockChunkBuilder.canAddFeature.mockReturnValue(FeatureStatus.FULL);
      mockChunkBuilder.build.mockReturnValue({
        id: 0,
        features: [mockFeature],
        verticesCount: 50,
        skippedFeatures: [],
        skippedVerticesCount: 0,
      });
      Object.defineProperty(mockChunkBuilder, 'chunkId', { value: 0, writable: true });
      mockProcessor.mockRejectedValue(error);
      mockProgressTracker.getProcessedFeatures.mockReturnValue(1);

      await expect(reader.readAndProcess(shapefilePath, { process: mockProcessor })).rejects.toThrow(error);

      expect(mockSource.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('getShapefileStats', () => {
    beforeEach(() => {
      vi.spyOn(vertices, 'countVertices').mockReturnValue(100);
    });

    it('should count total vertices and features', async () => {
      mockSource.read
        .mockResolvedValueOnce({ done: false, value: mockFeature })
        .mockResolvedValueOnce({ done: false, value: mockFeature })
        .mockResolvedValueOnce({ done: false, value: mockFeature })
        .mockResolvedValueOnce({ done: true, value: undefined as unknown as Feature });

      const stats = await reader.getShapefileStats(shapefilePath);

      expect(stats).toEqual({
        totalVertices: 300,
        totalFeatures: 3,
      });
    });

    it('should include skip features exceeding vertex limit', async () => {
      vi.spyOn(vertices, 'countVertices').mockReturnValueOnce(100).mockReturnValueOnce(2000).mockReturnValueOnce(100);

      mockSource.read
        .mockResolvedValueOnce({ done: false, value: mockFeature })
        .mockResolvedValueOnce({ done: false, value: { ...mockFeature, id: 'large-feature' } })
        .mockResolvedValueOnce({ done: false, value: mockFeature })
        .mockResolvedValueOnce({ done: true, value: undefined as unknown as Feature });

      const stats = await reader.getShapefileStats(shapefilePath);

      expect(stats).toEqual({
        totalVertices: 2200,
        totalFeatures: 3,
      });
    });

    it('should handle errors during counting', async () => {
      mockSource.read.mockRejectedValue(new Error('Read error'));

      await expect(reader.getShapefileStats(shapefilePath)).rejects.toThrow('Read error');
    });

    it('should close the reader after getting stats', async () => {
      mockSource.read
        .mockResolvedValueOnce({ done: false, value: mockFeature })
        .mockResolvedValueOnce({ done: true, value: undefined as unknown as Feature });

      await reader.getShapefileStats(shapefilePath);

      expect(mockSource.close).toHaveBeenCalledTimes(1);
    });

    it('should close the reader even when an error occurs', async () => {
      mockSource.read.mockRejectedValue(new Error('Read error'));

      await expect(reader.getShapefileStats(shapefilePath)).rejects.toThrow('Read error');

      expect(mockSource.close).toHaveBeenCalledTimes(1);
    });
  });
});
