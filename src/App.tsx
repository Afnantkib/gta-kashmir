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
  ARENA_BOUNDS,
  ARENA_SPAWNS,
  ROAD_BOUNDS,
} from './shared/types.ts';
import { createVehicleMesh, VehicleMeshBundle } from './game/vehicles.ts';
import { buildSrinagarWorld, WorldObjects } from './game/world.ts';
import { buildBattleArena, ArenaManager } from './game/arena.ts';

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
    lookAheadBase: 3.5,
    lookAheadSpeed: 3.5,
    baseFov: 60,
    maxFovBoost: 3.0,
  },
  taxi: {
    // Kashmir Ambassador Taxi: classic sedan profile
    dist: 7.2,
    height: 2.8,
    lookHeight: 1.25,
    lookAheadBase: 4.0,
    lookAheadSpeed: 4.0,
    baseFov: 60,
    maxFovBoost: 3.5,
  },
  police: {
    // J&K Police Cruiser: pursuit cruiser framing
    dist: 7.4,
    height: 2.8,
    lookHeight: 1.25,
    lookAheadBase: 4.2,
    lookAheadSpeed: 4.5,
    baseFov: 60,
    maxFovBoost: 3.5,
  },
  bike: {
    // Royal Enfield Bullet 350: closer, lower motorcycle chase view
    dist: 5.2,
    height: 2.3,
    lookHeight: 1.15,
    lookAheadBase: 3.8,
    lookAheadSpeed: 4.0,
    baseFov: 60,
    maxFovBoost: 3.0,
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
  RefreshCw,
  Skull,
} from 'lucide-react';

