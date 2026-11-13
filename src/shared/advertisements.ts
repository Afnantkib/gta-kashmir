export type AdCategory = 'stay' | 'food' | 'shop' | 'ride' | 'service' | 'event';

export interface Advertisement {
  id: string;
  brand: string;
  headline: string;
  details: string;
  offer: string;
  category: AdCategory;
  postedBy: string;
  createdAt: string;
  featured: boolean;
}

export interface AdDraft {
  brand: string;
  headline: string;
  details: string;
  offer: string;
  category: AdCategory;
  postedBy: string;
}

export const AD_CATEGORIES: { id: AdCategory; label: string }[] = [
  { id: 'stay', label: 'Stay' },
  { id: 'food', label: 'Food' },
  { id: 'shop', label: 'Shop' },
  { id: 'ride', label: 'Ride' },
  { id: 'service', label: 'Service' },
  { id: 'event', label: 'Event' },
];

export const AD_LIMITS = {
  brand: 28,
  headline: 64,
  details: 180,
  offer: 40,
  postedBy: 16,
  maxPlayerAds: 40,
};

export function adPalette(category: AdCategory): { accent: string; ink: string; chip: string } {
  switch (category) {
    case 'stay':
      return { accent: '#1b365d', ink: '#f6ead0', chip: '#7dd3fc' };
    case 'food':
      return { accent: '#7a2518', ink: '#ffe8c7', chip: '#fdba74' };
    case 'shop':
      return { accent: '#3b1848', ink: '#f7e9ff', chip: '#e9d5ff' };
    case 'ride':
      return { accent: '#0e4d5c', ink: '#dff6ff', chip: '#67e8f9' };
    case 'service':
      return { accent: '#1d4334', ink: '#e7f6ea', chip: '#86efac' };
    case 'event':
      return { accent: '#8a4b12', ink: '#fff4df', chip: '#fcd34d' };
  }
}

export function categoryLabel(category: AdCategory): string {
  return AD_CATEGORIES.find(c => c.id === category)?.label ?? 'Listing';
}

function clean(value: unknown, max: number): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function parseAdDraft(input: unknown, fallbackPoster = 'Driver'): { ok: true; draft: AdDraft } | { ok: false; message: string } {
  const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const category = String(body.category || '') as AdCategory;
  if (!AD_CATEGORIES.some(c => c.id === category)) {
    return { ok: false, message: 'Pick a category for this advertisement.' };
  }

  const brand = clean(body.brand, AD_LIMITS.brand);
  const headline = clean(body.headline, AD_LIMITS.headline);
  const details = clean(body.details, AD_LIMITS.details);
  const offer = clean(body.offer, AD_LIMITS.offer);
  const postedBy = clean(body.postedBy || fallbackPoster, AD_LIMITS.postedBy) || 'Driver';

  if (brand.length < 2) return { ok: false, message: 'Brand needs at least 2 characters.' };
  if (headline.length < 4) return { ok: false, message: 'Headline needs at least 4 characters.' };

  return { ok: true, draft: { brand, headline, details, offer, category, postedBy } };
}

