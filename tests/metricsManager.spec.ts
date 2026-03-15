import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mocked } from 'vitest';
import { MetricsManager } from '../src/core/metricsManager';
import type { MetricsCollector } from '../src/types/index';
import { createTestChunk } from './utils';

describe('MetricsManager', () => {
  let metricsManager: MetricsManager;
  let mockMetricsCollector: Mocked<MetricsCollector>;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Setup metrics collector mock
    mockMetricsCollector = {
      onChunkMetrics: vi.fn(),
      onFileMetrics: vi.fn(),
    };
  });

  describe('constructor', () => {
    it('should initialize with basic configuration', () => {
      metricsManager = new MetricsManager();

      expect(metricsManager).toBeDefined();
    });

    it('should initialize with metrics collector', () => {
      metricsManager = new MetricsManager(mockMetricsCollector);

      expect(metricsManager).toBeDefined();
    });
  });

  describe('sendChunkMetrics', () => {
    beforeEach(() => {
      metricsManager = new MetricsManager(mockMetricsCollector);
    });

    it('should update file metrics with chunk data', () => {
      const chunk = createTestChunk(1, 5, 100);
      const readTime = 10;
      const processTime = 20;

      metricsManager.sendChunkMetrics(chunk, readTime, processTime);

      // Verify metrics collector was called
      expect(mockMetricsCollector.onChunkMetrics).toHaveBeenCalledWith(
        expect.objectContaining({
          chunkIndex: 1,
          featuresCount: 5,
          verticesCount: 100,
          readTimeMs: 10,
          processTimeMs: 20,
          totalTimeMs: 30,
          timestamp: expect.any(Date) as Date,
        })
      );
    });

    it('should accumulate metrics across multiple chunks', () => {
      const chunk1 = createTestChunk(1, 3, 50);
      const chunk2 = createTestChunk(2, 7, 150);

      metricsManager.sendChunkMetrics(chunk1, 5, 10);
      metricsManager.sendChunkMetrics(chunk2, 8, 12);

      const fileMetrics = metricsManager.sendFileMetrics();

      expect(fileMetrics.totalFeatures).toBe(10);
      expect(fileMetrics.totalVertices).toBe(200);
      expect(fileMetrics.totalChunks).toBe(2);
      expect(fileMetrics.totalReadTimeMs).toBe(13);
      expect(fileMetrics.totalProcessTimeMs).toBe(22);
      expect(fileMetrics.totalTimeMs).toBe(35);
    });
  });

  describe('sendFileMetrics', () => {
    beforeEach(() => {
      metricsManager = new MetricsManager(mockMetricsCollector);
    });

    it('should return finalized file metrics', () => {
      const chunk = createTestChunk(1, 5, 100);
      metricsManager.sendChunkMetrics(chunk, 10, 20);

      const fileMetrics = metricsManager.sendFileMetrics();

      expect(fileMetrics).toEqual(
        expect.objectContaining({
          totalFeatures: 5,
          totalVertices: 100,
          totalChunks: 1,
          totalReadTimeMs: 10,
          totalProcessTimeMs: 20,
          totalTimeMs: 30,
          startTime: expect.any(Date) as Date,
          endTime: expect.any(Date) as Date,
        })
      );
    });

    it('should notify metrics collector with file metrics', () => {
      const chunk = createTestChunk(1, 5, 100);
      metricsManager.sendChunkMetrics(chunk, 10, 20);

      metricsManager.sendFileMetrics();

      expect(mockMetricsCollector.onFileMetrics).toHaveBeenCalledWith(
        expect.objectContaining({
          totalFeatures: 5,
          totalVertices: 100,
        })
      );
    });
  });

  describe('without metrics collector', () => {
    beforeEach(() => {
      metricsManager = new MetricsManager();
    });

    it('should handle chunk metrics without collector', () => {
      const chunk = createTestChunk(1, 5, 100);

      expect(() => {
        metricsManager.sendChunkMetrics(chunk, 10, 20);
      }).not.toThrow();
    });

    it('should handle file metrics without collector', () => {
      const chunk = createTestChunk(1, 5, 100);
      metricsManager.sendChunkMetrics(chunk, 10, 20);

      expect(() => {
        metricsManager.sendFileMetrics();
      }).not.toThrow();
    });
  });

  describe('edge cases', () => {
    beforeEach(() => {
      metricsManager = new MetricsManager(mockMetricsCollector);
    });

    it('should handle empty chunks', () => {
      const emptyChunk = createTestChunk(1, 0, 0);

      metricsManager.sendChunkMetrics(emptyChunk, 5, 10);
      const fileMetrics = metricsManager.sendFileMetrics();

      expect(fileMetrics.totalFeatures).toBe(0);
      expect(fileMetrics.totalVertices).toBe(0);
      expect(fileMetrics.totalChunks).toBe(1);
    });

    it('should handle zero processing times', () => {
      const chunk = createTestChunk(1, 5, 100);

      metricsManager.sendChunkMetrics(chunk, 0, 0);
      const fileMetrics = metricsManager.sendFileMetrics();

      expect(fileMetrics.totalReadTimeMs).toBe(0);
      expect(fileMetrics.totalProcessTimeMs).toBe(0);
      expect(fileMetrics.totalTimeMs).toBe(0);
    });

    it('should handle large numbers', () => {
      const largeChunk = createTestChunk(1, 1000000, 50000000);

      metricsManager.sendChunkMetrics(largeChunk, 5000, 10000);
      const fileMetrics = metricsManager.sendFileMetrics();

      expect(fileMetrics.totalFeatures).toBe(1000000);
      expect(fileMetrics.totalVertices).toBe(50000000);
      expect(fileMetrics.totalTimeMs).toBe(15000);
    });
  });
});
