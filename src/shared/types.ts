export type VehicleCategory = 'auto' | 'taxi' | 'police' | 'bike';

export interface VehiclePhysicsConfig {
  id: VehicleCategory;
  name: string;
  categoryName: string;
  mass: number; // kg
  maxSpeed: number; // m/s (multiply by 3.6 for km/h)
  acceleration: number; // m/s^2
  reverseSpeed: number; // m/s
  brakeForce: number; // m/s^2
  turnSpeed: number; // rad/s base steering sensitivity
  wheelBase: number; // meters
  wheelRadius: number; // meters
  rollFactor: number; // visual body roll/lean
  description: string;
  audioKey: 'electric' | 'engine' | 'cruiser' | 'motorcycle';
  baseColor: number;
}

export const VEHICLE_CONFIGS: Record<VehicleCategory, VehiclePhysicsConfig> = {
  auto: {
    id: 'auto',
    name: 'Electric Battery Auto (Supercharged)',
    categoryName: '3-Wheel E-Rickshaw',
    mass: 420,
    maxSpeed: 41.7, // ~150 km/h hyper e-rickshaw
    acceleration: 14.5,
    reverseSpeed: 18.0,
    brakeForce: 24.0,
    turnSpeed: 2.8,
    wheelBase: 1.8,
    wheelRadius: 0.27,
    rollFactor: 0.028,
    description: 'Supercharged 3-wheel electric battery auto with hyper-inverter boost and nitro response.',
    audioKey: 'electric',
    baseColor: 0x3ac2de,
  },
  taxi: {
    id: 'taxi',
    name: 'Kashmir Ambassador Taxi (Turbo V8)',
    categoryName: 'Heritage Sedan Taxi',
    mass: 1280,
    maxSpeed: 52.8, // ~190 km/h
    acceleration: 16.8,
    reverseSpeed: 20.0,
    brakeForce: 26.0,
    turnSpeed: 2.2,
    wheelBase: 2.5,
    wheelRadius: 0.32,
    rollFactor: 0.015,
    description: 'Tuned Kashmir Ambassador sedan with twin-turbo engine. Blasts down Boulevard Road at 190 km/h.',
    audioKey: 'engine',
    baseColor: 0xf4f1ea,
  },
  police: {
    id: 'police',
    name: 'J&K Police Interceptor (200 KM/H)',
    categoryName: 'Police Cruiser',
    mass: 1550,
    maxSpeed: 55.6, // 200.16 km/h (exact 200 km/h top speed!)
    acceleration: 22.5,
    reverseSpeed: 22.0,
    brakeForce: 32.0,
    turnSpeed: 2.5,
    wheelBase: 2.7,
    wheelRadius: 0.34,
    rollFactor: 0.010,
    description: 'State-of-the-art pursuit interceptor calibrated to 200 km/h with siren and emergency strobe arrays.',
    audioKey: 'cruiser',
    baseColor: 0x11161d,
  },
  bike: {
    id: 'bike',
    name: 'Royal Enfield Bullet 350 (200 KM/H Super-Thump)',
    categoryName: 'Classic Motorcycle',
    mass: 195,
    maxSpeed: 55.6, // 200.16 km/h (exact 200 km/h top speed!)
    acceleration: 25.0,
    reverseSpeed: 16.0,
    brakeForce: 30.0,
    turnSpeed: 3.2,
    wheelBase: 1.4,
    wheelRadius: 0.33,
    rollFactor: 0.052,
    description: 'Custom bored-out Bullet 350 superbike capable of 200 km/h with deep racing exhaust and steep bank angles.',
    audioKey: 'motorcycle',
    baseColor: 0x1a1a1a,
  },
};

// Spatial & Road Constants
export const ROAD_BOUNDS = {
  MIN_X: -26.0, // Physical hotel building walls & Nishat Bagh gate (West)
  MAX_X: 17.2,  // Promenade deodar railing wall along Dal Lake (East)
  MIN_Z: -428.4, // JK Police Dalgate barricade (South)
  MAX_Z: 411.4,  // JK Police Burger Barn checkpoint barricade (North)
  CHECKPOINT_Z: 413.0,
  SOUTH_CHECKPOINT_Z: -430.0,
};

