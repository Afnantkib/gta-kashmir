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
  ArenaCrateState,
  ArenaProjectileState,
  ArenaHazardState,
  ArenaMatchState,
  DamageEvent,
} from '../src/shared/types.ts';
import { storage } from './storage.ts';

interface ConnectedClient {
  ws: WebSocket;
  playerId: string;
  name: string;
  vehicle: VehicleCategory;
  mode: GameMode;
  lastInputTime: number;
  inputQueue: PlayerInputPacket[];
  state: PlayerServerState;
  combat: PlayerCombatState;
  lastFireTime: number;
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
    timerSec: 180,
    totalPlayers: 0,
    playersAlive: 0,
  };
  private matchId: string = `match_${Date.now()}`;
  private matchCountdownTimer: number = 0;

  constructor() {
    this.initRoadBots();
    this.initArenaCrates();
    this.initArenaBots();
  }

  private initRoadBots() {
    const botTemplates: { id: string; name: string; vehicle: VehicleCategory; z: number; x: number; heading: number }[] = [
      { id: 'bot_taxi_1', name: 'Bashir (Taxi)', vehicle: 'taxi', z: -300, x: -3.5, heading: 0 },
      { id: 'bot_auto_1', name: 'Tariq (Auto)', vehicle: 'auto', z: -100, x: -3.5, heading: 0 },
      { id: 'bot_bike_1', name: 'Zubair (Bullet)', vehicle: 'bike', z: 120, x: 3.5, heading: Math.PI },
      { id: 'bot_police_1', name: 'JK Police 04', vehicle: 'police', z: 350, x: 3.5, heading: Math.PI },
      { id: 'bot_auto_2', name: 'Farooq (Auto)', vehicle: 'auto', z: 50, x: -3.5, heading: 0 },
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
      });
    }
  }

  private initArenaCrates() {
    this.crates = CRATE_SPAWN_LOCATIONS.map((loc, idx) => ({
      id: loc.id,
      x: loc.x,
      y: 0.9,
      z: loc.z,
      active: idx < 4, // 4 initially active
      respawnTimer: idx < 4 ? 0 : 4 + Math.random() * 6,
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
      };

      const combatState: PlayerCombatState = {
        health: 100,
        maxHealth: 100,
        shield: 25,
        weapon: 'machinegun',
        ammo: 15,
        kills: 0,
        damageDealt: 0,
        isAlive: true,
        invulnerableUntil: Date.now() + 3500,
        empUntil: 0,
        oilUntil: 0,
        speedPenaltyUntil: 0,
        boostUntil: 0,
        boostCooldownUntil: 0,
        dodgeCooldownUntil: 0,
      };

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
              const { playerId, name, vehicle, mode } = msg;
              clientSessionId = playerId;
              const vCategory: VehicleCategory = vehicle || 'auto';
              const selectedMode: GameMode = mode === 'battle_arena' ? 'battle_arena' : 'free_roam';

              const profile = storage.getOrCreateProfile(playerId, name);

              // Spawn position depending on mode
              let spawnX = 0;
              let spawnZ = -400;
              let spawnHeading = 0;

              if (selectedMode === 'battle_arena') {
                const sp = ARENA_SPAWNS[this.clients.size % ARENA_SPAWNS.length];
                spawnX = sp.x;
                spawnZ = sp.z;
                spawnHeading = sp.heading;
              } else {
                spawnZ = -400 + Math.random() * 40;
                spawnX = Math.random() > 0.5 ? -3.5 : 3.5;
              }

              const combat: PlayerCombatState = {
                health: 100,
                maxHealth: 100,
                shield: 0,
                weapon: null,
                ammo: 0,
                kills: 0,
                damageDealt: 0,
                isAlive: true,
                invulnerableUntil: Date.now() + 3500,
                empUntil: 0,
                oilUntil: 0,
                speedPenaltyUntil: 0,
                boostUntil: 0,
                boostCooldownUntil: 0,
                dodgeCooldownUntil: 0,
              };

              const client: ConnectedClient = {
                ws,
                playerId,
                name: profile.name,
                vehicle: vCategory,
                mode: selectedMode,
                lastInputTime: Date.now(),
                inputQueue: [],
                lastFireTime: 0,
                combat,
                state: {
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
                },
              };

              this.clients.set(playerId, client);

              // Send Welcome Handshake
              ws.send(JSON.stringify({
                type: 'WELCOME',
                playerId,
                profile,
                mode: selectedMode,
                players: this.getAllEntities(),
                crates: this.crates,
                matchState: this.matchState,
                chat: this.chatHistory.slice(-15),
              }));

              this.broadcast({
                type: 'PLAYER_JOINED',
                player: client.state,
              }, playerId);

              if (selectedMode === 'battle_arena') {
                this.checkStartArenaMatch();
              }
              break;
            }

            case 'INPUT': {
              if (!clientSessionId) return;
              const client = this.clients.get(clientSessionId);
              if (!client) return;
              const input: PlayerInputPacket = msg.input;
              if (input && typeof input.seq === 'number') {
                client.inputQueue.push(input);
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
                const sp = ARENA_SPAWNS[Math.floor(Math.random() * ARENA_SPAWNS.length)];
                client.state.x = sp.x;
                client.state.z = sp.z;
                client.state.heading = sp.heading;
                client.state.speed = 0;
                this.resetPlayerCombat(client);
                this.checkStartArenaMatch();
              } else {
                client.state.x = Math.random() > 0.5 ? -3.5 : 3.5;
                client.state.z = -380;
                client.state.heading = 0;
                client.state.speed = 0;
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
              if (!client || client.mode !== 'battle_arena' || !client.combat.isAlive) return;

              const now = Date.now();
              const wType = client.combat.weapon;
              if (!wType || client.combat.ammo <= 0) return;

              const wCfg = WEAPON_CONFIGS[wType];
              if (!wCfg) return;

              if (now - client.lastFireTime < wCfg.cooldownMs) return;
              client.lastFireTime = now;
              client.combat.ammo -= 1;
              if (client.combat.ammo <= 0) {
                client.combat.weapon = null;
              }

              this.handleWeaponFire(client, wType);
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
              this.startArenaMatchCountdown();
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

            case 'PING': {
              ws.send(JSON.stringify({ type: 'PONG', time: msg.time }));
              break;
            }
          }
        } catch (e) {
          console.error('[RoomManager] Message parsing error:', e);
        }
      });

      ws.on('close', () => {
        if (clientSessionId) {
          this.clients.delete(clientSessionId);
          this.broadcast({
            type: 'PLAYER_LEFT',
            playerId: clientSessionId,
          });
          this.updateArenaPlayerCounts();
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
      this.broadcastStateSnapshot();
    }, 1000 / 20);
  }

  private resetPlayerCombat(client: ConnectedClient) {
    client.combat.health = 100;
    client.combat.maxHealth = 100;
    client.combat.shield = 25;
    client.combat.weapon = null;
    client.combat.ammo = 0;
    client.combat.isAlive = true;
    client.combat.invulnerableUntil = Date.now() + 3500;
    client.combat.empUntil = 0;
    client.combat.oilUntil = 0;
    client.combat.speedPenaltyUntil = 0;
    client.combat.boostUntil = 0;
    client.state.combat = client.combat;
  }

  private checkStartArenaMatch() {
    const arenaPlayers = Array.from(this.clients.values()).filter(c => c.mode === 'battle_arena');
    if (arenaPlayers.length >= 1 && this.matchState.state === 'waiting') {
      this.startArenaMatchCountdown();
    }
  }

  private startArenaMatchCountdown() {
    this.matchState.state = 'countdown';
    this.matchCountdownTimer = 10;
    this.matchId = `match_${Date.now()}`;
    this.projectiles.clear();
    this.hazards.clear();
    this.initArenaCrates();

    // Reset human players in arena
    let spIdx = 0;
    for (const c of this.clients.values()) {
      if (c.mode === 'battle_arena') {
        const sp = ARENA_SPAWNS[spIdx % ARENA_SPAWNS.length];
        spIdx++;
        c.state.x = sp.x;
        c.state.z = sp.z;
        c.state.heading = sp.heading;
        c.state.speed = 0;
        this.resetPlayerCombat(c);
      }
    }

    // Reset arena bots
    for (const b of this.arenaBots.values()) {
      const sp = ARENA_SPAWNS[spIdx % ARENA_SPAWNS.length];
      spIdx++;
      b.state.x = sp.x;
      b.state.z = sp.z;
      b.state.heading = sp.heading;
      b.state.speed = 0;
      b.combat.health = 100;
      b.combat.maxHealth = 100;
      b.combat.shield = 25;
      b.combat.weapon = 'machinegun';
      b.combat.ammo = 18;
      b.combat.isAlive = true;
      b.combat.invulnerableUntil = Date.now() + 3500;
      b.combat.empUntil = 0;
      b.combat.oilUntil = 0;
      b.state.combat = b.combat;
    }

    this.updateArenaPlayerCounts();

    this.broadcast({
      type: 'MATCH_STATE_CHANGE',
      matchState: this.matchState,
    });
  }

  private updateArenaPlayerCounts() {
    const humanAlive = Array.from(this.clients.values()).filter(c => c.mode === 'battle_arena' && c.combat.isAlive).length;
    const botAlive = Array.from(this.arenaBots.values()).filter(b => b.combat.isAlive).length;
    const humanTotal = Array.from(this.clients.values()).filter(c => c.mode === 'battle_arena').length;
    const botTotal = this.arenaBots.size;

    this.matchState.totalPlayers = humanTotal + botTotal;
    this.matchState.playersAlive = humanAlive + botAlive;
  }

  private handleWeaponFire(attacker: ConnectedClient, wType: WeaponType) {
    const now = Date.now();
    const forwardX = Math.sin(attacker.state.heading);
    const forwardZ = Math.cos(attacker.state.heading);
    const muzzleX = attacker.state.x + forwardX * 2.2;
    const muzzleZ = attacker.state.z + forwardZ * 2.2;

    switch (wType) {
      case 'machinegun': {
        const id = `proj_${now}_${Math.random().toString(36).substring(2, 6)}`;
        const proj: ArenaProjectileState = {
          id,
          weaponType: 'machinegun',
          ownerId: attacker.playerId,
          ownerName: attacker.name,
          x: muzzleX,
          y: 0.65,
          z: muzzleZ,
          vx: forwardX * 95.0,
          vy: 0,
          vz: forwardZ * 95.0,
          heading: attacker.state.heading,
          spawnTime: now,
          lifeTimeSec: 0.75,
        };
        this.projectiles.set(id, proj);
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
          heading: attacker.state.heading,
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
          heading: attacker.state.heading,
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
          const h = attacker.state.heading + ang;
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
          x: attacker.state.x,
          z: attacker.state.z,
          radius: empRadius,
        });

        // Apply EMP disable to nearby opponents
        this.applyEmpEffect(attacker.playerId, attacker.state.x, attacker.state.z, empRadius);
        break;
      }

      case 'oil': {
        const id = `haz_${now}_${Math.random().toString(36).substring(2, 6)}`;
        const haz: ArenaHazardState = {
          id,
          type: 'oil',
          ownerId: attacker.playerId,
          x: attacker.state.x - forwardX * 2.2,
          z: attacker.state.z - forwardZ * 2.2,
          heading: attacker.state.heading,
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
          x: attacker.state.x - forwardX * 2.0,
          z: attacker.state.z - forwardZ * 2.0,
          heading: attacker.state.heading,
          expiresAt: now + 16000,
        };
        this.hazards.set(id, haz);
        break;
      }

      case 'homing': {
        // Find closest opponent in front cone
        let targetId: string | undefined = undefined;
        let bestDist = 75.0;

        // Check human clients
        for (const c of this.clients.values()) {
          if (c.playerId === attacker.playerId || c.mode !== 'battle_arena' || !c.combat.isAlive) continue;
          const dx = c.state.x - attacker.state.x;
          const dz = c.state.z - attacker.state.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist < bestDist) {
            // Forward dot check
            const dot = (dx * forwardX + dz * forwardZ) / dist;
            if (dot > 0.5) {
              bestDist = dist;
              targetId = c.playerId;
            }
          }
        }

        // Check bots
        if (!targetId) {
          for (const b of this.arenaBots.values()) {
            if (!b.combat.isAlive) continue;
            const dx = b.state.x - attacker.state.x;
            const dz = b.state.z - attacker.state.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist < bestDist) {
              const dot = (dx * forwardX + dz * forwardZ) / dist;
              if (dot > 0.5) {
                bestDist = dist;
                targetId = b.state.id;
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
          heading: attacker.state.heading,
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
      x: muzzleX,
      z: muzzleZ,
      heading: attacker.state.heading,
    });
  }

  private applyEmpEffect(attackerId: string, x: number, z: number, radius: number) {
    const now = Date.now();
    for (const c of this.clients.values()) {
      if (c.playerId === attackerId || c.mode !== 'battle_arena' || !c.combat.isAlive) continue;
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

  private simulationTick(dt: number) {
    const now = Date.now();

    // 1. Arena Match Lifecycle State Machine
    if (this.matchState.state === 'countdown') {
      this.matchCountdownTimer -= dt;
      this.matchState.timerSec = Math.ceil(this.matchCountdownTimer);
      if (this.matchCountdownTimer <= 0) {
        this.matchState.state = 'active';
        this.matchState.timerSec = 180; // 3-minute combat round
        this.broadcast({
          type: 'MATCH_STARTED',
          matchState: this.matchState,
        });
      }
    } else if (this.matchState.state === 'active') {
      this.matchState.timerSec = Math.max(0, this.matchState.timerSec - dt);

      // Check victory condition
      const humanAlive = Array.from(this.clients.values()).filter(c => c.mode === 'battle_arena' && c.combat.isAlive);
      const botAlive = Array.from(this.arenaBots.values()).filter(b => b.combat.isAlive);
      const totalAlive = humanAlive.length + botAlive.length;

      this.matchState.playersAlive = totalAlive;

      if (totalAlive <= 1 || this.matchState.timerSec <= 0) {
        this.matchState.state = 'finished';

        let winnerId: string | undefined = undefined;
        let winnerName: string = 'No Contest';

        if (humanAlive.length === 1) {
          winnerId = humanAlive[0].playerId;
          winnerName = humanAlive[0].name;
        } else if (botAlive.length === 1 && humanAlive.length === 0) {
          winnerId = botAlive[0].state.id;
          winnerName = botAlive[0].state.name;
        } else if (humanAlive.length > 1) {
          // Tie-break by highest health + kills
          humanAlive.sort((a, b) => (b.combat.kills * 100 + b.combat.health) - (a.combat.kills * 100 + a.combat.health));
          winnerId = humanAlive[0].playerId;
          winnerName = humanAlive[0].name;
        }

        this.matchState.winnerId = winnerId;
        this.matchState.winnerName = winnerName;

        this.broadcast({
          type: 'MATCH_FINISHED',
          matchState: this.matchState,
        });

        // Persist rewards for connected players
        for (const c of this.clients.values()) {
          if (c.mode === 'battle_arena') {
            const isWin = c.playerId === winnerId;
            const rewardCash = isWin ? 5000 : 1500 + c.combat.kills * 500;
            const rewardXp = isWin ? 600 : 200 + c.combat.kills * 150;
            storage.recordBattleRewards(
              c.playerId,
              this.matchId,
              `auto_${now}`,
              c.combat.kills,
              c.combat.damageDealt,
              isWin ? 1 : 2,
              rewardCash,
              rewardXp,
              isWin
            );
          }
        }
      }
    }

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
          if (client.state.speed > 0.5) {
            accel -= cfg.brakeForce * brake;
          } else {
            accel -= cfg.acceleration * 0.7 * brake;
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
          if (client.state.z < ROAD_BOUNDS.MIN_Z) {
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
          if (client.state.z < ROAD_BOUNDS.MIN_Z) {
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

      // Crate pickup in battle arena
      if (client.mode === 'battle_arena' && client.combat.isAlive) {
        this.checkCratePickup(client);
      }
    }

    // 3. Simulate Free-Roam AI Bots
    for (const [bId, bot] of this.bots.entries()) {
      const dir = bot.heading === 0 ? 1 : -1;
      bot.z += dir * bot.speed * dt;
      if (dir === 1 && bot.z > 390) {
        bot.heading = Math.PI;
        bot.x = 3.5;
      } else if (dir === -1 && bot.z < -410) {
        bot.heading = 0;
        bot.x = -3.5;
      }
    }

    // 4. Simulate Battle Arena Combat Bots
    for (const [abId, b] of this.arenaBots.entries()) {
      if (!b.combat.isAlive) continue;

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
          cr.active = false;
          cr.respawnTimer = 9.0;
          b.combat.weapon = this.getRandomWeapon();
          b.combat.ammo = WEAPON_CONFIGS[b.combat.weapon].ammo;
        }
      }

      // Bot firing at nearby players
      if (b.combat.weapon && b.combat.ammo > 0 && now - b.lastFireTime > 2500) {
        for (const c of this.clients.values()) {
          if (c.mode === 'battle_arena' && c.combat.isAlive) {
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
          this.broadcast({
            type: 'CRATE_SPAWNED',
            crateId: c.id,
            x: c.x,
            z: c.z,
          });
        }
      }
    }

    // 6. Update Projectiles and Handle Collision
    this.updateProjectiles(dt, now);

    // 7. Update Hazards (Oil, Spikes)
    this.updateHazards(now);
  }

  private checkCratePickup(client: ConnectedClient) {
    for (const cr of this.crates) {
      if (!cr.active) continue;
      const dx = cr.x - client.state.x;
      const dz = cr.z - client.state.z;
      if (dx * dx + dz * dz < 2.8 * 2.8) {
        cr.active = false;
        cr.respawnTimer = 8 + Math.random() * 4; // 8 - 12 seconds respawn

        const weapon = this.getRandomWeapon();
        client.combat.weapon = weapon;
        client.combat.ammo = WEAPON_CONFIGS[weapon].ammo;

        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(JSON.stringify({
            type: 'WEAPON_ACQUIRED',
            weapon,
            ammo: client.combat.ammo,
          }));
        }

        this.broadcast({
          type: 'CRATE_COLLECTED',
          crateId: cr.id,
          collectorId: client.playerId,
        });
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
        const target = this.clients.get(p.targetId)?.state || this.arenaBots.get(p.targetId)?.state;
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

      // Arena boundary collision for heavy explosives
      if (
        p.x < ARENA_BOUNDS.MIN_X ||
        p.x > ARENA_BOUNDS.MAX_X ||
        p.z < ARENA_BOUNDS.MIN_Z ||
        p.z > ARENA_BOUNDS.MAX_Z
      ) {
        expiredProjectiles.push(pId);
        if (p.weaponType === 'rocket' || p.weaponType === 'grenade' || p.weaponType === 'homing') {
          this.triggerExplosion(p.x, p.z, p);
        }
        continue;
      }

      // Check collision with human players
      let hit = false;
      for (const c of this.clients.values()) {
        if (c.playerId === p.ownerId || c.mode !== 'battle_arena' || !c.combat.isAlive) continue;
        const dx = c.state.x - p.x;
        const dz = c.state.z - p.z;
        if (dx * dx + dz * dz < 2.0 * 2.0) {
          this.applyDirectHit(c, p);
          hit = true;
          break;
        }
      }

      // Check collision with bots
      if (!hit) {
        for (const b of this.arenaBots.values()) {
          if (b.state.id === p.ownerId || !b.combat.isAlive) continue;
          const dx = b.state.x - p.x;
          const dz = b.state.z - p.z;
          if (dx * dx + dz * dz < 2.0 * 2.0) {
            this.applyDirectHitBot(b, p);
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
      if (c.playerId === p.ownerId || c.mode !== 'battle_arena' || !c.combat.isAlive) continue;
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
    wType: WeaponType,
    x: number,
    z: number
  ) {
    const now = Date.now();
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
    const isElim = victim.combat.health <= 0;

    // Credit attacker
    const attacker = this.clients.get(attackerId);
    if (attacker) {
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
      this.broadcast({
        type: 'PLAYER_ELIMINATED',
        attackerId,
        attackerName,
        victimId: victim.playerId,
        victimName: victim.name,
        weaponType: wType,
      });
      this.updateArenaPlayerCounts();
    }
  }

  private dealDamageToBot(
    victim: { state: PlayerServerState; combat: PlayerCombatState },
    amount: number,
    attackerId: string,
    attackerName: string,
    wType: WeaponType,
    x: number,
    z: number
  ) {
    const now = Date.now();
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
    const isElim = victim.combat.health <= 0;

    const attacker = this.clients.get(attackerId);
    if (attacker) {
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
      this.broadcast({
        type: 'PLAYER_ELIMINATED',
        attackerId,
        attackerName,
        victimId: victim.state.id,
        victimName: victim.state.name,
        weaponType: wType,
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
        if (c.mode !== 'battle_arena' || !c.combat.isAlive) continue;
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
      projectiles: Array.from(this.projectiles.values()),
      hazards: Array.from(this.hazards.values()),
      matchState: this.matchState,
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
