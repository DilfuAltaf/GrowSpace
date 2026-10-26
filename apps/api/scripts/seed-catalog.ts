import { PLANT_CATALOG } from '@growspace/shared';
import { getDatabase } from '../src/lib/db';

async function main() {
  const sql = getDatabase();

  for (const entry of PLANT_CATALOG) {
    await sql`
      INSERT INTO plant_catalog (
        id, slug, common_name, scientific_name, category, difficulty,
        image_url, light_guidance, watering_guidance, growing_method_notes,
        harvest_days_min, harvest_days_max, reference_notes, is_published,
        created_at, updated_at
      ) VALUES (
        ${entry.id}, ${entry.slug}, ${entry.commonName}, ${entry.scientificName ?? null}, ${entry.category}, ${entry.difficulty ?? null},
        ${entry.imageUrl ?? null}, ${entry.lightGuidance ?? null}, ${entry.wateringGuidance ?? null}, ${entry.growingMethodNotes ?? null},
        ${entry.harvestDaysMin ?? null}, ${entry.harvestDaysMax ?? null}, ${entry.referenceNotes ?? null}, ${entry.isPublished},
        ${entry.createdAt}, ${entry.updatedAt}
      )
      ON CONFLICT (id) DO UPDATE SET
        slug = EXCLUDED.slug,
        common_name = EXCLUDED.common_name,
        scientific_name = EXCLUDED.scientific_name,
        category = EXCLUDED.category,
        difficulty = EXCLUDED.difficulty,
        image_url = EXCLUDED.image_url,
        light_guidance = EXCLUDED.light_guidance,
        watering_guidance = EXCLUDED.watering_guidance,
        growing_method_notes = EXCLUDED.growing_method_notes,
        harvest_days_min = EXCLUDED.harvest_days_min,
        harvest_days_max = EXCLUDED.harvest_days_max,
        reference_notes = EXCLUDED.reference_notes,
        is_published = EXCLUDED.is_published,
        updated_at = EXCLUDED.updated_at
    `;
  }

  console.log(`Seeded ${PLANT_CATALOG.length} plant catalog entries into PostgreSQL.`);
}

main().catch((error) => {
  console.error('Catalog seed failed.', error);
  process.exit(1);
});
