import type { Feature } from 'geojson';
import { countVertices } from '../utils/geometry';
import { FeatureStatus, type ShapefileChunk } from '../types/index';
import { featurePropertiesSchema } from '../utils/validation';

export class ChunkBuilder {
  private features: Feature[];
  private skippedFeatures: Feature[];
  private currentVerticesCount: number;
  private skippedVerticesCount: number;

  public constructor(
    private readonly maxVertices: number,
    private chunkIndex: number = 0
  ) {
    this.features = [];
    this.skippedFeatures = [];
    this.currentVerticesCount = 0;
    this.skippedVerticesCount = 0;
  }

  public get chunkId(): number {
    return this.chunkIndex;
  }

  public canAddFeature(feature: Feature): FeatureStatus {
    this.validateFeatureId(feature);

    const featureVertices = countVertices(feature.geometry);

    if (featureVertices > this.maxVertices) {
      const featureWithVertices: Feature = { ...feature, properties: { ...feature.properties, vertices: featureVertices } };
      this.skippedFeatures.push(featureWithVertices);
      this.skippedVerticesCount += featureVertices;
      return FeatureStatus.SKIPPED;
    }
    const canAdd = this.currentVerticesCount + featureVertices <= this.maxVertices;

    return canAdd ? FeatureStatus.ADD : FeatureStatus.FULL;
  }

  public addFeature(feature: Feature): void {
    this.validateFeatureId(feature);
    if (this.withinSkipped(feature)) {
      return;
    }
    this.features.push(feature);
    this.currentVerticesCount += countVertices(feature.geometry);
  }

  public build(): ShapefileChunk {
    return {
      id: this.chunkIndex,
      features: this.features,
      verticesCount: this.currentVerticesCount,
      skippedFeatures: this.skippedFeatures,
      skippedVerticesCount: this.skippedVerticesCount,
    };
  }

  public nextChunk(): void {
    this.features = [];
    this.skippedFeatures = [];
    this.currentVerticesCount = 0;
    this.chunkIndex++;
  }

  private withinSkipped(feature: Feature): boolean {
    const featureId = featurePropertiesSchema.safeParse(feature.properties).data?.id;
    return this.skippedFeatures.some((skipped) => {
      const skippedId = featurePropertiesSchema.safeParse(skipped.properties).data?.id;
      return skippedId === featureId;
    });
  }

  private validateFeatureId(feature: Feature): void {
    const parsed = featurePropertiesSchema.safeParse(feature.properties);
    if (!parsed.success) {
      throw new Error('Feature must have an id');
    }
  }
}
