import { WebSocket, WebSocketServer } from 'ws';
import {
  PlayerInputPacket,
  PlayerServerState,
  PlayerCombatState,
  VEHICLE_CONFIGS,
  ROAD_BOUNDS,
  ARENA_BOUNDS,
  ARENA_SPAWNS,
  CRATE_SPAWN_LOCATIONS,
  ChatMessage,
  VehicleCategory,
  GameMode,
  WeaponType,
  WEAPON_CONFIGS,
  VEHICLE_DAMAGE_MULT,
  WEAPON_SLOT_ORDER,
  ArenaCrateState,
  ArenaProjectileState,
  ArenaHazardState,
  ArenaMatchState,
  DamageEvent,
  MatchLeaderboardEntry,
  LiveScoreEntry,
  PresenceMetrics,
  PICKUP_RESPAWN_SEC,
  MATCH_DURATION_SEC,
  MATCH_COUNTDOWN_SEC,
  MATCH_CELEBRATION_SEC,
  MATCH_INTERMISSION_SEC,
  PLAYER_RESPAWN_SEC,
  STREET_WEAPON_ORDER,
  STREET_WORLD_SPAWN_MIX,
  StreetWeaponType,
  WorldWeaponPickup,
  WORLD_WEAPON_SPAWNS,
  MAX_WORLD_PICKUPS,
  WORLD_SLOT_RESPAWN_SEC,
  WORLD_SPAWN_MIN_SEC,
  WORLD_SPAWN_MAX_SEC,
} from '../src/shared/types.ts';
import { storage } from './storage.ts';

const HEARTBEAT_TIMEOUT_MS = 12000;
const STALE_SESSION_MS = 25000;

interface ConnectedClient {
  ws: WebSocket;
  playerId: string;
  name: string;
  vehicle: VehicleCategory;
  mode: GameMode;
  lastInputTime: number;
  lastHeartbeat: number;
  inputQueue: PlayerInputPacket[];
  state: PlayerServerState;
  combat: PlayerCombatState;
  lastFireTime: number;
  lastFireByWeapon: Partial<Record<WeaponType, number>>;
  inRoom: boolean;
  inMatch: boolean;
  waitingForRound: boolean;
  wantsFire: boolean;
  poseHistory: { t: number; x: number; z: number }[];
}

export class RoomManager {
  private clients: Map<string, ConnectedClient> = new Map();
  private bots: Map<string, PlayerServerState> = new Map();
  private arenaBots: Map<string, { state: PlayerServerState; combat: PlayerCombatState; targetCrateIndex: number; lastFireTime: number }> = new Map();
  private wss: WebSocketServer | null = null;
  private tickInterval: NodeJS.Timeout | null = null;
  private broadcastInterval: NodeJS.Timeout | null = null;
  private chatHistory: ChatMessage[] = [];

  // Arena Combat State
  private crates: ArenaCrateState[] = [];
  private projectiles: Map<string, ArenaProjectileState> = new Map();
  private hazards: Map<string, ArenaHazardState> = new Map();
  private matchState: ArenaMatchState = {
    state: 'waiting',
    timerSec: MATCH_COUNTDOWN_SEC,
    totalPlayers: 0,
    playersAlive: 0,
    announcement: 'WAITING FOR PLAYERS',
    matchId: '',
    leaderboard: [],
    presence: { online: 0, inRoom: 0, inMatch: 0, waiting: 0, bots: 0, connected: true },
  };
  private matchId: string = `match_${Date.now()}`;
  private matchCountdownTimer: number = 0;
  private matchClockSec: number = MATCH_DURATION_SEC;
  private phaseTimerSec: number = 0;
  private rewardedMatchId: string | null = null;
  private pickupLocks: Set<string> = new Set();
  private worldPickups: WorldWeaponPickup[] = [];
  private nextWorldSpawnSec = 4;
  private worldPickupSeq = 1;
  private lastMinuteAnnounced = false;
  private lastAliveAnnounced = -1;
  private ramCooldown = new Map<string, number>();

  constructor() {
    this.initRoadBots();
    this.initArenaCrates(true);
    this.initArenaBots();
    this.seedWorldPickups();
  }

  private createCombatState(partial?: Partial<PlayerCombatState>): PlayerCombatState {
    return {
      health: 100,
      maxHealth: 100,
      vehicleHealth: 100,
      shield: 0,
      weapon: null,
      ammo: 0,
      inventory: {},
      kills: 0,
      deaths: 0,
      damageDealt: 0,
      isAlive: true,
      invulnerableUntil: 0,
      respawnAt: 0,
      empUntil: 0,
      oilUntil: 0,
      speedPenaltyUntil: 0,
      boostUntil: 0,
      boostCooldownUntil: 0,
      dodgeCooldownUntil: 0,
      ...partial,
    };
  }

  private initRoadBots() {
    const botTemplates: { id: string; name: string; vehicle: VehicleCategory; z: number; x: number; heading: number }[] = [
      { id: 'bot_taxi_1', name: 'Bashir (Taxi)', vehicle: 'taxi', z: -348, x: -3.5, heading: 0 },
      { id: 'bot_auto_1', name: 'Tariq (Auto)', vehicle: 'auto', z: -322, x: 3.5, heading: Math.PI },
      { id: 'bot_bike_1', name: 'Zubair (Bullet)', vehicle: 'bike', z: 120, x: 3.5, heading: Math.PI },
      { id: 'bot_police_1', name: 'JK Police 04', vehicle: 'police', z: 350, x: 3.5, heading: Math.PI },
      { id: 'bot_auto_2', name: 'Farooq (Auto)', vehicle: 'auto', z: 50, x: -3.5, heading: 0 },
      { id: 'bot_taxi_2', name: 'Ghulam (Taxi)', vehicle: 'taxi', z: -200, x: 3.5, heading: Math.PI },
      { id: 'bot_bike_2', name: 'Imran (Bullet)', vehicle: 'bike', z: -40, x: -3.5, heading: 0 },
      { id: 'bot_police_2', name: 'JK Police 07', vehicle: 'police', z: 210, x: -3.5, heading: 0 },
      { id: 'bot_taxi_3', name: 'Naseer (Taxi)', vehicle: 'taxi', z: 280, x: 3.5, heading: Math.PI },
      { id: 'bot_auto_3', name: 'Rasool (Auto)', vehicle: 'auto', z: -250, x: 3.5, heading: Math.PI },
    ];

    for (const b of botTemplates) {
      this.bots.set(b.id, {
        id: b.id,
        name: b.name,
        vehicle: b.vehicle,
        x: b.x,
        y: 0,
        z: b.z,
        heading: b.heading,
        speed: 8.5,
        steerAngle: 0,
        lastAckSeq: 0,
        wantedLevel: 0,
        inPursuit: false,
        mode: 'free_roam',
        isNpc: true,
        combat: this.createCombatState({ shield: 0 }),
      });
    }
  }

  private initArenaCrates(allActive = true) {
    this.pickupLocks.clear();
    this.crates = CRATE_SPAWN_LOCATIONS.map(loc => ({
      id: loc.id,
      x: loc.x,
      y: 0.9,
      z: loc.z,
      active: allActive,
      respawnTimer: 0,
    }));
  }

  private initArenaBots() {
    const arenaBotTemplates: { id: string; name: string; vehicle: VehicleCategory; spawnIndex: number }[] = [
      { id: 'abot_shabbir', name: 'Shabbir (Auto-Gladiator)', vehicle: 'auto', spawnIndex: 2 },
      { id: 'abot_gulzar', name: 'Gulzar (Taxi-Enforcer)', vehicle: 'taxi', spawnIndex: 3 },
      { id: 'abot_aijaz', name: 'Aijaz (Cruiser-Wrecker)', vehicle: 'police', spawnIndex: 4 },
    ];

    for (const b of arenaBotTemplates) {
      const sp = ARENA_SPAWNS[b.spawnIndex] || ARENA_SPAWNS[0];
      const botState: PlayerServerState = {
        id: b.id,
        name: b.name,
        vehicle: b.vehicle,
        x: sp.x,
        y: 0,
        z: sp.z,
        heading: sp.heading,
        speed: 0,
        steerAngle: 0,
        lastAckSeq: 0,
        wantedLevel: 0,
        inPursuit: false,
        mode: 'battle_arena',
        isNpc: true,
        inRoom: false,
        inMatch: false,
        waitingForRound: false,
      };

      const combatState: PlayerCombatState = this.createCombatState({
        shield: 25,
        weapon: 'machinegun',
        ammo: 15,
        inventory: { machinegun: 15 },
      });

      botState.combat = combatState;
      this.arenaBots.set(b.id, {
        state: botState,
        combat: combatState,
        targetCrateIndex: Math.floor(Math.random() * this.crates.length),
        lastFireTime: 0,
      });
    }
  }

