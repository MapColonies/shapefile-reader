import gdal from 'gdal-async';
import type { Feature, Geometry, GeoJsonProperties } from 'geojson';

/**
 * Result of reading a feature from the shapefile
 * Matches the interface pattern used by the shapefile package
 */
export interface ShapefileReadResult {
  done: boolean;
  value: Feature;
}

/**
 * Interface for shapefile reader that can be used interchangeably
 * with either gdal-async or the shapefile package
 */
export interface IShapefileSource {
  read: () => Promise<ShapefileReadResult>;
  close: () => void;
}

/**
 * Adapter class that wraps gdal-async to provide a shapefile reader
 * compatible with the interface expected by ShapefileChunkReader.
 *
 * This adapter allows seamless migration from the 'shapefile' npm package
 * to 'gdal-async' while maintaining the same API contract.
 */
export class GdalShapefileReader implements IShapefileSource {
  private readonly layer: gdal.Layer;
  private isFirstRead = true;

  private constructor(private readonly dataset: gdal.Dataset) {
    this.layer = dataset.layers.get(0);
  }

  /**
   * Opens a shapefile using gdal-async and returns a reader instance.
   * This is the async factory method to create a GdalShapefileReader.
   *
   * @param shapefilePath - Path to the .shp file
   * @returns Promise resolving to a GdalShapefileReader instance
   */
  public static async open(shapefilePath: string): Promise<GdalShapefileReader> {
    // Note: GDAL handles .dbf file association automatically based on the .shp path
    // and typically reads encoding from .cpg file if present, or uses UTF-8 by default
    // eslint-disable-next-line import-x/no-named-as-default-member
    const dataset = await gdal.openAsync(shapefilePath);
    return new GdalShapefileReader(dataset);
  }

  /**
   * Reads the next feature from the shapefile.
   * Returns { done: true, value: undefined } when no more features are available.
   *
   * @returns Promise resolving to the read result with done flag and feature value
   */
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  public readonly read = (): Promise<ShapefileReadResult> => {
    // Note: GDAL types say Feature is always returned, but in practice it returns null when done
    let gdalFeature: gdal.Feature | null;

    if (this.isFirstRead) {
      this.isFirstRead = false;
      gdalFeature = this.layer.features.first();
    } else {
      gdalFeature = this.layer.features.next();
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/strict-boolean-expressions
    if (!gdalFeature) {
      return Promise.resolve({
        done: true,
        value: undefined as unknown as Feature,
      });
    }

    const feature = this.convertToGeoJsonFeature(gdalFeature);

    return Promise.resolve({
      done: false,
      value: feature,
    });
  };

  /**
   * Closes the underlying dataset and releases resources.
   * Should be called when done reading the shapefile.
   */
  public close(): void {
    this.dataset.close();
  }

  /**
   * Converts a GDAL feature to a GeoJSON Feature object.
   *
   * @param gdalFeature - The GDAL feature to convert
   * @returns GeoJSON Feature object
   */
  private convertToGeoJsonFeature(gdalFeature: gdal.Feature): Feature {
    const geometry = gdalFeature.getGeometry();
    const properties = gdalFeature.fields.toObject() as GeoJsonProperties;

    // Convert GDAL geometry to GeoJSON
    let geoJsonGeometry: Geometry | null = null;
    if (geometry) {
      geoJsonGeometry = geometry.toObject() as Geometry;
    }

    const feature: Feature = {
      type: 'Feature',
      geometry: geoJsonGeometry as Geometry,
      properties,
    };

    // Preserve feature ID if present
    const fid = gdalFeature.fid;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (fid !== undefined) {
      feature.id = fid;
    }

    return feature;
  }
}

/**
 * Factory function to open a shapefile using gdal-async.
 *
 * @param shapefilePath - Path to the .shp file
 * @returns Promise resolving to a shapefile reader
 */
export async function openShapefile(shapefilePath: string): Promise<IShapefileSource> {
  return GdalShapefileReader.open(shapefilePath);
}