export default function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const minimapCanvasRef = useRef<HTMLCanvasElement>(null);

  // Game UI State
  const [hasStarted, setHasStarted] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [cash, setCash] = useState(1500);
  const [speedKmh, setSpeedKmh] = useState(0);
  const [wantedStars, setWantedStars] = useState(0);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleCategory>('auto');
  const [unlockedVehicles, setUnlockedVehicles] = useState<VehicleCategory[]>(['auto', 'taxi', 'police', 'bike']);
  const [isGarageOpen, setIsGarageOpen] = useState(false);
  const [connectedPlayersCount, setConnectedPlayersCount] = useState(1);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [callsign, setCallsign] = useState(() => `Driver_${Math.floor(1000 + Math.random() * 9000)}`);
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
  const [playerShield, setPlayerShield] = useState(0);
  const [equippedWeapon, setEquippedWeapon] = useState<WeaponType | null>(null);
  const [ammo, setAmmo] = useState(0);
  const [kills, setKills] = useState(0);
  const [damageDealt, setDamageDealt] = useState(0);
  const [isAlive, setIsAlive] = useState(true);
  const [missileWarning, setMissileWarning] = useState(false);
  const [redHitFlash, setRedHitFlash] = useState(false);

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

  // References to live mutable game state
  const clashTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const crashShakeRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const playerIdRef = useRef<string>(`p_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`);
  const inputSeqRef = useRef(0);
  const keysRef = useRef<{ [k: string]: boolean }>({});
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
        isAlive?: boolean;
      }
    >
  >(new Map());

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
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
  const fireWeapon = useCallback(() => {
    if (gameModeRef.current !== 'battle_arena' || !isAlive) return;
    if (!equippedWeapon || ammo <= 0) {
      showToast('⚠️ No weapon equipped! Drive over glowing crates to pick up weapons.');
      return;
    }

    const now = Date.now();
    const wCfg = WEAPON_CONFIGS[equippedWeapon];
    if (now - lastFireTimeRef.current < wCfg.cooldownMs) return;
    lastFireTimeRef.current = now;

    // Snappy procedural client sound
    switch (equippedWeapon) {
      case 'machinegun':
        playMachineGunFX();
        break;
      case 'rocket':
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
        playHazardDropFX(equippedWeapon);
        break;
      case 'homing':
        playRocketLaunchFX();
        break;
    }

    // Decrement local predicted ammo
    setAmmo(prev => {
      const next = prev - 1;
      if (next <= 0) {
        setEquippedWeapon(null);
      }
      return Math.max(0, next);
    });

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'FIRE_WEAPON' }));
    }
  }, [equippedWeapon, ammo, isAlive, showToast]);

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
    }, 100);
    return () => clearInterval(timer);
  }, []);

  // Claim Mission Reward with server idempotency
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

      // Combat key triggers
      if (gameModeRef.current === 'battle_arena' && !isChatOpen && !isInputFocused) {
        if (e.code === 'Space') {
          e.preventDefault();
          fireWeapon();
          return;
        }
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
      } else if (!isChatOpen) {
        if (e.code === 'Digit1' || e.code === 'Numpad1') switchVehicle('auto');
        if (e.code === 'Digit2' || e.code === 'Numpad2') switchVehicle('taxi');
        if (e.code === 'Digit3' || e.code === 'Numpad3') switchVehicle('police');
        if (e.code === 'Digit4' || e.code === 'Numpad4') switchVehicle('bike');
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current[e.code] = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [isChatOpen, switchVehicle, fireWeapon, useBoost, useDodge, showToast]);

  // --------------------------------------------------------------------------
  // Initialize Three.js Game Scene & Loop
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!mountRef.current) return;

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
    const world = buildSrinagarWorld(scene);
    worldObjectsRef.current = world;

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
      ws.send(
        JSON.stringify({
          type: 'JOIN',
          playerId: playerIdRef.current,
          name: callsign,
          vehicle: selectedVehicle,
          mode: gameModeRef.current,
        })
      );
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
          if (msg.matchState) {
            setMatchState(msg.matchState);
          }
        } else if (msg.type === 'STATE_SNAPSHOT') {
          const players: PlayerServerState[] = msg.players || [];
          setConnectedPlayersCount(players.length);

          if (msg.crates) serverCratesRef.current = msg.crates;
          if (msg.projectiles) serverProjectilesRef.current = msg.projectiles;
          if (msg.hazards) serverHazardsRef.current = msg.hazards;
          if (msg.matchState) {
            setMatchState(msg.matchState);
            if (msg.matchState.state === 'finished' && !isMatchResultsOpen) {
              setIsMatchResultsOpen(true);
            }
          }

          // Sync local combat data from server snapshot
          const localServerPlayer = players.find(p => p.id === playerIdRef.current);
          if (localServerPlayer?.combat) {
            setPlayerHealth(localServerPlayer.combat.health);
            setPlayerShield(localServerPlayer.combat.shield);
            setKills(localServerPlayer.combat.kills);
            setDamageDealt(localServerPlayer.combat.damageDealt);
            setIsAlive(localServerPlayer.combat.isAlive);
            if (localServerPlayer.combat.weapon) {
              setEquippedWeapon(localServerPlayer.combat.weapon);
              setAmmo(localServerPlayer.combat.ammo);
            }
          }

          // Remote vehicles
          for (const p of players) {
            if (p.id === playerIdRef.current) continue;

            remoteTargetsRef.current.set(p.id, {
              x: p.x,
              y: p.y,
              z: p.z,
              heading: p.heading,
              speed: p.speed,
              steer: p.steerAngle,
              vehicle: p.vehicle,
              name: p.name,
              health: p.combat?.health,
              isAlive: p.combat?.isAlive,
            });

            // Ensure remote mesh exists in scene
            if (!remoteVehicleBundlesRef.current.has(p.id)) {
              const rMesh = createVehicleMesh(p.vehicle);
              remoteVehicleBundlesRef.current.set(p.id, rMesh);
              scene.add(rMesh.root);
            }
          }

          // Clean up disconnected players
          const activeIds = new Set(players.map(pl => pl.id));
          for (const [rId, bundle] of remoteVehicleBundlesRef.current.entries()) {
            if (!activeIds.has(rId)) {
              scene.remove(bundle.root);
              remoteVehicleBundlesRef.current.delete(rId);
              remoteTargetsRef.current.delete(rId);
            }
          }
        } else if (msg.type === 'WEAPON_ACQUIRED') {
          playCratePickupFX();
          setEquippedWeapon(msg.weapon);
          setAmmo(msg.ammo);
          const wCfg = WEAPON_CONFIGS[msg.weapon as WeaponType];
          showToast(`📦 Acquired: ${wCfg?.icon} ${wCfg?.name} (${msg.ammo}x)`);
        } else if (msg.type === 'DAMAGE_EVENT') {
          const ev: DamageEvent = msg.event;
          arenaManagerRef.current?.triggerDamageNumberFX(ev);

          if (ev.victimId === playerIdRef.current) {
            setRedHitFlash(true);
            setTimeout(() => setRedHitFlash(false), 260);
            playCrashFX();
            crashShakeRef.current = 0.55;
          }
        } else if (msg.type === 'EXPLOSION') {
          playExplosionFX();
          arenaManagerRef.current?.triggerExplosionFX(msg.x, msg.z, msg.weaponType, msg.radius);
        } else if (msg.type === 'COMBAT_EFFECT') {
          if (msg.effect === 'emp_shockwave') {
            playEmpShockwaveFX();
            arenaManagerRef.current?.triggerEmpShockwaveFX(msg.x, msg.z, msg.radius || 14.0);
          }
        } else if (msg.type === 'PLAYER_ELIMINATED') {
          playEliminationHorn();
          const wCfg = WEAPON_CONFIGS[msg.weaponType as WeaponType];
          const feedItem = {
            id: `kf_${Date.now()}_${Math.random()}`,
            text: `${msg.attackerName} eliminated ${msg.victimName}`,
            icon: wCfg?.icon || '💥',
          };
          setKillFeed(prev => [...prev.slice(-4), feedItem]);

          if (msg.victimId === playerIdRef.current) {
            setIsAlive(false);
            showToast('💀 You were ELIMINATED! Spectating remaining combatants...');
          } else if (msg.attackerId === playerIdRef.current) {
            showToast(`🎯 ELIMINATION CONFIRMED: ${msg.victimName}!`);
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
      const up = keys['ArrowUp'] || keys['KeyW'];
      const dn = keys['ArrowDown'] || keys['KeyS'];
      const lf = keys['ArrowLeft'] || keys['KeyA'];
      const rt = keys['ArrowRight'] || keys['KeyD'];
      const space = !!keys['Space'];

      const loc = localStateRef.current;
      const vCfg = VEHICLE_CONFIGS[loc.vehicle] || VEHICLE_CONFIGS.auto;

      // Local Vehicle Input & Prediction
      if (hasStarted) {
        let accel = 0;
        if (up) accel += vCfg.acceleration;
        if (dn) {
          if (loc.speed > 0.5) accel -= vCfg.brakeForce;
          else accel -= vCfg.acceleration * 0.7; // reverse
        }
        // In free roam, space is handbrake. In battle arena, space is fire
        if (space && gameModeRef.current === 'free_roam') {
          accel -= Math.sign(loc.speed) * vCfg.brakeForce * 1.5;
        }

        const drag = 0.45 * loc.speed;
        loc.speed += (accel - drag) * dt;
        loc.speed = Math.max(-vCfg.reverseSpeed, Math.min(vCfg.maxSpeed, loc.speed));

        // Steering: Left arrow turns left (+heading), Right arrow turns right (-heading)
        const steerTarget = (lf ? 1 : 0) - (rt ? 1 : 0);
        loc.steerAngle += (steerTarget - loc.steerAngle) * Math.min(1, 14 * dt);

        const turnRate = vCfg.turnSpeed * loc.steerAngle * Math.max(-1, Math.min(1, loc.speed / 4.0));
        loc.heading += turnRate * dt;

        loc.x += Math.sin(loc.heading) * loc.speed * dt;
        loc.z += Math.cos(loc.heading) * loc.speed * dt;

        // Collision helper
        const reportClash = (obstacle: string) => {
          playCollisionAudio();
          crashShakeRef.current = Math.min(0.7, Math.max(0.3, Math.abs(loc.speed) * 0.025 + 0.2));
          setClashNotification(`💥 CLASH! [${obstacle}] — Shahid Tariq: Danisha Kale Ha Phot`);
          if (clashTimeoutRef.current) clearTimeout(clashTimeoutRef.current);
          clashTimeoutRef.current = setTimeout(() => {
            setClashNotification(null);
          }, 3500);
        };

        // Mode-Specific Boundaries
        if (gameModeRef.current === 'battle_arena') {
          if (loc.x <= ARENA_BOUNDS.MIN_X) {
            loc.x = ARENA_BOUNDS.MIN_X;
            reportClash('West Arena Grandstand Wall');
            loc.speed = -loc.speed * 0.35;
          } else if (loc.x >= ARENA_BOUNDS.MAX_X) {
            loc.x = ARENA_BOUNDS.MAX_X;
            reportClash('East Arena Lake Barrier');
            loc.speed = -loc.speed * 0.35;
          }
          if (loc.z <= ROAD_BOUNDS.MIN_Z) {
            loc.z = ROAD_BOUNDS.MIN_Z;
            reportClash('Dalgate Game End Boundary Wall');
            loc.speed = -loc.speed * 0.4;
          } else if (loc.z >= ROAD_BOUNDS.MAX_Z && loc.x >= -24 && loc.x <= 18) {
            loc.z = ROAD_BOUNDS.MAX_Z;
            reportClash('North Checkpoint Barrier Wall');
            loc.speed = -loc.speed * 0.45;
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
            loc.speed = -loc.speed * 0.35;
          }

          if (loc.x >= 17.2) {
            loc.x = 17.2;
            reportClash('Dal Lake Promenade Railing Wall');
            loc.speed = -loc.speed * 0.35;
          }

          if (loc.z <= -430.0) {
            loc.z = -430.0;
            reportClash('Dalgate Game End Boundary Wall');
            loc.speed = -loc.speed * 0.4;
          }

          if (loc.z >= 411.4 && loc.x >= -26 && loc.x <= 18) {
            loc.z = 411.4;
            reportClash('North Checkpoint Barrier Wall');
            loc.speed = -loc.speed * 0.45;
          }
        }

        // Collision with other vehicles
        for (const [, target] of remoteTargetsRef.current.entries()) {
          const dx = loc.x - target.x;
          const dz = loc.z - target.z;
          const dist = Math.hypot(dx, dz);
          const collisionRadius = 2.8;
          if (dist < collisionRadius) {
            reportClash(`${target.name || 'Vehicle'}`);
            const pushDir = Math.atan2(dx, dz);
            loc.x += Math.sin(pushDir) * (collisionRadius - dist) * 0.7;
            loc.z += Math.cos(pushDir) * (collisionRadius - dist) * 0.7;
            loc.speed = -loc.speed * 0.35;
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
              handbrake: space && gameModeRef.current === 'free_roam',
              vehicleType: loc.vehicle,
              clientTime: Date.now(),
            };
            ws.send(JSON.stringify({ type: 'INPUT', input: pkt }));
          }
        }
      }

      // Smooth Entity Interpolation for Remote Players
      for (const [rId, target] of remoteTargetsRef.current.entries()) {
        const bundle = remoteVehicleBundlesRef.current.get(rId);
        if (bundle) {
          bundle.root.position.x += (target.x - bundle.root.position.x) * Math.min(1, 14 * dt);
          bundle.root.position.z += (target.z - bundle.root.position.z) * Math.min(1, 14 * dt);
          bundle.root.rotation.y += (target.heading - bundle.root.rotation.y) * Math.min(1, 14 * dt);
          if (bundle.frontSteerGroup) {
            bundle.frontSteerGroup.rotation.y = target.steer * 0.45;
          }
          for (const w of bundle.wheels) {
            w.rotation.x += (target.speed / 0.3) * dt;
          }
          // Hide eliminated players
          bundle.root.visible = target.isAlive !== false;
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
            claimMissionReward(curMission);
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
        const isReversing = loc.speed < -0.8;

        // Vehicle-calibrated camera profile
        const profile = VEHICLE_CAMERA_PROFILES[loc.vehicle] || VEHICLE_CAMERA_PROFILES.auto;

        // 1. Maintain consistent vehicle screen size across 0 to 200 km/h:
        // Do NOT continuously increase camera distance based on vehicle speed.
        // Screen size remains consistent at all speeds.
        const targetDist = profile.dist;
        const targetHeight = profile.height;

        // 2. Critical-damped rotational follow (heading only):
        // Damping the camera heading rather than Cartesian XYZ position eliminates
        // velocity lag distance completely while preserving smooth turning arcs.
        let diff = loc.heading - camHeadingRef.current;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        const headingTrackingSpeed = Math.abs(loc.speed) > 1.0 ? 8.5 : 5.0;
        camHeadingRef.current += diff * (1 - Math.exp(-headingTrackingSpeed * dt));

        const camFx = Math.sin(camHeadingRef.current);
        const camFz = Math.cos(camHeadingRef.current);

        // 3. Subtle speed-aware look-ahead along vehicle trajectory:
        // Forward driving extends look-ahead down the road so oncoming turns and scenery are visible.
        // Angles view slightly forward, placing the vehicle stably in the lower-middle portion of the screen.
        const lookDir = isReversing ? -0.8 : 1.0;
        const lookAheadDist = profile.lookAheadBase + speedRatio * profile.lookAheadSpeed;
        const vehFx = Math.sin(loc.heading);
        const vehFz = Math.cos(loc.heading);

        const lookTargetX = loc.x + vehFx * lookAheadDist * lookDir;
        const lookTargetZ = loc.z + vehFz * lookAheadDist * lookDir;
        const lookTargetY = profile.lookHeight;

        // 4. Subtle FOV adjustment (minimal change: 60 deg to max 63.5 deg to avoid shrinking vehicle)
        const targetFov = profile.baseFov + speedRatio * profile.maxFovBoost;
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
        cam.position.x = loc.x - camFx * targetDist + sShakeX + cShakeX;
        cam.position.y = targetHeight + sShakeY + cShakeY;
        cam.position.z = loc.z - camFz * targetDist + cShakeZ;

        cam.lookAt(lookTargetX, lookTargetY, lookTargetZ);
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

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      if (ws.readyState === WebSocket.OPEN) ws.close();
      arenaManager.dispose();
      renderer.dispose();
      if (mountRef.current && renderer.domElement) {
        mountRef.current.removeChild(renderer.domElement);
      }
    };
  }, [hasStarted, callsign, selectedVehicle, claimMissionReward, showToast]);

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
    }

    // Remote Players / Bots Blips
    for (const [, target] of remoteTargetsRef.current.entries()) {
      const rx = mx(target.x);
      const ry = my(target.z);
      if (rx >= 0 && rx <= 160 && ry >= 0 && ry <= 128) {
        ctx.fillStyle = target.vehicle === 'police' ? '#3b82f6' : '#f59e0b';
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

      {/* Red Hit Flash Overlay */}
      {redHitFlash && (
        <div className="absolute inset-0 z-30 pointer-events-none bg-red-600/30 animate-pulse border-8 border-red-500/80" />
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
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center p-6 bg-gradient-to-b from-slate-950/90 via-sky-950/85 to-slate-950/95 backdrop-blur-md">
          <div className="text-center max-w-xl space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-500/20 border border-amber-500/40 rounded-full text-amber-300 text-sm font-semibold tracking-wider uppercase">
              <Sparkles className="w-4 h-4 text-amber-400" /> Open-World 3D Srinagar & Battle Arena
            </div>
            <h1 className="text-6xl md:text-7xl font-extrabold tracking-tight text-white drop-shadow-lg font-['Outfit']">
              GTA KASHMIR
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

            <div className="text-xs text-slate-400 flex flex-wrap items-center justify-center gap-3 pt-4 border-t border-slate-800">
              <span><b>WASD / Arrows</b> Drive</span>
              <span>·</span>
              <span><b>Space</b> Fire Weapon / Handbrake</span>
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
          {/* Top Center: Game Mode Switcher Tab Bar */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 pointer-events-auto flex items-center p-1 bg-slate-950/85 border border-slate-700 rounded-2xl shadow-2xl backdrop-blur-md">
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
          <div className="absolute top-4 left-4 z-20 flex flex-col gap-1 pointer-events-none">
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
                <Users className="w-3.5 h-3.5" /> {connectedPlayersCount} Online
              </span>
            </div>
          </div>

          {/* Top Center-Sub: Match Info in Battle Arena */}
          {gameMode === 'battle_arena' && (
            <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 flex items-center gap-4 px-5 py-2 bg-slate-950/90 border border-slate-700/80 rounded-2xl shadow-xl backdrop-blur-md pointer-events-none text-xs font-bold font-['Outfit']">
              <div className="flex items-center gap-1.5 text-amber-400 font-mono text-sm">
                <span>⏱️</span>
                <span>
                  {Math.floor(matchState.timerSec / 60)}:
                  {String(matchState.timerSec % 60).padStart(2, '0')}
                </span>
              </div>
              <div className="h-4 w-[1px] bg-slate-700" />
              <div className="flex items-center gap-1.5 text-emerald-400">
                <Users className="w-3.5 h-3.5" />
                <span>{matchState.playersAlive} ALIVE</span>
              </div>
              <div className="h-4 w-[1px] bg-slate-700" />
              <div className="flex items-center gap-1.5 text-red-400">
                <Skull className="w-3.5 h-3.5" />
                <span>{kills} KILLS</span>
              </div>
            </div>
          )}

          {/* Top-Right: Quick Vehicle Switcher & Garage Button */}
          <div className="absolute top-4 right-4 z-20 flex items-center gap-2 pointer-events-auto">
            <div className="hidden md:flex items-center gap-1 bg-slate-950/80 border border-slate-700/70 p-1 rounded-xl backdrop-blur-md shadow-xl">
              <button
                onClick={() => switchVehicle('auto')}
                title="Switch to Electric Battery Auto (Hotkey 1)"
                className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  selectedVehicle === 'auto'
                    ? 'bg-cyan-500 text-slate-950 font-black shadow-md shadow-cyan-500/30'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                ⚡ [1] Auto
              </button>
              <button
                onClick={() => switchVehicle('taxi')}
                title="Switch to Ambassador Taxi (Hotkey 2)"
                className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  selectedVehicle === 'taxi'
                    ? 'bg-cyan-500 text-slate-950 font-black shadow-md shadow-cyan-500/30'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                🚕 [2] Taxi
              </button>
              <button
                onClick={() => switchVehicle('police')}
                title="Switch to Police Cruiser (Hotkey 3)"
                className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  selectedVehicle === 'police'
                    ? 'bg-cyan-500 text-slate-950 font-black shadow-md shadow-cyan-500/30'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                🚨 [3] Police
              </button>
              <button
                onClick={() => switchVehicle('bike')}
                title="Switch to Bullet 350 (Hotkey 4)"
                className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  selectedVehicle === 'bike'
                    ? 'bg-cyan-500 text-slate-950 font-black shadow-md shadow-cyan-500/30'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                🏍️ [4] Bullet
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

          {/* Top-Right Kill Feed (Battle Arena) */}
          {gameMode === 'battle_arena' && killFeed.length > 0 && (
            <div className="absolute top-18 right-4 z-20 flex flex-col gap-1.5 pointer-events-none max-w-xs">
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

          {/* Active Mission HUD Card (Free Roam) */}
          {activeMission && gameMode === 'free_roam' && (
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
          {clashNotification && (
            <div className="absolute top-24 left-1/2 -translate-x-1/2 z-20 px-5 py-2.5 bg-slate-950/90 border border-cyan-400/80 rounded-xl shadow-2xl text-xs sm:text-sm font-bold text-cyan-300 font-['Outfit'] backdrop-blur-md pointer-events-none flex items-center gap-2 animate-bounce">
              <Sparkles className="w-4 h-4 text-cyan-400 animate-spin" />
              <span>{clashNotification}</span>
            </div>
          )}

          {/* Toast Notification */}
          {toastMessage && (
            <div className="absolute top-36 left-1/2 -translate-x-1/2 z-30 px-6 py-2.5 bg-slate-900/95 border border-cyan-500/60 rounded-xl shadow-2xl text-sm font-bold text-white font-['Outfit'] backdrop-blur-md pointer-events-none animate-fade-in-down">
              {toastMessage}
            </div>
          )}

          {/* Bottom-Left: 2D Radar Minimap */}
          <div className="absolute bottom-4 left-4 z-20 pointer-events-auto">
            <div className="relative border-2 border-slate-600 rounded-xl overflow-hidden shadow-2xl bg-slate-950/80">
              <canvas ref={minimapCanvasRef} width={160} height={128} className="block" />
              <div className="absolute bottom-1 right-2 text-[10px] text-slate-400 font-bold tracking-wider">
                {gameMode === 'battle_arena' ? 'ARENA' : 'SRINAGAR'}
              </div>
            </div>
          </div>

          {/* Bottom Left-Center: Combat Health & Defensive Ability Gauge (Battle Arena) */}
          {gameMode === 'battle_arena' && (
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
          {gameMode === 'battle_arena' && (
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
                    {currentWeaponDef ? `AMMO: ${ammo} SHOTS` : 'CRATES: 3-5 ACTIVE'}
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
          {gameMode === 'free_roam' && (
            <div className="absolute bottom-4 right-4 z-20 text-right pointer-events-none">
              <div className="flex items-baseline justify-end gap-1 font-['Outfit']">
                <span className="text-5xl font-black text-cyan-400 tabular-nums drop-shadow-lg">
                  {speedKmh}
                </span>
                <span className="text-sm font-bold text-slate-400 tracking-wider">KM/H</span>
              </div>
              <div className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-0.5">
                {VEHICLE_CONFIGS[selectedVehicle]?.name || 'Vehicle'}
              </div>
            </div>
          )}

          {/* Bottom-Center: Available Missions Pill Bar (Free Roam) */}
          {!activeMission && gameMode === 'free_roam' && (
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
          <div className="absolute bottom-20 left-4 z-20 w-84 max-w-[85vw] pointer-events-auto">
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

      {/* Match Results Modal */}
      {isMatchResultsOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md">
          <div className="bg-slate-900 border-2 border-amber-500/80 rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl text-center space-y-5 animate-fade-in-up">
            <div className="text-5xl">🏆</div>
            <h2 className="text-3xl font-black text-white font-['Outfit'] tracking-tight">
              MATCH CONCLUDED!
            </h2>
            <div className="text-lg font-bold text-amber-400 font-['Outfit']">
              Winner: {matchState.winnerName || 'Combatant'}
            </div>

            <div className="grid grid-cols-3 gap-3 p-4 bg-slate-950/70 border border-slate-800 rounded-2xl">
              <div>
                <div className="text-xs text-slate-400 font-semibold uppercase">Your Kills</div>
                <div className="text-2xl font-black text-white font-mono">{kills}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400 font-semibold uppercase">Damage Dealt</div>
                <div className="text-2xl font-black text-cyan-400 font-mono">{damageDealt}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400 font-semibold uppercase">Reward</div>
                <div className="text-2xl font-black text-emerald-400 font-mono">
                  +₹{kills * 500 + (matchState.winnerId === playerIdRef.current ? 5000 : 1500)}
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <button
                onClick={() => {
                  setIsMatchResultsOpen(false);
                  if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({ type: 'RESTART_ARENA_MATCH' }));
                  }
                }}
                className="w-full sm:w-auto px-7 py-3 bg-gradient-to-r from-red-600 to-amber-500 hover:from-red-500 hover:to-amber-400 text-slate-950 font-black text-base rounded-xl shadow-lg cursor-pointer font-['Outfit'] flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" /> REMATCH (PLAY AGAIN)
              </button>

              <button
                onClick={() => {
                  setIsMatchResultsOpen(false);
                  switchGameMode('free_roam');
                }}
                className="w-full sm:w-auto px-6 py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm rounded-xl border border-slate-700 cursor-pointer font-['Outfit']"
              >
                RETURN TO BOULEVARD
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
