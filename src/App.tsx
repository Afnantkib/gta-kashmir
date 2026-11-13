import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import {
  VehicleCategory,
  VEHICLE_CONFIGS,
  PlayerServerState,
  ChatMessage,
  PlayerInputPacket,
  GameMode,
  WeaponType,
  WEAPON_CONFIGS,
  ArenaCrateState,
  ArenaProjectileState,
  ArenaHazardState,
  ArenaMatchState,
  DamageEvent,
  PresenceMetrics,
  LiveScoreEntry,
  WEAPON_SLOT_ORDER,
  STREET_WEAPON_ORDER,
  WorldWeaponPickup,
  ARENA_BOUNDS,
  ARENA_SPAWNS,
  ROAD_BOUNDS,
} from './shared/types.ts';
import { createVehicleMesh, VehicleMeshBundle } from './game/vehicles.ts';
import { buildSrinagarWorld, WorldObjects } from './game/world.ts';
import { buildBattleArena, ArenaManager } from './game/arena.ts';
import { createWorldPickupMesh, createWeaponMesh, updatePickupVisual } from './game/weaponModels.ts';

function makeNametagSprite(name: string, isNpc: boolean) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = isNpc ? 'rgba(20, 64, 38, 0.82)' : 'rgba(80, 12, 12, 0.9)';
  ctx.fillRect(0, 0, 256, 64);
  if (!isNpc) {
    ctx.strokeStyle = 'rgba(248, 113, 113, 0.95)';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, 252, 60);
  }
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText((name || 'Driver').slice(0, 16), 128, 28);
  ctx.fillStyle = isNpc ? '#86efac' : '#f87171';
  ctx.font = 'bold 13px Outfit, sans-serif';
  ctx.fillText(isNpc ? 'AI BOT' : 'PLAYER', 128, 50);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 12;
  sprite.scale.set(isNpc ? 4.4 : 5.2, isNpc ? 1.1 : 1.25, 1);
  sprite.position.y = isNpc ? 3.15 : 3.45;
  sprite.userData.tagKey = `${name}|${isNpc}|red`;
  return sprite;
}

function ensureHeldWeapon(bundle: VehicleMeshBundle, weapon: WeaponType | null) {
  if (bundle.root.userData.heldType === weapon) return;
  const prev = bundle.root.userData.heldMesh as THREE.Object3D | undefined;
  if (prev) bundle.body.remove(prev);
  bundle.root.userData.heldMesh = null;
  bundle.root.userData.heldType = weapon;
  if (!weapon) return;
  const mesh = createWeaponMesh(weapon);
  mesh.scale.setScalar(weapon === 'kangri' ? 0.95 : 0.9);
  mesh.position.set(0.7, 0.92, 0.55);
  mesh.rotation.x = weapon === 'bat' || weapon === 'pipe' ? 0.9 : 0.15;
  mesh.rotation.z = -0.35;
  mesh.rotation.y = 0;
  mesh.userData.baseRotX = mesh.rotation.x;
  mesh.userData.baseRotZ = mesh.rotation.z;
  const tips: Partial<Record<WeaponType, [number, number, number]>> = {
    pistol: [0, 0.24, 0.38],
    shotgun: [0, 0.22, 0.72],
    rifle: [0, 0.22, 0.9],
    machinegun: [0, 0.2, 0.7],
    rocket: [0, 0.2, 0.85],
    homing: [0, 0.2, 0.9],
    grenade: [0, 0.18, 0.45],
    firecracker: [0, 0.18, 0.55],
    bat: [0, 1.05, 0],
    pipe: [0, 1.15, 0],
    kangri: [0, 0.28, 0.22],
  };
  const tip = tips[weapon] || [0, 0.2, 0.5];
  mesh.userData.muzzleLocal = new THREE.Vector3(tip[0], tip[1], tip[2]);
  bundle.body.add(mesh);
  bundle.root.userData.heldMesh = mesh;
}

function muzzleWorld(bundle: VehicleMeshBundle | null): { x: number; y: number; z: number } | null {
  if (!bundle) return null;
  const held = bundle.root.userData.heldMesh as THREE.Object3D | undefined;
  if (!held) return null;
  const local = (held.userData.muzzleLocal as THREE.Vector3 | undefined) || new THREE.Vector3(0, 0.2, 0.5);
  const world = local.clone();
  held.updateWorldMatrix(true, false);
  held.localToWorld(world);
  return { x: world.x, y: world.y, z: world.z };
}

function setVehicleHurt(bundle: VehicleMeshBundle, level: 0 | 1 | 2) {
  const existing = bundle.root.getObjectByName('hurtSmoke');
  if (level === 0) {
    if (existing) bundle.root.remove(existing);
    return;
  }
  if (existing && existing.userData.level === level) return;
  if (existing) bundle.root.remove(existing);
  const smoke = new THREE.Group();
  smoke.name = 'hurtSmoke';
  smoke.userData.level = level;
  const puffs = level === 2 ? 4 : 2;
  for (let i = 0; i < puffs; i++) {
    const puff = new THREE.Mesh(
      new THREE.SphereGeometry(0.12 + i * 0.04, 6, 6),
      new THREE.MeshBasicMaterial({
        color: level === 2 ? 0x374151 : 0x9ca3af,
        transparent: true,
        opacity: level === 2 ? 0.55 : 0.35,
      })
    );
    puff.position.set((i - 1) * 0.18, 1.05 + i * 0.12, -0.35);
    smoke.add(puff);
  }
  bundle.root.add(smoke);
}

function setVehicleWrecked(bundle: VehicleMeshBundle, wrecked: boolean) {
  if (bundle.root.userData.wrecked === wrecked) return;
  bundle.root.userData.wrecked = wrecked;
  bundle.root.visible = true;
  bundle.body.rotation.z = wrecked ? 0.42 : 0;
  bundle.body.position.y = wrecked ? 0.08 : 0;
  const existing = bundle.root.getObjectByName('wreckSmoke');
  if (existing) bundle.root.remove(existing);
  if (wrecked) setVehicleHurt(bundle, 0);
  if (!wrecked) return;
  const smoke = new THREE.Group();
  smoke.name = 'wreckSmoke';
  for (let i = 0; i < 5; i++) {
    const puff = new THREE.Mesh(
      new THREE.SphereGeometry(0.22 + i * 0.05, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0x6b7280, transparent: true, opacity: 0.45 })
    );
    puff.position.set((Math.random() - 0.5) * 0.4, 1.1 + i * 0.18, (Math.random() - 0.5) * 0.3);
    smoke.add(puff);
  }
  bundle.root.add(smoke);
}

function animateHeldWeapon(mesh: THREE.Object3D, dt: number) {
  const baseX = mesh.userData.baseRotX || 0;
  const baseZ = mesh.userData.baseRotZ || 0;
  if (mesh.userData.kick > 0) {
    mesh.rotation.x = baseX - mesh.userData.kick;
    mesh.userData.kick = Math.max(0, mesh.userData.kick - dt * 1.6);
  } else if (mesh.userData.swing > 0) {
    mesh.rotation.z = baseZ - Math.sin(mesh.userData.swing * 18) * 0.8;
    mesh.userData.swing += dt;
    if (mesh.userData.swing > 0.35) mesh.userData.swing = 0;
  } else {
    mesh.rotation.x += (baseX - mesh.rotation.x) * Math.min(1, 12 * dt);
    mesh.rotation.z += (baseZ - mesh.rotation.z) * Math.min(1, 12 * dt);
  }
}

// Third-Person Chase Camera Calibration Profiles for each vehicle
interface VehicleCameraProfile {
  dist: number; // Horizontal follow distance behind vehicle
  height: number; // Camera elevation above road
  lookHeight: number; // Aim point elevation (vehicle center/road)
  lookAheadBase: number; // Base look-ahead distance in front of vehicle
  lookAheadSpeed: number; // Speed-scaled look-ahead addition
  baseFov: number; // Base FOV
  maxFovBoost: number; // Max subtle FOV boost at 200 km/h (minimal to prevent shrinking)
}

const VEHICLE_CAMERA_PROFILES: Record<VehicleCategory, VehicleCameraProfile> = {
  auto: {
    // Electric Battery Auto: taller, compact 3-wheeler
    dist: 6.2,
    height: 3.1,
    lookHeight: 1.3,
    lookAheadBase: 1.6,
    lookAheadSpeed: 2.2,
    baseFov: 58,
    maxFovBoost: 2.0,
  },
  taxi: {
    // Kashmir Ambassador Taxi: classic sedan profile
    dist: 7.0,
    height: 2.7,
    lookHeight: 1.2,
    lookAheadBase: 1.8,
    lookAheadSpeed: 2.4,
    baseFov: 58,
    maxFovBoost: 2.2,
  },
  police: {
    // J&K Police Cruiser: pursuit cruiser framing
    dist: 7.2,
    height: 2.75,
    lookHeight: 1.2,
    lookAheadBase: 2.2,
    lookAheadSpeed: 2.8,
    baseFov: 59,
    maxFovBoost: 2.4,
  },
  bike: {
    // Royal Enfield Bullet 350: closer, lower motorcycle chase view
    dist: 5.0,
    height: 2.15,
    lookHeight: 1.05,
    lookAheadBase: 1.5,
    lookAheadSpeed: 2.0,
    baseFov: 57,
    maxFovBoost: 1.8,
  },
};
import {
  initAudio,
  playKashmiriSoundtrack,
  playCollisionAudio,
  updateEngineSound,
  toggleAudioMute,
  setPursuitSiren,
  playRewardChime,
  playMachineGunFX,
  playRocketLaunchFX,
  playExplosionFX,
  playGrenadeLaunchFX,
  playFirecrackerFX,
  playKangriFX,
  playEmpShockwaveFX,
  playHazardDropFX,
  playMissileLockWarningFX,
  playCratePickupFX,
  playEliminationHorn,
  playCrashFX,
} from './game/audio.ts';
import { MISSIONS, MissionDefinition } from './game/missions.ts';
import {
  Trophy,
  Volume2,
  VolumeX,
  Navigation,
  Car,
  Flag,
  Send,
  Users,
  ShieldAlert,
  RotateCcw,
  Sparkles,
  MessageSquare,
  Minus,
  X,
  Swords,
  Flame,
  Zap,
  Shield,
  Crosshair,
  Bomb,
  AlertTriangle,
  Skull,
  ChevronLeft,
  ChevronRight,
  Square,
} from 'lucide-react';

