import type { Geometry } from 'geojson';

/**
 * Counts the number of vertices in a given geometry.
 * @param geometry - The geometry object to count vertices in.
 * @returns The total number of vertices in the geometry.
 * @throws Will throw an error if the geometry type is unsupported.
 */
export function countVertices(geometry: Geometry): number {
  let count = 0;

  switch (geometry.type) {
    case 'Polygon':
      geometry.coordinates.forEach((ring) => {
        count += ring.length;
      });
      break;
    case 'MultiPolygon':
      geometry.coordinates.forEach((polygon) => {
        polygon.forEach((ring) => {
          count += ring.length;
        });
      });
      break;
    case 'LineString':
      count = geometry.coordinates.length; // Each point in a LineString is a vertex
      break;
    case 'MultiLineString':
      geometry.coordinates.forEach((line) => {
        count += line.length;
      });
      break;
    case 'Point':
      count = 1; // A point is considered to have 1 vertex
      break;
    case 'MultiPoint':
      count = geometry.coordinates.length; // Each point is a vertex
      break;
    case 'GeometryCollection':
      geometry.geometries.forEach((geom) => {
        count += countVertices(geom);
      });
      break;
    default:
      throw new Error(`Unsupported geometry type`);
  }

  return count;
}
