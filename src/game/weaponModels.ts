import * as THREE from 'three';
import { WeaponType } from '../shared/types.ts';

function mat(color: number, extra?: THREE.MeshStandardMaterialParameters) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.15, ...extra });
}

export function createWeaponMesh(type: WeaponType): THREE.Group {
  switch (type) {
    case 'bat':
      return createBat();
    case 'pipe':
      return createPipe();
    case 'pistol':
      return createPistol();
    case 'shotgun':
      return createShotgun();
    case 'rifle':
      return createRifle();
    case 'kangri':
      return createKangri();
    default:
      return createGenericPickup(type);
  }
}

function pickupNameSprite(label: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 48;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(15, 18, 22, 0.72)';
  ctx.fillRect(8, 8, 240, 32);
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, 128, 32);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false }));
  sprite.scale.set(2.4, 0.45, 1);
  sprite.position.y = 1.15;
  return sprite;
}

export function createWorldPickupMesh(type: WeaponType): THREE.Group {
  const root = new THREE.Group();
  const weapon = createWeaponMesh(type);
  const isKangri = type === 'kangri';
  const isMelee = type === 'bat' || type === 'pipe';
  weapon.scale.setScalar(isKangri ? 1.35 : 1.55);
  if (isKangri) {
    weapon.position.y = 0.18;
  } else if (isMelee) {
    weapon.rotation.z = Math.PI / 2;
    weapon.position.y = 0.12;
  } else {
    weapon.rotation.x = Math.PI / 2;
    weapon.position.y = 0.1;
  }
  root.add(weapon);

  const labels: Record<string, string> = {
    bat: 'WOODEN BAT',
    pipe: 'METAL PIPE',
    pistol: 'PISTOL',
    shotgun: 'SHOTGUN',
    rifle: 'RIFLE',
    kangri: 'KANGIR',
  };
  root.add(pickupNameSprite(labels[type] || type.toUpperCase()));

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.45, 0.7, 20).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color: isKangri ? 0xc2410c : 0xd6d3d1,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
    })
  );
  ring.position.y = 0.03;
  root.add(ring);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.5, 14).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32 })
  );
  shadow.position.y = 0.015;
  root.add(shadow);
  root.userData.weapon = weapon;
  root.userData.isKangri = isKangri;
  root.userData.baseY = weapon.position.y;
  return root;
}

function createBat(): THREE.Group {
  const g = new THREE.Group();
  const wood = mat(0x4a2c14, { roughness: 0.82, metalness: 0.04 });
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.55, 8), wood);
  handle.position.y = 0.2;
  const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 0.85, 10), mat(0x3a2412, { roughness: 0.7 }));
  blade.position.y = 0.85;
  const tape = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.12, 8), mat(0xd6c39a));
  tape.position.y = 0.08;
  g.add(handle, blade, tape);
  return g;
}

function createPipe(): THREE.Group {
  const g = new THREE.Group();
  const steel = mat(0xc5ced4, { roughness: 0.22, metalness: 0.95 });
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 1.2, 12, 1, true), steel);
  tube.position.y = 0.55;
  const bore = new THREE.Mesh(
    new THREE.CircleGeometry(0.042, 12),
    mat(0x1f2933, { metalness: 0.8, roughness: 0.4 })
  );
  bore.position.y = 1.15;
  bore.rotation.x = -Math.PI / 2;
  const bore2 = bore.clone();
  bore2.position.y = -0.05;
  bore2.rotation.x = Math.PI / 2;
  const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 12), steel);
  flange.position.y = 1.12;
  const rust = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.018, 6, 10), mat(0x8a5a32, { metalness: 0.6 }));
  rust.position.y = 0.35;
  rust.rotation.x = Math.PI / 2;
  g.add(tube, bore, bore2, flange, rust);
  return g;
}

function createPistol(): THREE.Group {
  const g = new THREE.Group();
  const iron = mat(0x1b1d20, { roughness: 0.35, metalness: 0.82 });
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.09, 0.34), iron);
  slide.position.set(0, 0.24, 0.04);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.22), iron);
  frame.position.set(0, 0.17, 0.0);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.11), mat(0x141414, { roughness: 0.75 }));
  grip.position.set(0, 0.07, -0.1);
  grip.rotation.x = 0.28;
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 6, 10, Math.PI), iron);
  guard.position.set(0, 0.13, 0.02);
  guard.rotation.x = Math.PI / 2;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.18, 8), iron);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.235, 0.24);
  g.add(slide, frame, grip, guard, barrel);
  return g;
}