  public bindServer(wss: WebSocketServer) {
    this.wss = wss;

    wss.on('connection', (ws: WebSocket) => {
      let clientSessionId: string | null = null;

      ws.on('message', (data: string | Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          switch (msg.type) {
            case 'JOIN': {
              const { playerId, name, vehicle, mode, enterRoom } = msg;
              if (!playerId || typeof playerId !== 'string') return;
              clientSessionId = playerId;
              const vCategory: VehicleCategory = vehicle || 'auto';
              const selectedMode: GameMode = mode === 'battle_arena' ? 'battle_arena' : 'free_roam';
              const profile = storage.getOrCreateProfile(playerId, name);

              const existing = this.clients.get(playerId);
              const matchIsLive =
                this.matchState.state === 'active' ||
                this.matchState.state === 'countdown' ||
                this.matchState.state === 'finished' ||
                this.matchState.state === 'celebration';

              let spawnX = 0;
              let spawnZ = -400;
              let spawnHeading = 0;
              if (selectedMode === 'battle_arena') {
                const sp = ARENA_SPAWNS[this.realOnlineCount() % ARENA_SPAWNS.length];
                spawnX = sp.x;
                spawnZ = sp.z;
                spawnHeading = sp.heading;
              } else {
                const humanCount = this.clients.size;
                spawnX = humanCount % 2 === 0 ? -3.5 : 3.5;
                spawnZ = -385 - (humanCount % 6) * 14;
                spawnHeading = 0;
              }

              const wantsRoom = selectedMode === 'battle_arena' && enterRoom !== false;
              const resumeMatch = !!(existing && existing.inMatch && matchIsLive);
              const waiting = wantsRoom && matchIsLive && !resumeMatch;

              const combat = existing?.combat || this.createCombatState({
                shield: selectedMode === 'battle_arena' ? 25 : 0,
              });
              if (!combat.inventory) combat.inventory = {};
              if (typeof combat.deaths !== 'number') combat.deaths = 0;
              const leftoverBat = combat.inventory.bat || 0;
              if (leftoverBat > 0) {
                combat.inventory.shotgun = (combat.inventory.shotgun || 0) + leftoverBat;
                delete combat.inventory.bat;
                if (combat.weapon === 'bat') {
                  combat.weapon = 'shotgun';
                  combat.ammo = combat.inventory.shotgun;
                }
              }

              const client: ConnectedClient = {
                ws,
                playerId,
                name: profile.name,
                vehicle: vCategory,
                mode: selectedMode,
                lastInputTime: Date.now(),
                lastHeartbeat: Date.now(),
                inputQueue: [],
                lastFireTime: existing?.lastFireTime || 0,
                lastFireByWeapon: existing?.lastFireByWeapon || {},
                combat,
                wantsFire: false,
                inRoom: wantsRoom || existing?.inRoom || false,
                inMatch: resumeMatch,
                waitingForRound: waiting,
                poseHistory: existing?.poseHistory || [],
                state: existing?.state || {
                  id: playerId,
                  name: profile.name,
                  vehicle: vCategory,
                  x: spawnX,
                  y: 0,
                  z: spawnZ,
                  heading: spawnHeading,
                  speed: 0,
                  steerAngle: 0,
                  lastAckSeq: 0,
                  wantedLevel: 0,
                  inPursuit: false,
                  mode: selectedMode,
                  combat,
                  isNpc: false,
                  inRoom: wantsRoom,
                  inMatch: resumeMatch,
                  waitingForRound: waiting,
                },
              };

              client.state.name = profile.name;
              client.state.vehicle = vCategory;
              client.state.mode = selectedMode;
              client.state.combat = combat;
              client.state.isNpc = false;
              client.state.inRoom = client.inRoom;
              client.state.inMatch = client.inMatch;
              client.state.waitingForRound = client.waitingForRound;

              if (existing && existing.ws !== ws && existing.ws.readyState === WebSocket.OPEN) {
                try {
                  existing.ws.send(JSON.stringify({ type: 'SESSION_REPLACED' }));
                  existing.ws.close();
                } catch {
                  /* ignore */
                }
              }

              this.clients.set(playerId, client);
              this.updateArenaPlayerCounts();

              ws.send(JSON.stringify({
                type: 'WELCOME',
                playerId,
                profile,
                mode: selectedMode,
                players: this.getAllEntities(),
                crates: this.crates,
                worldPickups: this.worldPickups,
                matchState: this.getPublicMatchState(),
                presence: this.buildPresence(),
                scoreboard: this.buildLiveScoreboard(),
                chat: this.chatHistory.slice(-15),
              }));

              this.broadcast({
                type: 'PLAYER_JOINED',
                player: client.state,
                presence: this.buildPresence(),
              }, playerId);

              if (client.inRoom) {
                this.checkStartArenaMatch();
              }
              break;
            }

            case 'ENTER_ROOM': {
              if (!clientSessionId) return;
              const client = this.clients.get(clientSessionId);
              if (!client) return;
              this.enterRoom(client);
              break;
            }

            case 'LEAVE_ROOM': {
              if (!clientSessionId) return;
              const client = this.clients.get(clientSessionId);
              if (!client) return;
              client.inRoom = false;
              client.inMatch = false;
              client.waitingForRound = false;
              client.mode = 'free_roam';
              client.state.mode = 'free_roam';
              client.state.inRoom = false;
              client.state.inMatch = false;
              client.state.waitingForRound = false;
              this.updateArenaPlayerCounts();
              this.broadcast({ type: 'PRESENCE_UPDATE', presence: this.buildPresence(), matchState: this.getPublicMatchState() });
              break;
            }

            case 'SELECT_WEAPON': {
              if (!clientSessionId) return;
              const client = this.clients.get(clientSessionId);
              if (!client || !client.combat.isAlive) return;
              const slot = Number(msg.slot);
              const list = client.mode === 'battle_arena' ? WEAPON_SLOT_ORDER : STREET_WEAPON_ORDER;
              const wType: WeaponType | undefined =
                list[slot - 1] || (WEAPON_CONFIGS[msg.weapon as WeaponType] ? msg.weapon : undefined);
              if (!wType) return;
              const ammo = client.combat.inventory[wType] || 0;
              if (ammo <= 0) return;
              client.combat.weapon = wType;
              client.combat.ammo = ammo;
              client.state.combat = client.combat;
              break;
            }

            case 'INPUT': {
              if (!clientSessionId) return;
              const client = this.clients.get(clientSessionId);
              if (!client) return;
              client.lastHeartbeat = Date.now();
              client.lastInputTime = Date.now();
              const input: PlayerInputPacket = msg.input;
              if (input && typeof input.seq === 'number') {
                client.wantsFire = !!input.fire;
                client.inputQueue.push(input);
                if (client.inputQueue.length > 16) {
                  client.inputQueue.splice(0, client.inputQueue.length - 16);
                }
              }
              break;
            }

            case 'SET_MODE': {
              if (!clientSessionId) return;
              const client = this.clients.get(clientSessionId);
              if (!client) return;
              const targetMode: GameMode = msg.mode === 'battle_arena' ? 'battle_arena' : 'free_roam';
              client.mode = targetMode;
              client.state.mode = targetMode;

              if (targetMode === 'battle_arena') {
                this.enterRoom(client);
              } else {
                client.inRoom = false;
                client.inMatch = false;
                client.waitingForRound = false;
                client.state.inRoom = false;
                client.state.inMatch = false;
                client.state.waitingForRound = false;
                client.state.x = Math.random() > 0.5 ? -3.5 : 3.5;
                client.state.z = -380;
                client.state.heading = 0;
                client.state.speed = 0;
                this.updateArenaPlayerCounts();
              }

              this.broadcast({
                type: 'PLAYER_UPDATED',
                player: client.state,
              });
              break;
            }

            case 'FIRE_WEAPON': {
              if (!clientSessionId) return;
              const client = this.clients.get(clientSessionId);
              if (!client) return;
              const shot = {
                x: Number.isFinite(Number(msg.x)) ? Number(msg.x) : client.state.x,
                z: Number.isFinite(Number(msg.z)) ? Number(msg.z) : client.state.z,
                mx: Number.isFinite(Number(msg.mx)) ? Number(msg.mx) : undefined,
                mz: Number.isFinite(Number(msg.mz)) ? Number(msg.mz) : undefined,
                heading: Number.isFinite(Number(msg.heading)) ? Number(msg.heading) : client.state.heading,
                clientTime: Number(msg.clientTime) || Date.now(),
                lockTargetId: typeof msg.lockTargetId === 'string' ? msg.lockTargetId : undefined,
                weapon: typeof msg.weapon === 'string' ? msg.weapon : undefined,
              };
              this.tryFireWeapon(client, shot);
              break;
            }

            case 'PICKUP_WEAPON': {
              if (!clientSessionId) return;
              const client = this.clients.get(clientSessionId);
              if (!client || !client.combat.isAlive) return;
              const px = Number(msg.x);
              const pz = Number(msg.z);
              this.tryCollectWorldPickup(
                client,
                msg.pickupId,
                Number.isFinite(px) ? px : undefined,
                Number.isFinite(pz) ? pz : undefined,
                true
              );
              break;
            }

            case 'USE_BOOST': {
              if (!clientSessionId) return;
              const client = this.clients.get(clientSessionId);
              if (!client || client.mode !== 'battle_arena' || !client.combat.isAlive) return;

              const now = Date.now();
              if (now < client.combat.boostCooldownUntil) return;

              client.combat.boostUntil = now + 1800;
              client.combat.boostCooldownUntil = now + 6500;
              client.state.speed += 14.0; // Instant boost impulse

              this.broadcast({
                type: 'COMBAT_EFFECT',
                effect: 'boost',
                playerId: client.playerId,
                x: client.state.x,
                z: client.state.z,
              });
              break;
            }

            case 'USE_DODGE': {
              if (!clientSessionId) return;
              const client = this.clients.get(clientSessionId);
              if (!client || client.mode !== 'battle_arena' || !client.combat.isAlive) return;

              const now = Date.now();
              if (now < client.combat.dodgeCooldownUntil) return;

              client.combat.dodgeCooldownUntil = now + 4000;
              // Lateral dash perpendicular to vehicle heading
              const perpHeading = client.state.heading + Math.PI / 2;
              client.state.x += Math.sin(perpHeading) * 4.2;
              client.state.z += Math.cos(perpHeading) * 4.2;

              this.broadcast({
                type: 'COMBAT_EFFECT',
                effect: 'dodge',
                playerId: client.playerId,
                x: client.state.x,
                z: client.state.z,
              });
              break;
            }

            case 'RESTART_ARENA_MATCH': {
              // Automatic lifecycle owns restarts; ignore client restart requests
              // so a single player cannot reset an in-progress round.
              break;
            }

            case 'SWITCH_VEHICLE': {
              if (!clientSessionId) return;
              const client = this.clients.get(clientSessionId);
              if (!client) return;
              const newVeh: VehicleCategory = msg.vehicle;
              if (VEHICLE_CONFIGS[newVeh]) {
                if (storage.selectVehicle(client.playerId, newVeh)) {
                  client.vehicle = newVeh;
                  client.state.vehicle = newVeh;
                  this.broadcast({
                    type: 'PLAYER_UPDATED',
                    player: client.state,
                  });
                }
              }
              break;
            }

            case 'CHAT': {
              if (!clientSessionId) return;
              const client = this.clients.get(clientSessionId);
              if (!client) return;
              const text = String(msg.text || '').trim();
              if (text.length > 0 && text.length <= 160) {
                const chatMsg: ChatMessage = {
                  id: `chat_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                  senderId: client.playerId,
                  senderName: client.name,
                  text,
                  timestamp: Date.now(),
                };
                this.chatHistory.push(chatMsg);
                if (this.chatHistory.length > 50) this.chatHistory.shift();
                this.broadcast({
                  type: 'CHAT_BROADCAST',
                  message: chatMsg,
                });
              }
              break;
            }

            case 'RAM': {
              if (!clientSessionId) return;
              const client = this.clients.get(clientSessionId);
              if (!client) return;
              this.resolveRam(
                client,
                String(msg.targetId || ''),
                Number(msg.speed),
                Number(msg.x),
                Number(msg.z)
              );
              break;
            }

            case 'PING': {
              if (clientSessionId) {
                const client = this.clients.get(clientSessionId);
                if (client) client.lastHeartbeat = Date.now();
              }
              ws.send(JSON.stringify({ type: 'PONG', time: msg.time, presence: this.buildPresence() }));
              break;
            }
          }
        } catch (e) {
          console.error('[RoomManager] Message parsing error:', e);
        }
      });

      ws.on('close', () => {
        if (clientSessionId) {
          const current = this.clients.get(clientSessionId);
          if (current && current.ws === ws) {
            this.clients.delete(clientSessionId);
            this.broadcast({
              type: 'PLAYER_LEFT',
              playerId: clientSessionId,
              presence: this.buildPresence(),
            });
            this.updateArenaPlayerCounts();
          }
        }
      });
    });

    // 30 Hz Authoritative Simulation Tick Loop
    const TICK_DT = 1 / 30; // 33.33ms
    this.tickInterval = setInterval(() => {
      this.simulationTick(TICK_DT);
    }, 1000 / 30);

    // 20 Hz State Broadcast Loop
    this.broadcastInterval = setInterval(() => {
      this.dropStaleSessions();
      this.broadcastStateSnapshot();
    }, 1000 / 20);
  }

  private enterRoom(client: ConnectedClient) {
    client.mode = 'battle_arena';
    client.state.mode = 'battle_arena';
    client.inRoom = true;
    client.state.inRoom = true;

    const live =
      this.matchState.state === 'active' ||
      this.matchState.state === 'countdown' ||
      this.matchState.state === 'finished' ||
      this.matchState.state === 'celebration';

    if (live && !client.inMatch) {
      client.waitingForRound = true;
      client.inMatch = false;
      client.state.waitingForRound = true;
      client.state.inMatch = false;
      const sp = ARENA_SPAWNS[this.realOnlineCount() % ARENA_SPAWNS.length];
      client.state.x = sp.x;
      client.state.z = sp.z;
      client.state.heading = sp.heading;
      client.state.speed = 0;
    } else if (!live) {
      client.waitingForRound = false;
      client.state.waitingForRound = false;
      this.checkStartArenaMatch();
    }

    this.updateArenaPlayerCounts();
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify({
        type: 'ROOM_JOINED',
        matchState: this.getPublicMatchState(),
        presence: this.buildPresence(),
        waitingForRound: client.waitingForRound,
      }));
    }
    this.broadcast({ type: 'PRESENCE_UPDATE', presence: this.buildPresence(), matchState: this.getPublicMatchState() });
  }

  private realOnlineCount() {
    return this.clients.size;
  }

  private roomClients() {
    return Array.from(this.clients.values()).filter(c => c.inRoom);
  }

  private matchClients() {
    return Array.from(this.clients.values()).filter(c => c.inMatch);
  }

  private buildPresence(): PresenceMetrics {
    const inRoom = this.roomClients().length;
    const inMatch = this.matchClients().length;
    const waiting = Array.from(this.clients.values()).filter(c => c.inRoom && !c.inMatch).length;
    return {
      online: this.clients.size,
      inRoom,
      inMatch,
      waiting,
      bots: this.bots.size + this.arenaBots.size,
      connected: true,
    };
  }

  private getPublicMatchState(): ArenaMatchState {
    return {
      ...this.matchState,
      presence: this.buildPresence(),
      matchId: this.matchId,
      leaderboard: this.buildLeaderboard(false),
    };
  }

  private kdRatio(kills: number, deaths: number) {
    if (kills > 0 && deaths === 0) return Number.POSITIVE_INFINITY;
    if (kills === 0 && deaths === 0) return 0;
    return kills / Math.max(1, deaths);
  }

  private kdDisplay(kills: number, deaths: number) {
    if (kills > 0 && deaths === 0) return '∞';
    if (kills === 0 && deaths === 0) return '0.00';
    return (kills / Math.max(1, deaths)).toFixed(2);
  }

  private buildLeaderboard(humansOnly: boolean): MatchLeaderboardEntry[] {
    const rows: MatchLeaderboardEntry[] = [];
    for (const c of this.clients.values()) {
      if (!c.inMatch && this.matchState.state !== 'waiting') {
        if (!c.inRoom) continue;
      }
      if (humansOnly || true) {
        if (c.inMatch || this.matchState.state === 'waiting' || this.matchState.state === 'countdown' || this.matchState.state === 'intermission') {
          if (!c.inRoom && !c.inMatch) continue;
          rows.push({
            playerId: c.playerId,
            name: c.name,
            kills: c.combat.kills,
            deaths: c.combat.deaths,
            kdRatio: this.kdRatio(c.combat.kills, c.combat.deaths),
            kdDisplay: this.kdDisplay(c.combat.kills, c.combat.deaths),
            damageDealt: c.combat.damageDealt,
            rank: 0,
            isNpc: false,
            isAlive: c.combat.isAlive,
          });
        }
      }
    }
    rows.sort((a, b) => {
      const aInf = a.kdRatio === Number.POSITIVE_INFINITY;
      const bInf = b.kdRatio === Number.POSITIVE_INFINITY;
      if (aInf && !bInf) return -1;
      if (bInf && !aInf) return 1;
      if (b.kdRatio !== a.kdRatio) return b.kdRatio - a.kdRatio;
      if (b.kills !== a.kills) return b.kills - a.kills;
      if (a.deaths !== b.deaths) return a.deaths - b.deaths;
      if (b.damageDealt !== a.damageDealt) return b.damageDealt - a.damageDealt;
      return a.name.localeCompare(b.name);
    });
    rows.forEach((r, i) => {
      r.rank = i + 1;
    });
    return rows;
  }

  private buildLiveScoreboard(): LiveScoreEntry[] {
    const rows: LiveScoreEntry[] = [];
    for (const c of this.clients.values()) {
      const kills = c.combat.kills || 0;
      const deaths = c.combat.deaths || 0;
      const damageDealt = c.combat.damageDealt || 0;
      rows.push({
        playerId: c.playerId,
        name: c.name,
        kills,
        deaths,
        damageDealt,
        score: kills * 100 + damageDealt,
        rank: 0,
      });
    }
    rows.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.kills !== a.kills) return b.kills - a.kills;
      if (a.deaths !== b.deaths) return a.deaths - b.deaths;
      return a.name.localeCompare(b.name);
    });
    rows.forEach((r, i) => {
      r.rank = i + 1;
    });
    return rows;
  }

  private recordPose(client: ConnectedClient) {
    const t = Date.now();
    client.poseHistory.push({ t, x: client.state.x, z: client.state.z });
    if (client.poseHistory.length > 16) client.poseHistory.splice(0, client.poseHistory.length - 16);
  }

  private poseAt(history: { t: number; x: number; z: number }[] | undefined, t: number, fallbackX: number, fallbackZ: number) {
    if (!history || history.length === 0) return { x: fallbackX, z: fallbackZ };
    if (t >= history[history.length - 1].t) return history[history.length - 1];
    if (t <= history[0].t) return history[0];
    for (let i = 1; i < history.length; i++) {
      if (history[i].t >= t) {
        const a = history[i - 1];
        const b = history[i];
        const u = (t - a.t) / Math.max(1, b.t - a.t);
        return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u };
      }
    }
    return history[history.length - 1];
  }

  private tryFireWeapon(
    client: ConnectedClient | undefined,
    shot?: {
      x: number;
      z: number;
      heading: number;
      mx?: number;
      mz?: number;
      clientTime?: number;
      lockTargetId?: string;
      weapon?: string;
    }
  ) {
    if (!client || !client.combat.isAlive) return;
    if (client.mode === 'battle_arena') {
      if (!client.inMatch || this.matchState.state !== 'active') return;
    }

    if (shot?.weapon && (client.combat.inventory[shot.weapon as WeaponType] || 0) > 0) {
      client.combat.weapon = shot.weapon as WeaponType;
      client.combat.ammo = client.combat.inventory[shot.weapon as WeaponType] || 0;
    }

    if (client.combat.weapon === 'pipe' || (client.combat.inventory.pipe || 0) > 0) {
      const pipeAmmo = client.combat.inventory.pipe || 0;
      delete client.combat.inventory.pipe;
      client.combat.inventory.shotgun = (client.combat.inventory.shotgun || 0) + pipeAmmo;
      if (client.combat.weapon === 'pipe' || client.combat.weapon === 'bat') client.combat.weapon = 'shotgun';
      client.combat.ammo = client.combat.inventory[client.combat.weapon || 'shotgun'] || 0;
    }
    const leftoverBat = client.combat.inventory.bat || 0;
    if (leftoverBat > 0) {
      client.combat.inventory.shotgun = (client.combat.inventory.shotgun || 0) + leftoverBat;
      delete client.combat.inventory.bat;
      if (client.combat.weapon === 'bat') client.combat.weapon = 'shotgun';
      client.combat.ammo = client.combat.inventory[client.combat.weapon || 'shotgun'] || 0;
    }
    const wType = client.combat.weapon;
    if (!wType) return;
    const ammo = client.combat.inventory[wType] || 0;
    if (ammo <= 0) {
      client.combat.weapon = null;
      client.combat.ammo = 0;
      return;
    }

    const wCfg = WEAPON_CONFIGS[wType];
    if (!wCfg) return;
    const now = Date.now();
    const last = client.lastFireByWeapon[wType] || 0;
    if (now - last < wCfg.cooldownMs) return;

    client.lastFireByWeapon[wType] = now;
    client.lastFireTime = now;
    const remaining = ammo - 1;
    client.combat.inventory[wType] = remaining;
    client.combat.ammo = remaining;
    if (remaining <= 0) {
      const next =
        STREET_WEAPON_ORDER.find(w => (client.combat.inventory[w] || 0) > 0) ||
        WEAPON_SLOT_ORDER.find(w => (client.combat.inventory[w] || 0) > 0) ||
        null;
      client.combat.weapon = next;
      client.combat.ammo = next ? client.combat.inventory[next] || 0 : 0;
    }
    client.state.combat = client.combat;
    this.handleWeaponFire(
      client,
      wType,
      shot?.x ?? client.state.x,
      shot?.z ?? client.state.z,
      shot?.heading ?? client.state.heading,
      shot?.mx,
      shot?.mz,
      shot?.clientTime,
      shot?.lockTargetId
    );
  }

  private dropStaleSessions() {
    const now = Date.now();
    for (const [id, client] of this.clients.entries()) {
      const deadSocket = client.ws.readyState !== WebSocket.OPEN && client.ws.readyState !== WebSocket.CONNECTING;
      const stale = now - client.lastHeartbeat > HEARTBEAT_TIMEOUT_MS && now - client.lastInputTime > STALE_SESSION_MS;
      if (deadSocket || stale) {
        this.clients.delete(id);
        this.broadcast({
          type: 'PLAYER_LEFT',
          playerId: id,
          presence: this.buildPresence(),
        });
      }
    }
  }

  private resetPlayerCombat(client: ConnectedClient, resetStats: boolean) {
    client.combat.health = 100;
    client.combat.maxHealth = 100;
    client.combat.vehicleHealth = 100;
    client.combat.shield = 25;
    client.combat.weapon = null;
    client.combat.ammo = 0;
    client.combat.inventory = {};
    client.combat.isAlive = true;
    client.combat.invulnerableUntil = Date.now() + 3500;
    client.combat.respawnAt = 0;
    client.combat.empUntil = 0;
    client.combat.oilUntil = 0;
    client.combat.speedPenaltyUntil = 0;
    client.combat.boostUntil = 0;
    client.combat.boostCooldownUntil = 0;
    client.combat.dodgeCooldownUntil = 0;
    if (resetStats) {
      client.combat.kills = 0;
      client.combat.deaths = 0;
      client.combat.damageDealt = 0;
    }
    client.lastFireByWeapon = {};
    client.state.combat = client.combat;
  }

  private checkStartArenaMatch() {
    const ready = this.roomClients();
    if (ready.length >= 1 && this.matchState.state === 'waiting') {
      this.startArenaMatchCountdown();
    }
  }

  private lockMatchParticipants() {
    let spIdx = 0;
    for (const c of this.clients.values()) {
      if (!c.inRoom) {
        c.inMatch = false;
        c.waitingForRound = false;
        c.state.inMatch = false;
        c.state.waitingForRound = false;
        continue;
      }
      c.inMatch = true;
      c.waitingForRound = false;
      c.state.inMatch = true;
      c.state.waitingForRound = false;
      const sp = ARENA_SPAWNS[spIdx % ARENA_SPAWNS.length];
      spIdx++;
      c.state.x = sp.x;
      c.state.z = sp.z;
      c.state.heading = sp.heading;
      c.state.speed = 0;
      this.resetPlayerCombat(c, true);
    }

    for (const b of this.arenaBots.values()) {
      const sp = ARENA_SPAWNS[spIdx % ARENA_SPAWNS.length];
      spIdx++;
      b.state.x = sp.x;
      b.state.z = sp.z;
      b.state.heading = sp.heading;
      b.state.speed = 0;
      b.combat.health = 100;
      b.combat.maxHealth = 100;
      b.combat.vehicleHealth = 100;
      b.combat.shield = 25;
      b.combat.weapon = 'machinegun';
      b.combat.ammo = 18;
      b.combat.inventory = { machinegun: 18 };
      b.combat.kills = 0;
      b.combat.deaths = 0;
      b.combat.damageDealt = 0;
      b.combat.isAlive = true;
      b.combat.invulnerableUntil = Date.now() + 3500;
      b.combat.empUntil = 0;
      b.combat.oilUntil = 0;
      b.state.combat = b.combat;
    }
  }

  private startArenaMatchCountdown() {
    this.matchState.state = 'countdown';
    this.matchCountdownTimer = MATCH_COUNTDOWN_SEC;
    this.phaseTimerSec = MATCH_COUNTDOWN_SEC;
    this.matchId = `match_${Date.now()}`;
    this.rewardedMatchId = null;
    this.matchState.matchId = this.matchId;
    this.matchState.announcement = `MATCH STARTING IN ${MATCH_COUNTDOWN_SEC}...`;
    this.matchState.winnerId = undefined;
    this.matchState.winnerName = undefined;
    this.matchState.sharedVictory = false;
    this.lastMinuteAnnounced = false;
    this.lastAliveAnnounced = -1;
    this.projectiles.clear();
    this.hazards.clear();
    this.initArenaCrates(true);
    this.lockMatchParticipants();
    this.updateArenaPlayerCounts();

    this.broadcast({
      type: 'MATCH_STATE_CHANGE',
      matchState: this.getPublicMatchState(),
      presence: this.buildPresence(),
      announcement: this.matchState.announcement,
    });
  }

  private beginActiveMatch() {
    this.matchState.state = 'active';
    this.matchClockSec = MATCH_DURATION_SEC;
    this.matchState.timerSec = MATCH_DURATION_SEC;
    this.matchState.announcement = 'MATCH STARTED!';
    this.updateArenaPlayerCounts();
    this.broadcast({
      type: 'MATCH_STARTED',
      matchState: this.getPublicMatchState(),
      presence: this.buildPresence(),
      announcement: 'MATCH STARTED!',
    });
  }

  private finishMatch() {
    this.matchState.state = 'finished';
    this.projectiles.clear();
    const board = this.buildLeaderboard(true).filter(r => !r.isNpc && this.clients.get(r.playerId)?.inMatch);
    this.matchState.leaderboard = board;

    let winners = board.filter(r => r.rank === 1);
    if (board.length >= 2) {
      const top = board[0];
      winners = board.filter(r =>
        r.kdRatio === top.kdRatio &&
        r.kills === top.kills &&
        r.deaths === top.deaths &&
        r.damageDealt === top.damageDealt
      );
    }

    this.matchState.sharedVictory = winners.length > 1;
    this.matchState.winnerId = winners[0]?.playerId;
    this.matchState.winnerName = winners.length
      ? winners.map(w => w.name).join(' & ')
      : 'No Contest';
    this.matchState.announcement = winners.length ? 'WE HAVE A WINNER!' : 'MATCH FINISHED';

    this.grantMatchRewards(board);
    this.broadcast({
      type: 'MATCH_FINISHED',
      matchState: this.getPublicMatchState(),
      presence: this.buildPresence(),
      announcement: this.matchState.announcement,
    });

    this.matchState.state = 'celebration';
    this.phaseTimerSec = MATCH_CELEBRATION_SEC;
    this.matchState.timerSec = MATCH_CELEBRATION_SEC;
    this.broadcast({
      type: 'WINNER_CELEBRATION',
      matchState: this.getPublicMatchState(),
      presence: this.buildPresence(),
    });
  }

  private grantMatchRewards(board: MatchLeaderboardEntry[]) {
    if (this.rewardedMatchId === this.matchId) return;
    this.rewardedMatchId = this.matchId;
    const now = Date.now();
    for (const row of board) {
      const c = this.clients.get(row.playerId);
      if (!c) continue;
      const isWin = row.rank === 1;
      const topThree = row.rank <= 3;
      const rewardCash = 400 + row.kills * 250 + (isWin ? 5000 : topThree ? 2000 : 0);
      const rewardXp = 80 + row.kills * 40 + (isWin ? 600 : topThree ? 250 : 0);
      row.rewardCash = rewardCash;
      row.rewardXp = rewardXp;
      storage.recordBattleRewards(
        c.playerId,
        this.matchId,
        `auto_${this.matchId}_${c.playerId}`,
        row.kills,
        row.damageDealt,
        row.rank,
        rewardCash,
        rewardXp,
        isWin
      );
    }
    void now;
  }

  private startIntermission() {
    this.matchState.state = 'intermission';
    this.phaseTimerSec = MATCH_INTERMISSION_SEC;
    this.matchState.timerSec = MATCH_INTERMISSION_SEC;
    this.matchState.announcement = 'NEXT MATCH STARTING SOON';
    this.broadcast({
      type: 'MATCH_INTERMISSION',
      matchState: this.getPublicMatchState(),
      presence: this.buildPresence(),
    });
  }

  private updateArenaPlayerCounts() {
    const humans = this.matchClients();
    const humanAlive = humans.filter(c => c.combat.isAlive).length;
    this.matchState.totalPlayers = humans.length;
    this.matchState.playersAlive = humanAlive;
    this.matchState.presence = this.buildPresence();
    this.matchState.leaderboard = this.buildLeaderboard(true);

    if (
      this.matchState.state === 'active' &&
      humanAlive !== this.lastAliveAnnounced &&
      this.lastAliveAnnounced !== -1 &&
      humanAlive >= 0
    ) {
      this.matchState.announcement = `${humanAlive} PLAYERS REMAINING`;
    }
    this.lastAliveAnnounced = humanAlive;
  }

  private seedWorldPickups() {
    this.worldPickups = WORLD_WEAPON_SPAWNS.map((spot, slot) => ({
      id: `spawn_${slot}`,
      slot,
      weapon: STREET_WORLD_SPAWN_MIX[slot % STREET_WORLD_SPAWN_MIX.length],
      x: spot.x,
      y: 0.08,
      z: spot.z,
      active: false,
      respawnAt: 0,
    }));
    const order = [...this.worldPickups.keys()].sort(() => Math.random() - 0.5);
    let on = 0;
    for (const idx of order) {
      if (on >= MAX_WORLD_PICKUPS) break;
      this.worldPickups[idx].active = true;
      on++;
    }
    this.nextWorldSpawnSec = WORLD_SPAWN_MIN_SEC + Math.random() * (WORLD_SPAWN_MAX_SEC - WORLD_SPAWN_MIN_SEC);
  }

  private activePickupCount() {
    return this.worldPickups.filter(p => p.active).length;
  }

  private slotOccupied(p: WorldWeaponPickup) {
    return (
      Array.from(this.clients.values()).some(c => {
        const dx = c.state.x - p.x;
        const dz = c.state.z - p.z;
        return dx * dx + dz * dz < 9;
      }) ||
      Array.from(this.bots.values()).some(b => {
        const dx = b.x - p.x;
        const dz = b.z - p.z;
        return dx * dx + dz * dz < 9;
      })
    );
  }

  private activatePickupSlot(p: WorldWeaponPickup) {
    if (p.active) return false;
    if (this.activePickupCount() >= MAX_WORLD_PICKUPS) return false;
    if (this.slotOccupied(p)) return false;
    p.active = true;
    p.respawnAt = 0;
    this.broadcast({ type: 'WORLD_WEAPON_SPAWNED', pickup: { ...p } });
    return true;
  }

  private spawnWorldPickup(): WorldWeaponPickup | null {
    const idle = this.worldPickups.filter(p => !p.active && p.respawnAt === 0);
    if (!idle.length) return null;
    const pick = idle[Math.floor(Math.random() * idle.length)];
    return this.activatePickupSlot(pick) ? pick : null;
  }

  private updateWorldPickups(dt: number) {
    const now = Date.now();
    for (const p of this.worldPickups) {
      if (!p.active && p.respawnAt > 0 && now >= p.respawnAt) {
        this.activatePickupSlot(p);
      }
    }
    this.nextWorldSpawnSec -= dt;
    if (this.nextWorldSpawnSec <= 0) {
      this.spawnWorldPickup();
      this.nextWorldSpawnSec = WORLD_SPAWN_MIN_SEC + Math.random() * (WORLD_SPAWN_MAX_SEC - WORLD_SPAWN_MIN_SEC);
    }
  }

  private tryCollectWorldPickup(
    collector: { combat: PlayerCombatState; state: PlayerServerState; playerId?: string; ws?: WebSocket },
    pickupId?: string,
    hintX?: number,
    hintZ?: number,
    trustClientId = false
  ) {
    const points = [
      { x: collector.state.x, z: collector.state.z },
      ...(hintX !== undefined && hintZ !== undefined ? [{ x: hintX, z: hintZ }] : []),
    ];
    let best: WorldWeaponPickup | undefined;
    let bestD = 8 * 8;
    for (const p of this.worldPickups) {
      if (!p.active) continue;
      if (pickupId && p.id !== pickupId) continue;
      if (trustClientId && pickupId && p.id === pickupId) {
        best = p;
        bestD = 0;
        break;
      }
      for (const pt of points) {
        const dx = p.x - pt.x;
        const dz = p.z - pt.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD) {
          bestD = d2;
          best = p;
        }
      }
    }
    if (!best) return false;
    if (this.pickupLocks.has(best.id)) return false;
    this.pickupLocks.add(best.id);
    best.active = false;
    best.respawnAt = Date.now() + WORLD_SLOT_RESPAWN_SEC * 1000;
    const ammo = WEAPON_CONFIGS[best.weapon].ammo;
    collector.combat.inventory[best.weapon] = (collector.combat.inventory[best.weapon] || 0) + ammo;
    collector.combat.weapon = best.weapon;
    collector.combat.ammo = collector.combat.inventory[best.weapon] || ammo;
    collector.state.combat = collector.combat;
    const pid = collector.playerId || collector.state.id;
    this.broadcast({
      type: 'WORLD_WEAPON_COLLECTED',
      pickupId: best.id,
      collectorId: pid,
      weapon: best.weapon,
      ammo: collector.combat.ammo,
      inventory: collector.combat.inventory,
      respawnAt: best.respawnAt,
    });
    setTimeout(() => this.pickupLocks.delete(best!.id), 80);
    return true;
  }

  private applyForwardCone(
    attackerId: string,
    attackerName: string,
    x: number,
    z: number,
    heading: number,
    range: number,
    damage: number,
    wType: WeaponType,
    minDot = 0.2,
    rewindAt?: number
  ) {
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const when = rewindAt || Date.now() - 90;
    for (const c of this.clients.values()) {
      if (c.playerId === attackerId || !c.combat.isAlive) continue;
      const pose = this.poseAt(c.poseHistory, when, c.state.x, c.state.z);
      const dx = pose.x - x;
      const dz = pose.z - z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > range || dist < 0.05) continue;
      const dot = (dx * fx + dz * fz) / dist;
      if (dot < minDot) continue;
      const scaled =
        wType === 'kangri' ? damage : Math.round(damage * (0.55 + 0.45 * (1 - dist / range)));
      this.dealDamageToPlayer(c, scaled, attackerId, attackerName, wType, c.state.x, c.state.z);
      if (wType === 'kangri') {
        c.combat.speedPenaltyUntil = Date.now() + 2800;
      }
    }
    for (const b of this.arenaBots.values()) {
      if (!b.combat.isAlive || b.state.id === attackerId) continue;
      const dx = b.state.x - x;
      const dz = b.state.z - z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > range || dist < 0.05) continue;
      const dot = (dx * fx + dz * fz) / dist;
      if (dot < minDot) continue;
      const scaled =
        wType === 'kangri' ? damage : Math.round(damage * (0.55 + 0.45 * (1 - dist / range)));
      this.dealDamageToBot(b, scaled, attackerId, attackerName, wType, b.state.x, b.state.z);
      if (wType === 'kangri') {
        b.combat.speedPenaltyUntil = Date.now() + 2800;
      }
    }
    for (const bot of this.bots.values()) {
      if (!bot.combat?.isAlive || bot.id === attackerId) continue;
      const dx = bot.x - x;
      const dz = bot.z - z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > range || dist < 0.05) continue;
      const dot = (dx * fx + dz * fz) / dist;
      if (dot < minDot) continue;
      const scaled =
        wType === 'kangri' ? damage : Math.round(damage * (0.55 + 0.45 * (1 - dist / range)));
      this.hurtRoadBot(bot, scaled, attackerId, attackerName, wType);
    }
  }

  private hullDamage(wType: WeaponType | 'ram', amount: number) {
    if (wType === 'ram') return amount;
    if (wType === 'kangri') return 50;
    return Math.round(amount * (VEHICLE_DAMAGE_MULT[wType] ?? 1));
  }

  private ramDamageForSpeed(speed: number) {
    const s = Math.min(Math.abs(speed), 45);
    if (s < 2.2) return 0;
    return Math.min(58, Math.round(6 + (s - 2.2) * 1.4));
  }

  private resolveRam(client: ConnectedClient, targetId: string, speed: number, x: number, z: number) {
    if (!client.combat.isAlive) return;
    if (!targetId || targetId === client.playerId) return;
    if (!Number.isFinite(speed) || !Number.isFinite(x) || !Number.isFinite(z)) return;

    const maxSpeed = (VEHICLE_CONFIGS[client.vehicle]?.maxSpeed ?? 40) + 30;
    const impact = this.ramDamageForSpeed(Math.min(Math.abs(speed), maxSpeed));
    if (impact <= 0) return;

    const now = Date.now();
    const human = this.clients.get(targetId);
    const arena = this.arenaBots.get(targetId);
    const road = this.bots.get(targetId);

    let tx = NaN;
    let tz = NaN;
    let kind: 'player' | 'arena' | 'road' | null = null;
    if (human?.combat.isAlive) {
      tx = human.state.x;
      tz = human.state.z;
      kind = 'player';
    } else if (arena?.combat.isAlive) {
      tx = arena.state.x;
      tz = arena.state.z;
      kind = 'arena';
    } else if (road && road.combat?.isAlive !== false) {
      tx = road.x;
      tz = road.z;
      kind = 'road';
    }
    if (!kind || Math.hypot(x - tx, z - tz) > 18) return;

    const victimInvuln = human
      ? human.combat.invulnerableUntil
      : arena
        ? arena.combat.invulnerableUntil
        : road?.combat?.invulnerableUntil || 0;
    if (now < victimInvuln) return;

    const key = `${client.playerId}:${targetId}`;
    if (now - (this.ramCooldown.get(key) || 0) < 650) return;
    this.ramCooldown.set(key, now);

    if (kind === 'player' && human) {
      this.dealDamageToPlayer(human, impact, client.playerId, client.name, 'ram', human.state.x, human.state.z, true);
      human.state.combat = human.combat;
    } else if (kind === 'arena' && arena) {
      this.dealDamageToBot(arena, impact, client.playerId, client.name, 'ram', arena.state.x, arena.state.z, true);
      arena.state.combat = arena.combat;
    } else if (kind === 'road' && road) {
      this.hurtRoadBot(road, impact, client.playerId, client.name, 'ram');
    }

    const selfDamage = Math.max(4, Math.round(impact * 0.5));
    this.dealDamageToPlayer(client, selfDamage, client.playerId, client.name, 'ram', client.state.x, client.state.z, true);
    client.state.combat = client.combat;
  }

  private hurtRoadBot(bot: PlayerServerState, amount: number, attackerId: string, attackerName: string, wType: WeaponType | 'ram') {
    if (!bot.combat) bot.combat = this.createCombatState();
    if (Date.now() < bot.combat.invulnerableUntil) return;
    bot.combat.health = Math.max(0, bot.combat.health - amount);
    bot.combat.vehicleHealth = Math.max(0, (bot.combat.vehicleHealth ?? 100) - this.hullDamage(wType, amount));
    const attacker = this.clients.get(attackerId);
    if (attacker && attacker.playerId !== bot.id) attacker.combat.damageDealt += amount;
    const dead = bot.combat.health <= 0 || bot.combat.vehicleHealth <= 0;
    if (dead) {
      bot.combat.health = 0;
      bot.combat.vehicleHealth = 0;
      bot.combat.isAlive = false;
      bot.speed = 0;
      bot.combat.respawnAt = Date.now() + 5000;
    }
    this.broadcast({
      type: 'DAMAGE_EVENT',
      event: {
        id: `dmg_${Date.now()}`,
        attackerId,
        attackerName,
        victimId: bot.id,
        victimName: bot.name,
        amount,
        weaponType: wType,
        x: bot.x,
        y: 1,
        z: bot.z,
        isElimination: dead,
        timestamp: Date.now(),
      },
    });
    if (dead) {
      if (attacker) attacker.combat.kills += 1;
      this.broadcast({
        type: 'PLAYER_ELIMINATED',
        attackerId,
        attackerName,
        victimId: bot.id,
        victimName: bot.name,
        weaponType: wType,
      });
    }
  }

  private recycleRoadBot(bot: PlayerServerState, fromZ?: number) {
    const northbound = Math.random() > 0.5;
    bot.heading = northbound ? 0 : Math.PI;
    bot.x = northbound ? -3.5 : 3.5;
    if (typeof fromZ === 'number' && Number.isFinite(fromZ)) {
      bot.z = fromZ + (northbound ? 50 : -50) + (Math.random() - 0.5) * 24;
    } else {
      bot.z = -360 + Math.random() * 720;
    }
    bot.z = Math.max(-400, Math.min(390, bot.z));
    bot.speed = 8.5 + Math.random() * 3;
    bot.y = 0;
    bot.combat = this.createCombatState({ shield: 0 });
    bot.combat.invulnerableUntil = Date.now() + 1200;
  }

  private applyHitscan(
    attackerId: string,
    attackerName: string,
    x: number,
    z: number,
    heading: number,
    range: number,
    damage: number,
    wType: WeaponType,
    radius = 3.2,
    rewindAt?: number
  ) {
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    let bestDist = range;
    let hitPlayer: ConnectedClient | undefined;
    let hitArena: { state: PlayerServerState; combat: PlayerCombatState } | undefined;
    let hitRoad: PlayerServerState | undefined;
    const when = rewindAt || Date.now() - 90;

    for (const c of this.clients.values()) {
      if (c.playerId === attackerId || !c.combat.isAlive) continue;
      const pose = this.poseAt(c.poseHistory, when, c.state.x, c.state.z);
      const dx = pose.x - x;
      const dz = pose.z - z;
      const along = dx * fx + dz * fz;
      if (along < -1.8 || along > range) continue;
      const perp = Math.abs(dx * fz - dz * fx);
      if (perp > radius) continue;
      if (along < bestDist) {
        bestDist = along;
        hitPlayer = c;
        hitArena = undefined;
        hitRoad = undefined;
      }
    }
    for (const b of this.arenaBots.values()) {
      if (!b.combat.isAlive || b.state.id === attackerId) continue;
      const dx = b.state.x - x;
      const dz = b.state.z - z;
      const along = dx * fx + dz * fz;
      if (along < -1.8 || along > range) continue;
      const perp = Math.abs(dx * fz - dz * fx);
      if (perp > radius) continue;
      if (along < bestDist) {
        bestDist = along;
        hitPlayer = undefined;
        hitArena = b;
        hitRoad = undefined;
      }
    }
    for (const bot of this.bots.values()) {
      if (!bot.combat?.isAlive || bot.id === attackerId) continue;
      const dx = bot.x - x;
      const dz = bot.z - z;
      const along = dx * fx + dz * fz;
      if (along < -1.8 || along > range) continue;
      const perp = Math.abs(dx * fz - dz * fx);
      if (perp > radius) continue;
      if (along < bestDist) {
        bestDist = along;
        hitPlayer = undefined;
        hitArena = undefined;
        hitRoad = bot;
      }
    }

    if (hitPlayer) {
      this.dealDamageToPlayer(hitPlayer, damage, attackerId, attackerName, wType, hitPlayer.state.x, hitPlayer.state.z);
    } else if (hitArena) {
      this.dealDamageToBot(hitArena, damage, attackerId, attackerName, wType, hitArena.state.x, hitArena.state.z);
    } else if (hitRoad) {
      this.hurtRoadBot(hitRoad, damage, attackerId, attackerName, wType);
    }
  }

  private handleWeaponFire(
    attacker: ConnectedClient,
    wType: WeaponType,
    originX: number,
    originZ: number,
    heading: number,
    muzzleOverrideX?: number,
    muzzleOverrideZ?: number,
    clientTime?: number,
    lockTargetId?: string
  ) {
    const now = Date.now();
    const forwardX = Math.sin(heading);
    const forwardZ = Math.cos(heading);
    const muzzleFar =
      typeof muzzleOverrideX === 'number' &&
      typeof muzzleOverrideZ === 'number' &&
      Math.hypot(muzzleOverrideX - originX, muzzleOverrideZ - originZ) > 8;
    const muzzleX = !muzzleFar && typeof muzzleOverrideX === 'number' ? muzzleOverrideX : originX + forwardX * 2.2;
    const muzzleZ = !muzzleFar && typeof muzzleOverrideZ === 'number' ? muzzleOverrideZ : originZ + forwardZ * 2.2;
    const scanX = originX;
    const scanZ = originZ;
    const lag = Number.isFinite(clientTime) ? now - (clientTime as number) : 90;
    const rewindAt = now - Math.max(40, Math.min(180, lag));

    switch (wType) {
      case 'bat':
      case 'pipe': {
        const range = (WEAPON_CONFIGS[wType].range || 3.4) + 1.2;
        this.applyForwardCone(attacker.playerId, attacker.name, originX, originZ, heading, range, WEAPON_CONFIGS[wType].damage, wType);
        break;
      }
      case 'kangri': {
        const range = 14.5;
        this.applyForwardCone(
          attacker.playerId,
          attacker.name,
          scanX,
          scanZ,
          heading,
          range,
          WEAPON_CONFIGS.kangri.damage,
          wType,
          0.55,
          rewindAt
        );
        this.broadcast({
          type: 'COMBAT_EFFECT',
          effect: 'kangri_burst',
          playerId: attacker.playerId,
          x: muzzleX,
          z: muzzleZ,
          heading,
          radius: 4.5,
        });
        break;
      }
      case 'pistol':
      case 'rifle': {
        const cfg = WEAPON_CONFIGS[wType];
        this.applyHitscan(
          attacker.playerId,
          attacker.name,
          scanX,
          scanZ,
          heading,
          cfg.range || 28,
          cfg.damage,
          wType,
          wType === 'rifle' ? 6.2 : 6.8,
          rewindAt
        );
        break;
      }
      case 'shotgun': {
        const pellets = [-0.22, -0.11, 0, 0.11, 0.22];
        const pelletDmg = [6, 5, 6, 5, 6];
        pellets.forEach((ang, i) => {
          this.applyHitscan(
            attacker.playerId,
            attacker.name,
            scanX,
            scanZ,
            heading + ang,
            WEAPON_CONFIGS.shotgun.range || 16,
            pelletDmg[i],
            'shotgun',
            3.8,
            rewindAt
          );
        });
        break;
      }
      case 'machinegun': {
        this.applyHitscan(
          attacker.playerId,
          attacker.name,
          scanX,
          scanZ,
          heading,
          38,
          WEAPON_CONFIGS.machinegun.damage,
          'machinegun',
          6.2,
          rewindAt
        );
        break;
      }

      case 'rocket': {
        const id = `proj_${now}_${Math.random().toString(36).substring(2, 6)}`;
        const proj: ArenaProjectileState = {
          id,
          weaponType: 'rocket',
          ownerId: attacker.playerId,
          ownerName: attacker.name,
          x: muzzleX,
          y: 0.7,
          z: muzzleZ,
          vx: forwardX * 48.0,
          vy: 0,
          vz: forwardZ * 48.0,
          heading,
          spawnTime: now,
          lifeTimeSec: 2.5,
        };
        this.projectiles.set(id, proj);
        break;
      }

      case 'grenade': {
        const id = `proj_${now}_${Math.random().toString(36).substring(2, 6)}`;
        const proj: ArenaProjectileState = {
          id,
          weaponType: 'grenade',
          ownerId: attacker.playerId,
          ownerName: attacker.name,
          x: muzzleX,
          y: 0.9,
          z: muzzleZ,
          vx: forwardX * 30.0,
          vy: 6.5,
          vz: forwardZ * 30.0,
          heading,
          spawnTime: now,
          lifeTimeSec: 1.8,
        };
        this.projectiles.set(id, proj);
        break;
      }

      case 'firecracker': {
        // 5 spread rockets
        const spreadAngles = [-0.3, -0.15, 0, 0.15, 0.3];
        spreadAngles.forEach((ang, idx) => {
          const h = heading + ang;
          const id = `proj_${now}_${idx}_${Math.random().toString(36).substring(2, 6)}`;
          const proj: ArenaProjectileState = {
            id,
            weaponType: 'firecracker',
            ownerId: attacker.playerId,
            ownerName: attacker.name,
            x: muzzleX,
            y: 0.7,
            z: muzzleZ,
            vx: Math.sin(h) * 42.0,
            vy: (Math.random() - 0.5) * 1.5,
            vz: Math.cos(h) * 42.0,
            heading: h,
            spawnTime: now,
            lifeTimeSec: 1.4,
          };
          this.projectiles.set(id, proj);
        });
        break;
      }

      case 'emp': {
        // Instant area disabler dome
        const empRadius = 14.0;
    this.broadcast({
      type: 'COMBAT_EFFECT',
      effect: 'emp_shockwave',
      playerId: attacker.playerId,
      x: originX,
      z: originZ,
      radius: empRadius,
    });

        // Apply EMP disable to nearby opponents
        this.applyEmpEffect(attacker.playerId, originX, originZ, empRadius);
        break;
      }

      case 'oil': {
        const id = `haz_${now}_${Math.random().toString(36).substring(2, 6)}`;
        const haz: ArenaHazardState = {
          id,
          type: 'oil',
          ownerId: attacker.playerId,
          x: originX - forwardX * 2.2,
          z: originZ - forwardZ * 2.2,
          heading,
          expiresAt: now + 15000,
        };
        this.hazards.set(id, haz);
        break;
      }

      case 'spike': {
        const id = `haz_${now}_${Math.random().toString(36).substring(2, 6)}`;
        const haz: ArenaHazardState = {
          id,
          type: 'spike',
          ownerId: attacker.playerId,
          x: originX - forwardX * 2.0,
          z: originZ - forwardZ * 2.0,
          heading,
          expiresAt: now + 16000,
        };
        this.hazards.set(id, haz);
        break;
      }

      case 'homing': {
        let targetId: string | undefined = undefined;
        const claimed = lockTargetId;
        if (claimed) {
          const human = this.clients.get(claimed);
          if (human && human.playerId !== attacker.playerId && human.combat.isAlive) targetId = claimed;
          else if (this.arenaBots.get(claimed)?.combat.isAlive) targetId = claimed;
          else if (this.bots.get(claimed)?.combat?.isAlive) targetId = claimed;
        }
        let bestDist = 80.0;
        if (!targetId) {
          for (const c of this.clients.values()) {
            if (c.playerId === attacker.playerId || !c.combat.isAlive) continue;
            const dx = c.state.x - originX;
            const dz = c.state.z - originZ;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist < bestDist) {
              const dot = dist > 0.01 ? (dx * forwardX + dz * forwardZ) / dist : 0;
              if (dot > 0.5) {
                bestDist = dist;
                targetId = c.playerId;
              }
            }
          }
          for (const b of this.arenaBots.values()) {
            if (!b.combat.isAlive) continue;
            const dx = b.state.x - originX;
            const dz = b.state.z - originZ;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist < bestDist) {
              const dot = dist > 0.01 ? (dx * forwardX + dz * forwardZ) / dist : 0;
              if (dot > 0.5) {
                bestDist = dist;
                targetId = b.state.id;
              }
            }
          }
          for (const bot of this.bots.values()) {
            if (!bot.combat?.isAlive) continue;
            const dx = bot.x - originX;
            const dz = bot.z - originZ;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist < bestDist) {
              const dot = dist > 0.01 ? (dx * forwardX + dz * forwardZ) / dist : 0;
              if (dot > 0.5) {
                bestDist = dist;
                targetId = bot.id;
              }
            }
          }
        }

        const id = `proj_${now}_${Math.random().toString(36).substring(2, 6)}`;
        const proj: ArenaProjectileState = {
          id,
          weaponType: 'homing',
          ownerId: attacker.playerId,
          ownerName: attacker.name,
          x: muzzleX,
          y: 0.8,
          z: muzzleZ,
          vx: forwardX * 38.0,
          vy: 0,
          vz: forwardZ * 38.0,
          heading,
          targetId,
          spawnTime: now,
          lifeTimeSec: 4.2,
        };
        this.projectiles.set(id, proj);

        // Warn targeted player
        if (targetId) {
          const targetClient = this.clients.get(targetId);
          if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
            targetClient.ws.send(JSON.stringify({
              type: 'MISSILE_WARNING',
              attackerName: attacker.name,
            }));
          }
        }
        break;
      }
    }

    this.broadcast({
      type: 'WEAPON_FIRED',
      ownerId: attacker.playerId,
      weaponType: wType,
      x: originX,
      z: originZ,
      mx: muzzleX,
      mz: muzzleZ,
      heading,
    });
  }

  private applyEmpEffect(attackerId: string, x: number, z: number, radius: number) {
    const now = Date.now();
    for (const c of this.clients.values()) {
      if (c.playerId === attackerId || !c.inMatch || !c.combat.isAlive) continue;
      const dx = c.state.x - x;
      const dz = c.state.z - z;
      if (dx * dx + dz * dz <= radius * radius) {
        c.combat.empUntil = now + 2500;
        c.state.speed *= 0.2;
      }
    }
    for (const b of this.arenaBots.values()) {
      if (b.state.id === attackerId || !b.combat.isAlive) continue;
      const dx = b.state.x - x;
      const dz = b.state.z - z;
      if (dx * dx + dz * dz <= radius * radius) {
        b.combat.empUntil = now + 2500;
        b.state.speed *= 0.2;
      }
    }
  }

  private getRandomWeapon(): WeaponType {
    const rand = Math.random() * 100;
    let accum = 0;
    const types: WeaponType[] = ['machinegun', 'rocket', 'grenade', 'oil', 'emp', 'spike', 'firecracker', 'homing'];
    for (const t of types) {
      accum += WEAPON_CONFIGS[t].dropProbability;
      if (rand <= accum) return t;
    }
    return 'machinegun';
  }

  private advanceMatchLifecycle(dt: number) {
    if (this.matchState.state === 'countdown') {
      this.matchCountdownTimer -= dt;
      this.phaseTimerSec = this.matchCountdownTimer;
      this.matchState.timerSec = Math.max(0, Math.ceil(this.matchCountdownTimer));
      this.matchState.announcement = `MATCH STARTING IN ${Math.max(0, Math.ceil(this.matchCountdownTimer))}...`;
      if (this.matchCountdownTimer <= 0) {
        this.beginActiveMatch();
      }
      return;
    }

    if (this.matchState.state === 'active') {
      this.matchClockSec = Math.max(0, this.matchClockSec - dt);
      this.matchState.timerSec = Math.ceil(this.matchClockSec);
      this.updateArenaPlayerCounts();

      if (!this.lastMinuteAnnounced && this.matchClockSec <= 60 && this.matchClockSec > 0) {
        this.lastMinuteAnnounced = true;
        this.matchState.announcement = '1 MINUTE LEFT!';
        this.broadcast({
          type: 'MATCH_ANNOUNCEMENT',
          announcement: '1 MINUTE LEFT!',
          matchState: this.getPublicMatchState(),
        });
      }

      if (this.matchClockSec <= 0) {
        this.finishMatch();
      }
      return;
    }

    if (this.matchState.state === 'finished' || this.matchState.state === 'celebration') {
      this.phaseTimerSec -= dt;
      this.matchState.timerSec = Math.max(0, Math.ceil(this.phaseTimerSec));
      if (this.phaseTimerSec <= 0) {
        this.startIntermission();
      }
      return;
    }

    if (this.matchState.state === 'intermission') {
      this.phaseTimerSec -= dt;
      this.matchState.timerSec = Math.max(0, Math.ceil(this.phaseTimerSec));
      this.matchState.announcement = 'NEXT MATCH STARTING SOON';
      if (this.phaseTimerSec <= 0) {
        if (this.roomClients().length >= 1) {
          this.startArenaMatchCountdown();
        } else {
          this.matchState.state = 'waiting';
          this.matchState.announcement = 'WAITING FOR PLAYERS';
          this.matchState.timerSec = MATCH_COUNTDOWN_SEC;
          this.broadcast({
            type: 'MATCH_STATE_CHANGE',
            matchState: this.getPublicMatchState(),
            presence: this.buildPresence(),
          });
        }
      }
    }
  }

  private simulationTick(dt: number) {
    const now = Date.now();

    // 1. Arena Match Lifecycle State Machine
    this.advanceMatchLifecycle(dt);
    this.updateWorldPickups(dt);

    // 2. Simulate Connected Clients
    for (const [id, client] of this.clients.entries()) {
      const cfg = VEHICLE_CONFIGS[client.vehicle] || VEHICLE_CONFIGS.auto;
      let lastProcessedSeq = client.state.lastAckSeq;

      // Check status effects
      const isEmpActive = now < client.combat.empUntil;
      const isOilActive = now < client.combat.oilUntil;
      const isSpeedPenalized = now < client.combat.speedPenaltyUntil;
      const isBoostActive = now < client.combat.boostUntil;

      while (client.inputQueue.length > 0) {
        const inp = client.inputQueue.shift()!;
        if (inp.seq <= lastProcessedSeq) continue;
        lastProcessedSeq = inp.seq;

        if (!client.combat.isAlive) {
          client.state.speed *= 0.9;
          continue;
        }

        let steer = Math.max(-1, Math.min(1, inp.steer || 0));
        let throttle = Math.max(0, Math.min(1, inp.throttle || 0));
        let brake = Math.max(0, Math.min(1, inp.brake || 0));
        const handbrake = !!inp.handbrake;

        if (isEmpActive) {
          steer = 0;
          throttle = 0;
        }
        if (isOilActive) {
          steer += Math.sin(now * 0.01) * 0.8; // spin out
        }

        let accel = 0;
        if (throttle > 0) {
          let aMult = isBoostActive ? 1.8 : 1.0;
          if (isSpeedPenalized) aMult *= 0.5;
          accel += cfg.acceleration * throttle * aMult;
        }
        if (brake > 0) {
          if (client.state.speed > 1.4) {
            accel -= cfg.brakeForce * brake;
          } else {
            accel -= cfg.acceleration * 1.15 * brake;
          }
        }
        if (handbrake) {
          accel -= cfg.brakeForce * 1.5;
        }

        const drag = 0.45 * client.state.speed;
        client.state.speed += (accel - drag) * dt;

        let maxSpeed = cfg.maxSpeed;
        if (isBoostActive) maxSpeed += 16.0;
        if (isSpeedPenalized) maxSpeed *= 0.5;

        client.state.speed = Math.max(-cfg.reverseSpeed, Math.min(maxSpeed, client.state.speed));

        const steerAngle = steer * 0.45;
        client.state.steerAngle = steerAngle;
        const turnRate = cfg.turnSpeed * steer * Math.max(-1, Math.min(1, client.state.speed / 4.0));
        client.state.heading += turnRate * dt;

        client.state.x += Math.sin(client.state.heading) * client.state.speed * dt;
        client.state.z += Math.cos(client.state.heading) * client.state.speed * dt;

        // Boundaries check
        if (client.mode === 'battle_arena') {
          if (client.state.x < ARENA_BOUNDS.MIN_X) {
            client.state.x = ARENA_BOUNDS.MIN_X;
            client.state.speed = -client.state.speed * 0.35;
          } else if (client.state.x > ARENA_BOUNDS.MAX_X) {
            client.state.x = ARENA_BOUNDS.MAX_X;
            client.state.speed = -client.state.speed * 0.35;
          }
          if (client.state.z < ROAD_BOUNDS.MIN_Z && client.state.x >= -24 && client.state.x <= 18) {
            client.state.z = ROAD_BOUNDS.MIN_Z;
            if (client.state.speed < 0) client.state.speed = -client.state.speed * 0.35;
          } else if (client.state.z > ROAD_BOUNDS.MAX_Z && client.state.x >= -24 && client.state.x <= 18) {
            client.state.z = ROAD_BOUNDS.MAX_Z;
            if (client.state.speed > 0) client.state.speed = -client.state.speed * 0.35;
          }
        } else {
          // Free roam Boulevard bounds
          if (client.state.x < ROAD_BOUNDS.MIN_X) {
            client.state.x = ROAD_BOUNDS.MIN_X;
            client.state.speed *= 0.5;
          } else if (client.state.x > ROAD_BOUNDS.MAX_X) {
            client.state.x = ROAD_BOUNDS.MAX_X;
            client.state.speed *= 0.5;
          }
          if (client.state.z < ROAD_BOUNDS.MIN_Z && client.state.x >= -24 && client.state.x <= 18) {
            client.state.z = ROAD_BOUNDS.MIN_Z;
            if (client.state.speed < 0) client.state.speed = -client.state.speed * 0.3;
          }
          if (client.state.z >= ROAD_BOUNDS.MAX_Z && client.state.x >= -24 && client.state.x <= 18) {
            client.state.z = ROAD_BOUNDS.MAX_Z;
            if (client.state.speed > 0) client.state.speed = -client.state.speed * 0.35;
          }
        }
      }

      client.state.lastAckSeq = lastProcessedSeq;
      client.state.combat = client.combat;
      this.recordPose(client);

      if (!client.combat.isAlive && client.combat.respawnAt && now >= client.combat.respawnAt) {
        this.respawnClient(client);
      }

      if (client.wantsFire) {
        this.tryFireWeapon(client);
      }

      if (client.combat.isAlive) {
        this.tryCollectWorldPickup(client);
      }

      // Crate pickup in battle arena
      if (client.inMatch && this.matchState.state === 'active' && client.combat.isAlive) {
        this.checkCratePickup(client);
      }
    }

    // 3. Simulate Free-Roam AI Bots (server-authoritative, shared across sessions)
    for (const [bId, bot] of this.bots.entries()) {
      if (bot.combat && !bot.combat.isAlive) {
        bot.speed = 0;
        if (!bot.combat.respawnAt || now >= bot.combat.respawnAt) {
          this.recycleRoadBot(bot, bot.z);
        }
        continue;
      }
      if (bot.x === 0 && Math.abs(bot.z) < 2) {
        bot.x = bot.heading === 0 ? -3.5 : 3.5;
      }
      const dir = bot.heading === 0 ? 1 : -1;
      bot.z += dir * bot.speed * dt;
      if (dir === 1 && bot.z > 390) {
        bot.heading = Math.PI;
        bot.x = 3.5;
      } else if (dir === -1 && bot.z < -410) {
        bot.heading = 0;
        bot.x = -3.5;
      }
      if (!bot.combat) bot.combat = this.createCombatState();
      const armed = bot.combat.weapon;
      if (armed && (bot.combat.inventory[armed] || 0) > 0 && now - (bot.lastAckSeq || 0) > 2400) {
        for (const c of this.clients.values()) {
          if (!c.combat.isAlive) continue;
          const dx = c.state.x - bot.x;
          const dz = c.state.z - bot.z;
          if (dx * dx + dz * dz < 20 * 20) {
            bot.lastAckSeq = now;
            bot.combat.inventory[armed] = Math.max(0, (bot.combat.inventory[armed] || 1) - 1);
            bot.combat.ammo = bot.combat.inventory[armed] || 0;
            const cfg = WEAPON_CONFIGS[armed];
            this.applyForwardCone(bot.id, bot.name, bot.x, bot.z, bot.heading, cfg.range || 8, cfg.damage, armed);
            this.broadcast({
              type: 'WEAPON_FIRED',
              ownerId: bot.id,
              weaponType: armed,
              x: bot.x,
              z: bot.z,
              heading: bot.heading,
            });
            break;
          }
        }
      }
    }

    // 4. Simulate Battle Arena Combat Bots
    for (const [abId, b] of this.arenaBots.entries()) {
      if (!b.combat.isAlive) {
        if (this.matchState.state === 'active' && b.combat.respawnAt && now >= b.combat.respawnAt) {
          b.combat.health = 100;
          b.combat.vehicleHealth = 100;
          b.combat.isAlive = true;
          b.combat.respawnAt = 0;
          b.combat.invulnerableUntil = now + 1500;
          const sp = ARENA_SPAWNS[Math.floor(Math.random() * ARENA_SPAWNS.length)];
          b.state.x = sp.x;
          b.state.z = sp.z;
          b.state.heading = sp.heading;
        }
        continue;
      }
      if (this.matchState.state !== 'active') continue;

      const targetCrate = this.crates[b.targetCrateIndex];
      let tx = targetCrate?.x || 0;
      let tz = targetCrate?.z || -80;

      // If crate inactive, switch target
      if (!targetCrate || !targetCrate.active) {
        b.targetCrateIndex = (b.targetCrateIndex + 1) % this.crates.length;
      }

      const dx = tx - b.state.x;
      const dz = tz - b.state.z;
      const targetHeading = Math.atan2(dx, dz);
      let angleDiff = targetHeading - b.state.heading;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

      b.state.heading += Math.max(-2.5 * dt, Math.min(2.5 * dt, angleDiff * 3.0));
      b.state.speed = 14.0;
      b.state.x += Math.sin(b.state.heading) * b.state.speed * dt;
      b.state.z += Math.cos(b.state.heading) * b.state.speed * dt;

      // Arena bounds
      b.state.x = Math.max(ARENA_BOUNDS.MIN_X + 2, Math.min(ARENA_BOUNDS.MAX_X - 2, b.state.x));
      b.state.z = Math.max(ARENA_BOUNDS.MIN_Z + 2, Math.min(ARENA_BOUNDS.MAX_Z - 2, b.state.z));

      // Bot crate pickup
      for (const cr of this.crates) {
        if (!cr.active) continue;
        const cdx = cr.x - b.state.x;
        const cdz = cr.z - b.state.z;
        if (cdx * cdx + cdz * cdz < 2.8 * 2.8) {
          this.grantCrateWeapon(b.combat, b.state.id, cr);
        }
      }

      // Bot firing at nearby players
      if (b.combat.weapon && b.combat.ammo > 0 && now - b.lastFireTime > 2500) {
        for (const c of this.clients.values()) {
          if (c.inMatch && c.combat.isAlive) {
            const pdx = c.state.x - b.state.x;
            const pdz = c.state.z - b.state.z;
            const dist = Math.sqrt(pdx * pdx + pdz * pdz);
            if (dist < 40.0) {
              b.lastFireTime = now;
              b.combat.ammo -= 1;
              const fId = `bot_proj_${now}_${Math.random().toString(36).substring(2, 6)}`;
              this.projectiles.set(fId, {
                id: fId,
                weaponType: b.combat.weapon,
                ownerId: b.state.id,
                ownerName: b.state.name,
                x: b.state.x + Math.sin(b.state.heading) * 2.0,
                y: 0.7,
                z: b.state.z + Math.cos(b.state.heading) * 2.0,
                vx: Math.sin(b.state.heading) * 45.0,
                vy: 0,
                vz: Math.cos(b.state.heading) * 45.0,
                heading: b.state.heading,
                spawnTime: now,
                lifeTimeSec: 2.0,
              });
              break;
            }
          }
        }
      }
    }

    // 5. Update Crates
    for (const c of this.crates) {
      if (!c.active) {
        c.respawnTimer -= dt;
        if (c.respawnTimer <= 0) {
          c.active = true;
          c.respawnTimer = 0;
          this.pickupLocks.delete(c.id);
          this.broadcast({
            type: 'CRATE_SPAWNED',
            crateId: c.id,
            x: c.x,
            z: c.z,
            glow: true,
          });
        }
      }
    }

    // 6. Update Projectiles and Handle Collision
    this.updateProjectiles(dt, now);

    // 7. Update Hazards (Oil, Spikes)
    this.updateHazards(now);
  }

  private grantCrateWeapon(
    combat: PlayerCombatState,
    collectorId: string,
    cr: ArenaCrateState
  ): boolean {
    if (!cr.active || this.pickupLocks.has(cr.id)) return false;
    this.pickupLocks.add(cr.id);
    cr.active = false;
    cr.respawnTimer = PICKUP_RESPAWN_SEC;

    const weapon = this.getRandomWeapon();
    const ammoGain = WEAPON_CONFIGS[weapon].ammo;
    combat.inventory[weapon] = (combat.inventory[weapon] || 0) + ammoGain;
    combat.weapon = weapon;
    combat.ammo = combat.inventory[weapon] || ammoGain;

    const human = this.clients.get(collectorId);
    if (human?.ws.readyState === WebSocket.OPEN) {
      human.ws.send(JSON.stringify({
        type: 'WEAPON_ACQUIRED',
        weapon,
        ammo: combat.ammo,
        inventory: combat.inventory,
      }));
    }

    this.broadcast({
      type: 'CRATE_COLLECTED',
      crateId: cr.id,
      collectorId,
      respawnSec: PICKUP_RESPAWN_SEC,
    });
    this.pickupLocks.delete(cr.id);
    return true;
  }

  private checkCratePickup(client: ConnectedClient) {
    for (const cr of this.crates) {
      if (!cr.active) continue;
      const dx = cr.x - client.state.x;
      const dz = cr.z - client.state.z;
      if (dx * dx + dz * dz < 2.8 * 2.8) {
        this.grantCrateWeapon(client.combat, client.playerId, cr);
        client.state.combat = client.combat;
        break;
      }
    }
  }

  private updateProjectiles(dt: number, now: number) {
    const expiredProjectiles: string[] = [];

    for (const [pId, p] of this.projectiles.entries()) {
      const elapsed = (now - p.spawnTime) / 1000;
      if (elapsed > p.lifeTimeSec) {
        expiredProjectiles.push(pId);
        if (p.weaponType === 'rocket' || p.weaponType === 'grenade' || p.weaponType === 'homing') {
          this.triggerExplosion(p.x, p.z, p);
        }
        continue;
      }

      // Homing missile target tracking
      if (p.weaponType === 'homing' && p.targetId) {
        const human = this.clients.get(p.targetId)?.state;
        const arenaBot = this.arenaBots.get(p.targetId)?.state;
        const road = this.bots.get(p.targetId);
        const target = human || arenaBot || (road ? { x: road.x, z: road.z } : undefined);
        if (target) {
          const dx = target.x - p.x;
          const dz = target.z - p.z;
          const targetHeading = Math.atan2(dx, dz);
          let diff = targetHeading - p.heading;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          p.heading += Math.max(-2.8 * dt, Math.min(2.8 * dt, diff * 3.5));
          const speed = 40.0;
          p.vx = Math.sin(p.heading) * speed;
          p.vz = Math.cos(p.heading) * speed;
        }
      }

      // Parabolic gravity for grenades
      if (p.weaponType === 'grenade') {
        p.vy -= 16.0 * dt;
        p.y += p.vy * dt;
        if (p.y <= 0.1) {
          p.y = 0.1;
          p.vy = -p.vy * 0.45; // bounce
        }
      }

      p.x += p.vx * dt;
      p.z += p.vz * dt;

      const ownerMode = this.clients.get(p.ownerId)?.mode;
      const arenaOrdnance =
        ownerMode === 'battle_arena' &&
        (p.weaponType === 'rocket' ||
          p.weaponType === 'grenade' ||
          p.weaponType === 'homing' ||
          p.weaponType === 'firecracker');
      if (
        arenaOrdnance &&
        (p.x < ARENA_BOUNDS.MIN_X ||
          p.x > ARENA_BOUNDS.MAX_X ||
          p.z < ARENA_BOUNDS.MIN_Z ||
          p.z > ARENA_BOUNDS.MAX_Z)
      ) {
        expiredProjectiles.push(pId);
        if (p.weaponType === 'rocket' || p.weaponType === 'grenade' || p.weaponType === 'homing') {
          this.triggerExplosion(p.x, p.z, p);
        }
        continue;
      }

      const hitscanVisual =
        p.weaponType === 'pistol' ||
        p.weaponType === 'rifle' ||
        p.weaponType === 'shotgun' ||
        p.weaponType === 'machinegun';
      if (hitscanVisual) continue;

      // Check collision with human players
      let hit = false;
      for (const c of this.clients.values()) {
        if (c.playerId === p.ownerId || !c.combat.isAlive) continue;
        if (c.mode === 'battle_arena' && !c.inMatch) continue;
        const dx = c.state.x - p.x;
        const dz = c.state.z - p.z;
        if (dx * dx + dz * dz < 3.4 * 3.4) {
          this.applyDirectHit(c, p);
          hit = true;
          break;
        }
      }

      // Check collision with arena bots
      if (!hit) {
        for (const b of this.arenaBots.values()) {
          if (b.state.id === p.ownerId || !b.combat.isAlive) continue;
          const dx = b.state.x - p.x;
          const dz = b.state.z - p.z;
          if (dx * dx + dz * dz < 3.4 * 3.4) {
            this.applyDirectHitBot(b, p);
            hit = true;
            break;
          }
        }
      }

      if (!hit) {
        for (const bot of this.bots.values()) {
          if (bot.id === p.ownerId || !bot.combat?.isAlive) continue;
          const dx = bot.x - p.x;
          const dz = bot.z - p.z;
          if (dx * dx + dz * dz < 3.4 * 3.4) {
            this.hurtRoadBot(bot, WEAPON_CONFIGS[p.weaponType].damage, p.ownerId, p.ownerName, p.weaponType);
            hit = true;
            break;
          }
        }
      }

      if (hit) {
        expiredProjectiles.push(pId);
      }
    }

    for (const id of expiredProjectiles) {
      this.projectiles.delete(id);
    }
  }

  private applyDirectHit(victim: ConnectedClient, p: ArenaProjectileState) {
    const cfg = WEAPON_CONFIGS[p.weaponType];
    const damage = cfg.damage;
    this.dealDamageToPlayer(victim, damage, p.ownerId, p.ownerName, p.weaponType, p.x, p.z);
    if (cfg.splashRadius > 0) {
      this.triggerExplosion(p.x, p.z, p);
    }
  }

  private applyDirectHitBot(victim: { state: PlayerServerState; combat: PlayerCombatState }, p: ArenaProjectileState) {
    const cfg = WEAPON_CONFIGS[p.weaponType];
    const damage = cfg.damage;
    this.dealDamageToBot(victim, damage, p.ownerId, p.ownerName, p.weaponType, p.x, p.z);
    if (cfg.splashRadius > 0) {
      this.triggerExplosion(p.x, p.z, p);
    }
  }

  private triggerExplosion(x: number, z: number, p: ArenaProjectileState) {
    const cfg = WEAPON_CONFIGS[p.weaponType];
    const splashDmg = cfg.splashDamage || cfg.damage;
    const radius = cfg.splashRadius;

    this.broadcast({
      type: 'EXPLOSION',
      x,
      z,
      weaponType: p.weaponType,
      radius,
    });

    if (radius <= 0) return;

    // Splash damage to nearby clients
    for (const c of this.clients.values()) {
      if (c.playerId === p.ownerId || !c.inMatch || !c.combat.isAlive) continue;
      const dx = c.state.x - x;
      const dz = c.state.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 <= radius * radius) {
        const falloff = 1.0 - Math.sqrt(d2) / radius;
        const dmg = Math.round(splashDmg * Math.max(0.4, falloff));
        this.dealDamageToPlayer(c, dmg, p.ownerId, p.ownerName, p.weaponType, c.state.x, c.state.z);
      }
    }

    // Splash damage to nearby bots
    for (const b of this.arenaBots.values()) {
      if (b.state.id === p.ownerId || !b.combat.isAlive) continue;
      const dx = b.state.x - x;
      const dz = b.state.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 <= radius * radius) {
        const falloff = 1.0 - Math.sqrt(d2) / radius;
        const dmg = Math.round(splashDmg * Math.max(0.4, falloff));
        this.dealDamageToBot(b, dmg, p.ownerId, p.ownerName, p.weaponType, b.state.x, b.state.z);
      }
    }
  }

  private dealDamageToPlayer(
    victim: ConnectedClient,
    amount: number,
    attackerId: string,
    attackerName: string,
    wType: WeaponType | 'ram',
    x: number,
    z: number,
    ram = false
  ) {
    const now = Date.now();
    if (!ram && victim.mode === 'battle_arena') {
      if (this.matchState.state !== 'active') return;
      if (!victim.inMatch) return;
    }
    if (now < victim.combat.invulnerableUntil) return; // Spawn protection

    let dmgRemaining = amount;
    if (victim.combat.shield > 0) {
      if (victim.combat.shield >= dmgRemaining) {
        victim.combat.shield -= dmgRemaining;
        dmgRemaining = 0;
      } else {
        dmgRemaining -= victim.combat.shield;
        victim.combat.shield = 0;
      }
    }

    victim.combat.health = Math.max(0, victim.combat.health - dmgRemaining);
    const hull = this.hullDamage(wType, amount);
    victim.combat.vehicleHealth = Math.max(0, (victim.combat.vehicleHealth ?? 100) - hull);
    const isElim = victim.combat.health <= 0 || victim.combat.vehicleHealth <= 0;
    if (isElim) {
      victim.combat.health = 0;
      victim.combat.vehicleHealth = 0;
      victim.combat.isAlive = false;
      victim.state.speed = 0;
    }

    // Credit attacker
    const attacker = this.clients.get(attackerId);
    if (attacker && attacker.playerId !== victim.playerId) {
      attacker.combat.damageDealt += amount;
      if (isElim) {
        attacker.combat.kills += 1;
      }
    }

    const dmgEvent: DamageEvent = {
      id: `dmg_${now}_${Math.random().toString(36).substring(2, 6)}`,
      attackerId,
      attackerName,
      victimId: victim.playerId,
      victimName: victim.name,
      amount,
      weaponType: wType,
      x,
      y: 1.0,
      z,
      isElimination: isElim,
      timestamp: now,
    };

    this.broadcast({
      type: 'DAMAGE_EVENT',
      event: dmgEvent,
    });

    if (isElim) {
      victim.combat.isAlive = false;
      victim.combat.deaths += 1;
      victim.combat.respawnAt = now + PLAYER_RESPAWN_SEC * 1000;
      this.broadcast({
        type: 'PLAYER_ELIMINATED',
        attackerId,
        attackerName,
        victimId: victim.playerId,
        victimName: victim.name,
        weaponType: wType,
        announcement: 'PLAYER ELIMINATED',
      });
      this.updateArenaPlayerCounts();
    }
  }

  private respawnClient(client: ConnectedClient) {
    const now = Date.now();
    client.combat.health = 100;
    client.combat.vehicleHealth = 100;
    client.combat.shield = 0;
    client.combat.isAlive = true;
    client.combat.invulnerableUntil = now + 1500;
    client.combat.respawnAt = 0;
    client.state.speed = 0;
    if (client.mode === 'battle_arena') {
      const sp = ARENA_SPAWNS[Math.floor(Math.random() * ARENA_SPAWNS.length)];
      client.state.x = sp.x;
      client.state.z = sp.z;
      client.state.heading = sp.heading;
    } else {
      client.state.x = Math.random() > 0.5 ? -3.5 : 3.5;
      client.state.z = -380;
      client.state.heading = 0;
    }
    client.state.combat = client.combat;
    this.broadcast({
      type: 'PLAYER_RESPAWN',
      playerId: client.playerId,
      x: client.state.x,
      z: client.state.z,
      heading: client.state.heading,
    });
  }

  private dealDamageToBot(
    victim: { state: PlayerServerState; combat: PlayerCombatState },
    amount: number,
    attackerId: string,
    attackerName: string,
    wType: WeaponType | 'ram',
    x: number,
    z: number,
    ram = false
  ) {
    const now = Date.now();
    if (!ram && this.matchState.state !== 'active') return;
    if (now < victim.combat.invulnerableUntil) return;

    let dmgRemaining = amount;
    if (victim.combat.shield > 0) {
      if (victim.combat.shield >= dmgRemaining) {
        victim.combat.shield -= dmgRemaining;
        dmgRemaining = 0;
      } else {
        dmgRemaining -= victim.combat.shield;
        victim.combat.shield = 0;
      }
    }

    victim.combat.health = Math.max(0, victim.combat.health - dmgRemaining);
    const hull = this.hullDamage(wType, amount);
    victim.combat.vehicleHealth = Math.max(0, (victim.combat.vehicleHealth ?? 100) - hull);
    const isElim = victim.combat.health <= 0 || victim.combat.vehicleHealth <= 0;
    if (isElim) {
      victim.combat.health = 0;
      victim.combat.vehicleHealth = 0;
      victim.combat.isAlive = false;
      victim.state.speed = 0;
    }

    const attacker = this.clients.get(attackerId);
    if (attacker && attacker.playerId !== victim.state.id) {
      attacker.combat.damageDealt += amount;
      if (isElim) {
        attacker.combat.kills += 1;
      }
    }

    const dmgEvent: DamageEvent = {
      id: `dmg_${now}_${Math.random().toString(36).substring(2, 6)}`,
      attackerId,
      attackerName,
      victimId: victim.state.id,
      victimName: victim.state.name,
      amount,
      weaponType: wType,
      x,
      y: 1.0,
      z,
      isElimination: isElim,
      timestamp: now,
    };

    this.broadcast({
      type: 'DAMAGE_EVENT',
      event: dmgEvent,
    });

    if (isElim) {
      victim.combat.isAlive = false;
      victim.combat.deaths += 1;
      victim.combat.respawnAt = now + PLAYER_RESPAWN_SEC * 1000;
      this.broadcast({
        type: 'PLAYER_ELIMINATED',
        attackerId,
        attackerName,
        victimId: victim.state.id,
        victimName: victim.state.name,
        weaponType: wType,
        announcement: 'PLAYER ELIMINATED',
      });
      this.updateArenaPlayerCounts();
    }
  }

  private updateHazards(now: number) {
    const expiredHazards: string[] = [];

    for (const [hId, h] of this.hazards.entries()) {
      if (now > h.expiresAt) {
        expiredHazards.push(hId);
        continue;
      }

      // Check collision with players
      for (const c of this.clients.values()) {
        if (!c.inMatch || !c.combat.isAlive) continue;
        const dx = c.state.x - h.x;
        const dz = c.state.z - h.z;
        if (dx * dx + dz * dz < 2.5 * 2.5) {
          if (h.type === 'oil') {
            c.combat.oilUntil = now + 2500;
          } else if (h.type === 'spike') {
            c.combat.speedPenaltyUntil = now + 3000;
            this.dealDamageToPlayer(c, 10, h.ownerId, 'Spike Strip', 'spike', h.x, h.z);
            expiredHazards.push(hId); // spikes consumed
          }
        }
      }

      // Check collision with bots
      for (const b of this.arenaBots.values()) {
        if (!b.combat.isAlive) continue;
        const dx = b.state.x - h.x;
        const dz = b.state.z - h.z;
        if (dx * dx + dz * dz < 2.5 * 2.5) {
          if (h.type === 'oil') {
            b.combat.oilUntil = now + 2500;
          } else if (h.type === 'spike') {
            b.combat.speedPenaltyUntil = now + 3000;
            this.dealDamageToBot(b, 10, h.ownerId, 'Spike Strip', 'spike', h.x, h.z);
            expiredHazards.push(hId);
          }
        }
      }
    }

    for (const id of expiredHazards) {
      this.hazards.delete(id);
    }
  }

  private broadcastStateSnapshot() {
    if (!this.wss || this.clients.size === 0) return;

    const payload = JSON.stringify({
      type: 'STATE_SNAPSHOT',
      time: Date.now(),
      players: this.getAllEntities(),
      crates: this.crates,
      worldPickups: this.worldPickups,
      projectiles: Array.from(this.projectiles.values()),
      hazards: Array.from(this.hazards.values()),
      matchState: this.getPublicMatchState(),
      presence: this.buildPresence(),
      scoreboard: this.buildLiveScoreboard(),
    });

    for (const client of this.clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(payload);
      }
    }
  }

  private getAllEntities(): PlayerServerState[] {
    const list: PlayerServerState[] = [];
    for (const c of this.clients.values()) {
      list.push(c.state);
    }
    for (const b of this.bots.values()) {
      list.push(b);
    }
    for (const ab of this.arenaBots.values()) {
      list.push(ab.state);
    }
    return list;
  }

  private broadcast(data: any, excludeId?: string) {
    const json = JSON.stringify(data);
    for (const [id, c] of this.clients.entries()) {
      if (id !== excludeId && c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(json);
      }
    }
  }

  public destroy() {
    if (this.tickInterval) clearInterval(this.tickInterval);
    if (this.broadcastInterval) clearInterval(this.broadcastInterval);
  }
}

export const roomManager = new RoomManager();
