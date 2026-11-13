import * as THREE from 'three';
import {
  ARENA_BOUNDS,
  WeaponType,
  ArenaCrateState,
  ArenaProjectileState,
  ArenaHazardState,
  DamageEvent,
} from '../shared/types.ts';

export interface ArenaManager {
  group: THREE.Group;
  crateMeshes: Map<string, THREE.Group>;
  projectileMeshes: Map<string, THREE.Group>;
  hazardMeshes: Map<string, THREE.Group>;
  damageTextMeshes: { mesh: THREE.Sprite; velY: number; life: number; maxLife: number }[];
  activeEffects: { group: THREE.Group; update: (dt: number) => boolean }[];
  update: (
    dt: number,
    serverCrates: ArenaCrateState[],
    serverProjectiles: ArenaProjectileState[],
    serverHazards: ArenaHazardState[]
  ) => void;
  triggerExplosionFX: (x: number, z: number, weaponType: WeaponType, radius?: number) => void;
  triggerEmpShockwaveFX: (x: number, z: number, radius: number) => void;
  triggerKangriBurstFX: (x: number, z: number, heading?: number) => void;
  triggerKangriBurnFX: (x: number, z: number, wreck?: boolean) => void;
  triggerMuzzleFlash: (x: number, z: number, heading: number, weaponType: WeaponType) => void;
  triggerMeleeArc: (x: number, z: number, heading: number, weaponType: WeaponType) => void;
  triggerImpactSparks: (x: number, z: number) => void;
  triggerDamageNumberFX: (event: DamageEvent) => void;
  spawnDischargedShot: (weaponType: WeaponType, x: number, z: number, heading: number, fromMuzzle?: boolean) => void;
  dispose: () => void;
}

