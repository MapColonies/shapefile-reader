import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mocked } from 'vitest';
import gdal from 'gdal-async';
import type { Feature, Polygon } from 'geojson';
import { GdalShapefileReader, openShapefile } from '../src/core/gdalShapefileReader';

// Mock gdal-async
vi.mock('gdal-async');

const mockGdal = vi.mocked(gdal);

describe('GdalShapefileReader', () => {
  let mockDataset: Mocked<gdal.Dataset>;
  let mockLayer: Mocked<gdal.Layer>;
  let mockLayerFeatures: Mocked<gdal.LayerFeatures>;

  const shapefilePath = '/path/to/shapefile.shp';

  const createMockGdalFeature = (fid: number, properties: Record<string, unknown>, geometry: object | null): Mocked<gdal.Feature> => {
    const mockGeometry = geometry
      ? ({
          toObject: vi.fn().mockReturnValue(geometry),
        } as unknown as Mocked<gdal.Geometry>)
      : null;

    return {
      fid,
      fields: {
        toObject: vi.fn().mockReturnValue(properties),
      },
      getGeometry: vi.fn().mockReturnValue(mockGeometry),
    } as unknown as Mocked<gdal.Feature>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock layer features
    mockLayerFeatures = {
      first: vi.fn(),
      next: vi.fn(),
      count: vi.fn(),
    } as unknown as Mocked<gdal.LayerFeatures>;

    // Setup mock layer
    mockLayer = {
      features: mockLayerFeatures,
    } as unknown as Mocked<gdal.Layer>;

    // Setup mock dataset
    mockDataset = {
      layers: {
        get: vi.fn().mockReturnValue(mockLayer),
      },
      close: vi.fn(),
    } as unknown as Mocked<gdal.Dataset>;

    // Setup gdal.openAsync mock
    mockGdal.openAsync.mockResolvedValue(mockDataset);
  });

  describe('open', () => {
    it('should open a shapefile and return a reader instance', async () => {
      const reader = await GdalShapefileReader.open(shapefilePath);

      expect(mockGdal.openAsync).toHaveBeenCalledWith(shapefilePath);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockDataset.layers.get).toHaveBeenCalledWith(0);
      expect(reader).toBeInstanceOf(GdalShapefileReader);
    });

    it('should propagate errors from gdal.openAsync', async () => {
      const error = new Error('Failed to open shapefile');
      mockGdal.openAsync.mockRejectedValue(error);

      await expect(GdalShapefileReader.open(shapefilePath)).rejects.toThrow('Failed to open shapefile');
    });
  });

  describe('read', () => {
    it('should return the first feature on first read', async () => {
      const mockGeometry: Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
      };
      const mockProperties = { name: 'Test Feature', value: 42 };
      const mockGdalFeature = createMockGdalFeature(0, mockProperties, mockGeometry);

      mockLayerFeatures.first.mockReturnValue(mockGdalFeature);

      const reader = await GdalShapefileReader.open(shapefilePath);
      const result = await reader.read();

      expect(result.done).toBe(false);
      expect(result.value).toEqual<Feature>({
        type: 'Feature',
        id: 0,
        geometry: mockGeometry,
        properties: mockProperties,
      });

      /* eslint-disable @typescript-eslint/unbound-method */
      expect(mockLayerFeatures.first).toHaveBeenCalledTimes(1);
      expect(mockLayerFeatures.next).not.toHaveBeenCalled();
      /* eslint-enable @typescript-eslint/unbound-method */
    });

    it('should return subsequent features on subsequent reads', async () => {
      const mockGeometry: Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      };
      const feature1 = createMockGdalFeature(0, { id: 'feature1' }, mockGeometry);
      const feature2 = createMockGdalFeature(1, { id: 'feature2' }, mockGeometry);

      mockLayerFeatures.first.mockReturnValue(feature1);
      mockLayerFeatures.next.mockReturnValue(feature2);

      const reader = await GdalShapefileReader.open(shapefilePath);

      // First read
      const result1 = await reader.read();

      expect(result1.done).toBe(false);
      expect(result1.value.properties).toEqual({ id: 'feature1' });
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockLayerFeatures.first).toHaveBeenCalledTimes(1);

      // Second read
      const result2 = await reader.read();

      expect(result2.done).toBe(false);
      expect(result2.value.properties).toEqual({ id: 'feature2' });
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockLayerFeatures.next).toHaveBeenCalledTimes(1);
    });

    it('should return done=true when no more features are available', async () => {
      mockLayerFeatures.first.mockReturnValue(null as unknown as gdal.Feature);

      const reader = await GdalShapefileReader.open(shapefilePath);
      const result = await reader.read();

      expect(result.done).toBe(true);
      expect(result.value).toBeUndefined();
    });

    it('should handle empty shapefile with zero features', async () => {
      mockLayerFeatures.first.mockReturnValue(null as unknown as gdal.Feature);
      mockLayerFeatures.next.mockReturnValue(null as unknown as gdal.Feature);
      mockLayerFeatures.count.mockReturnValue(0);

      const reader = await GdalShapefileReader.open(shapefilePath);

      const result = await reader.read();

      expect(result.done).toBe(true);
      expect(result.value).toBeUndefined();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockLayerFeatures.first).toHaveBeenCalledTimes(1);
    });

    it('should return done=true after iterating through all features', async () => {
      const mockGeometry: Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      };
      const feature1 = createMockGdalFeature(0, { id: 'feature1' }, mockGeometry);

      mockLayerFeatures.first.mockReturnValue(feature1);
      mockLayerFeatures.next.mockReturnValue(null as unknown as gdal.Feature);

      const reader = await GdalShapefileReader.open(shapefilePath);

      // First read - returns feature
      const result1 = await reader.read();

      expect(result1.done).toBe(false);

      // Second read - no more features
      const result2 = await reader.read();

      expect(result2.done).toBe(true);
    });

    it('should handle features without geometry', async () => {
      const mockProperties = { name: 'No Geometry Feature' };
      const mockGdalFeature = createMockGdalFeature(0, mockProperties, null);

      mockLayerFeatures.first.mockReturnValue(mockGdalFeature);

      const reader = await GdalShapefileReader.open(shapefilePath);
      const result = await reader.read();

      expect(result.done).toBe(false);
      expect(result.value.geometry).toBeNull();
      expect(result.value.properties).toEqual(mockProperties);
    });

    it('should preserve feature ID (fid)', async () => {
      const mockGeometry: Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      };
      const mockGdalFeature = createMockGdalFeature(42, { name: 'Test' }, mockGeometry);

      mockLayerFeatures.first.mockReturnValue(mockGdalFeature);

      const reader = await GdalShapefileReader.open(shapefilePath);
      const result = await reader.read();

      expect(result.value.id).toBe(42);
    });

    it('should handle features with Hebrew characters in properties', async () => {
      const mockGeometry: Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      };
      const mockProperties = { name: 'שלום עולם', description: 'תכונה בעברית' };
      const mockGdalFeature = createMockGdalFeature(0, mockProperties, mockGeometry);

      mockLayerFeatures.first.mockReturnValue(mockGdalFeature);

      const reader = await GdalShapefileReader.open(shapefilePath);
      const result = await reader.read();

      expect(result.value.properties).toEqual(mockProperties);
    });
  });

  describe('close', () => {
    it('should close the underlying dataset', async () => {
      const reader = await GdalShapefileReader.open(shapefilePath);
      reader.close();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockDataset.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('iteration pattern', () => {
    it('should support reading all features in a loop', async () => {
      const mockGeometry: Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      };
      const feature1 = createMockGdalFeature(0, { index: 0 }, mockGeometry);
      const feature2 = createMockGdalFeature(1, { index: 1 }, mockGeometry);
      const feature3 = createMockGdalFeature(2, { index: 2 }, mockGeometry);

      mockLayerFeatures.first.mockReturnValue(feature1);
      mockLayerFeatures.next
        .mockReturnValueOnce(feature2)
        .mockReturnValueOnce(feature3)
        .mockReturnValue(null as unknown as gdal.Feature);

      const reader = await GdalShapefileReader.open(shapefilePath);
      const features: Feature[] = [];

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        features.push(value);
      }

      expect(features).toHaveLength(3);
      expect(features[0]!.properties).toEqual({ index: 0 });
      expect(features[1]!.properties).toEqual({ index: 1 });
      expect(features[2]!.properties).toEqual({ index: 2 });
    });
  });
});