export const SEED_ADVERTISEMENTS: Advertisement[] = [
  {
    id: 'seed_boulevard_hotel',
    brand: 'Grand Boulevard Hotel',
    headline: 'Wake up over Dal Lake',
    details: 'Cedar rooms, a chinar courtyard, and noon checkout for drivers who raced all night.',
    offer: 'First night ₹2,400',
    category: 'stay',
    postedBy: 'Boulevard',
    createdAt: '2026-01-01T08:00:00.000Z',
    featured: true,
  },
  {
    id: 'seed_ahdoos',
    brand: 'Ahdoos Heritage Hotel',
    headline: 'Old Srinagar, still taking guests',
    details: 'Carved balconies, kahwa at dawn, and a garage for the Ambassador.',
    offer: 'Weekday rooms open',
    category: 'stay',
    postedBy: 'Boulevard',
    createdAt: '2026-01-01T08:05:00.000Z',
    featured: true,
  },
  {
    id: 'seed_houseboats',
    brand: 'Nigeen Houseboats',
    headline: 'Sleep on the water tonight',
    details: 'Carved houseboats with a shikara pickup from the promenade steps.',
    offer: 'Sunset berth ₹1,800',
    category: 'stay',
    postedBy: 'Boulevard',
    createdAt: '2026-01-01T08:10:00.000Z',
    featured: true,
  },
  {
    id: 'seed_wazwan',
    brand: 'Wazwan Darbar',
    headline: 'A full trami, no waiting',
    details: 'Rista, gushtaba, and tabakh maaz served under the chinar lamps.',
    offer: 'Trami for two ₹900',
    category: 'food',
    postedBy: 'Boulevard',
    createdAt: '2026-01-01T08:15:00.000Z',
    featured: true,
  },
  {
    id: 'seed_kahwa',
    brand: 'Kahwa & Saffron Lounge',
    headline: 'Saffron kahwa, still hot',
    details: 'Almond kahwa, bakarkhani, and a window on the lake for the slow lap.',
    offer: 'Pot of kahwa ₹120',
    category: 'food',
    postedBy: 'Boulevard',
    createdAt: '2026-01-01T08:20:00.000Z',
    featured: true,
  },
  {
    id: 'seed_burger',
    brand: 'Burger Barn',
    headline: 'Pit stop before the north gate',
    details: 'The red barn at the Burger Barn checkpoint. Fries, shakes, and a dry seat.',
    offer: 'Combo ₹199',
    category: 'food',
    postedBy: 'Boulevard',
    createdAt: '2026-01-01T08:25:00.000Z',
    featured: true,
  },
  {
    id: 'seed_pashmina',
    brand: 'Pashmina Silk Palace',
    headline: 'Shawl weather is here',
    details: 'Handwoven pashmina and silk stoles, wrapped before you reach the next lamp.',
    offer: 'Wraps from ₹650',
    category: 'shop',
    postedBy: 'Boulevard',
    createdAt: '2026-01-01T08:30:00.000Z',
    featured: true,
  },
  {
    id: 'seed_kangir',
    brand: 'Kangir Emporium',
    headline: 'The hottest kangir on the road',
    details: 'Willow kangirs, fresh embers, and a copper stand that fits the taxi seat.',
    offer: 'Ember refill ₹40',
    category: 'shop',
    postedBy: 'Boulevard',
    createdAt: '2026-01-01T08:35:00.000Z',
    featured: true,
  },
  {
    id: 'seed_shikara',
    brand: 'Dal Lake Shikaras',
    headline: 'Leave the car. Take the lake.',
    details: 'Flower shikaras from the promenade. Twenty minutes to the houseboats and back.',
    offer: 'Ride ₹250',
    category: 'ride',
    postedBy: 'Boulevard',
    createdAt: '2026-01-01T08:40:00.000Z',
    featured: true,
  },
  {
    id: 'seed_autos',
    brand: 'Battery Auto Stand',
    headline: 'Charge while you eat',
    details: 'Boulevard e-rickshaw stand. Fast top-up, dry seats, no queue past dusk.',
    offer: 'Top-up ₹80',
    category: 'service',
    postedBy: 'Boulevard',
    createdAt: '2026-01-01T08:45:00.000Z',
    featured: true,
  },
  {
    id: 'seed_pine',
    brand: 'Hotel Pine & Peak',
    headline: 'Zabarwan in the window',
    details: 'Quiet rooms above the cedar cafe. Ask for the ridge side.',
    offer: 'Ridge rooms left',
    category: 'stay',
    postedBy: 'Boulevard',
    createdAt: '2026-01-01T08:50:00.000Z',
    featured: true,
  },
  {
    id: 'seed_mela',
    brand: 'Boulevard Night Mela',
    headline: 'Lights along the promenade',
    details: 'Music, saffron stalls, and a slow cruise from Dalgate to the Burger Barn.',
    offer: 'Tonight after dusk',
    category: 'event',
    postedBy: 'Boulevard',
    createdAt: '2026-01-01T08:55:00.000Z',
    featured: true,
  },
];