export const PICKUP_RESPAWN_SEC = 60;
export const PLAYER_RESPAWN_SEC = 30;
export const MATCH_DURATION_SEC = 600;
export const MATCH_COUNTDOWN_SEC = 10;
export const MATCH_CELEBRATION_SEC = 12;
export const MATCH_INTERMISSION_SEC = 8;

export interface PlayerInputPacket {
  seq: number;
  steer: number; // -1 to 1 (left to right)
  throttle: number; // 0 to 1
  brake: number; // 0 to 1 (or reverse)
  handbrake: boolean;
  fire?: boolean;
  vehicleType: VehicleCategory;
  clientTime: number;
}

export interface PlayerServerState {
  id: string;
  name: string;
  vehicle: VehicleCategory;
  x: number;
  y: number;
  z: number;
  heading: number; // radians
  speed: number; // m/s
  steerAngle: number;
  lastAckSeq: number;
  color?: number;
  wantedLevel: number;
  inPursuit: boolean;
  mode?: GameMode;
  combat?: PlayerCombatState;
  isNpc?: boolean;
  inRoom?: boolean;
  inMatch?: boolean;
  waitingForRound?: boolean;
}

export type GameMode = 'free_roam' | 'battle_arena';

export type WeaponType =
  | 'rocket'
  | 'grenade'
  | 'firecracker'
  | 'emp'
  | 'oil'
  | 'spike'
  | 'machinegun'
  | 'homing'
  | 'bat'
  | 'pipe'
  | 'pistol'
  | 'shotgun'
  | 'rifle'
  | 'kangri';

export type StreetWeaponType = 'pistol' | 'shotgun' | 'rifle' | 'kangri';

export const STREET_WEAPON_ORDER: StreetWeaponType[] = [
  'pistol',
  'shotgun',
  'rifle',
  'kangri',
];

/** Boulevard ground mix: no bats; extra shotgun / rifle / kangri. */
export const STREET_WORLD_SPAWN_MIX: StreetWeaponType[] = [
  'shotgun',
  'rifle',
  'kangri',
  'shotgun',
  'rifle',
  'kangri',
  'shotgun',
  'rifle',
  'kangri',
  'shotgun',
  'rifle',
  'kangri',
  'pistol',
  'shotgun',
];

export const WEAPON_SLOT_ORDER: WeaponType[] = [
  'machinegun',
  'rocket',
  'grenade',
  'firecracker',
  'emp',
  'oil',
  'spike',
  'homing',
];

export const MAX_WORLD_PICKUPS = 11;
export const WORLD_SLOT_RESPAWN_SEC = 30;
export const WORLD_SPAWN_MIN_SEC = 30;
export const WORLD_SPAWN_MAX_SEC = 60;

export const WORLD_WEAPON_SPAWNS: { x: number; z: number }[] = [
  { x: 3.4, z: -390 },
  { x: -3.4, z: -340 },
  { x: 3.4, z: -280 },
  { x: -3.4, z: -220 },
  { x: 3.4, z: -170 },
  { x: -3.4, z: -90 },
  { x: 3.4, z: 60 },
  { x: -3.4, z: 110 },
  { x: 3.4, z: 180 },
  { x: -3.4, z: 240 },
  { x: 3.4, z: 300 },
  { x: -3.4, z: 360 },
  { x: 3.4, z: -50 },
  { x: -3.4, z: 20 },
];

export interface WeaponDefinition {
  id: WeaponType;
  name: string;
  categoryName: string;
  description: string;
  icon: string;
  damage: number;
  splashDamage: number;
  splashRadius: number; // meters
  projectileSpeed: number; // m/s
  cooldownMs: number;
  ammo: number;
  dropProbability: number; // percentage (sums to 100)
  kind?: 'melee' | 'hitscan' | 'projectile' | 'special' | 'arena';
  range?: number;
}

