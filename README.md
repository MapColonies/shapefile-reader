# @map-colonies/shapefile-reader

A Node.js library for reading large shapefiles in memory-controlled chunks. It processes GeoJSON features in vertex-bounded batches, with built-in support for resumable processing, progress tracking, and metrics collection.

## Features

- **Chunk-based processing** — splits features into chunks bounded by a configurable vertex limit, keeping memory usage predictable
- **Oversized feature handling** — features that exceed the vertex limit are captured as `skippedFeatures` within their chunk rather than silently dropped
- **Resumable processing** — save and restore processing state to continue an interrupted run from where it left off
- **Progress tracking** — real-time percentage, speed (features/vertices/chunks per second), and estimated time remaining
- **Metrics collection** — per-chunk and per-file timing and feature count callbacks
- **Auto-generated feature IDs** — optionally assign a UUID to features that have no identifier

## Requirements

- Node.js >= 24
- GDAL native binaries (provided by [`gdal-async`](https://www.npmjs.com/package/gdal-async))

## Installation

```bash
npm install @map-colonies/shapefile-reader
```

## Quick Start

```typescript
import { ShapefileChunkReader } from '@map-colonies/shapefile-reader';

const reader = new ShapefileChunkReader({
  maxVerticesPerChunk: 50_000,
});

await reader.readAndProcess('/path/to/file.shp', {
  process: async (chunk) => {
    console.log(`Chunk ${chunk.id}: ${chunk.features.length} features, ${chunk.verticesCount} vertices`);
    // handle the GeoJSON features in chunk.features
  },
});
```

## API

### `ShapefileChunkReader`

The main class. Construct it once with your options and reuse it across multiple files.

```typescript
const reader = new ShapefileChunkReader(options: ReaderOptions);
```

#### `readAndProcess(shapefilePath, processor)`

Reads the shapefile at `shapefilePath` and calls `processor.process(chunk)` for each chunk.

```typescript
await reader.readAndProcess(shapefilePath: string, processor: ChunkProcessor): Promise<void>
```

- If a `stateManager` is provided, state is saved after each successfully processed chunk and on error.
- If a previous state exists (loaded via `stateManager.loadState()`), processing resumes from the last saved position.

#### `getShapefileStats(shapefilePath)`

Pre-scans the shapefile to return total feature and vertex counts. Useful for estimating progress before processing begins.

```typescript
const { totalFeatures, totalVertices } = await reader.getShapefileStats(shapefilePath: string);
```

Throws if the file has no valid features or vertices.

---

### `ReaderOptions`

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `maxVerticesPerChunk` | `number` | Yes | Maximum total vertices allowed per chunk. Controls peak memory usage. |
| `generateFeatureId` | `boolean` | No | When `true`, assigns a random UUID to each feature that has no `id`. Default: `false`. |
| `logger` | `Logger` | No | A `@map-colonies/js-logger` instance for debug/info/warn/error output. |
| `stateManager` | `StateManager` | No | Enables resumable processing. See [StateManager](#statemanager). |
| `metricsCollector` | `MetricsCollector` | No | Receives per-chunk and per-file metrics callbacks. See [MetricsCollector](#metricscollector). |

---

### `ShapefileChunk`

The object passed to your `ChunkProcessor` for each chunk.

```typescript
interface ShapefileChunk {
  id: number;                 // zero-based chunk index
  features: Feature[];        // GeoJSON features that fit within the vertex limit
  verticesCount: number;      // total vertices across features in this chunk
  skippedFeatures: Feature[]; // features whose vertex count alone exceeds maxVerticesPerChunk
  skippedVerticesCount: number;
}
```

Features in `skippedFeatures` have a `vertices` property added to their `properties` object, recording their vertex count.

---

### `StateManager`

Implement this interface to enable resumable processing.

```typescript
interface StateManager {
  saveState: (state: ProcessingState) => Promise<void> | void;
  loadState: () => (ProcessingState | null) | Promise<ProcessingState | null>;
}
```

`saveState` is called after each successfully processed chunk and on processing errors. `loadState` is called once at the start of `readAndProcess` — return `null` to start fresh.

**`ProcessingState`**

```typescript
interface ProcessingState {
  filePath: string;
  lastProcessedChunkIndex: number;
  lastProcessedFeatureIndex: number;
  timestamp: Date;
  progress?: ProgressInfo; // full progress snapshot at time of save
}
```

---

### `MetricsCollector`

Implement this interface to receive performance metrics.

```typescript
interface MetricsCollector {
  onChunkMetrics?: (metrics: ChunkMetrics) => void;
  onFileMetrics?: (metrics: FileMetrics) => void;
}
```

**`ChunkMetrics`** — emitted after each chunk is processed:

| Field | Type | Description |
|-------|------|-------------|
| `chunkIndex` | `number` | Chunk ID |
| `featuresCount` | `number` | Features in this chunk |
| `skippedFeaturesCount` | `number` | Skipped features in this chunk |
| `verticesCount` | `number` | Vertices in this chunk |
| `readTimeMs` | `number` | Time to read the chunk from disk |
| `processTimeMs` | `number` | Time your processor took |
| `totalTimeMs` | `number` | `readTimeMs + processTimeMs` |
| `timestamp` | `Date` | When the chunk finished processing |

**`FileMetrics`** — emitted once after all chunks are processed:

| Field | Type | Description |
|-------|------|-------------|
| `totalFeatures` | `number` | Total processed features |
| `totalSkippedFeatures` | `number` | Total skipped features |
| `totalVertices` | `number` | Total processed vertices |
| `totalChunks` | `number` | Number of chunks |
| `totalReadTimeMs` | `number` | Cumulative read time |
| `totalProcessTimeMs` | `number` | Cumulative process time |
| `totalTimeMs` | `number` | Cumulative total time |
| `startTime` | `Date` | When processing started |
| `endTime` | `Date \| undefined` | When processing ended |

---

### `openShapefile(path)` / `GdalShapefileReader`

Lower-level access to the GDAL-backed shapefile reader. Implements the `IShapefileSource` interface.

```typescript
import { openShapefile } from '@map-colonies/shapefile-reader';

const source = await openShapefile('/path/to/file.shp');

while (true) {
  const { done, value: feature } = await source.read();
  if (done) break;
  // feature is a GeoJSON Feature
}

source.close();
```

---

### `countVertices(geometry)`

Utility that counts the total number of vertices in any GeoJSON geometry, including nested rings and sub-geometries in `GeometryCollection`.

```typescript
import { countVertices } from '@map-colonies/shapefile-reader';

const count = countVertices(feature.geometry);
```

---

## Advanced Example

```typescript
import { ShapefileChunkReader } from '@map-colonies/shapefile-reader';
import { jsLogger } from '@map-colonies/js-logger';

const reader = new ShapefileChunkReader({
  maxVerticesPerChunk: 100000,
  generateFeatureId: true,
  logger: jsLogger({ level: 'info' }),

  stateManager: {
    saveState: async (state) => {
      await db.save('shapefile_state', state);
    },
    loadState: async () => {
      return db.load('shapefile_state');
    },
  },

  metricsCollector: {
    onChunkMetrics: (metrics) => {
      console.log(`Chunk ${metrics.chunkIndex}: ${metrics.featuresCount} features in ${metrics.totalTimeMs}ms`);
    },
    onFileMetrics: (metrics) => {
      console.log(`Done — ${metrics.totalFeatures} features across ${metrics.totalChunks} chunks`);
    },
  },
});

await reader.readAndProcess('/data/large-file.shp', {
  process: async (chunk) => {
    if (chunk.skippedFeatures.length > 0) {
      console.warn(`${chunk.skippedFeatures.length} features skipped in chunk ${chunk.id}`);
    }
      console.log(`${chunk.skippedFeatures.length} features in chunk ${chunk.id}`);
  },
});
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Lint
npm run lint

# Format
npm run format:fix
```