function createShotgun(): THREE.Group {
  const g = new THREE.Group();
  const iron = mat(0x2a2e32, { roughness: 0.32, metalness: 0.84 });
  const wood = mat(0x5a3418, { roughness: 0.82 });
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, 0.85, 8), iron);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.24, 0.22);
  const barrel2 = barrel.clone();
  barrel2.position.y = 0.175;
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.28), iron);
  receiver.position.set(0, 0.2, -0.12);
  const pump = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.22), wood);
  pump.position.set(0, 0.16, 0.08);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.34), wood);
  stock.position.set(0, 0.14, -0.38);
  g.add(barrel, barrel2, receiver, pump, stock);
  return g;
}

function createRifle(): THREE.Group {
  const g = new THREE.Group();
  const iron = mat(0x15181c, { roughness: 0.36, metalness: 0.72 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.58), iron);
  body.position.set(0, 0.2, 0);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.28), iron);
  stock.position.set(0, 0.16, -0.4);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.7, 8), iron);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.22, 0.52);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 0.08), iron);
  mag.position.set(0, 0.05, -0.02);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.07), iron);
  grip.position.set(0, 0.08, -0.16);
  grip.rotation.x = 0.35;
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.08), mat(0x4b5563, { metalness: 0.6 }));
  sight.position.set(0, 0.28, 0.08);
  g.add(body, stock, barrel, mag, grip, sight);
  return g;
}

export function createKangri(): THREE.Group {
  const g = new THREE.Group();
  const wicker = mat(0x6b3d1f, { roughness: 0.9, metalness: 0.02 });
  const clay = mat(0xb85c38, { roughness: 0.78, metalness: 0.05 });

  const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.32, 12, 1, true), wicker);
  basket.position.y = 0.16;
  const weave: THREE.Mesh[] = [];
  for (let i = 0; i < 8; i++) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.012, 6, 16), wicker);
    band.position.y = 0.05 + i * 0.035;
    band.rotation.x = Math.PI / 2;
    weave.push(band);
  }
  const pot = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10, 0, Math.PI * 2, 0, Math.PI / 1.4), clay);
  pot.position.y = 0.16;
  const coals = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshStandardMaterial({
      color: 0xff4d00,
      emissive: 0xff6a1a,
      emissiveIntensity: 1.4,
      roughness: 0.4,
    })
  );
  coals.position.y = 0.2;
  const glow = new THREE.PointLight(0xff6a1a, 1.1, 3.4);
  glow.position.y = 0.28;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.015, 6, 10, Math.PI), wicker);
  handle.position.set(0, 0.34, 0);
  handle.rotation.z = Math.PI / 2;

  g.add(basket, pot, coals, glow, handle, ...weave);
  g.userData.coals = coals;
  g.userData.glow = glow;
  return g;
}

function createGenericPickup(type: WeaponType): THREE.Group {
  const g = new THREE.Group();
  const cube = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), mat(0xf59e0b, { emissive: 0xb45309, emissiveIntensity: 0.35 }));
  g.add(cube);
  g.userData.fallbackType = type;
  return g;
}

export function updatePickupVisual(root: THREE.Group, dt: number, clock: number) {
  const weapon = root.userData.weapon as THREE.Group | undefined;
  if (weapon) {
    weapon.rotation.y += dt * 0.9;
    const baseY = (root.userData.baseY as number) || 0.12;
    weapon.position.y = baseY + Math.sin(clock * 2.1) * 0.05;
  }
  if (root.userData.isKangri && weapon) {
    const coals = weapon.userData.coals as THREE.Mesh | undefined;
    const glow = weapon.userData.glow as THREE.PointLight | undefined;
    if (coals) {
      const mat = coals.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 1.1 + Math.sin(clock * 9) * 0.45;
    }
    if (glow) glow.intensity = 0.85 + Math.sin(clock * 7) * 0.35;
  }
}

export function createKangriBurstMesh(): THREE.Group {
  const g = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xff6a1a, transparent: true, opacity: 0.9 })
  );
  g.add(core);
  return g;
}