export const WEAPON_CONFIGS: Record<WeaponType, WeaponDefinition> = {
  machinegun: {
    id: 'machinegun',
    name: 'Dal Machine Gun',
    categoryName: 'Rapid Fire',
    description: 'Fires a high-velocity stream of 15 bullets. Low damage per bullet but relentless continuous pressure.',
    icon: '🔫',
    damage: 8,
    splashDamage: 0,
    splashRadius: 0,
    projectileSpeed: 95.0,
    cooldownMs: 120,
    ammo: 18,
    dropProbability: 20,
  },
  rocket: {
    id: 'rocket',
    name: 'Boulevard Rocket Launcher',
    categoryName: 'Heavy Explosive',
    description: 'Fires a fast rocket straight ahead. Explodes on impact with heavy direct and splash damage.',
    icon: '🚀',
    damage: 35,
    splashDamage: 20,
    splashRadius: 7.5,
    projectileSpeed: 48.0,
    cooldownMs: 900,
    ammo: 3,
    dropProbability: 15,
  },
  grenade: {
    id: 'grenade',
    name: 'Zabarwan Grenade Launcher',
    categoryName: 'Lobbed Explosive',
    description: 'Launches bouncing grenades in an arc trajectory that detonate on contact or timed fuse.',
    icon: '💣',
    damage: 30,
    splashDamage: 25,
    splashRadius: 6.5,
    projectileSpeed: 30.0,
    cooldownMs: 800,
    ammo: 4,
    dropProbability: 15,
  },
  oil: {
    id: 'oil',
    name: 'Slick Mustard Oil Trap',
    categoryName: 'Hazard / Area Denial',
    description: 'Drops a slick oil puddle behind your vehicle. Opponents lose traction and spin out for 2.5s.',
    icon: '🛢️',
    damage: 0,
    splashDamage: 0,
    splashRadius: 3.2,
    projectileSpeed: 0,
    cooldownMs: 600,
    ammo: 3,
    dropProbability: 15,
  },
  emp: {
    id: 'emp',
    name: 'Kashmir EMP Shockwave',
    categoryName: 'Tactical Disabler',
    description: 'Discharges an electric EMP dome in a 14m radius, temporarily cutting opponents steering & engine.',
    icon: '⚡',
    damage: 0,
    splashDamage: 0,
    splashRadius: 14.0,
    projectileSpeed: 0,
    cooldownMs: 1200,
    ammo: 1,
    dropProbability: 12,
  },
  spike: {
    id: 'spike',
    name: 'Steel Spike Strip',
    categoryName: 'Tire Hazard',
    description: 'Deploys a row of jagged caltrops behind vehicle. Deals 10 damage and halves opponent speed for 3s.',
    icon: '⚠️',
    damage: 10,
    splashDamage: 0,
    splashRadius: 2.8,
    projectileSpeed: 0,
    cooldownMs: 700,
    ammo: 2,
    dropProbability: 10,
  },
  firecracker: {
    id: 'firecracker',
    name: 'Kashmir Firecracker Barrage',
    categoryName: 'Spread Rockets',
    description: 'Launches a chaotic 5-rocket fan spread that blankets the roadway in fiery sparks.',
    icon: '🎆',
    damage: 8,
    splashDamage: 6,
    splashRadius: 3.5,
    projectileSpeed: 42.0,
    cooldownMs: 750,
    ammo: 4,
    dropProbability: 8,
  },
  homing: {
    id: 'homing',
    name: 'Shikara-Seeking Missile',
    categoryName: 'Homing Ordnance',
    description: 'Locks onto nearest visible opponent in forward cone and relentlessly pursues them. 40 damage.',
    icon: '🎯',
    damage: 40,
    splashDamage: 22,
    splashRadius: 8.0,
    projectileSpeed: 40.0,
    cooldownMs: 1500,
    ammo: 2,
    dropProbability: 5,
    kind: 'arena',
  },
  bat: {
    id: 'bat',
    name: 'Boulevard Wooden Bat',
    categoryName: 'Melee',
    description: 'Dark walnut cricket bat. Fast close-range smash from the driver seat.',
    icon: '🏏',
    damage: 16,
    splashDamage: 0,
    splashRadius: 0,
    projectileSpeed: 0,
    cooldownMs: 480,
    ammo: 28,
    dropProbability: 28,
    kind: 'melee',
    range: 3.4,
  },
  pipe: {
    id: 'pipe',
    name: 'Scrap Metal Pipe',
    categoryName: 'Heavy Melee',
    description: 'Heavy galvanized pipe. Slower swing, harder hit, briefly stuns steering.',
    icon: '🔧',
    damage: 24,
    splashDamage: 0,
    splashRadius: 0,
    projectileSpeed: 0,
    cooldownMs: 720,
    ammo: 18,
    dropProbability: 0,
    kind: 'melee',
    range: 3.8,
  },
  pistol: {
    id: 'pistol',
    name: 'Compact Pistol',
    categoryName: 'Sidearm',
    description: 'Short-range 9mm bursts from the window.',
    icon: '🔫',
    damage: 12,
    splashDamage: 0,
    splashRadius: 0,
    projectileSpeed: 78,
    cooldownMs: 280,
    ammo: 14,
    dropProbability: 22,
    kind: 'projectile',
    range: 28,
  },
  shotgun: {
    id: 'shotgun',
    name: 'Sawed Off Shotgun',
    categoryName: 'Close Range',
    description: 'Devastating spread at bumper distance, falloff beyond 12m.',
    icon: '💥',
    damage: 28,
    splashDamage: 8,
    splashRadius: 2.4,
    projectileSpeed: 62,
    cooldownMs: 900,
    ammo: 7,
    dropProbability: 14,
    kind: 'projectile',
    range: 16,
  },
  rifle: {
    id: 'rifle',
    name: 'Boulevard Rifle',
    categoryName: 'Long Range',
    description: 'Accurate rifle fire down the lakeside lanes.',
    icon: '🎯',
    damage: 18,
    splashDamage: 0,
    splashRadius: 0,
    projectileSpeed: 110,
    cooldownMs: 220,
    ammo: 22,
    dropProbability: 14,
    kind: 'projectile',
    range: 55,
  },
  kangri: {
    id: 'kangri',
    name: 'Kashmiri Kangri',
    categoryName: 'Fire Pot',
    description: 'Hottest kangri on the boulevard. Two ember bursts cook a vehicle hull to scrap.',
    icon: '🔥',
    damage: 50,
    splashDamage: 18,
    splashRadius: 4.2,
    projectileSpeed: 18,
    cooldownMs: 1100,
    ammo: 8,
    dropProbability: 14,
    kind: 'special',
    range: 14.5,
  },
};