describe('openShapefile', () => {
  let mockDataset: Mocked<gdal.Dataset>;
  let mockLayer: Mocked<gdal.Layer>;
  let mockLayerFeatures: Mocked<gdal.LayerFeatures>;

  const shapefilePath = '/path/to/shapefile.shp';

  beforeEach(() => {
    vi.clearAllMocks();

    mockLayerFeatures = {
      first: vi.fn(),
      next: vi.fn(),
    } as unknown as Mocked<gdal.LayerFeatures>;

    mockLayer = {
      features: mockLayerFeatures,
    } as unknown as Mocked<gdal.Layer>;

    mockDataset = {
      layers: {
        get: vi.fn().mockReturnValue(mockLayer),
      },
      close: vi.fn(),
    } as unknown as Mocked<gdal.Dataset>;

    mockGdal.openAsync.mockResolvedValue(mockDataset);
  });

  it('should return an IShapefileSource compatible reader', async () => {
    const reader = await openShapefile(shapefilePath);

    expect(reader).toBeDefined();
    expect(typeof reader.read).toBe('function');
  });

  it('should allow reading features through the returned interface', async () => {
    const mockGeometry: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    };
    const mockGdalFeature = {
      fid: 0,
      fields: {
        toObject: vi.fn().mockReturnValue({ name: 'Test' }),
      },
      getGeometry: vi.fn().mockReturnValue({
        toObject: vi.fn().mockReturnValue(mockGeometry),
      }),
    } as unknown as Mocked<gdal.Feature>;

    mockLayerFeatures.first.mockReturnValue(mockGdalFeature);

    const reader = await openShapefile(shapefilePath);
    const result = await reader.read();

    expect(result.done).toBe(false);
    expect(result.value.type).toBe('Feature');
  });
});
