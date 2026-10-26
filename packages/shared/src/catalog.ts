import type { PlantCatalogEntry } from './types';

const CREATED_AT = '2026-01-01T00:00:00.000Z';

type CatalogSeed = Omit<PlantCatalogEntry, 'id' | 'createdAt' | 'updatedAt' | 'isPublished' | 'imageUrl'>;

const seed: CatalogSeed[] = [
  {
    slug: 'tomato',
    commonName: 'Tomato',
    scientificName: 'Solanum lycopersicum',
    category: 'Vegetables',
    difficulty: 'moderate',
    lightGuidance: 'Full sun, roughly 6–8 hours of direct light per day.',
    wateringGuidance: 'Water deeply when the top few centimetres of soil feel dry; avoid waterlogging.',
    growingMethodNotes: 'Container, raised bed, or soil. Needs support as it grows.',
    harvestDaysMin: 60,
    harvestDaysMax: 85,
    referenceNotes:
      'General home-garden reference ranges. Adjust for variety, climate, and local growing conditions.',
    referenceRanges: {
      air_temperature: { min: 18, max: 27 },
      air_humidity: { min: 50, max: 70 },
      medium_moisture: { min: 55, max: 75 },
    },
  },
  {
    slug: 'lettuce',
    commonName: 'Lettuce',
    scientificName: 'Lactuca sativa',
    category: 'Vegetables',
    difficulty: 'easy',
    lightGuidance: 'Partial sun to full sun; shade helps in hot weather.',
    wateringGuidance: 'Keep the medium consistently moist but not saturated.',
    growingMethodNotes: 'Shallow roots suit containers, raised beds, and hydroponic systems.',
    harvestDaysMin: 30,
    harvestDaysMax: 60,
    referenceNotes:
      'General home-garden reference ranges. Lettuce bolts in heat; local climate matters.',
    referenceRanges: {
      air_temperature: { min: 10, max: 22 },
      air_humidity: { min: 50, max: 70 },
      medium_moisture: { min: 55, max: 75 },
    },
  },
  {
    slug: 'basil',
    commonName: 'Basil',
    scientificName: 'Ocimum basilicum',
    category: 'Herbs',
    difficulty: 'easy',
    lightGuidance: 'Full sun for at least 5–6 hours, with some afternoon shade in hot climates.',
    wateringGuidance: 'Water when the surface begins to dry; basil dislikes both drought and soggy roots.',
    growingMethodNotes: 'Containers and raised beds work well. Pinch flowers to encourage leaf growth.',
    harvestDaysMin: 30,
    harvestDaysMax: 60,
    referenceNotes: 'General herb guidance; humidity needs vary by climate.',
    referenceRanges: {
      air_temperature: { min: 18, max: 30 },
      air_humidity: { min: 40, max: 70 },
      medium_moisture: { min: 45, max: 65 },
    },
  },
  {
    slug: 'mint',
    commonName: 'Mint',
    scientificName: 'Mentha spp.',
    category: 'Herbs',
    difficulty: 'easy',
    lightGuidance: 'Partial sun; tolerates more shade than most culinary herbs.',
    wateringGuidance: 'Keep the medium evenly moist. Containers may need frequent watering.',
    growingMethodNotes: 'Grow in a container to limit spreading through garden beds.',
    harvestDaysMin: 30,
    harvestDaysMax: 60,
    referenceNotes: 'General herb guidance. Mint spreads aggressively in open soil.',
    referenceRanges: {
      air_temperature: { min: 15, max: 25 },
      air_humidity: { min: 40, max: 70 },
      medium_moisture: { min: 50, max: 70 },
    },
  },
  {
    slug: 'chili-pepper',
    commonName: 'Chili pepper',
    scientificName: 'Capsicum spp.',
    category: 'Vegetables',
    difficulty: 'moderate',
    lightGuidance: 'Full sun, at least 6 hours daily.',
    wateringGuidance: 'Water when the top layer dries; avoid constant saturation.',
    growingMethodNotes: 'Containers and raised beds. Warmth matters for germination and fruiting.',
    harvestDaysMin: 70,
    harvestDaysMax: 100,
    referenceNotes: 'General home-garden guidance; heat tolerance varies by variety.',
    referenceRanges: {
      air_temperature: { min: 20, max: 30 },
      air_humidity: { min: 50, max: 70 },
      medium_moisture: { min: 50, max: 70 },
    },
  },
  {
    slug: 'spinach',
    commonName: 'Spinach',
    scientificName: 'Spinacia oleracea',
    category: 'Vegetables',
    difficulty: 'easy',
    lightGuidance: 'Partial sun; avoid intense midday heat.',
    wateringGuidance: 'Keep the medium moist; small containers dry quickly.',
    growingMethodNotes: 'Cool-season crop suited to containers and raised beds.',
    harvestDaysMin: 30,
    harvestDaysMax: 50,
    referenceNotes: 'General guidance. Spinach performs poorly in sustained heat.',
    referenceRanges: {
      air_temperature: { min: 10, max: 22 },
      air_humidity: { min: 40, max: 70 },
      medium_moisture: { min: 50, max: 70 },
    },
  },
  {
    slug: 'cucumber',
    commonName: 'Cucumber',
    scientificName: 'Cucumis sativus',
    category: 'Vegetables',
    difficulty: 'moderate',
    lightGuidance: 'Full sun, 6–8 hours daily.',
    wateringGuidance: 'Water regularly and deeply; avoid wetting leaves.',
    growingMethodNotes: 'Provide a trellis. Containers need adequate depth and consistent moisture.',
    harvestDaysMin: 50,
    harvestDaysMax: 70,
    referenceNotes: 'General home-garden guidance; varieties differ in days to harvest.',
    referenceRanges: {
      air_temperature: { min: 18, max: 30 },
      air_humidity: { min: 60, max: 80 },
      medium_moisture: { min: 60, max: 80 },
    },
  },
  {
    slug: 'strawberry',
    commonName: 'Strawberry',
    scientificName: 'Fragaria × ananassa',
    category: 'Fruits',
    difficulty: 'moderate',
    lightGuidance: 'Full sun for best fruiting.',
    wateringGuidance: 'Keep moisture steady during flowering and fruiting; improve drainage.',
    growingMethodNotes: 'Containers and raised beds with well-draining medium.',
    harvestDaysMin: 90,
    harvestDaysMax: 120,
    referenceNotes: 'General guidance; cycles depend on variety and climate.',
    referenceRanges: {
      air_temperature: { min: 15, max: 25 },
      air_humidity: { min: 50, max: 75 },
      medium_moisture: { min: 55, max: 75 },
    },
  },
  {
    slug: 'rosemary',
    commonName: 'Rosemary',
    scientificName: 'Salvia rosmarinus',
    category: 'Herbs',
    difficulty: 'easy',
    lightGuidance: 'Full sun; tolerates dry air.',
    wateringGuidance: 'Allow the medium to dry between waterings. Avoid soggy roots.',
    growingMethodNotes: 'Well-draining containers or garden beds.',
    harvestDaysMin: 80,
    harvestDaysMax: 100,
    referenceNotes: 'General herb guidance; drought tolerance depends on establishment.',
    referenceRanges: {
      air_temperature: { min: 15, max: 28 },
      air_humidity: { min: 30, max: 50 },
      medium_moisture: { min: 30, max: 50 },
    },
  },
  {
    slug: 'kale',
    commonName: 'Kale',
    scientificName: 'Brassica oleracea var. sabellica',
    category: 'Vegetables',
    difficulty: 'easy',
    lightGuidance: 'Full sun to partial shade.',
    wateringGuidance: 'Keep the medium evenly moist.',
    growingMethodNotes: 'Containers and raised beds. Cool-season growth is usually strongest.',
    harvestDaysMin: 50,
    harvestDaysMax: 70,
    referenceNotes: 'General home-garden guidance; local heat and pests affect results.',
    referenceRanges: {
      air_temperature: { min: 10, max: 22 },
      air_humidity: { min: 40, max: 70 },
      medium_moisture: { min: 50, max: 70 },
    },
  },
  {
    slug: 'coriander',
    commonName: 'Coriander',
    scientificName: 'Coriandrum sativum',
    category: 'Herbs',
    difficulty: 'easy',
    lightGuidance: 'Partial sun; tolerates light shade.',
    wateringGuidance: 'Keep the surface moist; avoid drought stress.',
    growingMethodNotes: 'Best sown in succession. Bolts quickly in hot weather.',
    harvestDaysMin: 40,
    harvestDaysMax: 60,
    referenceNotes: 'General herb guidance; flowering is triggered by heat and day length.',
    referenceRanges: {
      air_temperature: { min: 15, max: 25 },
      air_humidity: { min: 40, max: 60 },
      medium_moisture: { min: 45, max: 65 },
    },
  },
  {
    slug: 'spring-onion',
    commonName: 'Spring onion',
    scientificName: 'Allium fistulosum',
    category: 'Vegetables',
    difficulty: 'easy',
    lightGuidance: 'Full sun to partial shade.',
    wateringGuidance: 'Keep the medium moist but draining freely.',
    growingMethodNotes: 'Containers and raised beds; small harvests can begin before full maturity.',
    harvestDaysMin: 50,
    harvestDaysMax: 70,
    referenceNotes: 'General home-garden guidance; harvest timing depends on the intended size.',
    referenceRanges: {
      air_temperature: { min: 13, max: 25 },
      air_humidity: { min: 40, max: 70 },
      medium_moisture: { min: 50, max: 70 },
    },
  },
];