function MobileHoldButton({
  label,
  className,
  onHoldChange,
  onTap,
}: {
  label: React.ReactNode;
  className?: string;
  onHoldChange?: (held: boolean) => void;
  onTap?: () => void;
}) {
  return (
    <button
      type="button"
      className={className}
      style={{ touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' }}
      onContextMenu={e => e.preventDefault()}
      onPointerDown={e => {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        onHoldChange?.(true);
        onTap?.();
      }}
      onPointerUp={() => onHoldChange?.(false)}
      onPointerCancel={() => onHoldChange?.(false)}
    >
      {label}
    </button>
  );
}

function LiveTopFive({
  board,
  localId,
  className = '',
}: {
  board: LiveScoreEntry[];
  localId: string;
  className?: string;
}) {
  const top = board.slice(0, 5);
  const me = board.find(row => row.playerId === localId);
  const showSelf = !!me && me.rank > 5;
  return (
    <div
      className={`pointer-events-none w-[172px] rounded-xl bg-slate-950/85 border border-amber-400/35 backdrop-blur-md px-2 py-1.5 shadow-xl ${className}`}
    >
      <div className="flex items-center justify-between text-[9px] font-black tracking-[0.14em] text-amber-300/90 mb-1">
        <span className="flex items-center gap-1">
          <Trophy className="w-3 h-3" /> TOP 5
        </span>
        <span className="font-mono text-slate-500 tracking-normal font-bold">K · SCORE</span>
      </div>
      {top.length === 0 ? (
        <div className="text-[10px] text-slate-500 font-semibold">Waiting for players</div>
      ) : (
        top.map(row => {
          const mine = row.playerId === localId;
          return (
            <div
              key={row.playerId}
              className={`flex items-center gap-1 text-[11px] leading-tight py-px ${
                mine ? 'text-cyan-200' : 'text-slate-200'
              }`}
            >
              <span className="w-3.5 font-mono text-amber-400/80">{row.rank}</span>
              <span className="flex-1 truncate font-bold">{row.name}</span>
              <span className="font-mono tabular-nums text-rose-300">{row.kills}</span>
              <span className="font-mono tabular-nums text-slate-400 w-8 text-right">{row.score}</span>
            </div>
          );
        })
      )}
      {showSelf && me && (
        <div className="mt-0.5 pt-0.5 border-t border-white/10 flex items-center gap-1 text-[11px] leading-tight text-cyan-200">
          <span className="w-3.5 font-mono text-amber-400/80">{me.rank}</span>
          <span className="flex-1 truncate font-bold">{me.name}</span>
          <span className="font-mono tabular-nums text-rose-300">{me.kills}</span>
          <span className="font-mono tabular-nums text-slate-400 w-8 text-right">{me.score}</span>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const minimapCanvasRef = useRef<HTMLCanvasElement>(null);

  // Game UI State
  const [hasStarted, setHasStarted] = useState(false);
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    const touch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
    return window.matchMedia('(pointer: coarse)').matches || (touch && window.innerWidth <= 1024) || window.innerWidth < 768;
  });
  const isMobileRef = useRef(isMobile);
  const touchSteerRef = useRef({ left: false, right: false });
  const touchFireRef = useRef(false);
  const touchBrakeRef = useRef(false);
  const toastTimerRef = useRef<number | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [cash, setCash] = useState(1500);
  const [speedKmh, setSpeedKmh] = useState(0);
  const [wantedStars, setWantedStars] = useState(0);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleCategory>('auto');
  const [unlockedVehicles, setUnlockedVehicles] = useState<VehicleCategory[]>(['auto', 'taxi', 'police', 'bike']);
  const [isGarageOpen, setIsGarageOpen] = useState(false);
  const [connectedPlayersCount, setConnectedPlayersCount] = useState(0);
  const [liveScoreboard, setLiveScoreboard] = useState<LiveScoreEntry[]>([]);
  const liveScoreboardKeyRef = useRef('');
  const [presence, setPresence] = useState<PresenceMetrics>({
    online: 0,
    inRoom: 0,
    inMatch: 0,
    waiting: 0,
    bots: 0,
    connected: false,
  });
  const [serverAnnouncement, setServerAnnouncement] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [callsign, setCallsign] = useState(() => `Driver_${Math.floor(1000 + Math.random() * 9000)}`);
  const callsignRef = useRef(callsign);
  const [activeMission, setActiveMission] = useState<MissionDefinition | null>(null);
  const [missionStep, setMissionStep] = useState(0);
  const [missionTimeLeft, setMissionTimeLeft] = useState(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [clashNotification, setClashNotification] = useState<string | null>(null);

  // --------------------------------------------------------------------------
  // DAL LAKE MAYHEM — BATTLE ARENA COMBAT STATE
  // --------------------------------------------------------------------------
  const [gameMode, setGameMode] = useState<GameMode>('free_roam');
  const gameModeRef = useRef<GameMode>('free_roam');

  const [playerHealth, setPlayerHealth] = useState(100);
  const [playerVehicleHealth, setPlayerVehicleHealth] = useState(100);
  const localHullRef = useRef(100);
  const [playerShield, setPlayerShield] = useState(0);
  const [equippedWeapon, setEquippedWeapon] = useState<WeaponType | null>(null);
  const [ammo, setAmmo] = useState(0);
  const [kills, setKills] = useState(0);
  const [deaths, setDeaths] = useState(0);
  const [damageDealt, setDamageDealt] = useState(0);
  const [weaponInventory, setWeaponInventory] = useState<Partial<Record<WeaponType, number>>>({});
  const [weaponCooldownMs, setWeaponCooldownMs] = useState(0);
  const [waitingForRound, setWaitingForRound] = useState(false);
  const [isAlive, setIsAlive] = useState(true);
  const [respawnAt, setRespawnAt] = useState(0);
  const [spectateName, setSpectateName] = useState<string | null>(null);
  const [respawnCountdown, setRespawnCountdown] = useState(0);
  const [missileWarning, setMissileWarning] = useState(false);
  const [redHitFlash, setRedHitFlash] = useState(false);
  const [fireHitFlash, setFireHitFlash] = useState(false);

  const [boostCooldownTimer, setBoostCooldownTimer] = useState(0);
  const [dodgeCooldownTimer, setDodgeCooldownTimer] = useState(0);

  const [killFeed, setKillFeed] = useState<{ id: string; text: string; icon: string }[]>([]);
  const [matchState, setMatchState] = useState<ArenaMatchState>({
    state: 'waiting',
    timerSec: 180,
    totalPlayers: 0,
    playersAlive: 0,
  });
  const [isMatchResultsOpen, setIsMatchResultsOpen] = useState(false);
  const [nearbyPickup, setNearbyPickup] = useState<WorldWeaponPickup | null>(null);
  const matchStateRef = useRef<ArenaMatchState>({
    state: 'waiting',
    timerSec: 180,
    totalPlayers: 0,
    playersAlive: 0,
  });

  // References to live mutable game state
  const clashTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastRamSentRef = useRef<Map<string, number>>(new Map());
  const crashShakeRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const playerIdRef = useRef<string>((() => {
    try {
      const key = 'gta_kashmir_tab_id';
      const existing = sessionStorage.getItem(key);
      if (existing) return existing;
      const created = `p_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      sessionStorage.setItem(key, created);
      return created;
    } catch {
      return `p_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    }
  })());
  const inputSeqRef = useRef(0);
  const keysRef = useRef<{ [k: string]: boolean }>({});

  useEffect(() => {
    callsignRef.current = callsign;
  }, [callsign]);

  useEffect(() => {
    if (isMobile) isMobileRef.current = true;
  }, [isMobile]);

  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)');
    const apply = () => {
      const touch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
      const mobile = mq.matches || (touch && window.innerWidth <= 1024) || window.innerWidth < 768;
      isMobileRef.current = mobile;
      setIsMobile(mobile);
    };
    apply();
    mq.addEventListener('change', apply);
    window.addEventListener('resize', apply);
    return () => {
      mq.removeEventListener('change', apply);
      window.removeEventListener('resize', apply);
    };
  }, []);
  const activeMissionRef = useRef<MissionDefinition | null>(null);
  const missionStepRef = useRef(0);
  const missionTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Arena & Combat Refs
  const arenaManagerRef = useRef<ArenaManager | null>(null);
  const lastFireTimeRef = useRef(0);
  const boostCooldownUntilRef = useRef(0);
  const dodgeCooldownUntilRef = useRef(0);
  const serverCratesRef = useRef<ArenaCrateState[]>([]);
  const serverProjectilesRef = useRef<ArenaProjectileState[]>([]);
  const serverHazardsRef = useRef<ArenaHazardState[]>([]);
  const worldPickupsRef = useRef<WorldWeaponPickup[]>([]);
  const worldPickupMeshesRef = useRef<Map<string, THREE.Group>>(new Map());
  const nametagSpritesRef = useRef<Map<string, THREE.Sprite>>(new Map());
  const localWeaponMeshRef = useRef<THREE.Group | null>(null);
  const equippedWeaponRef = useRef<WeaponType | null>(null);
  const nearbyPickupRef = useRef<WorldWeaponPickup | null>(null);
  const autoPickupSentRef = useRef<string | null>(null);
  const autoPickupAtRef = useRef(0);

  // Three.js mutable scene handles
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const camHeadingRef = useRef<number>(0);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const localVehicleBundleRef = useRef<VehicleMeshBundle | null>(null);
  const remoteVehicleBundlesRef = useRef<Map<string, VehicleMeshBundle>>(new Map());
  const checkpointMeshRef = useRef<THREE.Group | null>(null);
  const worldObjectsRef = useRef<WorldObjects | null>(null);

  // Local simulated player state
  const localStateRef = useRef({
    x: 3.5,
    y: 0,
    z: -400,
    heading: 0,
    speed: 0,
    steerAngle: 0,
    wheelRot: 0,
    vehicle: 'auto' as VehicleCategory,
  });

  // Remote player target positions for interpolation
  const remoteTargetsRef = useRef<
    Map<
      string,
      {
        x: number;
        y: number;
        z: number;
        heading: number;
        speed: number;
        steer: number;
        vehicle: VehicleCategory;
        name: string;
        health?: number;
        vehicleHealth?: number;
        isAlive?: boolean;
        isNpc?: boolean;
        weapon?: WeaponType | null;
        mode?: GameMode;
      }
    >
  >(new Map());

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    const ms = isMobileRef.current ? 420 : 1800;
    toastTimerRef.current = window.setTimeout(() => setToastMessage(null), ms);
  }, []);

  // --------------------------------------------------------------------------
  // Mode Switching
  // --------------------------------------------------------------------------
  const switchGameMode = useCallback(
    (mode: GameMode) => {
      setGameMode(mode);
      gameModeRef.current = mode;

      if (mode === 'battle_arena') {
        // Teleport to Battle Arena spawn
        const sp = ARENA_SPAWNS[Math.floor(Math.random() * ARENA_SPAWNS.length)];
        localStateRef.current.x = sp.x;
        localStateRef.current.z = sp.z;
        localStateRef.current.heading = sp.heading;
        localStateRef.current.speed = 0;
        camHeadingRef.current = sp.heading;
        setPlayerHealth(100);
        setPlayerShield(25);
        setIsAlive(true);
        setActiveMission(null);
        activeMissionRef.current = null;
        showToast('⚔️ Entered DAL LAKE MAYHEM Arena! Drive over glowing crates for weapons!');
      } else {
        // Return to Boulevard Free-Roam
        localStateRef.current.x = -3.5;
        localStateRef.current.z = -380;
        localStateRef.current.heading = 0;
        localStateRef.current.speed = 0;
        camHeadingRef.current = 0;
        showToast('🚗 Returned to Boulevard Road Free-Roam!');
      }

      // Notify WebSocket server
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'SET_MODE', mode }));
      }
    },
    [showToast]
  );

  // --------------------------------------------------------------------------
  // Combat Actions: Fire, Boost, Dodge
  // --------------------------------------------------------------------------
  const selectWeaponSlot = useCallback((slot: number) => {
    const list = gameModeRef.current === 'battle_arena' ? WEAPON_SLOT_ORDER : STREET_WEAPON_ORDER;
    const wType = list[slot - 1];
    if (!wType) return;
    const owned = weaponInventory[wType] || 0;
    if (owned <= 0) return;
    setEquippedWeapon(wType);
    setAmmo(owned);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'SELECT_WEAPON', slot, weapon: wType }));
    }
  }, [weaponInventory]);

  const isAliveRef = useRef(true);
  const ammoRef = useRef(0);
  const fireWeaponRef = useRef<() => void>(() => undefined);
  const isAimingRef = useRef(false);
  const aimYawRef = useRef(0);
  const fireHeadingRef = useRef(0);
  const lastLocalFxRef = useRef(0);
  const spectateIdRef = useRef<string | null>(null);
  const lastKillerIdRef = useRef<string | null>(null);
  const lockTargetIdRef = useRef<string | null>(null);
  const lockProgressRef = useRef(0);
  const [lockHud, setLockHud] = useState<{ name: string; progress: number } | null>(null);
  const lockHudKeyRef = useRef('');
  const empUntilRef = useRef(0);
  const oilUntilRef = useRef(0);
  const speedPenaltyRef = useRef(0);
  const [isAiming, setIsAiming] = useState(false);

  const fireWeapon = useCallback(() => {
    if (!isAliveRef.current) return;
    const wType = equippedWeaponRef.current;
    if (!wType || ammoRef.current <= 0) return;

    const now = Date.now();
    const wCfg = WEAPON_CONFIGS[wType];
    if (now - lastFireTimeRef.current < wCfg.cooldownMs) return;
    lastFireTimeRef.current = now;
    setWeaponCooldownMs(wCfg.cooldownMs);

    const loc = localStateRef.current;
    const heading = Number.isFinite(fireHeadingRef.current)
      ? fireHeadingRef.current
      : loc.heading + aimYawRef.current;
    const muzzleRaw = muzzleWorld(localVehicleBundleRef.current);
    const muzzleOk =
      muzzleRaw && Number.isFinite(muzzleRaw.x) && Math.hypot(muzzleRaw.x - loc.x, muzzleRaw.z - loc.z) < 6;
    const muzzle = muzzleOk ? muzzleRaw : null;
    const remaining = Math.max(0, ammoRef.current - 1);
    ammoRef.current = remaining;
    setAmmo(remaining);

    arenaManagerRef.current?.spawnDischargedShot(
      wType,
      muzzle?.x ?? loc.x,
      muzzle?.z ?? loc.z,
      heading,
      !!muzzle
    );
    lastLocalFxRef.current = now;
    if (wType === 'pistol' || wType === 'rifle' || wType === 'shotgun' || wType === 'machinegun') playMachineGunFX();
    else if (wType === 'bat' || wType === 'pipe') playCrashFX();
    else if (wType === 'kangri') playKangriFX();
    else if (wType === 'firecracker') playFirecrackerFX();
    else if (wType === 'rocket' || wType === 'homing') playRocketLaunchFX();
    else if (wType === 'grenade') playGrenadeLaunchFX();
    else if (wType === 'emp') playEmpShockwaveFX();
    else if (wType === 'oil' || wType === 'spike') playHazardDropFX(wType);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'FIRE_WEAPON',
          x: loc.x,
          z: loc.z,
          mx: muzzle?.x,
          mz: muzzle?.z,
          heading,
          weapon: wType,
          clientTime: now,
          lockTargetId: wType === 'homing' ? lockTargetIdRef.current : undefined,
        })
      );
    }
  }, []);

  useEffect(() => {
    equippedWeaponRef.current = equippedWeapon;
  }, [equippedWeapon]);
  useEffect(() => {
    ammoRef.current = ammo;
  }, [ammo]);
  useEffect(() => {
    isAliveRef.current = isAlive;
  }, [isAlive]);
  useEffect(() => {
    if (!respawnAt) {
      setRespawnCountdown(0);
      return;
    }
    const tick = () => setRespawnCountdown(Math.max(0, Math.ceil((respawnAt - Date.now()) / 1000)));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [respawnAt]);
  useEffect(() => {
    fireWeaponRef.current = fireWeapon;
  }, [fireWeapon]);

  useEffect(() => {
    matchStateRef.current = matchState;
  }, [matchState]);

  const collectNearbyPickup = useCallback((pickupId?: string) => {
    const id = typeof pickupId === 'string' ? pickupId : nearbyPickupRef.current?.id;
    if (!id || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const loc = localStateRef.current;
    wsRef.current.send(JSON.stringify({ type: 'PICKUP_WEAPON', pickupId: id, x: loc.x, z: loc.z }));
  }, []);

  const useBoost = useCallback(() => {
    if (gameModeRef.current !== 'battle_arena' || !isAlive) return;
    const now = Date.now();
    if (now < boostCooldownUntilRef.current) return;

    boostCooldownUntilRef.current = now + 6500;
    setBoostCooldownTimer(6.5);

    // Apply local speed burst
    localStateRef.current.speed += 14.0;
    playRewardChime();
    showToast('🚀 Nitro Boost Activated!');

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'USE_BOOST' }));
    }
  }, [isAlive, showToast]);

  const useDodge = useCallback(() => {
    if (gameModeRef.current !== 'battle_arena' || !isAlive) return;
    const now = Date.now();
    if (now < dodgeCooldownUntilRef.current) return;

    dodgeCooldownUntilRef.current = now + 4000;
    setDodgeCooldownTimer(4.0);

    // Lateral dodge
    const perpHeading = localStateRef.current.heading + Math.PI / 2;
    localStateRef.current.x += Math.sin(perpHeading) * 4.2;
    localStateRef.current.z += Math.cos(perpHeading) * 4.2;
    playCrashFX();
    showToast('⚡ Evasive Jink Executed!');

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'USE_DODGE' }));
    }
  }, [isAlive, showToast]);

  // Cooldown countdown interval
  useEffect(() => {
    const timer = setInterval(() => {
      setBoostCooldownTimer(prev => Math.max(0, parseFloat((prev - 0.1).toFixed(1))));
      setDodgeCooldownTimer(prev => Math.max(0, parseFloat((prev - 0.1).toFixed(1))));
      setWeaponCooldownMs(prev => Math.max(0, prev - 100));
    }, 100);
    return () => clearInterval(timer);
  }, []);

  // Claim Mission Reward with server idempotency
  const claimMissionRewardRef = useRef<(m: MissionDefinition) => void>(() => undefined);

  const claimMissionReward = useCallback(
    async (m: MissionDefinition) => {
      playRewardChime();
      const nonce = `nonce_${m.id}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      try {
        const res = await fetch('/api/missions/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            playerId: playerIdRef.current,
            missionId: m.id,
            nonce,
            rewardCash: m.rewardCash,
            rewardXp: m.rewardXp,
          }),
        });
        const data = await res.json();
        if (data.success && typeof data.newCash === 'number') {
          setCash(data.newCash);
          showToast(`🎉 Mission Completed: ${m.title}! +₹${m.rewardCash.toLocaleString('en-IN')}`);
        } else {
          setCash(prev => prev + m.rewardCash);
          showToast(`🎉 Mission Completed: ${m.title}! +₹${m.rewardCash.toLocaleString('en-IN')}`);
        }
      } catch {
        setCash(prev => prev + m.rewardCash);
        showToast(`🎉 Mission Completed: ${m.title}! +₹${m.rewardCash.toLocaleString('en-IN')}`);
      }

      if (activeMissionRef.current?.category === 'pursuit') {
        setPursuitSiren(false);
        setWantedStars(0);
      }

      activeMissionRef.current = null;
      setActiveMission(null);
      setMissionStep(0);
      if (missionTimerRef.current) clearInterval(missionTimerRef.current);
    },
    [showToast]
  );
  claimMissionRewardRef.current = claimMissionReward;

  // Start a chosen mission
  const startMission = useCallback(
    (m: MissionDefinition) => {
      if (gameModeRef.current === 'battle_arena') {
        showToast('⚠️ Switch to Boulevard Free-Roam to play missions!');
        return;
      }
      activeMissionRef.current = m;
      missionStepRef.current = 0;
      setActiveMission(m);
      setMissionStep(0);
      setMissionTimeLeft(m.timeLimitSec);

      if (m.category === 'pursuit') {
        setWantedStars(2);
        setPursuitSiren(true);
        showToast('🚨 Wanted Level: 2 Stars! Police pursuit dispatched!');
      } else {
        showToast(`🚀 Mission Started: ${m.title}`);
      }

      if (missionTimerRef.current) clearInterval(missionTimerRef.current);
      missionTimerRef.current = setInterval(() => {
        setMissionTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(missionTimerRef.current!);
            activeMissionRef.current = null;
            setActiveMission(null);
            showToast('❌ Mission Failed: Time ran out!');
            setPursuitSiren(false);
            setWantedStars(0);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    },
    [showToast]
  );

  // Switch Vehicle instantly without paywalls
  const switchVehicle = useCallback(
    (v: VehicleCategory) => {
      if (!sceneRef.current) return;
      const cfg = VEHICLE_CONFIGS[v];
      if (!cfg) return;

      const loc = localStateRef.current;

      if (localVehicleBundleRef.current) {
        sceneRef.current.remove(localVehicleBundleRef.current.root);
      }

      const newBundle = createVehicleMesh(v);
      newBundle.root.position.set(loc.x, 0.04, loc.z);
      newBundle.root.rotation.y = loc.heading;
      localVehicleBundleRef.current = newBundle;
      loc.vehicle = v;
      sceneRef.current.add(newBundle.root);
      setSelectedVehicle(v);
      setIsGarageOpen(false);
      showToast(`🏎️ Switched to ${cfg.name}!`);

      updateEngineSound(v, loc.speed);

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'SWITCH_VEHICLE', vehicle: v }));
      }
    },
    [showToast]
  );

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !wsRef.current) return;
    wsRef.current.send(JSON.stringify({ type: 'CHAT', text: chatInput.trim() }));
    setChatInput('');
  };

  // Keyboard handlers
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isInputFocused = document.activeElement?.tagName === 'INPUT';
      if (isInputFocused && e.code !== 'Escape') {
        return;
      }

      keysRef.current[e.code] = true;

      if (!isChatOpen && !isInputFocused) {
        if (
          e.code === 'KeyW' ||
          e.code === 'KeyA' ||
          e.code === 'KeyS' ||
          e.code === 'KeyD' ||
          e.code === 'ArrowUp' ||
          e.code === 'ArrowDown' ||
          e.code === 'ArrowLeft' ||
          e.code === 'ArrowRight'
        ) {
          e.preventDefault();
        }
        if (e.code === 'Space') {
          e.preventDefault();
          const armed = equippedWeaponRef.current;
          if (e.repeat && armed !== 'machinegun') return;
          fireWeaponRef.current();
        }
        if (e.code === 'KeyE') {
          e.preventDefault();
          collectNearbyPickup();
        }
        if (/^Digit[1-8]$/.test(e.code) || /^Numpad[1-8]$/.test(e.code)) {
          e.preventDefault();
          selectWeaponSlot(Number(e.code.replace(/^\D+/, '')));
          return;
        }
      }

      if (gameModeRef.current === 'battle_arena' && !isChatOpen && !isInputFocused) {
        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
          e.preventDefault();
          useBoost();
          return;
        }
        if (e.code === 'KeyQ') {
          e.preventDefault();
          useDodge();
          return;
        }
      }

      if (e.code === 'KeyM') {
        const muted = toggleAudioMute();
        setIsMuted(muted);
      } else if (e.code === 'KeyV' && !isChatOpen) {
        setIsGarageOpen(prev => !prev);
      } else if (e.code === 'KeyT' && !isChatOpen) {
        e.preventDefault();
        setIsChatOpen(true);
      } else if (e.code === 'Escape') {
        setIsChatOpen(false);
        setIsGarageOpen(false);
      } else if (e.code === 'KeyR' && !isChatOpen) {
        if (gameModeRef.current === 'battle_arena') {
          const sp = ARENA_SPAWNS[Math.floor(Math.random() * ARENA_SPAWNS.length)];
          localStateRef.current.x = sp.x;
          localStateRef.current.z = sp.z;
          localStateRef.current.heading = sp.heading;
          localStateRef.current.speed = 0;
          showToast('🔄 Vehicle reset to Arena starting grid');
        } else {
          localStateRef.current.x = -3.5;
          localStateRef.current.speed = 0;
          localStateRef.current.heading = 0;
          showToast('🔄 Vehicle reset to Boulevard centerline');
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current[e.code] = false;
    };

    const onMouseDown = (e: MouseEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'SELECT') return;
      if (e.button === 2) {
        isAimingRef.current = true;
        setIsAiming(true);
        return;
      }
      if (e.button === 0 && !isChatOpen) {
        fireWeapon();
      }
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 2) {
        isAimingRef.current = false;
        setIsAiming(false);
      }
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!isAimingRef.current) return;
      aimYawRef.current = Math.max(-0.85, Math.min(0.85, aimYawRef.current - e.movementX * 0.0035));
    };
    const onContextMenu = (e: Event) => e.preventDefault();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('contextmenu', onContextMenu);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('contextmenu', onContextMenu);
    };
  }, [isChatOpen, switchVehicle, fireWeapon, selectWeaponSlot, collectNearbyPickup, useBoost, useDodge, showToast]);

  // --------------------------------------------------------------------------
  // Initialize Three.js Game Scene & Loop
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!hasStarted || !mountRef.current) return;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: window.devicePixelRatio < 2, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Scene & Camera
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 1200);
    cameraRef.current = camera;
    camHeadingRef.current = localStateRef.current.heading;

    // Build Srinagar World
    try {
      const world = buildSrinagarWorld(scene);
      worldObjectsRef.current = world;
    } catch (err) {
      console.error('[GTA Kashmir] Failed to build Srinagar world:', err);
      showToast('World failed to load. Refresh the page.');
    }

    // Build Battle Arena Manager
    const arenaManager = buildBattleArena(scene);
    arenaManagerRef.current = arenaManager;

    // Build Initial Vehicle with chosen starting vehicle
    const initV = selectedVehicle || 'auto';
    localStateRef.current.vehicle = initV;
    const vBundle = createVehicleMesh(initV);
    localVehicleBundleRef.current = vBundle;
    scene.add(vBundle.root);

    // Dynamic Checkpoint Hologram Ring
    const cpGroup = new THREE.Group();
    const ringOuter = new THREE.Mesh(
      new THREE.CylinderGeometry(4.2, 4.2, 38, 20, 1, true).translate(0, 19, 0),
      new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })
    );
    const ringFloor = new THREE.Mesh(
      new THREE.RingGeometry(3.2, 4.4, 24).rotateX(-Math.PI / 2).translate(0, 0.25, 0),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, side: THREE.DoubleSide })
    );
    cpGroup.add(ringOuter, ringFloor);
    scene.add(cpGroup);
    checkpointMeshRef.current = cpGroup;

    // Resize Handler
    const handleResize = () => {
      if (!cameraRef.current || !rendererRef.current) return;
      cameraRef.current.aspect = window.innerWidth / window.innerHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    // WebSocket Networking Setup
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setPresence(prev => ({ ...prev, connected: true }));
      ws.send(
        JSON.stringify({
          type: 'JOIN',
          playerId: playerIdRef.current,
          name: callsignRef.current,
          vehicle: selectedVehicle,
          mode: gameModeRef.current,
          enterRoom: gameModeRef.current === 'battle_arena',
        })
      );
    };

    ws.onclose = () => {
      setPresence(prev => ({ ...prev, connected: false, online: 0, inRoom: 0, inMatch: 0, waiting: 0, bots: 0 }));
      setConnectedPlayersCount(0);
    };

    const syncRemotePlayer = (p: PlayerServerState) => {
      if (!p?.id || p.id === playerIdRef.current) return;
      const hp = p.combat?.health ?? 100;
      const vehHp = p.combat?.vehicleHealth ?? 100;
      const isNpc = p.isNpc === true;
      const alive = p.combat?.isAlive !== false && hp > 0 && vehHp > 0;
      remoteTargetsRef.current.set(p.id, {
        x: p.x,
        y: p.y,
        z: p.z,
        heading: p.heading,
        speed: p.speed,
        steer: p.steerAngle,
        vehicle: p.vehicle,
        name: p.name,
        health: hp,
        vehicleHealth: vehHp,
        isAlive: alive,
        isNpc,
        weapon: p.combat?.weapon || null,
        mode: p.mode,
      });

      const existing = remoteVehicleBundlesRef.current.get(p.id);
      if (existing && existing.root.userData.vehicle !== p.vehicle) {
        scene.remove(existing.root);
        nametagSpritesRef.current.delete(p.id);
        remoteVehicleBundlesRef.current.delete(p.id);
      }
      if (!remoteVehicleBundlesRef.current.has(p.id)) {
        const rMesh = createVehicleMesh(p.vehicle);
        rMesh.root.userData.vehicle = p.vehicle;
        rMesh.root.position.set(p.x, 0.04, p.z);
        rMesh.root.rotation.y = p.heading;
        rMesh.root.frustumCulled = false;
        rMesh.body.frustumCulled = false;
        rMesh.root.visible = true;
        rMesh.root.scale.set(1, 1, 1);
        const tag = makeNametagSprite(p.name, isNpc);
        rMesh.root.add(tag);
        rMesh.root.userData.tagKey = `${p.name}|${isNpc}|red`;
        nametagSpritesRef.current.set(p.id, tag);
        if (!isNpc) {
          const disc = new THREE.Mesh(
            new THREE.CircleGeometry(1.15, 18),
            new THREE.MeshBasicMaterial({
              color: 0xef4444,
              transparent: true,
              opacity: 0.4,
              depthWrite: false,
            })
          );
          disc.rotation.x = -Math.PI / 2;
          disc.position.y = 0.05;
          disc.name = 'playerMarker';
          rMesh.root.add(disc);
        }
        remoteVehicleBundlesRef.current.set(p.id, rMesh);
        scene.add(rMesh.root);
      } else {
        const live = remoteVehicleBundlesRef.current.get(p.id)!;
        live.root.visible = true;
        live.root.frustumCulled = false;
        const tagKey = `${p.name}|${isNpc}|red`;
        if (live.root.userData.tagKey !== tagKey) {
          const prev = nametagSpritesRef.current.get(p.id);
          if (prev) live.root.remove(prev);
          const tag = makeNametagSprite(p.name, isNpc);
          live.root.add(tag);
          nametagSpritesRef.current.set(p.id, tag);
          live.root.userData.tagKey = tagKey;
        }
        if (isNpc && p.mode === 'free_roam') {
          live.root.position.set(p.x, 0.04, p.z);
          live.root.rotation.y = p.heading;
        }
      }
    };

    ws.onmessage = event => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'WELCOME') {
          if (msg.profile) {
            setCash(msg.profile.cash);
          }
          setUnlockedVehicles(['auto', 'taxi', 'police', 'bike']);
          if (Array.isArray(msg.chat)) {
            setChatMessages(msg.chat);
          }
          if (msg.crates) {
            serverCratesRef.current = msg.crates;
          }
          if (msg.worldPickups) {
            worldPickupsRef.current = (msg.worldPickups as WorldWeaponPickup[]).filter(p => p.active !== false);
          }
          if (msg.matchState) {
            setMatchState(msg.matchState);
          }
          if (msg.presence) {
            setPresence(msg.presence);
            setConnectedPlayersCount(msg.presence.online);
          }
          if (Array.isArray(msg.scoreboard)) {
            const key = (msg.scoreboard as LiveScoreEntry[])
              .map(r => `${r.playerId}:${r.score}:${r.kills}:${r.deaths}`)
              .join('|');
            if (key !== liveScoreboardKeyRef.current) {
              liveScoreboardKeyRef.current = key;
              setLiveScoreboard(msg.scoreboard);
            }
          }
          const welcomePlayers = (msg.players as PlayerServerState[] | undefined) || [];
          for (const p of welcomePlayers) syncRemotePlayer(p);
          const me = welcomePlayers.find(p => p.id === playerIdRef.current);
          if (me) {
            localStateRef.current.x = me.x;
            localStateRef.current.z = me.z;
            localStateRef.current.heading = me.heading;
            localStateRef.current.speed = me.speed;
          }
        } else if (msg.type === 'STATE_SNAPSHOT') {
          const players: PlayerServerState[] = msg.players || [];
          if (msg.presence) {
            setPresence(msg.presence);
            setConnectedPlayersCount(msg.presence.online);
          } else {
            setConnectedPlayersCount(players.filter(p => !p.isNpc).length);
          }
          if (Array.isArray(msg.scoreboard)) {
            const key = (msg.scoreboard as LiveScoreEntry[])
              .map(r => `${r.playerId}:${r.score}:${r.kills}:${r.deaths}`)
              .join('|');
            if (key !== liveScoreboardKeyRef.current) {
              liveScoreboardKeyRef.current = key;
              setLiveScoreboard(msg.scoreboard);
            }
          }

          if (msg.crates) serverCratesRef.current = msg.crates;
          if (msg.worldPickups) {
            worldPickupsRef.current = (msg.worldPickups as WorldWeaponPickup[]).filter(p => p.active !== false);
          }
          if (msg.projectiles) serverProjectilesRef.current = msg.projectiles;
          if (msg.hazards) serverHazardsRef.current = msg.hazards;
          if (msg.matchState) {
            setMatchState(msg.matchState);
            if (msg.matchState.announcement) setServerAnnouncement(msg.matchState.announcement);
            const phase = msg.matchState.state;
            setIsMatchResultsOpen(phase === 'finished' || phase === 'celebration');
          }

          // Sync local combat data from server snapshot.
          // Do not snap driving position here — that rubber-bands the local car backward.
          const localServerPlayer = players.find(p => p.id === playerIdRef.current);
          if (localServerPlayer?.combat) {
            setPlayerHealth(localServerPlayer.combat.health);
            const hull = localServerPlayer.combat.vehicleHealth ?? localServerPlayer.combat.health;
            localHullRef.current = hull;
            setPlayerVehicleHealth(hull);
            setPlayerShield(localServerPlayer.combat.shield);
            setKills(localServerPlayer.combat.kills);
            setDeaths(localServerPlayer.combat.deaths || 0);
            setDamageDealt(localServerPlayer.combat.damageDealt);
            setIsAlive(localServerPlayer.combat.isAlive);
            setRespawnAt(localServerPlayer.combat.respawnAt || 0);
            setWaitingForRound(!!localServerPlayer.waitingForRound);
            if (!localServerPlayer.combat.isAlive) {
              const killer = lastKillerIdRef.current
                ? players.find(p => p.id === lastKillerIdRef.current && p.combat?.isAlive !== false)
                : undefined;
              if (killer) {
                spectateIdRef.current = killer.id;
                setSpectateName(killer.name);
              } else if (!spectateIdRef.current) {
                const candidates = players.filter(p => p.id !== playerIdRef.current && p.combat?.isAlive !== false);
                const pick = candidates[Math.floor(Math.random() * Math.max(1, candidates.length))];
                if (pick) {
                  spectateIdRef.current = pick.id;
                  setSpectateName(pick.name);
                }
              }
            } else {
              spectateIdRef.current = null;
              lastKillerIdRef.current = null;
              setSpectateName(null);
            }
            if (localServerPlayer.combat.inventory) {
              setWeaponInventory(localServerPlayer.combat.inventory);
            }
            setEquippedWeapon(localServerPlayer.combat.weapon);
            setAmmo(localServerPlayer.combat.ammo);
            empUntilRef.current = localServerPlayer.combat.empUntil || 0;
            oilUntilRef.current = localServerPlayer.combat.oilUntil || 0;
            speedPenaltyRef.current = localServerPlayer.combat.speedPenaltyUntil || 0;
          }

          for (const p of players) syncRemotePlayer(p);

          // Clean up disconnected players
          const activeIds = new Set(players.map(pl => pl.id));
          for (const [rId, bundle] of remoteVehicleBundlesRef.current.entries()) {
            if (!activeIds.has(rId)) {
              scene.remove(bundle.root);
              remoteVehicleBundlesRef.current.delete(rId);
              remoteTargetsRef.current.delete(rId);
              nametagSpritesRef.current.delete(rId);
            }
          }
        } else if (msg.type === 'PLAYER_JOINED' && msg.player) {
          syncRemotePlayer(msg.player as PlayerServerState);
          if (msg.presence) {
            setPresence(msg.presence);
            setConnectedPlayersCount(msg.presence.online);
          }
        } else if (msg.type === 'PLAYER_LEFT' && msg.playerId) {
          const bundle = remoteVehicleBundlesRef.current.get(msg.playerId);
          if (bundle) {
            scene.remove(bundle.root);
            remoteVehicleBundlesRef.current.delete(msg.playerId);
          }
          remoteTargetsRef.current.delete(msg.playerId);
          nametagSpritesRef.current.delete(msg.playerId);
          if (msg.presence) {
            setPresence(msg.presence);
            setConnectedPlayersCount(msg.presence.online);
          }
        } else if (msg.type === 'PRESENCE_UPDATE' || msg.type === 'PONG') {
          if (msg.presence) {
            setPresence(msg.presence);
            setConnectedPlayersCount(msg.presence.online);
          }
          if (msg.matchState) setMatchState(msg.matchState);
        } else if (msg.type === 'ROOM_JOINED') {
          if (msg.matchState) setMatchState(msg.matchState);
          if (msg.presence) {
            setPresence(msg.presence);
            setConnectedPlayersCount(msg.presence.online);
          }
          setWaitingForRound(!!msg.waitingForRound);
        } else if (msg.type === 'WORLD_WEAPON_SPAWNED' && msg.pickup) {
          const list = worldPickupsRef.current.filter(p => p.id !== msg.pickup.id);
          list.push(msg.pickup);
          worldPickupsRef.current = list;
        } else if (msg.type === 'WORLD_WEAPON_EXPIRED' || msg.type === 'WORLD_WEAPON_COLLECTED') {
          worldPickupsRef.current = worldPickupsRef.current.filter(p => p.id !== msg.pickupId);
          if (nearbyPickupRef.current?.id === msg.pickupId) {
            nearbyPickupRef.current = null;
            setNearbyPickup(null);
          }
          if (msg.type === 'WORLD_WEAPON_COLLECTED') {
            if (autoPickupSentRef.current === msg.pickupId) autoPickupSentRef.current = null;
            if (msg.collectorId === playerIdRef.current) {
              if (msg.inventory) setWeaponInventory(msg.inventory);
              setEquippedWeapon(msg.weapon);
              setAmmo(msg.ammo);
              const wCfg = WEAPON_CONFIGS[msg.weapon as WeaponType];
              showToast(`WEAPON COLLECTED: ${(wCfg?.name || msg.weapon).toUpperCase()}`);
              playCratePickupFX();
            }
          }
        } else if (msg.type === 'WEAPON_ACQUIRED') {
          playCratePickupFX();
          setEquippedWeapon(msg.weapon);
          setAmmo(msg.ammo);
          if (msg.inventory) setWeaponInventory(msg.inventory);
          const wCfg = WEAPON_CONFIGS[msg.weapon as WeaponType];
          showToast(`📦 Acquired: ${wCfg?.icon} ${wCfg?.name} (${msg.ammo}x)`);
        } else if (msg.type === 'WEAPON_FIRED') {
          const fired = msg.weaponType as WeaponType;
          const ownerBundle =
            msg.ownerId === playerIdRef.current
              ? localVehicleBundleRef.current
              : remoteVehicleBundlesRef.current.get(msg.ownerId);
          const fx = arenaManagerRef.current;
          const isLocal = msg.ownerId === playerIdRef.current;
          if (isLocal && Date.now() - lastLocalFxRef.current < 120) {
            const held = ownerBundle?.root.userData.heldMesh as THREE.Object3D | undefined;
            if (held) held.userData.kick = 0.18;
          } else if (fired === 'pistol' || fired === 'rifle' || fired === 'shotgun' || fired === 'machinegun') {
            playMachineGunFX();
            fx?.spawnDischargedShot(
              fired,
              Number.isFinite(Number(msg.mx)) ? Number(msg.mx) : msg.x,
              Number.isFinite(Number(msg.mz)) ? Number(msg.mz) : msg.z,
              msg.heading,
              Number.isFinite(Number(msg.mx))
            );
            const held = ownerBundle?.root.userData.heldMesh as THREE.Object3D | undefined;
            if (held) held.userData.kick = 0.18;
          } else if (fired === 'bat' || fired === 'pipe') {
            playCrashFX();
            fx?.spawnDischargedShot(
              fired,
              Number.isFinite(Number(msg.mx)) ? Number(msg.mx) : msg.x,
              Number.isFinite(Number(msg.mz)) ? Number(msg.mz) : msg.z,
              msg.heading,
              Number.isFinite(Number(msg.mx))
            );
            const held = ownerBundle?.root.userData.heldMesh as THREE.Object3D | undefined;
            if (held) held.userData.swing = 0.01;
          } else if (fired === 'kangri') {
            playKangriFX();
            fx?.spawnDischargedShot(
              fired,
              Number.isFinite(Number(msg.mx)) ? Number(msg.mx) : msg.x,
              Number.isFinite(Number(msg.mz)) ? Number(msg.mz) : msg.z,
              msg.heading,
              Number.isFinite(Number(msg.mx))
            );
          } else if (!isLocal) {
            fx?.spawnDischargedShot(
              fired,
              Number.isFinite(Number(msg.mx)) ? Number(msg.mx) : msg.x,
              Number.isFinite(Number(msg.mz)) ? Number(msg.mz) : msg.z,
              msg.heading,
              Number.isFinite(Number(msg.mx))
            );
          } else if (isLocal) {
            switch (fired) {
              case 'rocket':
              case 'homing':
                playRocketLaunchFX();
                break;
              case 'grenade':
                playGrenadeLaunchFX();
                break;
              case 'firecracker':
                playFirecrackerFX();
                break;
              case 'emp':
                playEmpShockwaveFX();
                break;
              case 'oil':
              case 'spike':
                playHazardDropFX(fired);
                break;
            }
          }
        } else if (msg.type === 'DAMAGE_EVENT') {
          const ev: DamageEvent = msg.event;
          arenaManagerRef.current?.triggerDamageNumberFX(ev);
          arenaManagerRef.current?.triggerImpactSparks(ev.x, ev.z);
          if (ev.weaponType === 'kangri') {
            arenaManagerRef.current?.triggerKangriBurnFX(ev.x, ev.z, ev.isElimination);
            if (ev.isElimination) {
              playExplosionFX();
              arenaManagerRef.current?.triggerExplosionFX(ev.x, ev.z, 'kangri', 7);
            }
          }

          const rammed = remoteTargetsRef.current.get(ev.victimId);
          if (rammed && ev.weaponType === 'ram') {
            rammed.health = Math.max(0, (rammed.health ?? 100) - ev.amount);
            rammed.vehicleHealth = Math.max(0, (rammed.vehicleHealth ?? 100) - ev.amount);
            if (ev.isElimination || rammed.vehicleHealth <= 0 || rammed.health <= 0) {
              rammed.isAlive = false;
              rammed.health = 0;
              rammed.vehicleHealth = 0;
              rammed.speed = 0;
            }
          }

          if (ev.victimId === playerIdRef.current) {
            if (ev.weaponType === 'ram') {
              localHullRef.current = Math.max(0, localHullRef.current - ev.amount);
            }
            if (ev.weaponType === 'kangri') {
              setFireHitFlash(true);
              setTimeout(() => setFireHitFlash(false), 420);
              playKangriFX();
              crashShakeRef.current = 0.9;
            } else {
              setRedHitFlash(true);
              setTimeout(() => setRedHitFlash(false), 260);
              playCrashFX();
              crashShakeRef.current = 0.55;
            }
          } else if (ev.attackerId === playerIdRef.current) {
            showToast(
              ev.weaponType === 'ram'
                ? `${ev.isElimination ? 'WRECKED' : 'RAMMED'} ${ev.victimName} −${ev.amount}`
                : ev.weaponType === 'kangri'
                ? `${ev.isElimination ? 'TORCHED' : 'SCORCHED'} ${ev.victimName} −${ev.amount}`
                : `${ev.isElimination ? 'ELIMINATED' : 'HIT'} ${ev.victimName} −${ev.amount} HP`
            );
          }
        } else if (msg.type === 'EXPLOSION') {
          playExplosionFX();
          arenaManagerRef.current?.triggerExplosionFX(msg.x, msg.z, msg.weaponType, msg.radius);
        } else if (msg.type === 'COMBAT_EFFECT') {
          if (msg.effect === 'emp_shockwave') {
            playEmpShockwaveFX();
            arenaManagerRef.current?.triggerEmpShockwaveFX(msg.x, msg.z, msg.radius || 14.0);
          } else if (msg.effect === 'kangri_burst') {
            playKangriFX();
            arenaManagerRef.current?.triggerKangriBurstFX(msg.x, msg.z, msg.heading || 0);
          }
        } else if (msg.type === 'PLAYER_ELIMINATED') {
          playEliminationHorn();
          const wCfg = WEAPON_CONFIGS[msg.weaponType as WeaponType];
          const ramKill = msg.weaponType === 'ram';
          const feedItem = {
            id: `kf_${Date.now()}_${Math.random()}`,
            text:
              ramKill && msg.attackerId === msg.victimId
                ? `${msg.victimName} crashed`
                : ramKill
                  ? `${msg.attackerName} wrecked ${msg.victimName}`
                  : `${msg.attackerName} eliminated ${msg.victimName}`,
            icon: ramKill ? '💥' : wCfg?.icon || '💥',
          };
          setKillFeed(prev => [...prev.slice(-4), feedItem]);

          if (msg.victimId === playerIdRef.current) {
            setIsAlive(false);
            setRespawnAt(Date.now() + 30000);
            lastKillerIdRef.current = msg.attackerId || null;
            spectateIdRef.current = msg.attackerId || null;
            setSpectateName(msg.attackerName || 'killer');
            setServerAnnouncement('YOU WERE ELIMINATED');
            showToast('You were eliminated. Spectating your killer...');
          } else {
            const remote = remoteTargetsRef.current.get(msg.victimId);
            if (remote) {
              remote.isAlive = false;
              remote.health = 0;
              remote.vehicleHealth = 0;
              remote.speed = 0;
            }
            if (msg.attackerId === playerIdRef.current) {
              showToast(`🎯 ELIMINATION CONFIRMED: ${msg.victimName}!`);
            }
          }
        } else if (msg.type === 'PLAYER_RESPAWN') {
          if (msg.playerId === playerIdRef.current) {
            setIsAlive(true);
            setRespawnAt(0);
            spectateIdRef.current = null;
            setSpectateName(null);
            if (typeof msg.x === 'number' && typeof msg.z === 'number') {
              localStateRef.current.x = msg.x;
              localStateRef.current.z = msg.z;
              localStateRef.current.heading = msg.heading || 0;
              localStateRef.current.speed = 0;
            }
            setPlayerHealth(100);
            localHullRef.current = 100;
            setPlayerVehicleHealth(100);
            showToast('RESPAWNED');
          }
        } else if (msg.type === 'MATCH_ANNOUNCEMENT' || msg.type === 'MATCH_STATE_CHANGE' || msg.type === 'MATCH_STARTED' || msg.type === 'MATCH_INTERMISSION' || msg.type === 'WINNER_CELEBRATION') {
          if (msg.matchState) setMatchState(msg.matchState);
          if (msg.presence) {
            setPresence(msg.presence);
            setConnectedPlayersCount(msg.presence.online);
          }
          if (msg.announcement || msg.matchState?.announcement) {
            setServerAnnouncement(msg.announcement || msg.matchState.announcement);
          }
          if (msg.type === 'WINNER_CELEBRATION' || msg.type === 'MATCH_FINISHED') {
            setIsMatchResultsOpen(true);
          }
          if (msg.type === 'MATCH_STARTED' || msg.type === 'MATCH_INTERMISSION') {
            setIsMatchResultsOpen(false);
          }
        } else if (msg.type === 'MISSILE_WARNING') {
          playMissileLockWarningFX();
          setMissileWarning(true);
          setTimeout(() => setMissileWarning(false), 3200);
        } else if (msg.type === 'MATCH_FINISHED') {
          setIsMatchResultsOpen(true);
          if (msg.matchState?.winnerId === playerIdRef.current) {
            playRewardChime();
            showToast('🏆 VICTORY! You won Dal Lake Mayhem!');
          }
        } else if (msg.type === 'CHAT_BROADCAST') {
          setChatMessages(prev => [...prev.slice(-30), msg.message]);
        }
      } catch (err) {
        console.error('[WS] Client parsing error:', err);
      }
    };

    // Client Simulation & Render Loop
    let animId = 0;
    let lastTime = performance.now();
    let netSendAccum = 0;
    let clock = 0;

    const tick = (now: number) => {
      animId = requestAnimationFrame(tick);
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      clock += dt;

      const keys = keysRef.current;
      const mobileDrive = isMobileRef.current;
      const touch = touchSteerRef.current;
      const braking = touchBrakeRef.current;
      const up = keys['ArrowUp'] || keys['KeyW'] || (mobileDrive && !braking);
      const dn = keys['ArrowDown'] || keys['KeyS'] || braking;
      const lf = keys['ArrowLeft'] || keys['KeyA'] || touch.left;
      const rt = keys['ArrowRight'] || keys['KeyD'] || touch.right;
      const space = !!keys['Space'] || touchFireRef.current;

      const loc = localStateRef.current;
      const vCfg = VEHICLE_CONFIGS[loc.vehicle] || VEHICLE_CONFIGS.auto;

      // Local Vehicle Input & Prediction
      if (hasStarted && isAliveRef.current) {
        let accel = 0;
        if (up) accel += vCfg.acceleration;
        if (dn && !up) {
          if (loc.speed > 1.4) accel -= vCfg.brakeForce;
          else accel -= vCfg.acceleration * 1.15;
        }
        const nowMs = Date.now();
        if (nowMs < empUntilRef.current) {
          accel = 0;
        } else if (nowMs < speedPenaltyRef.current) {
          accel *= 0.35;
        }

        if (keys['ControlLeft'] || keys['ControlRight']) {
          accel -= Math.sign(loc.speed) * vCfg.brakeForce * 1.5;
        }

        const drag = 0.45 * loc.speed;
        loc.speed += (accel - drag) * dt;
        loc.speed = Math.max(-vCfg.reverseSpeed, Math.min(vCfg.maxSpeed, loc.speed));

        // Steering: Left arrow turns left (+heading), Right arrow turns right (-heading)
        let steerTarget = (lf ? 1 : 0) - (rt ? 1 : 0);
        if (nowMs < empUntilRef.current) steerTarget = 0;
        if (nowMs < oilUntilRef.current) steerTarget += Math.sin(nowMs * 0.012) * 0.85;
        loc.steerAngle += (steerTarget - loc.steerAngle) * Math.min(1, 14 * dt);

        const turnRate = vCfg.turnSpeed * loc.steerAngle * Math.max(-1, Math.min(1, loc.speed / 4.0));
        loc.heading += turnRate * dt;

        loc.x += Math.sin(loc.heading) * loc.speed * dt;
        loc.z += Math.cos(loc.heading) * loc.speed * dt;

        if (space && equippedWeaponRef.current === 'machinegun') {
          fireWeaponRef.current();
        }

        // Collision helper
        const reportClash = (obstacle: string) => {
          playCollisionAudio();
          crashShakeRef.current = Math.min(0.7, Math.max(0.3, Math.abs(loc.speed) * 0.025 + 0.2));
          setClashNotification(`💥 CLASH! [${obstacle}]`);
          if (clashTimeoutRef.current) clearTimeout(clashTimeoutRef.current);
          clashTimeoutRef.current = setTimeout(() => {
            setClashNotification(null);
          }, isMobileRef.current ? 350 : 1800);
        };
        const bumpSpeed = (factor: number) => {
          if (loc.speed < -0.15) loc.speed *= 0.55;
          else loc.speed = -loc.speed * factor;
        };

        // Mode-Specific Boundaries
        if (gameModeRef.current === 'battle_arena') {
          if (loc.x <= ARENA_BOUNDS.MIN_X) {
            loc.x = ARENA_BOUNDS.MIN_X;
            reportClash('West Arena Grandstand Wall');
            bumpSpeed(0.35);
          } else if (loc.x >= ARENA_BOUNDS.MAX_X) {
            loc.x = ARENA_BOUNDS.MAX_X;
            reportClash('East Arena Lake Barrier');
            bumpSpeed(0.35);
          }
          if (loc.z <= ROAD_BOUNDS.MIN_Z && loc.x >= -24 && loc.x <= 18) {
            loc.z = ROAD_BOUNDS.MIN_Z;
            reportClash('JK Police Dalgate Barricade');
            bumpSpeed(0.4);
          } else if (loc.z >= ROAD_BOUNDS.MAX_Z && loc.x >= -24 && loc.x <= 18) {
            loc.z = ROAD_BOUNDS.MAX_Z;
            reportClash('JK Police Burger Barn Checkpoint');
            bumpSpeed(0.45);
          }
        } else {
          // Free roam Boulevard boundaries
          const hitBurgerBarn = loc.x <= -23.2 && loc.z >= 375 && loc.z <= 415;
          const isAtNishatForecourt = loc.z >= -26.0 && loc.z <= 44.0;

          let hitWestWall = false;
          let obstacleLabel = '';
          let clampX = -26.0;

          if (hitBurgerBarn) {
            hitWestWall = true;
            obstacleLabel = 'Burger Barn Outdoor Terrace';
            clampX = -23.2;
          } else if (isAtNishatForecourt) {
            if (loc.x <= -27.5) {
              hitWestWall = true;
              obstacleLabel = 'Nishat Bagh Mughal Gate';
              clampX = -27.5;
            }
          } else {
            if (loc.x <= -26.0) {
              hitWestWall = true;
              obstacleLabel = loc.z <= -26.0 && loc.z >= -44.0 ? 'Hotel Pine & Peak Wall' : 'Boulevard Hotel Building Wall';
              clampX = -26.0;
            }
          }

          if (hitWestWall) {
            loc.x = clampX;
            reportClash(obstacleLabel);
            bumpSpeed(0.35);
          }

          if (loc.x >= 17.2) {
            loc.x = 17.2;
            reportClash('Dal Lake Promenade Railing Wall');
            bumpSpeed(0.35);
          }

          if (loc.z <= ROAD_BOUNDS.MIN_Z && loc.x >= -24 && loc.x <= 18) {
            loc.z = ROAD_BOUNDS.MIN_Z;
            reportClash('JK Police Dalgate Barricade');
            bumpSpeed(0.4);
          }

          if (loc.z >= ROAD_BOUNDS.MAX_Z && loc.x >= -24 && loc.x <= 18) {
            loc.z = ROAD_BOUNDS.MAX_Z;
            reportClash('JK Police Burger Barn Checkpoint');
            bumpSpeed(0.45);
          }

          // JK Police sentry booths at both road endings
          if (loc.x > -17 && loc.x < -12 && loc.z > 406 && loc.z < 415) {
            loc.x = loc.x < -14.5 ? -17 : -12;
            reportClash('JK Police Post No. 4');
            loc.speed *= 0.5;
          }
          if (loc.x > -17 && loc.x < -12 && loc.z > -430 && loc.z < -424) {
            loc.x = loc.x < -14.5 ? -17 : -12;
            reportClash('JK Police Dalgate Post');
            loc.speed *= 0.5;
          }
        }

        // Collision with visible vehicles only (skip dead, hidden, and idle arena bots).
        const matchLive =
          matchStateRef.current.state === 'active' || matchStateRef.current.state === 'countdown';
        for (const [rId, target] of remoteTargetsRef.current.entries()) {
          if (target.isAlive === false) continue;
          const arenaIdle =
            !!target.isNpc && target.mode === 'battle_arena' && !matchLive && gameModeRef.current === 'free_roam';
          if (arenaIdle) continue;
          const bundle = remoteVehicleBundlesRef.current.get(rId);
          if (!bundle || !bundle.root.visible) continue;
          const ox = bundle.root.position.x;
          const oz = bundle.root.position.z;
          if (!Number.isFinite(ox) || !Number.isFinite(oz)) continue;
          if (Math.hypot(ox, oz) < 1.5 && Math.hypot(target.x, target.z) > 8) continue;
          if (Math.hypot(ox - target.x, oz - target.z) > 14) continue;
          const dx = loc.x - ox;
          const dz = loc.z - oz;
          const dist = Math.hypot(dx, dz);
          const collisionRadius = target.vehicle === 'bike' ? 1.7 : 2.35;
          if (dist < collisionRadius && dist > 0.05) {
            const impactSpeed = loc.speed;
            reportClash(`${target.name || 'Vehicle'}`);
            const pushDir = Math.atan2(dx, dz);
            loc.x += Math.sin(pushDir) * (collisionRadius - dist) * 0.7;
            loc.z += Math.cos(pushDir) * (collisionRadius - dist) * 0.7;
            bumpSpeed(0.35);
            if (Math.abs(impactSpeed) >= 4.5 && ws.readyState === WebSocket.OPEN) {
              const sentAt = lastRamSentRef.current.get(rId) || 0;
              if (nowMs - sentAt >= 650) {
                lastRamSentRef.current.set(rId, nowMs);
                ws.send(JSON.stringify({
                  type: 'RAM',
                  targetId: rId,
                  speed: impactSpeed,
                  x: loc.x,
                  z: loc.z,
                }));
              }
            }
          }
        }

        // Update wheel spin & chassis animation
        loc.wheelRot += (loc.speed / vCfg.wheelRadius) * dt;
        setSpeedKmh(Math.round(Math.abs(loc.speed) * 3.6));
        updateEngineSound(loc.vehicle, loc.speed);

        // Update Local 3D Mesh
        if (localVehicleBundleRef.current) {
          const bundle = localVehicleBundleRef.current;
          bundle.root.position.set(loc.x, 0.04 + Math.sin(clock * 28) * 0.005 * (Math.abs(loc.speed) / 10), loc.z);
          bundle.root.rotation.y = loc.heading;

          if (bundle.frontSteerGroup) {
            bundle.frontSteerGroup.rotation.y = loc.steerAngle * 0.45;
          }
          for (const w of bundle.wheels) {
            w.rotation.x = loc.wheelRot;
          }
          const bodyRoll = -loc.steerAngle * loc.speed * vCfg.rollFactor;
          bundle.body.rotation.z = bodyRoll;

          if (bundle.lightBar) {
            const strobe = Math.sin(clock * 18) > 0;
            bundle.lightBar.children[1].visible = strobe;
            bundle.lightBar.children[2].visible = !strobe;
          }
          bundle.root.visible = true;
          setVehicleWrecked(bundle, false);
          const hull = localHullRef.current;
          setVehicleHurt(bundle, hull < 35 ? 2 : hull < 75 ? 1 : 0);
          ensureHeldWeapon(bundle, equippedWeaponRef.current);
          const held = bundle.root.userData.heldMesh as THREE.Object3D | undefined;
          if (!isAimingRef.current) {
            aimYawRef.current *= Math.exp(-8 * dt);
          }
          if (held) {
            held.rotation.y += (aimYawRef.current - held.rotation.y) * Math.min(1, 12 * dt);
            animateHeldWeapon(held, dt);
          }
        }

        // 20 Hz WebSocket Input Transmission
        netSendAccum += dt;
        if (netSendAccum >= 0.05) {
          netSendAccum = 0;
          if (ws.readyState === WebSocket.OPEN) {
            inputSeqRef.current++;
            const pkt: PlayerInputPacket = {
              seq: inputSeqRef.current,
              steer: loc.steerAngle,
              throttle: up ? 1 : 0,
              brake: dn ? 1 : 0,
              handbrake: !!(keys['ControlLeft'] || keys['ControlRight']),
              fire: false,
              vehicleType: loc.vehicle,
              clientTime: Date.now(),
            };
            ws.send(JSON.stringify({ type: 'INPUT', input: pkt }));
          }
        }
      } else if (localVehicleBundleRef.current) {
        setVehicleWrecked(localVehicleBundleRef.current, true);
        netSendAccum += dt;
        if (netSendAccum >= 0.05) {
          netSendAccum = 0;
          if (ws.readyState === WebSocket.OPEN) {
            inputSeqRef.current++;
            ws.send(
              JSON.stringify({
                type: 'INPUT',
                input: {
                  seq: inputSeqRef.current,
                  steer: 0,
                  throttle: 0,
                  brake: 0,
                  handbrake: false,
                  fire: false,
                  vehicleType: loc.vehicle,
                  clientTime: Date.now(),
                },
              })
            );
          }
        }
      }

      // Smooth Entity Interpolation for Remote Players
      for (const [rId, target] of remoteTargetsRef.current.entries()) {
        const bundle = remoteVehicleBundlesRef.current.get(rId);
        if (bundle) {
          const drift = Math.hypot(target.x - bundle.root.position.x, target.z - bundle.root.position.z);
          if (drift > 16 || !Number.isFinite(bundle.root.position.x)) {
            bundle.root.position.set(target.x, 0.04, target.z);
            bundle.root.rotation.y = target.heading;
          } else {
            bundle.root.position.x += (target.x - bundle.root.position.x) * Math.min(1, 14 * dt);
            bundle.root.position.z += (target.z - bundle.root.position.z) * Math.min(1, 14 * dt);
            let rotDiff = target.heading - bundle.root.rotation.y;
            while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
            while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
            bundle.root.rotation.y += rotDiff * Math.min(1, 14 * dt);
          }
          bundle.root.position.y = 0.04;
          if (bundle.frontSteerGroup) {
            bundle.frontSteerGroup.rotation.y = target.steer * 0.45;
          }
          for (const w of bundle.wheels) {
            w.rotation.x += (target.speed / 0.3) * dt;
          }
          const matchLive =
            matchStateRef.current.state === 'active' || matchStateRef.current.state === 'countdown';
          const hideArenaIdle =
            gameModeRef.current === 'free_roam' &&
            target.mode === 'battle_arena' &&
            !!target.isNpc &&
            !matchLive;
          const isStreetNpc = !!target.isNpc && target.mode !== 'battle_arena';
          const dead = target.isAlive === false;
          if (dead) {
            bundle.root.visible = true;
            bundle.root.frustumCulled = false;
            setVehicleWrecked(bundle, true);
          } else if (isStreetNpc) {
            bundle.root.visible = true;
            bundle.root.frustumCulled = false;
            setVehicleWrecked(bundle, false);
          } else if (!target.isNpc) {
            bundle.root.visible = true;
            bundle.root.frustumCulled = false;
            setVehicleWrecked(bundle, false);
          } else {
            bundle.root.visible = !hideArenaIdle;
            setVehicleWrecked(bundle, false);
          }
          if (dead) setVehicleHurt(bundle, 0);
          else {
            const hull = target.vehicleHealth ?? 100;
            setVehicleHurt(bundle, hull < 35 ? 2 : hull < 75 ? 1 : 0);
          }
          ensureHeldWeapon(bundle, target.isAlive === false ? null : target.weapon || null);
          const held = bundle.root.userData.heldMesh as THREE.Object3D | undefined;
          if (held) animateHeldWeapon(held, dt);
          const smoke = bundle.root.getObjectByName('wreckSmoke') || bundle.root.getObjectByName('hurtSmoke');
          if (smoke) {
            smoke.children.forEach((puff, i) => {
              const baseY = smoke.name === 'hurtSmoke' ? 1.05 + i * 0.12 : 1.1 + i * 0.18;
              puff.position.y = baseY + Math.sin(clock * 3 + i) * 0.12;
              const mat = (puff as THREE.Mesh).material as THREE.MeshBasicMaterial;
              if (mat) mat.opacity = 0.28 + Math.sin(clock * 2 + i) * 0.12;
            });
          }
        }
      }

      // Update Battle Arena (Crates, Projectiles, Hazards, VFX)
      if (arenaManagerRef.current) {
        arenaManagerRef.current.update(
          dt,
          serverCratesRef.current,
          serverProjectilesRef.current,
          serverHazardsRef.current
        );
      }

      if (isAliveRef.current && equippedWeaponRef.current === 'homing') {
        const fx = Math.sin(fireHeadingRef.current);
        const fz = Math.cos(fireHeadingRef.current);
        let bestId: string | null = null;
        let bestName = '';
        let best = 80;
        for (const [id, t] of remoteTargetsRef.current.entries()) {
          if (t.isAlive === false) continue;
          const dx = t.x - loc.x;
          const dz = t.z - loc.z;
          const dist = Math.hypot(dx, dz);
          if (dist < 4 || dist > 80) continue;
          const dot = (dx * fx + dz * fz) / dist;
          if (dot > 0.72 && dist < best) {
            best = dist;
            bestId = id;
            bestName = t.name;
          }
        }
        if (bestId === lockTargetIdRef.current) lockProgressRef.current += dt;
        else {
          lockTargetIdRef.current = bestId;
          lockProgressRef.current = 0;
        }
        const p = bestId ? Math.min(1, lockProgressRef.current / 0.75) : 0;
        const key = bestId ? `${bestId}:${Math.floor(p * 8)}` : '';
        if (key !== lockHudKeyRef.current) {
          lockHudKeyRef.current = key;
          setLockHud(bestId ? { name: bestName, progress: p } : null);
        }
      } else if (lockHudKeyRef.current) {
        lockTargetIdRef.current = null;
        lockProgressRef.current = 0;
        lockHudKeyRef.current = '';
        setLockHud(null);
      }

      const pickupMeshes = worldPickupMeshesRef.current;
      const livePickups = worldPickupsRef.current;
      const liveIds = new Set(livePickups.map(p => p.id));
      for (const [id, mesh] of pickupMeshes.entries()) {
        if (!liveIds.has(id)) {
          scene.remove(mesh);
          pickupMeshes.delete(id);
        }
      }
      for (const p of livePickups) {
        let mesh = pickupMeshes.get(p.id);
        if (!mesh) {
          mesh = createWorldPickupMesh(p.weapon);
          mesh.position.set(p.x, p.y || 0, p.z);
          scene.add(mesh);
          pickupMeshes.set(p.id, mesh);
        }
        updatePickupVisual(mesh, dt, clock);
      }

      let closest: WorldWeaponPickup | null = null;
      let closestD = (isMobileRef.current ? 11 : 8.5) ** 2;
      for (const p of livePickups) {
        if (p.active === false) continue;
        const dx = p.x - loc.x;
        const dz = p.z - loc.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < closestD) {
          closestD = d2;
          closest = p;
        }
      }
      if (nearbyPickupRef.current?.id !== closest?.id) {
        nearbyPickupRef.current = closest;
        setNearbyPickup(closest);
      }
      const nowMs = performance.now();
      if (closest && closestD <= (isMobileRef.current ? 11 : 8) ** 2) {
        const due = autoPickupSentRef.current !== closest.id || nowMs - (autoPickupAtRef.current || 0) > 120;
        if (due && ws.readyState === WebSocket.OPEN) {
          autoPickupSentRef.current = closest.id;
          autoPickupAtRef.current = nowMs;
          ws.send(JSON.stringify({ type: 'PICKUP_WEAPON', pickupId: closest.id, x: loc.x, z: loc.z }));
        }
      }

      // Active Mission Checkpoint Detection (in Free Roam)
      const curMission = activeMissionRef.current;
      if (curMission && checkpointMeshRef.current && gameModeRef.current === 'free_roam') {
        const step = missionStepRef.current;
        const targetPt = curMission.checkpoints[step] || curMission.startPoint;
        checkpointMeshRef.current.position.set(targetPt.x, 0, targetPt.z);
        checkpointMeshRef.current.visible = true;

        const dist = Math.hypot(loc.x - targetPt.x, loc.z - targetPt.z);
        if (dist < 6.5) {
          if (step + 1 >= curMission.checkpoints.length) {
            claimMissionRewardRef.current(curMission);
          } else {
            missionStepRef.current = step + 1;
            setMissionStep(step + 1);
            showToast(`📍 Checkpoint ${step + 1}/${curMission.checkpoints.length} Cleared!`);
          }
        }
      } else if (checkpointMeshRef.current) {
        checkpointMeshRef.current.visible = false;
      }

      // Dynamic Chase Camera with Speed FOV, Zero-Lag Rotational Follow, and Road Look-Ahead
      if (cameraRef.current) {
        const cam = cameraRef.current;
        const speedRatio = Math.min(1.0, Math.abs(loc.speed) / 55.6); // 0 to 1 at 200 km/h

        // Vehicle-calibrated camera profile
        const profile = VEHICLE_CAMERA_PROFILES[loc.vehicle] || VEHICLE_CAMERA_PROFILES.auto;

        // 1. Maintain consistent vehicle screen size across 0 to 200 km/h:
        // Do NOT continuously increase camera distance based on vehicle speed.
        // Screen size remains consistent at all speeds.
        const ads = isAimingRef.current && isAliveRef.current;
        const targetDist = profile.dist * (ads ? 0.58 : 1);
        const targetHeight = profile.height + (ads ? 0.38 : 0.18);

        // 2. Critical-damped rotational follow (heading only):
        // Damping the camera heading rather than Cartesian XYZ position eliminates
        // velocity lag distance completely while preserving smooth turning arcs.
        let followX = loc.x;
        let followZ = loc.z;
        let followHeading = loc.heading + aimYawRef.current;
        let followSpeed = loc.speed;
        if (!isAliveRef.current) {
          let sid = spectateIdRef.current;
          let tgt = sid ? remoteTargetsRef.current.get(sid) : undefined;
          if (!tgt || tgt.isAlive === false) {
            const killerId = lastKillerIdRef.current;
            const killer = killerId ? remoteTargetsRef.current.get(killerId) : undefined;
            if (killer && killer.isAlive !== false) {
              spectateIdRef.current = killerId;
              tgt = killer;
            } else {
              const alive = [...remoteTargetsRef.current.entries()].filter(([, t]) => t.isAlive !== false);
              const pick = alive[Math.floor(Math.random() * Math.max(1, alive.length))];
              if (pick) {
                spectateIdRef.current = pick[0];
                tgt = pick[1];
              } else {
                tgt = undefined;
              }
            }
          }
          if (tgt) {
            const b = remoteVehicleBundlesRef.current.get(spectateIdRef.current || '');
            followX = b ? b.root.position.x : tgt.x;
            followZ = b ? b.root.position.z : tgt.z;
            followHeading = tgt.heading;
            followSpeed = tgt.speed || 0;
          }
        }

        let diff = followHeading - camHeadingRef.current;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        const headingTrackingSpeed = Math.abs(followSpeed) > 1.0 ? 8.5 : 5.0;
        camHeadingRef.current += diff * (1 - Math.exp(-headingTrackingSpeed * dt));

        const camFx = Math.sin(camHeadingRef.current);
        const camFz = Math.cos(camHeadingRef.current);

        // Look along the camera heading so screen-center is the firing aim.
        const lookDir = 1.0;
        const lookAheadDist =
          profile.lookAheadBase + speedRatio * profile.lookAheadSpeed + (ads ? 8.8 : 6.4);
        const lookTargetX = followX + camFx * lookAheadDist * lookDir;
        const lookTargetZ = followZ + camFz * lookAheadDist * lookDir;
        const lookTargetY = (ads ? 1.95 : 1.72) + profile.lookHeight * 0.2;

        const targetFov = ads ? 41 : profile.baseFov + speedRatio * profile.maxFovBoost;
        cam.fov += (targetFov - cam.fov) * Math.min(1, 8.0 * dt);
        cam.updateProjectionMatrix();

        // 5. Thrill vibration & crash shake:
        // High-speed micro-vibration above 140 km/h without disorienting the player
        const speedShakeAmp = speedRatio > 0.7 ? (speedRatio - 0.7) * 0.035 : 0;
        const sShakeX = (Math.random() - 0.5) * speedShakeAmp;
        const sShakeY = (Math.random() - 0.5) * speedShakeAmp;

        const cShake = crashShakeRef.current;
        const cShakeX = (Math.random() - 0.5) * cShake * 1.2;
        const cShakeY = (Math.random() - 0.5) * cShake * 0.8;
        const cShakeZ = (Math.random() - 0.5) * cShake * 1.2;
        crashShakeRef.current = Math.max(0, crashShakeRef.current - dt * 3.2);

        // Position camera strictly relative to car:
        // Because camFx and camFz are unit circle coordinates from camHeadingRef,
        // horizontal distance is ALWAYS exactly targetDist, guaranteeing zero speed lag!
        cam.position.x = followX - camFx * targetDist + sShakeX + cShakeX;
        cam.position.y = targetHeight + 0.15 + sShakeY + cShakeY;
        cam.position.z = followZ - camFz * targetDist + cShakeZ;

        cam.lookAt(lookTargetX, lookTargetY, lookTargetZ);
        fireHeadingRef.current = Math.atan2(lookTargetX - cam.position.x, lookTargetZ - cam.position.z);
      }

      // Animated Water & Houseboats
      if (worldObjectsRef.current) {
        const { houseboats, shikaras, amberLights, waterMaterial } = worldObjectsRef.current;
        waterMaterial.color.setHSL(0.49, 0.5, 0.3 + Math.sin(clock * 0.8) * 0.02);

        const flash = Math.sin(clock * 10) > 0.1;
        amberLights.forEach(l => {
          (l.material as THREE.MeshBasicMaterial).color.setHex(flash ? 0xffaa00 : 0x332200);
        });

        houseboats.forEach((hb, i) => {
          hb.group.position.y = hb.baseY + Math.sin(clock * 1.2 + i) * 0.04;
          hb.group.rotation.z = Math.cos(clock * 1.1 + i) * 0.01;
        });

        shikaras.forEach((sh, i) => {
          sh.group.position.z += sh.dir * sh.sp * dt;
          if (sh.group.position.z > 430) sh.group.position.z = -430;
          if (sh.group.position.z < -430) sh.group.position.z = 430;
          sh.group.position.y = 0.1 + Math.sin(clock * 1.8 + i) * 0.03;
        });

        if (worldObjectsRef.current.nishatFountains) {
          worldObjectsRef.current.nishatFountains.forEach(fn => {
            const h = fn.baseH + Math.sin(clock * 4.8 + fn.phase) * 0.65;
            fn.mesh.scale.set(
              1.0 + Math.sin(clock * 3.5 + fn.phase) * 0.15,
              Math.max(0.3, h / fn.baseH),
              1.0 + Math.cos(clock * 3.5 + fn.phase) * 0.15
            );
          });
        }
      }

      // Draw 2D Minimap Radar
      drawMinimap();

      renderer.render(scene, camera);
    };

    animId = requestAnimationFrame(tick);
    const pingTimer = window.setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'PING', time: Date.now() }));
      }
    }, 4000);

    return () => {
      cancelAnimationFrame(animId);
      window.clearInterval(pingTimer);
      window.removeEventListener('resize', handleResize);
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
      } catch {
        /* ignore */
      }
      try {
        arenaManager.dispose();
      } catch {
        /* ignore */
      }
      worldPickupMeshesRef.current.forEach(mesh => scene.remove(mesh));
      worldPickupMeshesRef.current.clear();
      nametagSpritesRef.current.clear();
      try {
        renderer.dispose();
        renderer.domElement.remove();
      } catch {
        /* ignore */
      }
      worldObjectsRef.current = null;
      arenaManagerRef.current = null;
      localVehicleBundleRef.current = null;
      rendererRef.current = null;
      sceneRef.current = null;
    };
  }, [hasStarted]);

  // Minimap Radar Drawing
  const drawMinimap = () => {
    const canvas = minimapCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const s = 0.75;
    const cx = 80;
    const cy = 64;
    const loc = localStateRef.current;

    const mx = (x: number) => cx - (x - loc.x) * s;
    const my = (z: number) => cy - (z - loc.z) * s;

    ctx.clearRect(0, 0, 160, 128);

    // Lake on East (+X)
    ctx.fillStyle = '#206d6b';
    ctx.fillRect(0, 0, mx(17), 128);

    // Promenade
    ctx.fillStyle = '#b8aa8d';
    ctx.fillRect(mx(17), 0, 9 * s, 128);

    // 14m Boulevard Road
    ctx.fillStyle = '#393c40';
    ctx.fillRect(mx(7), 0, 14 * s, 128);

    // Hotels & Buildings on West
    ctx.fillStyle = '#556358';
    ctx.fillRect(mx(-7), 0, 200, 128);

    // In Battle Arena, highlight arena perimeter
    if (gameModeRef.current === 'battle_arena') {
      const topZ = my(ARENA_BOUNDS.MAX_Z);
      const btmZ = my(ARENA_BOUNDS.MIN_Z);
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.strokeRect(mx(ARENA_BOUNDS.MAX_X), topZ, (ARENA_BOUNDS.MAX_X - ARENA_BOUNDS.MIN_X) * s, Math.abs(btmZ - topZ));

      // Draw weapon crate icons on minimap
      serverCratesRef.current.forEach(c => {
        if (c.active) {
          ctx.fillStyle = '#f59e0b';
          ctx.beginPath();
          ctx.arc(mx(c.x), my(c.z), 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    } else {
      // Nishat Bagh Mughal Garden on West (z: -26 to +44)
      const nTop = my(44);
      const nBottom = my(-26);
      const nY = Math.min(nTop, nBottom);
      const nH = Math.abs(nTop - nBottom);
      if (nY < 128 && nY + nH > 0) {
        ctx.fillStyle = '#1c6337';
        ctx.fillRect(mx(-7), nY, 120, nH);
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(mx(-7), my(9) - 1.5, 75, 3);
        ctx.fillStyle = '#fef08a';
        ctx.font = 'bold 8px sans-serif';
        ctx.fillText('NISHAT BAGH', mx(-22), my(9) - 3.5);
      }

      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(mx(18), my(ROAD_BOUNDS.MAX_Z));
      ctx.lineTo(mx(-24), my(ROAD_BOUNDS.MAX_Z));
      ctx.moveTo(mx(18), my(ROAD_BOUNDS.MIN_Z));
      ctx.lineTo(mx(-24), my(ROAD_BOUNDS.MIN_Z));
      ctx.stroke();
    }

    for (const p of worldPickupsRef.current) {
      const px = mx(p.x);
      const py = my(p.z);
      if (px >= 0 && px <= 160 && py >= 0 && py <= 128) {
        ctx.fillStyle = p.weapon === 'kangri' ? '#fb923c' : '#facc15';
        ctx.beginPath();
        ctx.arc(px, py, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Remote Players / Bots Blips
    for (const [, target] of remoteTargetsRef.current.entries()) {
      const rx = mx(target.x);
      const ry = my(target.z);
      if (rx >= 0 && rx <= 160 && ry >= 0 && ry <= 128) {
        ctx.fillStyle = target.isNpc ? '#4ade80' : '#ef4444';
        ctx.beginPath();
        ctx.arc(rx, ry, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Player Directional Arrow (Center)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-loc.heading);
    ctx.fillStyle = '#3ac2de';
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(4, 5);
    ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  const currentWeaponDef = equippedWeapon ? WEAPON_CONFIGS[equippedWeapon] : null;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950 font-['Rajdhani'] text-slate-100 select-none">
      {/* 3D WebGL Canvas Container */}
      <div ref={mountRef} className="absolute inset-0 w-full h-full" />

      {/* Hit Flash Overlay */}
      {redHitFlash && (
        <div className="absolute inset-0 z-30 pointer-events-none bg-red-600/30 animate-pulse border-8 border-red-500/80" />
      )}
      {fireHitFlash && (
        <div className="absolute inset-0 z-30 pointer-events-none bg-orange-500/35 animate-pulse border-8 border-orange-400/80" />
      )}

      {/* Incoming Missile Warning Banner */}
      {missileWarning && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-6 py-3 bg-red-950/90 border-2 border-red-500 rounded-2xl shadow-2xl animate-bounce pointer-events-none">
          <AlertTriangle className="w-8 h-8 text-red-500 animate-spin" />
          <div className="text-left font-['Outfit']">
            <div className="text-xl font-black text-red-400 tracking-wider">⚠️ INCOMING HOMING MISSILE!</div>
            <div className="text-xs font-bold text-slate-200">PRESS [SHIFT] NITRO OR [Q] DODGE TO EVADE!</div>
          </div>
        </div>
      )}

      {/* Title & Start Screen */}
      {!hasStarted && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center p-6">
          <img
            src="/assets/start-bg.jpg"
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-slate-950/45" />
          <div className="absolute top-5 right-5 z-10">
            <LiveTopFive board={liveScoreboard} localId={playerIdRef.current} />
          </div>
          <div className="relative z-10 text-center max-w-xl space-y-4">
            <h1 className="text-6xl md:text-7xl font-extrabold tracking-tight text-white drop-shadow-lg font-['Outfit']">
              BTA KASHMIR
            </h1>
            <p className="text-xl font-medium text-sky-200">
              Boulevard Road · Dal Lake · Zabarwan Ridge · Battle Arena
            </p>
            <p className="text-sm text-slate-300 max-w-md mx-auto leading-relaxed">
              Explore Srinagar's iconic Boulevard Road and dive into the chaotic <b>Dal Lake Mayhem Battle Arena</b>! Collect random weapon crates, blast opponents with rockets and EMPs, and survive the arena!
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
              <div className="flex flex-col text-left">
                <label className="text-xs text-slate-400 font-semibold mb-1">CALLSIGN / NAME</label>
                <input
                  type="text"
                  value={callsign}
                  onChange={e => setCallsign(e.target.value)}
                  maxLength={16}
                  className="px-4 py-2 bg-slate-900/90 border border-slate-700 rounded-lg text-white font-bold focus:outline-none focus:border-cyan-400"
                />
              </div>

              <div className="flex flex-col text-left">
                <label className="text-xs text-slate-400 font-semibold mb-1">STARTING VEHICLE</label>
                <select
                  value={selectedVehicle}
                  onChange={e => setSelectedVehicle(e.target.value as VehicleCategory)}
                  className="px-4 py-2 bg-slate-900/90 border border-slate-700 rounded-lg text-white font-bold focus:outline-none focus:border-cyan-400"
                >
                  <option value="auto">Electric Battery Auto</option>
                  <option value="taxi">Ambassador Taxi</option>
                  <option value="police">J&K Police Cruiser</option>
                  <option value="bike">Royal Enfield Bullet 350</option>
                </select>
              </div>
            </div>

            <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={() => {
                  setHasStarted(true);
                  switchGameMode('battle_arena');
                  initAudio();
                  playKashmiriSoundtrack();
                }}
                className="w-full sm:w-auto px-8 py-3.5 bg-gradient-to-r from-red-600 via-amber-600 to-amber-500 hover:from-red-500 hover:to-amber-400 text-slate-950 font-black text-xl tracking-wider rounded-xl shadow-xl shadow-red-600/30 transition-all transform hover:scale-105 active:scale-95 cursor-pointer font-['Outfit'] flex items-center justify-center gap-2"
              >
                <Swords className="w-5 h-5 text-slate-950" /> DAL LAKE MAYHEM (COMBAT)
              </button>

              <button
                onClick={() => {
                  setHasStarted(true);
                  switchGameMode('free_roam');
                  initAudio();
                  playKashmiriSoundtrack();
                }}
                className="w-full sm:w-auto px-7 py-3.5 bg-slate-800/90 hover:bg-slate-700 border border-slate-600 text-white font-bold text-lg rounded-xl shadow-lg transition-all cursor-pointer font-['Outfit'] flex items-center justify-center gap-2"
              >
                <Car className="w-5 h-5 text-cyan-400" /> BOULEVARD FREE-ROAM
              </button>
            </div>

            <div className={`text-xs text-slate-400 flex flex-wrap items-center justify-center gap-3 pt-4 border-t border-slate-800 ${isMobile ? 'hidden' : ''}`}>
              <span><b>WASD / Arrows</b> Drive</span>
              <span>·</span>
              <span><b>Space / FIRE</b> Attack</span>
              <span>·</span>
              <span><b>RMB</b> Aim</span>
              <span>·</span>
              <span><b>Ctrl</b> Handbrake</span>
              <span>·</span>
              <span><b>Shift</b> Nitro Boost</span>
              <span>·</span>
              <span><b>Q</b> Evasive Dodge</span>
              <span>·</span>
              <span><b>V</b> Garage</span>
              <span>·</span>
              <span><b>T</b> Chat</span>
            </div>
          </div>
        </div>
      )}

      {/* Floating In-Game HUD (85% Viewport Unobstructed) */}
      {hasStarted && (
        <>
          {isMobile && (
            <div className="absolute top-2 left-2 right-2 z-30 flex items-start justify-between pointer-events-none">
              <div className="text-left">
                <div className="text-xl font-extrabold text-amber-400 font-['Outfit'] tabular-nums drop-shadow-md">
                  ₹{cash.toLocaleString('en-IN')}
                </div>
                <div className="text-[11px] font-bold font-mono text-rose-300 drop-shadow">
                  HP {playerHealth} · VEH {playerVehicleHealth}
                </div>
              </div>
              <div className="pointer-events-auto flex gap-1 bg-slate-950/80 border border-slate-700 rounded-xl p-1">
                <button
                  onClick={() => switchGameMode('free_roam')}
                  className={`p-2 rounded-lg ${gameMode === 'free_roam' ? 'bg-cyan-500 text-slate-950' : 'text-slate-300'}`}
                  title="Free-Roam"
                >
                  <Car className="w-4 h-4" />
                </button>
                <button
                  onClick={() => switchGameMode('battle_arena')}
                  className={`p-2 rounded-lg ${gameMode === 'battle_arena' ? 'bg-amber-500 text-slate-950' : 'text-slate-300'}`}
                  title="Arena"
                >
                  <Swords className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Top Center: Game Mode Switcher Tab Bar */}
          <div className={`${isMobile ? 'hidden' : ''} absolute top-4 left-1/2 -translate-x-1/2 z-30 pointer-events-auto flex items-center p-1 bg-slate-950/85 border border-slate-700 rounded-2xl shadow-2xl backdrop-blur-md`}>
            <button
              onClick={() => switchGameMode('free_roam')}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                gameMode === 'free_roam'
                  ? 'bg-gradient-to-r from-cyan-600 to-cyan-500 text-white shadow-md shadow-cyan-600/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Car className="w-3.5 h-3.5" />
              <span>Boulevard Free-Roam</span>
            </button>
            <button
              onClick={() => switchGameMode('battle_arena')}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                gameMode === 'battle_arena'
                  ? 'bg-gradient-to-r from-red-600 via-amber-600 to-amber-500 text-slate-950 shadow-md shadow-amber-500/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Swords className="w-3.5 h-3.5" />
              <span>DAL LAKE MAYHEM (ARENA)</span>
            </button>
          </div>

          {/* Top-Left: Player Stats & Wallet */}
          <div className={`${isMobile ? 'hidden' : ''} absolute top-4 left-4 z-20 flex flex-col gap-1 pointer-events-none`}>
            <div className="flex items-center gap-3">
              <div className="text-3xl font-extrabold text-amber-400 drop-shadow-md font-['Outfit'] tabular-nums">
                ₹{cash.toLocaleString('en-IN')}
              </div>
              {wantedStars > 0 && (
                <div className="flex items-center gap-1 bg-red-950/80 px-2 py-1 rounded border border-red-500/50">
                  <ShieldAlert className="w-4 h-4 text-red-500 animate-pulse" />
                  <span className="text-red-400 font-bold text-sm tracking-widest">
                    {'★'.repeat(wantedStars)}
                  </span>
                </div>
              )}
            </div>
            <div className="text-xs text-slate-400 font-semibold tracking-wide flex items-center gap-2">
              <span className="text-cyan-400">{callsign}</span>
              <span>·</span>
              <span className="flex items-center gap-1">
                <Users className="w-3.5 h-3.5" />
                {presence.connected
                  ? `${connectedPlayersCount} players · ${presence.bots} AI bots`
                  : 'Disconnected'}
              </span>
              <span className="text-rose-300 font-mono">HP {playerHealth}</span>
              <span className="text-amber-300 font-mono">VEH {playerVehicleHealth}</span>
            </div>
          </div>

          {/* Top Center-Sub: Match Info in Battle Arena */}
          {gameMode === 'battle_arena' && !isMobile && (
            <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1 pointer-events-none">
              <div className="flex items-center gap-3 px-5 py-2 bg-slate-950/90 border border-slate-700/80 rounded-2xl shadow-xl backdrop-blur-md text-xs font-bold font-['Outfit']">
                <div className="flex items-center gap-1.5 text-amber-400 font-mono text-sm uppercase">
                  <span>{matchState.state}</span>
                  <span>
                    {Math.floor(matchState.timerSec / 60)}:
                    {String(Math.max(0, matchState.timerSec) % 60).padStart(2, '0')}
                  </span>
                </div>
                <div className="h-4 w-[1px] bg-slate-700" />
                <span className="text-cyan-300">{presence.online} PLAYERS</span>
                <span className="text-emerald-300">{presence.bots} AI BOTS</span>
                <span className="text-sky-300">{presence.inRoom} ROOM</span>
                <span className="text-emerald-400">{matchState.playersAlive} ALIVE</span>
                <span className="text-amber-200">{presence.waiting} WAITING</span>
                <span className="text-red-400">{kills} K / {deaths} D</span>
              </div>
              {(serverAnnouncement || waitingForRound) && (
                <div className="px-4 py-1 bg-amber-500/90 text-slate-950 text-[11px] font-black tracking-wider rounded-lg">
                  {waitingForRound && matchState.state === 'active' ? 'WAITING FOR NEXT ROUND' : serverAnnouncement}
                </div>
              )}
            </div>
          )}

          {/* Top-Right: Vehicle switcher, garage, compact live top 5 */}
          <div className={`${isMobile ? 'hidden' : ''} absolute top-4 right-4 z-20 flex flex-col items-end gap-2`}>
          <div className="flex items-center gap-2 pointer-events-auto">
            <div className="hidden md:flex items-center gap-1 bg-slate-950/80 border border-slate-700/70 p-1 rounded-xl backdrop-blur-md shadow-xl">
              <button
                onClick={() => switchVehicle('auto')}
                title="Switch to Electric Battery Auto"
                className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  selectedVehicle === 'auto'
                    ? 'bg-cyan-500 text-slate-950 font-black shadow-md shadow-cyan-500/30'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                ⚡ Auto
              </button>
              <button
                onClick={() => switchVehicle('taxi')}
                title="Switch to Ambassador Taxi"
                className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  selectedVehicle === 'taxi'
                    ? 'bg-cyan-500 text-slate-950 font-black shadow-md shadow-cyan-500/30'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                🚕 Taxi
              </button>
              <button
                onClick={() => switchVehicle('police')}
                title="Switch to Police Cruiser"
                className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  selectedVehicle === 'police'
                    ? 'bg-cyan-500 text-slate-950 font-black shadow-md shadow-cyan-500/30'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                🚨 Police
              </button>
              <button
                onClick={() => switchVehicle('bike')}
                title="Switch to Bullet 350"
                className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  selectedVehicle === 'bike'
                    ? 'bg-cyan-500 text-slate-950 font-black shadow-md shadow-cyan-500/30'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                🏍️ Bullet
              </button>
            </div>

            <button
              onClick={() => setIsGarageOpen(true)}
              title="Open Garage Modal (Key V)"
              className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-cyan-600 to-cyan-700 hover:from-cyan-500 hover:to-cyan-600 border border-cyan-400/50 rounded-lg text-white font-bold text-sm shadow-lg cursor-pointer font-['Outfit']"
            >
              <Car className="w-4 h-4" /> GARAGE (V)
            </button>
          </div>

          <LiveTopFive board={liveScoreboard} localId={playerIdRef.current} />

          {gameMode === 'battle_arena' && killFeed.length > 0 && (
            <div className="flex flex-col gap-1.5 pointer-events-none max-w-xs items-end">
              {killFeed.map(item => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 px-3 py-1.5 bg-slate-950/80 border border-red-500/40 rounded-lg text-xs font-mono text-slate-200 shadow-md backdrop-blur-sm animate-fadeIn"
                >
                  <span className="text-base">{item.icon}</span>
                  <span className="font-bold">{item.text}</span>
                </div>
              ))}
            </div>
          )}
          </div>

          {/* Active Mission HUD Card (Free Roam) */}
          {activeMission && gameMode === 'free_roam' && !isMobile && (
            <div className="absolute top-20 left-4 z-20 w-80 bg-slate-950/85 border-l-4 border-amber-500 border-y border-r border-slate-700/80 p-3 rounded-r-xl shadow-2xl backdrop-blur-md">
              <div className="flex items-center justify-between text-xs text-amber-400 font-bold mb-1">
                <span className="flex items-center gap-1.5">
                  <Flag className="w-3.5 h-3.5" /> MISSION IN PROGRESS
                </span>
                <span className="font-mono text-white bg-slate-800 px-2 py-0.5 rounded">
                  {Math.floor(missionTimeLeft / 60)}:{String(missionTimeLeft % 60).padStart(2, '0')}
                </span>
              </div>
              <h3 className="font-extrabold text-white text-base leading-tight font-['Outfit']">
                {activeMission.title}
              </h3>
              <p className="text-xs text-slate-300 mt-1">{activeMission.description}</p>
              <div className="flex items-center justify-between text-xs font-semibold text-slate-400 mt-2 pt-2 border-t border-slate-800">
                <span>Checkpoint {missionStep + 1} / {activeMission.checkpoints.length}</span>
                <span className="text-emerald-400 font-bold font-mono">+₹{activeMission.rewardCash.toLocaleString('en-IN')}</span>
              </div>
            </div>
          )}

          {/* Clash Notification Banner */}
          {clashNotification && !isMobile && (
            <div className="absolute top-24 left-1/2 -translate-x-1/2 z-20 px-5 py-2.5 bg-slate-950/90 border border-cyan-400/80 rounded-xl shadow-2xl text-xs sm:text-sm font-bold text-cyan-300 font-['Outfit'] backdrop-blur-md pointer-events-none flex items-center gap-2 animate-bounce">
              <Sparkles className="w-4 h-4 text-cyan-400 animate-spin" />
              <span>{clashNotification}</span>
            </div>
          )}

          {/* Toast Notification */}
          {toastMessage && (
            <div
              className={`absolute left-1/2 -translate-x-1/2 z-30 bg-slate-900/90 border border-amber-400/50 rounded-lg shadow-lg text-white font-['Outfit'] pointer-events-none ${
                isMobile ? 'top-12 max-w-[70vw] px-3 py-1 text-[11px] font-bold' : 'top-36 px-6 py-2.5 text-sm font-bold'
              }`}
            >
              {toastMessage}
            </div>
          )}

          {isAlive && (
            <div className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center">
              <div className="relative w-10 h-10">
                <div className="absolute left-1/2 top-0 w-[2px] h-3.5 -translate-x-1/2 bg-amber-300/90" />
                <div className="absolute left-1/2 bottom-0 w-[2px] h-3.5 -translate-x-1/2 bg-amber-300/90" />
                <div className="absolute top-1/2 left-0 h-[2px] w-3.5 -translate-y-1/2 bg-amber-300/90" />
                <div className="absolute top-1/2 right-0 h-[2px] w-3.5 -translate-y-1/2 bg-amber-300/90" />
                <div className="absolute left-1/2 top-1/2 w-1 h-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-100" />
              </div>
              {isAiming && (
                <div className="absolute mt-14 text-[10px] font-bold tracking-widest text-amber-200/80">ADS</div>
              )}
              {lockHud && (
                <div
                  className={`absolute mt-20 px-2 py-1 rounded border text-[10px] font-black tracking-wider ${
                    lockHud.progress >= 1
                      ? 'border-red-400 text-red-300 bg-red-950/70'
                      : 'border-cyan-400 text-cyan-200 bg-slate-950/70'
                  }`}
                >
                  {lockHud.progress >= 1 ? `LOCK ${lockHud.name}` : `ACQUIRING ${Math.round(lockHud.progress * 100)}%`}
                </div>
              )}
            </div>
          )}

          {!isAlive && (
            <div className="absolute inset-0 z-40 pointer-events-none flex flex-col items-center justify-center bg-slate-950/55">
              <div className="text-rose-400 font-black text-3xl tracking-wider font-['Outfit']">ELIMINATED</div>
              <div className="text-white text-lg mt-2 font-bold">
                Respawn in {Math.max(0, respawnCountdown)}s
              </div>
              <div className="text-slate-300 text-sm mt-1">
                Spectating {spectateName || 'another driver'} — you cannot drive or fire
              </div>
            </div>
          )}

          {nearbyPickup && gameMode === 'free_roam' && !isMobile && (
            <div className={`absolute left-1/2 -translate-x-1/2 z-30 px-6 py-3 bg-slate-950/95 border border-amber-400/80 rounded-2xl shadow-2xl text-center font-['Outfit'] pointer-events-none ${isMobile ? 'bottom-40 max-w-[80vw] px-3 py-2' : 'bottom-36'}`}>
              <div className="text-amber-300 text-lg font-black tracking-wide">
                DRIVE OVER TO COLLECT
              </div>
              <div className="text-white text-sm font-bold">
                {WEAPON_CONFIGS[nearbyPickup.weapon].icon} {WEAPON_CONFIGS[nearbyPickup.weapon].name}
              </div>
              <div className="text-[11px] text-slate-300 max-w-xs">
                {WEAPON_CONFIGS[nearbyPickup.weapon].description}
              </div>
            </div>
          )}

          {/* Bottom-Left: 2D Radar Minimap */}
          <div className={`${isMobile ? 'hidden' : ''} absolute bottom-4 left-4 z-20 pointer-events-auto`}>
            <div className="relative border-2 border-slate-600 rounded-xl overflow-hidden shadow-2xl bg-slate-950/80">
              <canvas ref={minimapCanvasRef} width={160} height={128} className="block" />
              <div className="absolute bottom-1 right-2 text-[10px] text-slate-400 font-bold tracking-wider">
                {gameMode === 'battle_arena' ? 'ARENA' : 'SRINAGAR'}
              </div>
            </div>
          </div>

          {gameMode === 'free_roam' && !isMobile && (
            <div className="absolute bottom-28 right-4 z-20 min-w-[210px] p-3 bg-slate-950/90 border border-slate-700/80 rounded-2xl shadow-2xl backdrop-blur-md pointer-events-none">
              <div className="flex items-center justify-between text-[10px] font-bold font-['Outfit'] text-red-400">
                <span>DRIVER</span>
                <span className="font-mono text-white">{playerHealth}</span>
              </div>
              <div className="h-2 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-700 mt-0.5">
                <div className="h-full bg-rose-500" style={{ width: `${Math.max(0, playerHealth)}%` }} />
              </div>
              <div className="flex items-center justify-between text-[10px] font-bold font-['Outfit'] text-amber-300 mt-1.5">
                <span>VEHICLE</span>
                <span className="font-mono text-white">{playerVehicleHealth}</span>
              </div>
              <div className="h-2 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-700 mt-0.5">
                <div className="h-full bg-amber-400" style={{ width: `${Math.max(0, playerVehicleHealth)}%` }} />
              </div>
            </div>
          )}

          {/* Bottom Left-Center: Combat Health & Defensive Ability Gauge (Battle Arena) */}
          {gameMode === 'battle_arena' && !isMobile && (
            <div className="absolute bottom-4 left-48 z-20 flex flex-col gap-2 p-3 bg-slate-950/90 border border-slate-700/80 rounded-2xl shadow-2xl backdrop-blur-md pointer-events-auto min-w-[210px]">
              {/* Health Bar */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs font-bold font-['Outfit']">
                  <span className="flex items-center gap-1 text-red-400">
                    <Shield className="w-3.5 h-3.5" /> HP
                  </span>
                  <span className="font-mono text-white">{playerHealth} / 100</span>
                </div>
                <div className="h-3 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-700">
                  <div
                    className={`h-full transition-all duration-200 ${
                      playerHealth > 50
                        ? 'bg-gradient-to-r from-emerald-500 to-green-400'
                        : playerHealth > 25
                        ? 'bg-gradient-to-r from-amber-500 to-yellow-400'
                        : 'bg-gradient-to-r from-red-600 to-rose-500 animate-pulse'
                    }`}
                    style={{ width: `${Math.max(0, playerHealth)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[10px] font-bold text-amber-300 pt-1">
                  <span>VEHICLE</span>
                  <span className="font-mono text-white">{playerVehicleHealth}</span>
                </div>
                <div className="h-2 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-700">
                  <div className="h-full bg-amber-400" style={{ width: `${Math.max(0, playerVehicleHealth)}%` }} />
                </div>
              </div>

              {/* Shield Bar */}
              {playerShield > 0 && (
                <div className="space-y-0.5">
                  <div className="flex items-center justify-between text-[11px] font-bold text-cyan-300 font-mono">
                    <span>SHIELD</span>
                    <span>{playerShield}</span>
                  </div>
                  <div className="h-1.5 w-full bg-slate-900 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-cyan-400 transition-all duration-200"
                      style={{ width: `${(playerShield / 50) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Defensive Abilities: Boost & Dodge */}
              <div className="flex items-center gap-2 pt-1 border-t border-slate-800 text-[11px]">
                <button
                  onClick={useBoost}
                  disabled={boostCooldownTimer > 0}
                  className={`flex-1 py-1.5 px-2 rounded-lg font-bold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                    boostCooldownTimer === 0
                      ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-md shadow-amber-600/30'
                      : 'bg-slate-850 text-slate-500 border border-slate-800 cursor-not-allowed'
                  }`}
                >
                  <Flame className="w-3 h-3 text-amber-300" />
                  <span>{boostCooldownTimer === 0 ? 'NITRO [Shift]' : `${boostCooldownTimer}s`}</span>
                </button>

                <button
                  onClick={useDodge}
                  disabled={dodgeCooldownTimer > 0}
                  className={`flex-1 py-1.5 px-2 rounded-lg font-bold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                    dodgeCooldownTimer === 0
                      ? 'bg-cyan-700 hover:bg-cyan-600 text-white shadow-md shadow-cyan-700/30'
                      : 'bg-slate-850 text-slate-500 border border-slate-800 cursor-not-allowed'
                  }`}
                >
                  <Zap className="w-3 h-3 text-cyan-300" />
                  <span>{dodgeCooldownTimer === 0 ? 'DODGE [Q]' : `${dodgeCooldownTimer}s`}</span>
                </button>
              </div>
            </div>
          )}

          {/* Bottom-Right: Active Weapon Card & Fire Button (Battle Arena) */}
          {gameMode === 'battle_arena' && !isMobile && (
            <div className="absolute bottom-4 right-4 z-20 flex flex-col items-end gap-2 pointer-events-auto">
              <div className="flex items-center gap-3 p-3.5 bg-slate-950/95 border border-slate-700/80 rounded-2xl shadow-2xl backdrop-blur-md">
                <div className="text-4xl p-2 bg-slate-900 border border-slate-800 rounded-xl">
                  {currentWeaponDef ? currentWeaponDef.icon : '📦'}
                </div>
                <div className="text-left font-['Outfit'] pr-2">
                  <div className="text-xs text-slate-400 font-bold uppercase tracking-wider">
                    {currentWeaponDef ? currentWeaponDef.categoryName : 'Weapon Slot'}
                  </div>
                  <div className="text-lg font-black text-white leading-tight">
                    {currentWeaponDef ? currentWeaponDef.name : 'Drive over crates!'}
                  </div>
                  <div className="text-xs font-mono font-bold mt-0.5 text-cyan-400">
                    {currentWeaponDef ? `AMMO: ${ammo} · CD: ${(weaponCooldownMs / 1000).toFixed(1)}s` : 'DRIVE OVER CRATES'}
                  </div>
                </div>

                <button
                  onClick={fireWeapon}
                  disabled={!currentWeaponDef || ammo <= 0 || !isAlive}
                  className={`px-5 py-3 rounded-xl font-black text-sm tracking-wider font-['Outfit'] shadow-xl transition-all cursor-pointer flex items-center gap-1.5 ${
                    currentWeaponDef && ammo > 0 && isAlive
                      ? 'bg-gradient-to-r from-red-600 via-amber-600 to-amber-500 hover:from-red-500 hover:to-amber-400 text-slate-950 shadow-amber-500/30 transform hover:scale-105 active:scale-95'
                      : 'bg-slate-800/60 text-slate-500 border border-slate-700 cursor-not-allowed'
                  }`}
                >
                  <Crosshair className="w-4 h-4" />
                  <span>FIRE [SPACE]</span>
                </button>
              </div>

              <div className="flex flex-wrap justify-end gap-1 max-w-[360px]">
                {WEAPON_SLOT_ORDER.map((wType, idx) => {
                  const owned = weaponInventory[wType] || 0;
                  const def = WEAPON_CONFIGS[wType];
                  const active = equippedWeapon === wType;
                  return (
                    <button
                      key={wType}
                      onClick={() => selectWeaponSlot(idx + 1)}
                      disabled={owned <= 0}
                      className={`px-1.5 py-1 rounded-md text-[10px] font-bold border ${
                        active
                          ? 'bg-amber-500 text-slate-950 border-amber-300'
                          : owned > 0
                          ? 'bg-slate-900/90 text-white border-slate-600'
                          : 'bg-slate-950/60 text-slate-600 border-slate-800 cursor-not-allowed'
                      }`}
                      title={`${idx + 1}: ${def.name}`}
                    >
                      {idx + 1} {def.icon} {owned}
                    </button>
                  );
                })}
              </div>

              {/* Speedometer Cluster */}
              <div className="flex items-baseline justify-end gap-1 font-['Outfit'] pr-2">
                <span className="text-4xl font-black text-cyan-400 tabular-nums drop-shadow-lg">
                  {speedKmh}
                </span>
                <span className="text-xs font-bold text-slate-400 tracking-wider">KM/H</span>
              </div>
            </div>
          )}

          {/* Bottom-Right: Speedometer Cluster (Free Roam) */}
          {gameMode === 'free_roam' && !isMobile && (
            <div className="absolute bottom-4 right-4 z-20 text-right pointer-events-none">
              <div className="flex flex-col items-end gap-2 pointer-events-auto">
                <div className="flex items-center gap-3 p-3 bg-slate-950/90 border border-slate-700/80 rounded-2xl shadow-xl backdrop-blur-md">
                  <div className="text-3xl">{currentWeaponDef ? currentWeaponDef.icon : '🔫'}</div>
                  <div className="text-left font-['Outfit']">
                    <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Street Weapon</div>
                    <div className="text-sm font-black text-white leading-tight">
                      {currentWeaponDef ? currentWeaponDef.name : 'Collect a pickup'}
                    </div>
                    <div className="text-[11px] font-mono text-cyan-400">
                      {currentWeaponDef ? `AMMO ${ammo} · SPACE to fire` : 'Drive over a weapon on the road'}
                    </div>
                  </div>
                  <button
                    onClick={fireWeapon}
                    disabled={!currentWeaponDef || ammo <= 0 || !isAlive}
                    className={`px-3 py-2 rounded-xl font-black text-xs ${
                      currentWeaponDef && ammo > 0 && isAlive
                        ? 'bg-amber-500 text-slate-950'
                        : 'bg-slate-800 text-slate-500'
                    }`}
                  >
                    FIRE
                  </button>
                </div>
                <div className="flex flex-wrap justify-end gap-1 max-w-[340px]">
                  {STREET_WEAPON_ORDER.map((wType, idx) => {
                    const owned = weaponInventory[wType] || 0;
                    const def = WEAPON_CONFIGS[wType];
                    const active = equippedWeapon === wType;
                    return (
                      <button
                        key={wType}
                        onClick={() => selectWeaponSlot(idx + 1)}
                        disabled={owned <= 0}
                        className={`px-1.5 py-1 rounded-md text-[10px] font-bold border ${
                          active
                            ? 'bg-amber-500 text-slate-950 border-amber-300'
                            : owned > 0
                            ? 'bg-slate-900/90 text-white border-slate-600'
                            : 'bg-slate-950/60 text-slate-600 border-slate-800 cursor-not-allowed'
                        }`}
                        title={`${idx + 1}: ${def.name}`}
                      >
                        {idx + 1} {def.icon} {owned}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-baseline justify-end gap-1 font-['Outfit'] mt-2 pointer-events-none">
                <span className="text-5xl font-black text-cyan-400 tabular-nums drop-shadow-lg">
                  {speedKmh}
                </span>
                <span className="text-sm font-bold text-slate-400 tracking-wider">KM/H</span>
              </div>
              <div className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-0.5 pointer-events-none">
                {VEHICLE_CONFIGS[selectedVehicle]?.name || 'Vehicle'}
              </div>
            </div>
          )}

          {/* Bottom-Center: Available Missions Pill Bar (Free Roam) */}
          {!activeMission && gameMode === 'free_roam' && !isMobile && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-slate-950/85 border border-slate-700/60 p-1.5 rounded-xl backdrop-blur-md shadow-2xl pointer-events-auto max-w-[90vw] overflow-x-auto">
              {MISSIONS.map(m => (
                <button
                  key={m.id}
                  onClick={() => startMission(m)}
                  className="px-3 py-1.5 bg-slate-800/90 hover:bg-amber-500 hover:text-slate-950 border border-slate-700 hover:border-amber-400 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5"
                >
                  <Trophy className="w-3.5 h-3.5 text-amber-400" />
                  {m.title}
                </button>
              ))}
            </div>
          )}

          {/* Bottom Chat Overlay (Toggleable with T / Escape / Minimize Button) */}
          <div className={`${isMobile ? 'hidden' : ''} absolute bottom-20 left-4 z-20 w-84 max-w-[85vw] pointer-events-auto`}>
            {isChatOpen ? (
              <div className="bg-slate-950/95 border border-slate-700/80 rounded-xl p-3 shadow-2xl backdrop-blur-md">
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800 text-xs">
                  <div className="flex items-center gap-1.5 font-bold text-cyan-400">
                    <MessageSquare className="w-3.5 h-3.5" /> Dal Lake Lobby Chat
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setIsChatOpen(false)}
                      title="Minimize chat window"
                      className="flex items-center gap-1 px-2 py-0.5 bg-slate-850 hover:bg-slate-800 text-slate-300 hover:text-white rounded text-[11px] font-semibold cursor-pointer transition-colors border border-slate-700"
                    >
                      <Minus className="w-3 h-3" /> Minimize
                    </button>
                    <button
                      onClick={() => setIsChatOpen(false)}
                      title="Close Chat"
                      className="p-1 hover:bg-slate-800 text-slate-400 hover:text-white rounded cursor-pointer transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="h-32 overflow-y-auto space-y-1 text-xs pr-1 font-mono">
                  {chatMessages.length === 0 ? (
                    <div className="text-slate-500 italic py-2 text-center">
                      No messages yet. Say hello to other drivers!
                    </div>
                  ) : (
                    chatMessages.map(msg => (
                      <div key={msg.id} className="leading-tight">
                        <span className="font-bold text-cyan-400">{msg.senderName}: </span>
                        <span className="text-slate-200">{msg.text}</span>
                      </div>
                    ))
                  )}
                </div>

                <form onSubmit={handleSendChat} className="flex gap-2 mt-2 pt-2 border-t border-slate-800">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    placeholder="Type message (Enter)..."
                    maxLength={100}
                    className="flex-1 px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-white focus:outline-none focus:border-cyan-400"
                    autoFocus
                  />
                  <button type="submit" className="p-1.5 bg-cyan-600 hover:bg-cyan-500 rounded text-white cursor-pointer">
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </form>
              </div>
            ) : (
              <button
                onClick={() => setIsChatOpen(true)}
                title="Expand chat window (Press Key T)"
                className="flex items-center gap-2 px-3 py-1.5 bg-slate-900/90 hover:bg-slate-800 border border-slate-700 hover:border-cyan-400/50 text-xs font-bold text-slate-200 rounded-lg backdrop-blur-md shadow-lg cursor-pointer transition-all transform hover:scale-105"
              >
                <MessageSquare className="w-3.5 h-3.5 text-cyan-400" />
                <span>Chat ({chatMessages.length})</span>
                <span className="text-[10px] px-1.5 py-0.5 bg-cyan-950 text-cyan-300 border border-cyan-800 rounded font-mono">
                  [T] Expand
                </span>
              </button>
            )}
          </div>

          {isMobile && isAlive && (
            <div className="absolute inset-x-0 bottom-0 z-40 px-4 pb-[max(10px,env(safe-area-inset-bottom))] pt-6 bg-gradient-to-t from-slate-950/80 to-transparent pointer-events-none">
              <div className="flex items-end justify-between gap-4">
                <div className="flex gap-2 pointer-events-auto items-end">
                  <MobileHoldButton
                    label={<ChevronLeft className="w-9 h-9" />}
                    onHoldChange={held => {
                      touchSteerRef.current.left = held;
                      isMobileRef.current = true;
                    }}
                    className="w-[68px] h-[68px] rounded-2xl bg-slate-900/90 border-2 border-white/20 text-white flex items-center justify-center shadow-xl active:bg-cyan-500 active:text-slate-950"
                  />
                  <MobileHoldButton
                    label={
                      <span className="flex flex-col items-center leading-none">
                        <Square className="w-5 h-5 mb-1 fill-current" />
                        <span className="text-[10px] font-black tracking-widest">BRAKE</span>
                      </span>
                    }
                    onHoldChange={held => {
                      touchBrakeRef.current = held;
                      isMobileRef.current = true;
                    }}
                    className="w-[68px] h-[68px] rounded-2xl bg-red-950/90 border-2 border-red-400/70 text-red-200 flex items-center justify-center shadow-xl active:bg-red-500 active:text-white"
                  />
                  <MobileHoldButton
                    label={<ChevronRight className="w-9 h-9" />}
                    onHoldChange={held => {
                      touchSteerRef.current.right = held;
                      isMobileRef.current = true;
                    }}
                    className="w-[68px] h-[68px] rounded-2xl bg-slate-900/90 border-2 border-white/20 text-white flex items-center justify-center shadow-xl active:bg-cyan-500 active:text-slate-950"
                  />
                </div>
                <MobileHoldButton
                  label={
                    <span className="flex flex-col items-center leading-none">
                      <Crosshair className="w-7 h-7 mb-1" />
                      <span className="text-sm font-black tracking-widest">FIRE</span>
                    </span>
                  }
                  onHoldChange={held => {
                    touchFireRef.current = held;
                  }}
                  onTap={fireWeapon}
                  className={`w-[92px] h-[92px] rounded-full border-4 flex items-center justify-center shadow-2xl font-['Outfit'] ${
                    currentWeaponDef && ammo > 0
                      ? 'bg-gradient-to-br from-red-600 to-amber-500 border-amber-200 text-slate-950'
                      : 'bg-slate-800/90 border-slate-600 text-slate-400'
                  }`}
                />
              </div>
            </div>
          )}
        </>
      )}

      {/* Vehicle Garage Modal */}
      {isGarageOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="text-2xl font-black text-white font-['Outfit'] flex items-center gap-2">
                <Car className="w-6 h-6 text-cyan-400" /> Lakeside Garage
              </h2>
              <button
                onClick={() => setIsGarageOpen(false)}
                className="text-slate-400 hover:text-white font-bold text-xl cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              {(Object.keys(VEHICLE_CONFIGS) as VehicleCategory[]).map(vId => {
                const v = VEHICLE_CONFIGS[vId];
                const isSelected = selectedVehicle === vId;

                return (
                  <div
                    key={vId}
                    className={`p-4 rounded-xl border transition-all ${
                      isSelected ? 'border-cyan-400 bg-cyan-950/30' : 'border-slate-700 bg-slate-800/40 hover:border-slate-500'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-bold text-white text-base font-['Outfit']">{v.name}</h4>
                        <span className="text-xs text-slate-400 font-semibold">{v.categoryName}</span>
                      </div>
                    </div>
                    <p className="text-xs text-slate-300 mt-2 line-clamp-2 leading-relaxed">{v.description}</p>
                    <div className="flex items-center justify-between text-xs text-slate-400 mt-3 pt-2 border-t border-slate-800">
                      <span>Top Speed: <b>{(v.maxSpeed * 3.6).toFixed(0)} km/h</b></span>
                      <span>Mass: <b>{v.mass} kg</b></span>
                    </div>
                    <div className="mt-3">
                      <button
                        onClick={() => switchVehicle(vId)}
                        className={`w-full py-2 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-cyan-500 text-slate-950 font-black'
                            : 'bg-emerald-600 hover:bg-emerald-500 text-white font-bold'
                        }`}
                      >
                        {isSelected ? 'CURRENTLY DRIVING' : 'DRIVE THIS VEHICLE'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Match Results / Winner Celebration (auto-advances with the round) */}
      {isMatchResultsOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-md pointer-events-none">
          <div className="bg-slate-900 border-2 border-amber-500/80 rounded-3xl max-w-xl w-full p-6 sm:p-8 shadow-2xl text-center space-y-4 animate-fade-in-up">
            <div className="text-6xl animate-bounce">🎆🏆🎆</div>
            <h2 className="text-4xl font-black text-amber-300 font-['Outfit'] tracking-tight">
              {matchState.sharedVictory ? 'SHARED VICTORY!' : 'WE HAVE A WINNER!'}
            </h2>
            <div className="text-2xl font-black text-white font-['Outfit']">
              {matchState.winnerName || 'No Contest'}
            </div>
            <div className="text-sm text-amber-200">
              Next round starts automatically — stay in the room to play.
            </div>

            <div className="grid grid-cols-4 gap-2 p-4 bg-slate-950/70 border border-slate-800 rounded-2xl">
              <div>
                <div className="text-[10px] text-slate-400 uppercase">Kills</div>
                <div className="text-xl font-black font-mono">{kills}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400 uppercase">Deaths</div>
                <div className="text-xl font-black font-mono">{deaths}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400 uppercase">K/D</div>
                <div className="text-xl font-black font-mono text-cyan-400">
                  {kills > 0 && deaths === 0 ? '∞' : (kills / Math.max(1, deaths)).toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400 uppercase">Damage</div>
                <div className="text-xl font-black font-mono text-amber-300">{damageDealt}</div>
              </div>
            </div>

            {matchState.leaderboard && matchState.leaderboard.length > 0 && (
              <div className="text-left space-y-1 max-h-40 overflow-y-auto">
                {matchState.leaderboard.slice(0, 8).map(row => (
                  <div key={row.playerId} className={`flex items-center justify-between text-xs px-3 py-1.5 rounded-lg ${row.rank <= 3 ? 'bg-amber-950/50 text-amber-200' : 'bg-slate-950/60 text-slate-300'}`}>
                    <span>#{row.rank} {row.name}</span>
                    <span className="font-mono">{row.kills}/{row.deaths} · {row.kdDisplay}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