export const VEHICLE_DAMAGE_MULT: Record<WeaponType, number> = {
  pistol: 0.55,
  shotgun: 0.85,
  rifle: 0.65,
  bat: 0.7,
  pipe: 0.9,
  kangri: 1.0,
  machinegun: 0.5,
  rocket: 1.35,
  grenade: 1.2,
  firecracker: 0.75,
  emp: 0.15,
  oil: 0,
  spike: 0.45,
  homing: 1.4,
};

export interface WorldWeaponPickup {
  id: string;
  slot: number;
  weapon: StreetWeaponType;
  x: number;
  y: number;
  z: number;
  active: boolean;
  respawnAt: number;
}

// Battle Arena Spatial Bounds (Dedicated Dal Lake Mayhem Arena Zone)
export const ARENA_BOUNDS = {
  MIN_X: -32.0, // Western pavilion and spectator grandstand wall
  MAX_X: 20.0,  // Eastern Dal Lake illuminated battle perimeter
  MIN_Z: -428.4, // Southern JK Police Dalgate barricade (road stays open past Wazwan Darbar Hotel)
  MAX_Z: 411.4,  // Northern JK Police Burger Barn checkpoint
};

export const ARENA_SPAWNS = [
  { x: -18.0, z: -140.0, heading: 0 },
  { x: 10.0, z: -140.0, heading: 0 },
  { x: -22.0, z: -80.0, heading: 0 },
  { x: 12.0, z: -80.0, heading: Math.PI },
  { x: -16.0, z: -20.0, heading: Math.PI },
  { x: 8.0, z: -20.0, heading: Math.PI },
  { x: -5.0, z: -60.0, heading: 0 },
  { x: 0.0, z: -110.0, heading: Math.PI },
];

