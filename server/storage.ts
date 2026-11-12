import fs from 'fs';
import path from 'path';

export interface PlayerProfile {
  id: string;
  name: string;
  cash: number;
  xp: number;
  level: number;
  selectedVehicle: 'auto' | 'taxi' | 'police' | 'bike';
  unlockedVehicles: string[];
  completedMissions: string[];
  bestRaceTimes: Record<string, number>;
  battleStats?: {
    wins: number;
    matchesPlayed: number;
    kills: number;
    damageDealt: number;
    weaponUsage: Record<string, number>;
  };
  createdAt: string;
  lastActiveAt: string;
}

const DATA_DIR = path.resolve(process.cwd(), 'server_data');
const DB_FILE = path.resolve(DATA_DIR, 'players.json');
const AUDIT_FILE = path.resolve(DATA_DIR, 'audit_ledger.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

class StorageEngine {
  private profiles: Map<string, PlayerProfile> = new Map();
  private missionNonces: Set<string> = new Set();

  constructor() {
    this.loadFromDisk();
  }

  private loadFromDisk() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const data = JSON.parse(raw);
        for (const [id, prof] of Object.entries(data)) {
          const p = prof as PlayerProfile;
          p.unlockedVehicles = ['auto', 'taxi', 'police', 'bike'];
          this.profiles.set(id, p);
        }
      }
      if (fs.existsSync(AUDIT_FILE)) {
        const raw = fs.readFileSync(AUDIT_FILE, 'utf-8');
        const nonces = JSON.parse(raw);
        if (Array.isArray(nonces)) {
          nonces.forEach(n => this.missionNonces.add(n));
        }
      }
    } catch (err) {
      console.error('[StorageEngine] Error loading disk state:', err);
    }
  }

  private saveToDisk() {
    try {
      const obj: Record<string, PlayerProfile> = {};
      this.profiles.forEach((v, k) => {
        obj[k] = v;
      });
      // Atomic write using temp file
      const tmpFile = `${DB_FILE}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify(obj, null, 2), 'utf-8');
      fs.renameSync(tmpFile, DB_FILE);

      const noncesTmp = `${AUDIT_FILE}.tmp`;
      fs.writeFileSync(noncesTmp, JSON.stringify(Array.from(this.missionNonces)), 'utf-8');
      fs.renameSync(noncesTmp, AUDIT_FILE);
    } catch (err) {
      console.error('[StorageEngine] Error writing to disk:', err);
    }
  }

  public getOrCreateProfile(id: string, name?: string): PlayerProfile {
    let profile = this.profiles.get(id);
    if (!profile) {
      profile = {
        id,
        name: name || `Driver_${id.slice(0, 4)}`,
        cash: 1500, // starting tourist allowance
        xp: 0,
        level: 1,
        selectedVehicle: 'auto',
        unlockedVehicles: ['auto', 'taxi', 'police', 'bike'],
        completedMissions: [],
        bestRaceTimes: {},
        battleStats: {
          wins: 0,
          matchesPlayed: 0,
          kills: 0,
          damageDealt: 0,
          weaponUsage: {},
        },
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
      };
      this.profiles.set(id, profile);
      this.saveToDisk();
    } else {
      if (!profile.battleStats) {
        profile.battleStats = {
          wins: 0,
          matchesPlayed: 0,
          kills: 0,
          damageDealt: 0,
          weaponUsage: {},
        };
      }
      if (name && profile.name !== name) {
        profile.name = name;
      }
      profile.lastActiveAt = new Date().toISOString();
      this.saveToDisk();
    }
    return profile;
  }

  public recordBattleRewards(
    playerId: string,
    matchId: string,
    nonce: string,
    kills: number,
    damage: number,
    placement: number,
    rewardCash: number,
    rewardXp: number,
    isWin: boolean
  ): { success: boolean; newCash?: number; newXp?: number; message?: string } {
    const key = `battle:${playerId}:${matchId}:${nonce}`;
    if (this.missionNonces.has(key)) {
      return { success: false, message: 'Battle reward already claimed.' };
    }

    const profile = this.getOrCreateProfile(playerId);
    if (!profile.battleStats) {
      profile.battleStats = { wins: 0, matchesPlayed: 0, kills: 0, damageDealt: 0, weaponUsage: {} };
    }

    profile.battleStats.matchesPlayed += 1;
    profile.battleStats.kills += Math.max(0, kills);
    profile.battleStats.damageDealt += Math.max(0, damage);
    if (isWin || placement === 1) {
      profile.battleStats.wins += 1;
    }

    profile.cash += Math.max(0, rewardCash);
    profile.xp += Math.max(0, rewardXp);
    profile.level = 1 + Math.floor(profile.xp / 500);

    this.missionNonces.add(key);
    profile.lastActiveAt = new Date().toISOString();
    this.saveToDisk();

    return { success: true, newCash: profile.cash, newXp: profile.xp };
  }

  public recordMissionReward(
    playerId: string,
    missionId: string,
    nonce: string,
    rewardCash: number,
    rewardXp: number,
    raceTime?: number
  ): { success: boolean; newCash?: number; newXp?: number; message?: string } {
    const key = `${playerId}:${nonce}`;
    if (this.missionNonces.has(key)) {
      return { success: false, message: 'Reward already claimed (idempotency triggered).' };
    }

    const profile = this.getOrCreateProfile(playerId);
    profile.cash += Math.max(0, rewardCash);
    profile.xp += Math.max(0, rewardXp);
    profile.level = 1 + Math.floor(profile.xp / 500);

    if (!profile.completedMissions.includes(missionId)) {
      profile.completedMissions.push(missionId);
    }

    if (raceTime && (!profile.bestRaceTimes[missionId] || raceTime < profile.bestRaceTimes[missionId])) {
      profile.bestRaceTimes[missionId] = raceTime;
    }

    this.missionNonces.add(key);
    profile.lastActiveAt = new Date().toISOString();
    this.saveToDisk();

    return { success: true, newCash: profile.cash, newXp: profile.xp };
  }

  public unlockVehicle(playerId: string, vehicleId: 'auto' | 'taxi' | 'police' | 'bike', price: number): { success: boolean; message?: string } {
    const profile = this.getOrCreateProfile(playerId);
    if (profile.unlockedVehicles.includes(vehicleId)) {
      profile.selectedVehicle = vehicleId;
      this.saveToDisk();
      return { success: true, message: 'Vehicle already owned; selected.' };
    }
    if (profile.cash < price) {
      return { success: false, message: `Insufficient funds. Needed: ₹${price}, Available: ₹${profile.cash}` };
    }
    profile.cash -= price;
    profile.unlockedVehicles.push(vehicleId);
    profile.selectedVehicle = vehicleId;
    this.saveToDisk();
    return { success: true };
  }

  public selectVehicle(playerId: string, vehicleId: 'auto' | 'taxi' | 'police' | 'bike'): boolean {
    const profile = this.getOrCreateProfile(playerId);
    if (!profile.unlockedVehicles.includes(vehicleId)) {
      profile.unlockedVehicles.push(vehicleId);
    }
    profile.selectedVehicle = vehicleId;
    this.saveToDisk();
    return true;
  }
}

export const storage = new StorageEngine();
