import {
  MEASUREMENTS,
  type MeasurementType,
  type ReadingSource,
  type SensorReadingWithDetails,
} from '@growspace/shared';
import { executeQuery, type Queryable } from '../auth/db-client';

export interface SensorReadingRecord {
  id: string;
  user_id: string;
  garden_id: string;
  plant_id: string | null;
  measurement_type: string;
  value: number | string;
  unit: string;
  source: string;
  recorded_at: Date | string;
  note: string | null;
  created_at: Date | string;
  garden_name?: string | null;
  plant_name?: string | null;
}

export interface SensorReadingInput {
  gardenId: string;
  plantId?: string | null;
  measurementType: MeasurementType;
  value: number;
  unit?: string;
  source?: ReadingSource;
  recordedAt?: string | null;
  note?: string | null;
}

export interface ReadingFilterOptions {
  plantId?: string;
  gardenId?: string;
  measurementType?: MeasurementType;
  source?: ReadingSource;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

/**
 * Normalizes a raw database sensor_readings row into a canonical SensorReadingWithDetails entity.
 */
export function toSensorReading(record: SensorReadingRecord): SensorReadingWithDetails {
  return {
    id: record.id,
    userId: record.user_id,
    gardenId: record.garden_id,
    plantId: record.plant_id ?? null,
    measurementType: record.measurement_type as MeasurementType,
    value: Number(record.value),
    unit: record.unit,
    source: record.source as ReadingSource,
    recordedAt:
      record.recorded_at instanceof Date
        ? record.recorded_at.toISOString()
        : new Date(record.recorded_at).toISOString(),
    note: record.note ?? null,
    createdAt:
      record.created_at instanceof Date
        ? record.created_at.toISOString()
        : new Date(record.created_at).toISOString(),
    gardenName: record.garden_name ?? null,
    plantName: record.plant_name ?? null,
  };
}

/**
 * Inserts a single sensor reading (manual or simulated) into PostgreSQL.
 */
export async function createSensorReading(
  client: Queryable,
  userId: string,
  input: SensorReadingInput,
): Promise<SensorReadingWithDetails> {
  const measurementType = input.measurementType;
  const meta = MEASUREMENTS[measurementType];
  const unit = input.unit?.trim() || meta.unit;
  const source: ReadingSource = input.source === 'simulated' ? 'simulated' : 'manual';
  const recordedAt = input.recordedAt
    ? new Date(input.recordedAt).toISOString()
    : new Date().toISOString();
  const note = input.note?.trim() || null;
  const plantId = input.plantId ?? null;

  const res = await executeQuery<SensorReadingRecord>(
    client,
    `WITH inserted AS (
       INSERT INTO sensor_readings (user_id, garden_id, plant_id, measurement_type, value, unit, source, recorded_at, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *
     )
     SELECT i.*,
            g.name AS garden_name,
            COALESCE(p.custom_name, p.catalog_id) AS plant_name
     FROM inserted i
     LEFT JOIN gardens g ON g.id = i.garden_id
     LEFT JOIN plants p ON p.id = i.plant_id;`,
    [userId, input.gardenId, plantId, measurementType, input.value, unit, source, recordedAt, note],
  );

  return toSensorReading(res.rows[0]);
}

/**
 * Lists sensor readings matching the provided filters for an authenticated user.
 * Guarantees strict user isolation by requiring user_id = $1.
 */
export async function findReadings(
  client: Queryable,
  userId: string,
  filters: ReadingFilterOptions = {},
): Promise<{ readings: SensorReadingWithDetails[]; total: number }> {
  const conditions: string[] = ['sr.user_id = $1'];
  const params: unknown[] = [userId];

  if (filters.plantId) {
    params.push(filters.plantId);
    conditions.push(`sr.plant_id = $${params.length}`);
  }

  if (filters.gardenId) {
    params.push(filters.gardenId);
    conditions.push(`sr.garden_id = $${params.length}`);
  }

  if (filters.measurementType) {
    params.push(filters.measurementType);
    conditions.push(`sr.measurement_type = $${params.length}`);
  }

  if (filters.source) {
    params.push(filters.source);
    conditions.push(`sr.source = $${params.length}`);
  }

  if (filters.from) {
    params.push(new Date(filters.from).toISOString());
    conditions.push(`sr.recorded_at >= $${params.length}`);
  }

  if (filters.to) {
    params.push(new Date(filters.to).toISOString());
    conditions.push(`sr.recorded_at <= $${params.length}`);
  }

  const whereClause = conditions.join(' AND ');

  // Get total count
  const countRes = await executeQuery<{ count: string | number }>(
    client,
    `SELECT COUNT(*)::int AS count
     FROM sensor_readings sr
     WHERE ${whereClause};`,
    params,
  );
  const total = Number(countRes.rows[0]?.count ?? 0);

  // Apply safe limit and offset
  const limit = Math.min(Math.max(Number(filters.limit ?? 100), 1), 500);
  const offset = Math.max(Number(filters.offset ?? 0), 0);

  params.push(limit);
  const limitPlaceholder = `$${params.length}`;
  params.push(offset);
  const offsetPlaceholder = `$${params.length}`;

  const query = `
    SELECT sr.id, sr.user_id, sr.garden_id, sr.plant_id, sr.measurement_type,
           sr.value, sr.unit, sr.source, sr.recorded_at, sr.note, sr.created_at,
           g.name AS garden_name,
           COALESCE(p.custom_name, p.catalog_id) AS plant_name
    FROM sensor_readings sr
    LEFT JOIN gardens g ON g.id = sr.garden_id
    LEFT JOIN plants p ON p.id = sr.plant_id
    WHERE ${whereClause}
    ORDER BY sr.recorded_at DESC, sr.created_at DESC
    LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder};
  `;

  const res = await executeQuery<SensorReadingRecord>(client, query, params);
  const readings = res.rows.map(toSensorReading);

  return { readings, total };
}

/**
 * Returns the single latest reading for each measurement type for an authenticated user,
 * optionally filtered to a specific plant or garden.
 */
export async function findLatestReadings(
  client: Queryable,
  userId: string,
  options?: { plantId?: string; gardenId?: string },
): Promise<Record<MeasurementType, SensorReadingWithDetails | null>> {
  const conditions: string[] = ['sr.user_id = $1'];
  const params: unknown[] = [userId];

  if (options?.plantId) {
    params.push(options.plantId);
    conditions.push(`sr.plant_id = $${params.length}`);
  }

  if (options?.gardenId) {
    params.push(options.gardenId);
    conditions.push(`sr.garden_id = $${params.length}`);
  }

  const whereClause = conditions.join(' AND ');

  const query = `
    SELECT DISTINCT ON (sr.measurement_type)
           sr.id, sr.user_id, sr.garden_id, sr.plant_id, sr.measurement_type,
           sr.value, sr.unit, sr.source, sr.recorded_at, sr.note, sr.created_at,
           g.name AS garden_name,
           COALESCE(p.custom_name, p.catalog_id) AS plant_name
    FROM sensor_readings sr
    LEFT JOIN gardens g ON g.id = sr.garden_id
    LEFT JOIN plants p ON p.id = sr.plant_id
    WHERE ${whereClause}
    ORDER BY sr.measurement_type, sr.recorded_at DESC, sr.created_at DESC;
  `;

  const res = await executeQuery<SensorReadingRecord>(client, query, params);
  const readings = res.rows.map(toSensorReading);

  const result: Record<MeasurementType, SensorReadingWithDetails | null> = {
    air_temperature: null,
    air_humidity: null,
    medium_moisture: null,
  };

  for (const r of readings) {
    result[r.measurementType] = r;
  }

  return result;
}

/**
 * Generates a batch of simulated demo readings for demonstration purposes.
 * Strictly marks all generated readings with source = 'simulated'.
 */
export async function generateSimulatedReadings(
  client: Queryable,
  userId: string,
  options: {
    gardenId: string;
    plantId?: string | null;
  },
): Promise<SensorReadingWithDetails[]> {
  const { gardenId, plantId = null } = options;
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;

  // Realistic sample profiles over the last 24 hours
  const sampleData: Array<{
    type: MeasurementType;
    values: number[];
  }> = [
    { type: 'air_temperature', values: [22.4, 23.1, 24.5, 25.2, 23.8, 22.0, 20.8, 19.5] },
    { type: 'air_humidity', values: [58.0, 56.5, 52.0, 49.5, 54.0, 60.0, 63.5, 66.0] },
    { type: 'medium_moisture', values: [65.0, 64.2, 63.0, 61.5, 60.0, 59.2, 58.0, 57.1] },
  ];

  const intervals = [0, 1, 3, 6, 9, 14, 18, 24]; // hours ago
  const createdReadings: SensorReadingWithDetails[] = [];

  for (const { type, values } of sampleData) {
    const meta = MEASUREMENTS[type];
    for (let i = 0; i < intervals.length; i++) {
      const hoursAgo = intervals[i];
      const recordedAt = new Date(now - hoursAgo * oneHour).toISOString();
      const value = values[i % values.length];

      const reading = await createSensorReading(client, userId, {
        gardenId,
        plantId,
        measurementType: type,
        value,
        unit: meta.unit,
        source: 'simulated',
        recordedAt,
        note: 'Simulated demonstration reading generated for environment testing',
      });
      createdReadings.push(reading);
    }
  }

  return createdReadings;
}
