import fs from 'fs';
import path from 'path';
import {
  AD_LIMITS,
  Advertisement,
  SEED_ADVERTISEMENTS,
  parseAdDraft,
} from '../src/shared/advertisements.ts';

const DATA_DIR = path.resolve(process.cwd(), 'server_data');
const ADS_FILE = path.resolve(DATA_DIR, 'advertisements.json');

const recentPosts = new Map<string, number>();
const POST_GAP_MS = 12_000;

function loadPlayerAds(): Advertisement[] {
  try {
    if (!fs.existsSync(ADS_FILE)) return [];
    const raw = JSON.parse(fs.readFileSync(ADS_FILE, 'utf-8'));
    const rows = Array.isArray(raw) ? raw : raw?.ads;
    if (!Array.isArray(rows)) return [];
    return rows.filter(isStoredAd);
  } catch (err) {
    console.error('[Advertisements] Failed to read listings:', err);
    return [];
  }
}

function isStoredAd(row: unknown): row is Advertisement {
  if (!row || typeof row !== 'object') return false;
  const ad = row as Advertisement;
  return Boolean(ad.id && ad.brand && ad.headline && ad.category && !ad.featured && !String(ad.id).startsWith('seed_'));
}

function savePlayerAds(ads: Advertisement[]) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${ADS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(ads, null, 2), 'utf-8');
  fs.renameSync(tmp, ADS_FILE);
}

export function listAdvertisements(): Advertisement[] {
  const playerAds = loadPlayerAds().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return [...playerAds, ...SEED_ADVERTISEMENTS];
}

export function createAdvertisement(input: unknown): { success: true; advertisement: Advertisement; advertisements: Advertisement[] } | { success: false; message: string } {
  const parsed = parseAdDraft(input);
  if (!parsed.ok) return { success: false, message: parsed.message };

  const posterKey = parsed.draft.postedBy.toLowerCase();
  const now = Date.now();
  const last = recentPosts.get(posterKey) || 0;
  if (now - last < POST_GAP_MS) {
    return { success: false, message: 'Wait a moment before posting another advertisement.' };
  }

  const playerAds = loadPlayerAds();
  const duplicate = playerAds.some(
    ad =>
      ad.postedBy.toLowerCase() === posterKey &&
      ad.brand.toLowerCase() === parsed.draft.brand.toLowerCase() &&
      ad.headline.toLowerCase() === parsed.draft.headline.toLowerCase()
  );
  if (duplicate) {
    return { success: false, message: 'That advertisement is already on the board.' };
  }

  const advertisement: Advertisement = {
    id: `ad_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    ...parsed.draft,
    createdAt: new Date(now).toISOString(),
    featured: false,
  };

  const next = [advertisement, ...playerAds]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, AD_LIMITS.maxPlayerAds);
  savePlayerAds(next);
  recentPosts.set(posterKey, now);
  return { success: true, advertisement, advertisements: [...next, ...SEED_ADVERTISEMENTS] };
}

export function removeAdvertisement(id: string): { success: true; advertisements: Advertisement[] } | { success: false; message: string } {
  if (!id || id.startsWith('seed_')) {
    return { success: false, message: 'Boulevard listings stay on the hoardings.' };
  }
  const playerAds = loadPlayerAds();
  const next = playerAds.filter(ad => ad.id !== id);
  if (next.length === playerAds.length) {
    return { success: false, message: 'That advertisement is already gone.' };
  }
  savePlayerAds(next);
  return { success: true, advertisements: [...next.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)), ...SEED_ADVERTISEMENTS] };
}