export const PLANT_CATALOG: PlantCatalogEntry[] = seed.map((entry) => ({
  ...entry,
  id: `catalog-${entry.slug}`,
  imageUrl: null,
  isPublished: true,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
}));

export function findCatalogEntry(slug: string): PlantCatalogEntry | undefined {
  return PLANT_CATALOG.find((entry) => entry.slug === slug);
}

export function findCatalogEntryById(id: string): PlantCatalogEntry | undefined {
  return PLANT_CATALOG.find((entry) => entry.id === id);
}

/**
 * Searches the reference library for a plant matching the query by slug,
 * id, common name, or botanical/scientific name.
 */
export function findCatalogEntryByQuery(query: string): PlantCatalogEntry | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;

  const slugified = q.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  return PLANT_CATALOG.find((entry) => {
    if (entry.slug === slugified || entry.id === `catalog-${slugified}`) {
      return true;
    }
    if (entry.commonName.toLowerCase() === q) {
      return true;
    }
    if (entry.scientificName && entry.scientificName.toLowerCase() === q) {
      return true;
    }
    // Match common name substrings or word boundaries (e.g. "Roma Tomato" -> "tomato")
    if (
      entry.commonName.toLowerCase().includes(q) ||
      (q.length >= 3 && q.includes(entry.commonName.toLowerCase()))
    ) {
      return true;
    }
    return false;
  });
}