export const CRATE_SPAWN_LOCATIONS = [
  { id: 'crate_1', x: -16.0, z: -120.0 },
  { id: 'crate_2', x: 8.0, z: -110.0 },
  { id: 'crate_3', x: -6.0, z: -75.0 },
  { id: 'crate_4', x: 2.0, z: -45.0 },
  { id: 'crate_5', x: -20.0, z: -40.0 },
  { id: 'crate_6', x: 10.0, z: -15.0 },
  { id: 'crate_7', x: -12.0, z: 5.0 },
];

export interface ArenaCrateState {
  id: string;
  x: number;
  y: number;
  z: number;
  active: boolean;
  respawnTimer: number; // seconds remaining until respawn
}

export interface ArenaProjectileState {
  id: string;
  weaponType: WeaponType;
  ownerId: string;
  ownerName: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  heading: number;
  targetId?: string; // For homing missile
  spawnTime: number;
  lifeTimeSec: number;
}

export interface ArenaHazardState {
  id: string;
  type: 'oil' | 'spike';
  ownerId: string;
  x: number;
  z: number;
  heading: number;
  expiresAt: number; // epoch ms
}

export interface PlayerCombatState {
  health: number; // 0 - 100
  maxHealth: number; // 100
  vehicleHealth: number; // 0 - 100 vehicle hull, shares damage with driver
  shield: number; // 0 - 50 bonus absorption
  weapon: WeaponType | null;
  ammo: number;
  inventory: Partial<Record<WeaponType, number>>;
  kills: number;
  deaths: number;
  damageDealt: number;
  isAlive: boolean;
  invulnerableUntil: number; // epoch ms
  respawnAt: number; // epoch ms; 0 = not waiting
  empUntil: number; // epoch ms
  oilUntil: number; // epoch ms
  speedPenaltyUntil: number; // epoch ms
  boostUntil: number; // epoch ms
  boostCooldownUntil: number; // epoch ms
  dodgeCooldownUntil: number; // epoch ms
}

export interface DamageEvent {
  id: string;
  attackerId: string;
  attackerName: string;
  victimId: string;
  victimName: string;
  amount: number;
  weaponType: WeaponType;
  x: number;
  y: number;
  z: number;
  isElimination: boolean;
  timestamp: number;
}

export type MatchPhase =
  | 'waiting'
  | 'countdown'
  | 'active'
  | 'finished'
  | 'celebration'
  | 'intermission';

export interface MatchLeaderboardEntry {
  playerId: string;
  name: string;
  kills: number;
  deaths: number;
  kdRatio: number;
  kdDisplay: string;
  damageDealt: number;
  rank: number;
  isNpc: boolean;
  isAlive: boolean;
  rewardCash?: number;
  rewardXp?: number;
}

export interface PresenceMetrics {
  online: number;
  inRoom: number;
  inMatch: number;
  waiting: number;
  bots: number;
  connected: boolean;
}

export interface LiveScoreEntry {
  playerId: string;
  name: string;
  kills: number;
  deaths: number;
  damageDealt: number;
  score: number;
  rank: number;
}

export interface ArenaMatchState {
  state: MatchPhase;
  timerSec: number;
  totalPlayers: number;
  playersAlive: number;
  winnerId?: string;
  winnerName?: string;
  sharedVictory?: boolean;
  announcement?: string;
  matchId?: string;
  leaderboard?: MatchLeaderboardEntry[];
  presence?: PresenceMetrics;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
}