export function buildBattleArena(scene: THREE.Scene): ArenaManager {
  const arenaGroup = new THREE.Group();
  arenaGroup.name = 'BattleArena';
  scene.add(arenaGroup);

  const crateMeshes = new Map<string, THREE.Group>();
  const projectileMeshes = new Map<string, THREE.Group>();
  const hazardMeshes = new Map<string, THREE.Group>();
  const damageTextMeshes: { mesh: THREE.Sprite; velY: number; life: number; maxLife: number }[] = [];
  const activeEffects: { group: THREE.Group; update: (dt: number) => boolean }[] = [];

  // Helper material
  function mat(c: number) {
    return new THREE.MeshLambertMaterial({ color: c, flatShading: true });
  }

  // 1. Arena Side Boundaries & Styling (Roadway kept 100% open and unobstructed)
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x5a5d61 });
  const curbMat = new THREE.MeshLambertMaterial({ color: 0xd9534f }); // Racing red/white curbs
  const curbWhiteMat = new THREE.MeshLambertMaterial({ color: 0xf4f4f4 });

  // NOTE: southWall at z = -160 near Wazwan Darbar Hotel is removed so Boulevard Road stays open.
  // Side walls stay north of the hotel (hotel sits near z = -145) and off the driveable lanes.

  // West Boundary Wall (behind hotel row, starts north of Wazwan Darbar)
  const westWall = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.8, 88), wallMat);
  westWall.position.set(ARENA_BOUNDS.MIN_X, 1.4, -28);
  arenaGroup.add(westWall);

  // East Boundary Wall / Lake Barrier (out in Dal Lake water, same northern span)
  const eastWall = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.8, 88), wallMat);
  eastWall.position.set(ARENA_BOUNDS.MAX_X, 1.4, -28);
  arenaGroup.add(eastWall);

  // Red/White racing curbs along side boundaries (clear of all 4 road lanes)
  for (let z = -70; z <= 25; z += 6) {
    const isRed = Math.floor(z / 6) % 2 === 0;
    const cMat = isRed ? curbMat : curbWhiteMat;

    const cWest = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.25, 5.8), cMat);
    cWest.position.set(ARENA_BOUNDS.MIN_X + 0.8, 0.12, z);
    arenaGroup.add(cWest);

    const cEast = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.25, 5.8), cMat);
    cEast.position.set(ARENA_BOUNDS.MAX_X - 0.8, 0.12, z);
    arenaGroup.add(cEast);
  }

  // 2. High-Tech Floodlight Towers at 4 Arena Perimeter Corners
  const towerPositions = [
    { x: ARENA_BOUNDS.MIN_X + 2, z: -70 },
    { x: ARENA_BOUNDS.MAX_X - 2, z: -70 },
    { x: ARENA_BOUNDS.MIN_X + 2, z: 20 },
    { x: ARENA_BOUNDS.MAX_X - 2, z: 20 },
  ];

  towerPositions.forEach(p => {
    const tower = new THREE.Group();
    tower.position.set(p.x, 0, p.z);

    // Lattice mast
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 14, 6), mat(0x222629));
    pole.position.y = 7;
    tower.add(pole);

    // Light head panel
    const head = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.2, 0.8), mat(0x181a1b));
    head.position.y = 13.8;
    head.lookAt(new THREE.Vector3(-6, 0, -65));
    tower.add(head);

    // Glowing bulb array
    const bulb = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.0), new THREE.MeshBasicMaterial({ color: 0xfff0aa, side: THREE.DoubleSide }));
    bulb.position.set(0, 13.8, 0.42);
    bulb.lookAt(new THREE.Vector3(-6, 0, -65));
    tower.add(bulb);

    arenaGroup.add(tower);
  });

  // 3. Central Mughal Combat Pavilion (Cover & Archway)
  const centerPavilion = new THREE.Group();
  centerPavilion.position.set(-6, 0, -65);

  // 4 Stone Columns
  const colMat = mat(0xc9c2b3);
  [
    { x: -5, z: -5 },
    { x: 5, z: -5 },
    { x: -5, z: 5 },
    { x: 5, z: 5 },
  ].forEach(cp => {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 5, 8), colMat);
    col.position.set(cp.x, 2.5, cp.z);
    centerPavilion.add(col);
  });

  // Kashmiri Tiered Roof
  const roof = new THREE.Mesh(new THREE.ConeGeometry(8.5, 3.2, 4), mat(0x2d4838));
  roof.position.y = 6.6;
  roof.rotation.y = Math.PI / 4;
  centerPavilion.add(roof);

  arenaGroup.add(centerPavilion);

  // 4. Tactical Road Obstacles & Tire Walls
  const tireMat = mat(0x1a1a1a);
  const tireWhiteMat = mat(0xe8e8e8);

  const barrierLocs = [
    { x: ARENA_BOUNDS.MIN_X + 4, z: -40, rot: -0.2 },
    { x: ARENA_BOUNDS.MAX_X - 4, z: -35, rot: 0.15 },
  ];

  barrierLocs.forEach(b => {
    const wall = new THREE.Group();
    wall.position.set(b.x, 0, b.z);
    wall.rotation.y = b.rot;

    for (let i = 0; i < 4; i++) {
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.5, 12), i % 2 === 0 ? tireMat : tireWhiteMat);
      tire.rotation.x = Math.PI / 2;
      tire.position.set(i * 1.3 - 2.0, 0.7, 0);
      wall.add(tire);
    }
    arenaGroup.add(wall);
  });

  // 5. Entrance Overhead Neon Banner
  const bannerGroup = new THREE.Group();
  bannerGroup.position.set(-6, 7.5, ARENA_BOUNDS.MAX_Z - 1);

  const archPoles = new THREE.Mesh(new THREE.BoxGeometry(28, 0.6, 0.6), mat(0x1a1a1a));
  bannerGroup.add(archPoles);

  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0b0f19';
  ctx.fillRect(0, 0, 1024, 256);
  ctx.strokeStyle = '#06b6d4';
  ctx.lineWidth = 10;
  ctx.strokeRect(10, 10, 1004, 236);

  ctx.fillStyle = '#f59e0b';
  ctx.font = 'bold 64px "Outfit", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('DAL LAKE MAYHEM', 512, 105);

  ctx.fillStyle = '#22d3ee';
  ctx.font = 'bold 42px "Rajdhani", sans-serif';
  ctx.fillText('⚡ MULTIPLAYER BATTLE ARENA ⚡', 512, 185);

  const bannerTex = new THREE.CanvasTexture(canvas);
  bannerTex.colorSpace = THREE.SRGBColorSpace;
  const bannerMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 4),
    new THREE.MeshBasicMaterial({ map: bannerTex, side: THREE.DoubleSide })
  );
  bannerMesh.position.y = 0.5;
  bannerGroup.add(bannerMesh);

  arenaGroup.add(bannerGroup);

  // --------------------------------------------------------------------------
  // Crate 3D Model Generator
  // --------------------------------------------------------------------------
  function createCrateMesh(): THREE.Group {
    const cg = new THREE.Group();

    // Floating outer glowing frame
    const boxMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      metalness: 0.8,
      roughness: 0.2,
      emissive: 0xd97706,
      emissiveIntensity: 0.45,
    });
    const cube = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), boxMat);
    cg.add(cube);

    // Inner glowing core
    const coreMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.7), coreMat);
    cg.add(core);

    // Ground glow circle decal
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x06b6d4,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.3, 16).rotateX(-Math.PI / 2), ringMat);
    ring.position.y = -0.85;
    cg.add(ring);

    return cg;
  }

  // --------------------------------------------------------------------------
  // Projectile 3D Model Generator
  // --------------------------------------------------------------------------
  function createProjectileMesh(type: WeaponType): THREE.Group {
    const pg = new THREE.Group();

    switch (type) {
      case 'machinegun': {
        const bulletMat = new THREE.MeshBasicMaterial({ color: 0xfde047 });
        const bullet = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.9, 8).rotateX(Math.PI / 2), bulletMat);
        pg.add(bullet);
        break;
      }

      case 'rocket': {
        const bodyMat = new THREE.MeshLambertMaterial({ color: 0x222629 });
        const noseMat = new THREE.MeshLambertMaterial({ color: 0xef4444 });
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.3, 8).rotateX(Math.PI / 2), bodyMat);
        const nose = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.5, 8).rotateX(-Math.PI / 2), noseMat);
        nose.position.z = 0.85;
        const exhaust = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.6, 8).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xf97316 }));
        exhaust.position.z = -0.9;
        pg.add(body, nose, exhaust);
        break;
      }

      case 'grenade': {
        const gMat = new THREE.MeshLambertMaterial({ color: 0x3f6212 });
        const grenade = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), gMat);
        const pin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.35, 0.15), mat(0x71717a));
        pin.position.y = 0.32;
        pg.add(grenade, pin);
        break;
      }

      case 'firecracker': {
        const fMat = new THREE.MeshBasicMaterial({ color: 0xec4899 });
        const rocket = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.8, 6).rotateX(Math.PI / 2), fMat);
        const spark = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 6), new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
        spark.position.z = -0.5;
        pg.add(rocket, spark);
        break;
      }

      case 'homing': {
        const mMat = new THREE.MeshLambertMaterial({ color: 0xd97706 });
        const tipMat = new THREE.MeshBasicMaterial({ color: 0x06b6d4 });
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.5, 8).rotateX(Math.PI / 2), mMat);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.6, 8).rotateX(-Math.PI / 2), tipMat);
        tip.position.z = 1.0;
        const fin1 = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.3), mMat);
        fin1.position.z = -0.6;
        pg.add(body, tip, fin1);
        break;
      }

      case 'pistol':
      case 'rifle': {
        const tracer = new THREE.Mesh(
          new THREE.CylinderGeometry(0.05, 0.05, 0.7, 6).rotateX(Math.PI / 2),
          new THREE.MeshBasicMaterial({ color: type === 'rifle' ? 0xfde68a : 0xfacc15 })
        );
        pg.add(tracer);
        break;
      }

      case 'shotgun': {
        const pellet = new THREE.Mesh(
          new THREE.SphereGeometry(0.09, 6, 6),
          new THREE.MeshBasicMaterial({ color: 0xfb923c })
        );
        pg.add(pellet);
        break;
      }

      default:
        break;
    }

    return pg;
  }

  // --------------------------------------------------------------------------
  // Hazard 3D Model Generator
  // --------------------------------------------------------------------------
  function createHazardMesh(type: 'oil' | 'spike'): THREE.Group {
    const hg = new THREE.Group();

    if (type === 'oil') {
      const oilMat = new THREE.MeshStandardMaterial({
        color: 0x11161d,
        metalness: 0.95,
        roughness: 0.1,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
      });
      const puddle = new THREE.Mesh(new THREE.CircleGeometry(1.8, 16).rotateX(-Math.PI / 2), oilMat);
      puddle.position.y = 0.06;
      hg.add(puddle);
    } else {
      // Spike Strip
      const base = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.08, 0.8), mat(0x27272a));
      base.position.y = 0.06;
      hg.add(base);

      // Caltrop spikes
      const spikeMat = new THREE.MeshStandardMaterial({ color: 0xe4e4e7, metalness: 0.9, roughness: 0.2 });
      for (let i = -1.5; i <= 1.5; i += 0.5) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.45, 6), spikeMat);
        spike.position.set(i, 0.3, 0);
        hg.add(spike);
      }
    }

    return hg;
  }

  // --------------------------------------------------------------------------
  // Particle Explosion & Shockwaves
  // --------------------------------------------------------------------------
  function triggerExplosionFX(x: number, z: number, weaponType: WeaponType, radius: number = 6.0) {
    const expGroup = new THREE.Group();
    expGroup.position.set(x, 0.8, z);
    scene.add(expGroup);

    // Fireball sphere
    const sphereMat = new THREE.MeshBasicMaterial({
      color: weaponType === 'firecracker' ? 0xf43f5e : 0xf97316,
      transparent: true,
      opacity: 0.9,
    });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(1.2, 12, 10), sphereMat);
    expGroup.add(sphere);

    // Expanding shockwave ring
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xfef08a,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 1.2, 16).rotateX(-Math.PI / 2), ringMat);
    expGroup.add(ring);

    // Debris particle chunks
    const particles: THREE.Mesh[] = [];
    const pMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
    for (let i = 0; i < 12; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), pMat);
      p.userData.vel = new THREE.Vector3(
        (Math.random() - 0.5) * 16,
        Math.random() * 12 + 2,
        (Math.random() - 0.5) * 16
      );
      expGroup.add(p);
      particles.push(p);
    }

    let age = 0;
    const maxAge = 0.65;

    activeEffects.push({
      group: expGroup,
      update: dt => {
        age += dt;
        const progress = age / maxAge;

        sphere.scale.setScalar(1.0 + progress * radius * 0.75);
        sphereMat.opacity = Math.max(0, 0.9 * (1.0 - progress));

        ring.scale.setScalar(1.0 + progress * radius * 1.2);
        ringMat.opacity = Math.max(0, 0.8 * (1.0 - progress));

        particles.forEach(p => {
          const v = p.userData.vel as THREE.Vector3;
          v.y -= 25.0 * dt;
          p.position.addScaledVector(v, dt);
        });

        if (age >= maxAge) {
          scene.remove(expGroup);
          sphere.geometry.dispose();
          sphereMat.dispose();
          ring.geometry.dispose();
          ringMat.dispose();
          pMat.dispose();
          return true; // remove
        }
        return false;
      },
    });
  }

  function triggerEmpShockwaveFX(x: number, z: number, radius: number = 14.0) {
    const empGroup = new THREE.Group();
    empGroup.position.set(x, 0.5, z);
    scene.add(empGroup);

    // Blue electric wireframe dome
    const domeMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.85,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 12), domeMat);
    empGroup.add(dome);

    // Electric ground ring
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x0284c7,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.8, 24).rotateX(-Math.PI / 2), ringMat);
    empGroup.add(ring);

    let age = 0;
    const maxAge = 0.55;

    activeEffects.push({
      group: empGroup,
      update: dt => {
        age += dt;
        const progress = age / maxAge;

        dome.scale.setScalar(1.0 + progress * (radius * 0.8));
        domeMat.opacity = Math.max(0, 0.85 * (1.0 - progress));

        ring.scale.setScalar(1.0 + progress * radius);
        ringMat.opacity = Math.max(0, 0.9 * (1.0 - progress));

        if (age >= maxAge) {
          scene.remove(empGroup);
          dome.geometry.dispose();
          domeMat.dispose();
          ring.geometry.dispose();
          ringMat.dispose();
          return true;
        }
        return false;
      },
    });
  }

  function triggerKangriBurstFX(x: number, z: number, heading = 0) {
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    [-0.32, -0.22, -0.12, -0.04, 0, 0.04, 0.12, 0.22, 0.32].forEach(ang => {
      spawnFlyingBolt(x, z, heading + ang, 32, 0.7, ang === 0 ? 0xff4500 : 0xfacc15, 0.11, 1.05);
    });
    const coneGroup = new THREE.Group();
    coneGroup.position.set(x + fx * 5.2, 0.95, z + fz * 5.2);
    coneGroup.rotation.y = heading;
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(2.8, 12.5, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff6a1a, transparent: true, opacity: 0.48, side: THREE.DoubleSide })
    );
    cone.rotation.x = Math.PI / 2;
    coneGroup.add(cone);
    scene.add(coneGroup);
    let coneAge = 0;
    activeEffects.push({
      group: coneGroup,
      update: dt => {
        coneAge += dt;
        const mat = cone.material as THREE.MeshBasicMaterial;
        mat.opacity = Math.max(0, 0.5 * (1 - coneAge / 0.45));
        coneGroup.scale.setScalar(1 + coneAge * 1.8);
        if (coneAge >= 0.45) {
          scene.remove(coneGroup);
          return true;
        }
        return false;
      },
    });
    const g = new THREE.Group();
    g.position.set(x, 0.55, z);
    scene.add(g);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xff6a1a, transparent: true, opacity: 0.95 });
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), coreMat);
    g.add(core);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xf97316,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.7, 16).rotateX(-Math.PI / 2), ringMat);
    g.add(ring);
    const sparks: THREE.Mesh[] = [];
    for (let i = 0; i < 18; i++) {
      const sm = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 5, 5),
        new THREE.MeshBasicMaterial({ color: i % 2 ? 0xfacc15 : 0xef4444 })
      );
      sm.position.set((Math.random() - 0.5) * 0.4, 0.2, (Math.random() - 0.5) * 0.4);
      sm.userData.vx = (Math.random() - 0.5) * 6;
      sm.userData.vy = 2 + Math.random() * 4;
      sm.userData.vz = (Math.random() - 0.5) * 6;
      g.add(sm);
      sparks.push(sm);
    }
    let age = 0;
    activeEffects.push({
      group: g,
      update: dt => {
        age += dt;
        const t = age / 0.55;
        core.scale.setScalar(1 + t * 4.2);
        coreMat.opacity = Math.max(0, 0.95 * (1 - t));
        ring.scale.setScalar(1 + t * 6);
        ringMat.opacity = Math.max(0, 0.85 * (1 - t));
        sparks.forEach(s => {
          s.position.x += s.userData.vx * dt;
          s.position.y += s.userData.vy * dt;
          s.position.z += s.userData.vz * dt;
          s.userData.vy -= 9 * dt;
        });
        if (age >= 0.55) {
          scene.remove(g);
          return true;
        }
        return false;
      },
    });
  }

  function triggerKangriBurnFX(x: number, z: number, wreck = false) {
    const g = new THREE.Group();
    g.position.set(x, 0.15, z);
    scene.add(g);
    const duration = wreck ? 2.4 : 1.35;
    const flames: THREE.Mesh[] = [];
    const count = wreck ? 10 : 6;
    for (let i = 0; i < count; i++) {
      const h = 0.9 + Math.random() * (wreck ? 1.8 : 1.1);
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.22 + Math.random() * 0.18, h, 6),
        new THREE.MeshBasicMaterial({
          color: i % 2 ? 0xff6a1a : 0xfacc15,
          transparent: true,
          opacity: 0.9,
        })
      );
      flame.position.set((Math.random() - 0.5) * 1.4, h * 0.45, (Math.random() - 0.5) * 1.4);
      flame.userData.baseY = flame.position.y;
      flame.userData.phase = Math.random() * Math.PI * 2;
      g.add(flame);
      flames.push(flame);
    }
    if (wreck) {
      const glow = new THREE.Mesh(
        new THREE.SphereGeometry(1.1, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xea580c, transparent: true, opacity: 0.45 })
      );
      glow.position.y = 0.6;
      g.add(glow);
    }
    let age = 0;
    activeEffects.push({
      group: g,
      update: dt => {
        age += dt;
        const t = age / duration;
        flames.forEach((f, i) => {
          f.position.y = f.userData.baseY + Math.sin(age * 10 + f.userData.phase) * 0.12;
          f.scale.setScalar(1 + Math.sin(age * 14 + i) * 0.18);
          const mat = f.material as THREE.MeshBasicMaterial;
          mat.opacity = Math.max(0, 0.9 * (1 - t));
        });
        if (age >= duration) {
          scene.remove(g);
          g.traverse(obj => {
            const mesh = obj as THREE.Mesh;
            if (mesh.geometry) mesh.geometry.dispose();
            const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
            if (Array.isArray(mat)) mat.forEach(m => m.dispose());
            else mat?.dispose();
          });
          return true;
        }
        return false;
      },
    });
  }

  function triggerMuzzleFlash(x: number, z: number, heading: number, weaponType: WeaponType) {
    const g = new THREE.Group();
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    g.position.set(x + fx * 1.6, 1.05, z + fz * 1.6);
    scene.add(g);
    const size = weaponType === 'shotgun' ? 0.55 : weaponType === 'rifle' ? 0.38 : 0.28;
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0.95 });
    const flash = new THREE.Mesh(new THREE.SphereGeometry(size, 8, 6), flashMat);
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(size * 0.7, size * 2.2, 8),
      new THREE.MeshBasicMaterial({ color: 0xfb923c, transparent: true, opacity: 0.85 })
    );
    cone.rotation.x = Math.PI / 2;
    cone.rotation.y = heading;
    g.add(flash, cone);
    let age = 0;
    activeEffects.push({
      group: g,
      update: dt => {
        age += dt;
        const t = age / 0.08;
        flash.scale.setScalar(1 + t * 1.8);
        flashMat.opacity = Math.max(0, 0.95 * (1 - t));
        if (age >= 0.09) {
          scene.remove(g);
          return true;
        }
        return false;
      },
    });
  }

  function triggerMeleeArc(x: number, z: number, heading: number, weaponType: WeaponType) {
    const g = new THREE.Group();
    g.position.set(x, 0.9, z);
    g.rotation.y = heading;
    scene.add(g);
    const color = weaponType === 'pipe' ? 0xcbd5e1 : 0xc4a484;
    const arc = new THREE.Mesh(
      new THREE.TorusGeometry(1.6, 0.07, 6, 14, Math.PI * 0.7),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 })
    );
    arc.rotation.x = Math.PI / 2;
    g.add(arc);
    let age = 0;
    activeEffects.push({
      group: g,
      update: dt => {
        age += dt;
        arc.rotation.z += dt * 8;
        (arc.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.85 * (1 - age / 0.22));
        if (age >= 0.22) {
          scene.remove(g);
          return true;
        }
        return false;
      },
    });
  }

  function spawnFlyingBolt(
    x: number,
    z: number,
    heading: number,
    speed: number,
    life: number,
    color: number,
    radius: number,
    length: number
  ) {
    const g = new THREE.Group();
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    g.position.set(x, 0.95, z);
    g.rotation.y = heading;
    scene.add(g);
    const bolt = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius * 0.55, length, 6).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color })
    );
    g.add(bolt);
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.8, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xfff7ed, transparent: true, opacity: 0.9 })
    );
    glow.position.z = length * 0.35;
    g.add(glow);
    let age = 0;
    activeEffects.push({
      group: g,
      update: dt => {
        age += dt;
        g.position.x += fx * speed * dt;
        g.position.z += fz * speed * dt;
        if (age >= life) {
          scene.remove(g);
          return true;
        }
        return false;
      },
    });
  }

  function spawnDischargedShot(weaponType: WeaponType, x: number, z: number, heading: number, fromMuzzle = false) {
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const muzzleX = fromMuzzle ? x : x + fx * 2.4;
    const muzzleZ = fromMuzzle ? z : z + fz * 2.4;

    switch (weaponType) {
      case 'pistol':
        triggerMuzzleFlash(muzzleX, muzzleZ, heading, weaponType);
        spawnFlyingBolt(muzzleX, muzzleZ, heading, 88, 0.45, 0xfacc15, 0.06, 1.1);
        break;
      case 'rifle':
        triggerMuzzleFlash(muzzleX, muzzleZ, heading, weaponType);
        spawnFlyingBolt(muzzleX, muzzleZ, heading, 120, 0.7, 0xfde68a, 0.07, 1.6);
        break;
      case 'machinegun':
        triggerMuzzleFlash(muzzleX, muzzleZ, heading, weaponType);
        spawnFlyingBolt(muzzleX, muzzleZ, heading, 100, 0.55, 0xfde047, 0.055, 1.2);
        break;
      case 'shotgun':
        triggerMuzzleFlash(muzzleX, muzzleZ, heading, weaponType);
        [-0.22, -0.11, 0, 0.11, 0.22].forEach(ang => {
          spawnFlyingBolt(muzzleX, muzzleZ, heading + ang, 70, 0.38, 0xfb923c, 0.08, 0.7);
        });
        break;
      case 'bat':
      case 'pipe':
        triggerMeleeArc(x, z, heading, weaponType);
        break;
      case 'kangri':
        triggerKangriBurstFX(muzzleX, muzzleZ, heading);
        break;
      case 'rocket':
      case 'homing':
        spawnFlyingBolt(muzzleX, muzzleZ, heading, 48, 1.6, 0xef4444, 0.14, 1.5);
        triggerMuzzleFlash(muzzleX, muzzleZ, heading, 'rifle');
        break;
      case 'grenade':
        spawnFlyingBolt(muzzleX, muzzleZ, heading, 30, 1.2, 0x65a30d, 0.16, 0.5);
        break;
      case 'firecracker':
        [-0.3, -0.15, 0, 0.15, 0.3].forEach(ang => {
          spawnFlyingBolt(muzzleX, muzzleZ, heading + ang, 42, 1.1, 0xec4899, 0.09, 0.9);
        });
        break;
      case 'emp':
        triggerEmpShockwaveFX(x, z, 14);
        break;
      case 'oil':
      case 'spike':
        triggerImpactSparks(x - fx * 2.2, z - fz * 2.2);
        break;
      default:
        triggerMuzzleFlash(muzzleX, muzzleZ, heading, 'pistol');
        spawnFlyingBolt(muzzleX, muzzleZ, heading, 80, 0.4, 0xf8fafc, 0.05, 0.9);
        break;
    }
  }

  function triggerImpactSparks(x: number, z: number) {
    const g = new THREE.Group();
    g.position.set(x, 0.7, z);
    scene.add(g);
    const sparks: THREE.Mesh[] = [];
    for (let i = 0; i < 8; i++) {
      const s = new THREE.Mesh(
        new THREE.SphereGeometry(0.05, 4, 4),
        new THREE.MeshBasicMaterial({ color: i % 2 ? 0xfde047 : 0xf97316 })
      );
      s.userData.v = new THREE.Vector3((Math.random() - 0.5) * 6, 2 + Math.random() * 3, (Math.random() - 0.5) * 6);
      g.add(s);
      sparks.push(s);
    }
    let age = 0;
    activeEffects.push({
      group: g,
      update: dt => {
        age += dt;
        sparks.forEach(s => {
          s.position.addScaledVector(s.userData.v, dt);
          s.userData.v.y -= 12 * dt;
        });
        if (age >= 0.28) {
          scene.remove(g);
          return true;
        }
        return false;
      },
    });
  }

  // --------------------------------------------------------------------------
  // Floating Damage Numbers FX
  // --------------------------------------------------------------------------
  function triggerDamageNumberFX(event: DamageEvent) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    ctx.font = 'bold 54px "Outfit", sans-serif';
    ctx.textAlign = 'center';

    if (event.isElimination) {
      ctx.fillStyle = '#ef4444';
      ctx.shadowColor = '#000000';
      ctx.shadowBlur = 8;
      ctx.fillText(`💥 ELIMINATED!`, 128, 70);
    } else {
      ctx.fillStyle = event.amount >= 30 ? '#f43f5e' : '#f59e0b';
      ctx.shadowColor = '#000000';
      ctx.shadowBlur = 6;
      ctx.fillText(`-${event.amount}`, 128, 75);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(3.2, 1.6, 1);
    sprite.position.set(event.x + (Math.random() - 0.5) * 0.8, 2.2, event.z + (Math.random() - 0.5) * 0.8);

    scene.add(sprite);
    damageTextMeshes.push({
      mesh: sprite,
      velY: 2.8,
      life: 0,
      maxLife: 0.95,
    });
  }

  // --------------------------------------------------------------------------
  // Main Update Loop for Arena
  // --------------------------------------------------------------------------
  function update(
    dt: number,
    serverCrates: ArenaCrateState[],
    serverProjectiles: ArenaProjectileState[],
    serverHazards: ArenaHazardState[]
  ) {
    const time = Date.now() * 0.003;

    // 1. Sync Weapon Crates
    const activeCrateIds = new Set(serverCrates.map(c => c.id));

    // Remove deleted crates
    for (const [id, mesh] of crateMeshes.entries()) {
      if (!activeCrateIds.has(id)) {
        arenaGroup.remove(mesh);
        crateMeshes.delete(id);
      }
    }

    // Update / add crates
    for (const sc of serverCrates) {
      let mesh = crateMeshes.get(sc.id);
      if (!mesh) {
        mesh = createCrateMesh();
        crateMeshes.set(sc.id, mesh);
        arenaGroup.add(mesh);
      }

      const wasHidden = mesh.userData.wasActive === false;
      mesh.visible = sc.active;
      if (sc.active) {
        mesh.position.set(sc.x, sc.y + Math.sin(time + sc.x) * 0.18, sc.z);
        mesh.rotation.y += 1.8 * dt;
        if (wasHidden) {
          triggerEmpShockwaveFX(sc.x, sc.z, 4.5);
        }
        const pulse = 0.45 + Math.sin(time * 2.2) * 0.15;
        mesh.traverse(child => {
          const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
          if (mat && 'emissiveIntensity' in mat) mat.emissiveIntensity = pulse;
        });
      }
      mesh.userData.wasActive = sc.active;
    }

    // 2. Sync Projectiles
    const activeProjIds = new Set(serverProjectiles.map(p => p.id));
    for (const [id, mesh] of projectileMeshes.entries()) {
      if (!activeProjIds.has(id)) {
        scene.remove(mesh);
        projectileMeshes.delete(id);
      }
    }

    for (const sp of serverProjectiles) {
      let mesh = projectileMeshes.get(sp.id);
      if (!mesh) {
        mesh = createProjectileMesh(sp.weaponType);
        projectileMeshes.set(sp.id, mesh);
        scene.add(mesh);
      }

      mesh.position.set(sp.x, sp.y, sp.z);
      mesh.rotation.y = sp.heading;
      if (sp.weaponType === 'grenade') {
        mesh.rotation.x += 12.0 * dt;
      }
    }

    // 3. Sync Hazards
    const activeHazIds = new Set(serverHazards.map(h => h.id));
    for (const [id, mesh] of hazardMeshes.entries()) {
      if (!activeHazIds.has(id)) {
        arenaGroup.remove(mesh);
        hazardMeshes.delete(id);
      }
    }

    for (const sh of serverHazards) {
      let mesh = hazardMeshes.get(sh.id);
      if (!mesh) {
        mesh = createHazardMesh(sh.type);
        hazardMeshes.set(sh.id, mesh);
        arenaGroup.add(mesh);
      }
      mesh.position.set(sh.x, 0, sh.z);
      mesh.rotation.y = sh.heading;
    }

    // 4. Update Damage Text Numbers
    for (let i = damageTextMeshes.length - 1; i >= 0; i--) {
      const item = damageTextMeshes[i];
      item.life += dt;
      item.mesh.position.y += item.velY * dt;
      const progress = item.life / item.maxLife;
      item.mesh.material.opacity = Math.max(0, 1.0 - progress);

      if (item.life >= item.maxLife) {
        scene.remove(item.mesh);
        item.mesh.material.dispose();
        damageTextMeshes.splice(i, 1);
      }
    }

    // 5. Update Active Particle Effects
    for (let i = activeEffects.length - 1; i >= 0; i--) {
      const eff = activeEffects[i];
      const finished = eff.update(dt);
      if (finished) {
        activeEffects.splice(i, 1);
      }
    }
  }

  function dispose() {
    scene.remove(arenaGroup);
    crateMeshes.forEach(m => arenaGroup.remove(m));
    projectileMeshes.forEach(m => scene.remove(m));
    hazardMeshes.forEach(m => arenaGroup.remove(m));
    damageTextMeshes.forEach(d => scene.remove(d.mesh));
    activeEffects.forEach(e => scene.remove(e.group));
  }

  return {
    group: arenaGroup,
    crateMeshes,
    projectileMeshes,
    hazardMeshes,
    damageTextMeshes,
    activeEffects,
    update,
    triggerExplosionFX,
    triggerEmpShockwaveFX,
    triggerKangriBurstFX,
    triggerKangriBurnFX,
    triggerMuzzleFlash,
    triggerMeleeArc,
    triggerImpactSparks,
    triggerDamageNumberFX,
    spawnDischargedShot,
    dispose,
  };
}
