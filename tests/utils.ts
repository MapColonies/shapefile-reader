import type { Feature, Polygon } from 'geojson';
import type { ShapefileChunk } from '../src';

// Helper function to create a simple polygon feature
export function createPolygonFeature(coordinates: number[][], id?: string): Feature<Polygon> {
  return {
    type: 'Feature',
    id: id,
    properties: { id: id },
    geometry: {
      type: 'Polygon',
      coordinates: [coordinates],
    },
  };
}

// Helper function to create test chunks
export function createTestChunk(id: number, featuresCount: number, verticesCount: number): ShapefileChunk {
  const defaultCoords: number[][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
    [0, 0],
  ];
  const features = Array.from({ length: featuresCount }, (_, index) => createPolygonFeature(defaultCoords, `feature-${index}`));

  return {
    id,
    features,
    verticesCount,
    skippedFeatures: [],
    skippedVerticesCount: 0,
  };
}
