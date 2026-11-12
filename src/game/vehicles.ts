import * as THREE from 'three';
import { VehicleCategory } from '../shared/types.ts';

// Shared materials
const matChrome = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.15, metalness: 0.95 });
const matRubber = new THREE.MeshLambertMaterial({ color: 0x181818 });
const matRim = new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.35, metalness: 0.85 });
const matBlackMetal = new THREE.MeshStandardMaterial({ color: 0x22262a, roughness: 0.45, metalness: 0.7 });
const matGlass = new THREE.MeshStandardMaterial({ color: 0xd2f2ff, transparent: true, opacity: 0.42, roughness: 0.08, metalness: 0.2 });

export interface VehicleMeshBundle {
  root: THREE.Group;
  body: THREE.Group;
  frontSteerGroup?: THREE.Group;
  wheels: THREE.Group[];
  lightBar?: THREE.Group;
  headlights: THREE.Mesh[];
  taillights: THREE.Mesh[];
  type: VehicleCategory;
}

function createWheel(r: number, w: number, spokeCount = 0): THREE.Group {
  const wg = new THREE.Group();
  const tyreGeo = new THREE.CylinderGeometry(r, r, w, 16).rotateZ(Math.PI / 2);
  const tyre = new THREE.Mesh(tyreGeo, matRubber);
  
  const rimR = r * 0.65;
  const rimGeo = new THREE.CylinderGeometry(rimR, rimR, w + 0.01, 12).rotateZ(Math.PI / 2);
  const rim = new THREE.Mesh(rimGeo, matRim);

  const hubGeo = new THREE.CylinderGeometry(r * 0.22, r * 0.22, w + 0.02, 8).rotateZ(Math.PI / 2);
  const hub = new THREE.Mesh(hubGeo, matBlackMetal);

  wg.add(tyre, rim, hub);

  if (spokeCount > 0) {
    const spokeMat = matChrome;
    for (let i = 0; i < spokeCount; i++) {
      const angle = (i / spokeCount) * Math.PI;
      const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, rimR * 1.9, 4), spokeMat);
      sp.rotation.z = angle;
      wg.add(sp);
    }
  }

  return wg;
}

/**
 * 1. ELECTRIC BATTERY AUTO (E-Rickshaw)
 */
export function buildElectricAutoMesh(): VehicleMeshBundle {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const matCyan = new THREE.MeshStandardMaterial({ color: 0x3ac2de, roughness: 0.28, metalness: 0.22 });
  const matBlueCanopy = new THREE.MeshStandardMaterial({ color: 0x1b6ec7, roughness: 0.85, metalness: 0.04 });
  const matCanopyTrim = new THREE.MeshLambertMaterial({ color: 0x11161a });
  const matLeather = new THREE.MeshLambertMaterial({ color: 0x1e1e1e });

  // Chassis
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.06, 2.3), matBlackMetal);
  chassis.position.set(0, 0.32, -0.05);
  const floorMat = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.02, 2.2), matLeather);
  floorMat.position.set(0, 0.36, -0.05);
  body.add(chassis, floorMat);

  // Battery box & body panelling
  const battBox = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.28, 1.3), matCyan);
  battBox.position.set(0, 0.48, -0.45);
  const rearBulkhead = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.56, 0.1), matCyan);
  rearBulkhead.position.set(0, 0.68, -1.1);
  const noseLower = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.36, 0.32), matCyan);
  noseLower.position.set(0, 0.48, 0.85);
  const noseUpper = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.48, 0.18), matCyan);
  noseUpper.position.set(0, 0.84, 0.76);
  noseUpper.rotation.x = -0.22;
  body.add(battBox, rearBulkhead, noseLower, noseUpper);

  // Roll cage pillars
  const pilGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.85, 6);
  const aPilL = new THREE.Mesh(pilGeo, matBlackMetal);
  aPilL.position.set(-0.41, 1.25, 0.64);
  aPilL.rotation.x = -0.22;
  const aPilR = new THREE.Mesh(pilGeo, matBlackMetal);
  aPilR.position.set(0.41, 1.25, 0.64);
  aPilR.rotation.x = -0.22;
  body.add(aPilL, aPilR);

  // Canopy
  const roofTop = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.12, 1.88), matBlueCanopy);
  roofTop.position.set(0, 1.72, -0.24);
  const roofPiping = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.04, 1.9), matCanopyTrim);
  roofPiping.position.set(0, 1.66, -0.24);
  const windshield = new THREE.Mesh(new THREE.PlaneGeometry(0.80, 0.58), matGlass);
  windshield.position.set(0, 1.25, 0.65);
  windshield.rotation.x = -0.22;
  body.add(roofTop, roofPiping, windshield);

  // Seats
  const seatD = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.14, 0.36), matLeather);
  seatD.position.set(0, 0.62, 0.18);
  const seatP = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.16, 0.44), matLeather);
  seatP.position.set(0, 0.62, -0.74);
  body.add(seatD, seatP);

  // Headlight
  const hlBezel = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 14).rotateX(Math.PI / 2), matChrome);
  hlBezel.position.set(0, 0.74, 0.98);
  const hlLens = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.09, 0.09, 14).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3cc, emissiveIntensity: 0.9 })
  );
  hlLens.position.set(0, 0.74, 0.99);
  body.add(hlBezel, hlLens);

  // Taillights
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xd61818, emissive: 0x9e0e0e, emissiveIntensity: 0.7 });
  const tailL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.04), tailMat);
  tailL.position.set(-0.42, 0.64, -1.16);
  const tailR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.04), tailMat);
  tailR.position.set(0.42, 0.64, -1.16);
  body.add(tailL, tailR);

  // Front fork steering
  const frontSteerGroup = new THREE.Group();
  frontSteerGroup.position.set(0, 0.27, 1.02);

  const frontWheelRot = createWheel(0.27, 0.13);
  frontSteerGroup.add(frontWheelRot);

  const forkL = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.65, 6), matBlackMetal);
  forkL.position.set(-0.11, 0.28, 0);
  const forkR = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.65, 6), matBlackMetal);
  forkR.position.set(0.11, 0.28, 0);
  const handlebar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.58, 8).rotateZ(Math.PI / 2), matChrome);
  handlebar.position.set(0, 0.94, -0.28);
  frontSteerGroup.add(forkL, forkR, handlebar);
  body.add(frontSteerGroup);

  // Rear wheels
  const rearLWheelRot = createWheel(0.27, 0.13);
  rearLWheelRot.position.set(-0.52, 0.27, -0.72);
  const rearRWheelRot = createWheel(0.27, 0.13);
  rearRWheelRot.position.set(0.52, 0.27, -0.72);
  body.add(rearLWheelRot, rearRWheelRot);

  return {
    root,
    body,
    frontSteerGroup,
    wheels: [frontWheelRot, rearLWheelRot, rearRWheelRot],
    headlights: [hlLens],
    taillights: [tailL, tailR],
    type: 'auto',
  };
}

/**
 * 2. KASHMIR AMBASSADOR TAXI
 */
export function buildAmbassadorTaxiMesh(): VehicleMeshBundle {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const matPaint = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.32, metalness: 0.18 });
  const matRoofTaxi = new THREE.MeshStandardMaterial({ color: 0xffcc00, emissive: 0xffaa00, emissiveIntensity: 0.45 });

  // Main chassis & lower hull
  const lowerHull = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.48, 3.4), matPaint);
  lowerHull.position.set(0, 0.48, 0);
  body.add(lowerHull);

  // Curved passenger cabin
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.52, 1.7), matPaint);
  cabin.position.set(0, 0.96, -0.2);
  body.add(cabin);

  // Front & rear windshields
  const fGlass = new THREE.Mesh(new THREE.PlaneGeometry(1.24, 0.45), matGlass);
  fGlass.position.set(0, 0.98, 0.66);
  fGlass.rotation.x = -0.35;
  const rGlass = new THREE.Mesh(new THREE.PlaneGeometry(1.24, 0.42), matGlass);
  rGlass.position.set(0, 0.98, -1.06);
  rGlass.rotation.x = 0.35;
  body.add(fGlass, rGlass);

  // TAXI Roof Light
  const taxiPod = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.14, 0.22), matRoofTaxi);
  taxiPod.position.set(0, 1.30, -0.2);
  body.add(taxiPod);

  // Chrome bumpers & radiator grille
  const fBumper = new THREE.Mesh(new THREE.BoxGeometry(1.54, 0.12, 0.14), matChrome);
  fBumper.position.set(0, 0.34, 1.74);
  const rBumper = new THREE.Mesh(new THREE.BoxGeometry(1.54, 0.12, 0.14), matChrome);
  rBumper.position.set(0, 0.34, -1.74);
  const grille = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.24, 0.04), matChrome);
  grille.position.set(0, 0.56, 1.71);
  body.add(fBumper, rBumper, grille);

  // Headlights
  const hlMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6dd, emissiveIntensity: 0.9 });
  const hlL = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.05, 12).rotateX(Math.PI / 2), hlMat);
  hlL.position.set(-0.54, 0.60, 1.71);
  const hlR = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.05, 12).rotateX(Math.PI / 2), hlMat);
  hlR.position.set(0.54, 0.60, 1.71);
  body.add(hlL, hlR);

  // Taillights
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xd61818, emissive: 0x9e0e0e, emissiveIntensity: 0.7 });
  const tailL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.05), tailMat);
  tailL.position.set(-0.62, 0.58, -1.71);
  const tailR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.05), tailMat);
  tailR.position.set(0.62, 0.58, -1.71);
  body.add(tailL, tailR);

  // Front steering group (contains front wheels)
  const frontSteerGroup = new THREE.Group();
  frontSteerGroup.position.set(0, 0.32, 1.05);

  const fWheelL = createWheel(0.32, 0.16);
  fWheelL.position.set(-0.76, 0, 0);
  const fWheelR = createWheel(0.32, 0.16);
  fWheelR.position.set(0.76, 0, 0);
  frontSteerGroup.add(fWheelL, fWheelR);
  body.add(frontSteerGroup);

  // Rear wheels
  const rWheelL = createWheel(0.32, 0.16);
  rWheelL.position.set(-0.76, 0.32, -1.05);
  const rWheelR = createWheel(0.32, 0.16);
  rWheelR.position.set(0.76, 0.32, -1.05);
  body.add(rWheelL, rWheelR);

  return {
    root,
    body,
    frontSteerGroup,
    wheels: [fWheelL, fWheelR, rWheelL, rWheelR],
    headlights: [hlL, hlR],
    taillights: [tailL, tailR],
    type: 'taxi',
  };
}

/**
 * 3. J&K POLICE CRUISER (Interceptor)
 */
export function buildPoliceCruiserMesh(): VehicleMeshBundle {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const matBlack = new THREE.MeshStandardMaterial({ color: 0x14181c, roughness: 0.25, metalness: 0.4 });
  const matWhite = new THREE.MeshStandardMaterial({ color: 0xf0f2f5, roughness: 0.3, metalness: 0.2 });

  // Lower chassis
  const hull = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.48, 3.6), matBlack);
  hull.position.set(0, 0.48, 0);
  body.add(hull);

  // White side panels & roof
  const sideDoorsL = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.44).rotateY(-Math.PI / 2), matWhite);
  sideDoorsL.position.set(-0.78, 0.48, -0.1);
  const sideDoorsR = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.44).rotateY(Math.PI / 2), matWhite);
  sideDoorsR.position.set(0.78, 0.48, -0.1);
  body.add(sideDoorsL, sideDoorsR);

  // Cabin
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.50, 1.8), matWhite);
  cabin.position.set(0, 0.95, -0.15);
  body.add(cabin);

  // Push-bar bull-bumper
  const bullBar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.35, 0.15), matBlackMetal);
  bullBar.position.set(0, 0.45, 1.86);
  body.add(bullBar);

  // Police Emergency Strobe Bar
  const lightBar = new THREE.Group();
  lightBar.position.set(0, 1.25, -0.15);
  const barFrame = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.08, 0.16), matBlackMetal);
  
  const redLens = new THREE.Mesh(
    new THREE.BoxGeometry(0.36, 0.09, 0.14),
    new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 1.2 })
  );
  redLens.position.set(-0.22, 0, 0);

  const blueLens = new THREE.Mesh(
    new THREE.BoxGeometry(0.36, 0.09, 0.14),
    new THREE.MeshStandardMaterial({ color: 0x0066ff, emissive: 0x0066ff, emissiveIntensity: 1.2 })
  );
  blueLens.position.set(0.22, 0, 0);

  lightBar.add(barFrame, redLens, blueLens);
  body.add(lightBar);

  // Headlights & Taillights
  const hlMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.0 });
  const hlL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.04), hlMat);
  hlL.position.set(-0.58, 0.56, 1.81);
  const hlR = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.04), hlMat);
  hlR.position.set(0.58, 0.56, 1.81);
  body.add(hlL, hlR);

  const tailMat = new THREE.MeshStandardMaterial({ color: 0xd61818, emissive: 0xd61818, emissiveIntensity: 0.8 });
  const tailL = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.14, 0.04), tailMat);
  tailL.position.set(-0.60, 0.56, -1.81);
  const tailR = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.14, 0.04), tailMat);
  tailR.position.set(0.60, 0.56, -1.81);
  body.add(tailL, tailR);

  // Front steering group
  const frontSteerGroup = new THREE.Group();
  frontSteerGroup.position.set(0, 0.34, 1.15);

  const fWheelL = createWheel(0.34, 0.18);
  fWheelL.position.set(-0.80, 0, 0);
  const fWheelR = createWheel(0.34, 0.18);
  fWheelR.position.set(0.80, 0, 0);
  frontSteerGroup.add(fWheelL, fWheelR);
  body.add(frontSteerGroup);

  // Rear wheels
  const rWheelL = createWheel(0.34, 0.18);
  rWheelL.position.set(-0.80, 0.34, -1.15);
  const rWheelR = createWheel(0.34, 0.18);
  rWheelR.position.set(0.80, 0.34, -1.15);
  body.add(rWheelL, rWheelR);

  return {
    root,
    body,
    frontSteerGroup,
    wheels: [fWheelL, fWheelR, rWheelL, rWheelR],
    lightBar,
    headlights: [hlL, hlR],
    taillights: [tailL, tailR],
    type: 'police',
  };
}

/**
 * 4. ROYAL ENFIELD BULLET 350 MOTORCYCLE
 */
export function buildBullet350Mesh(): VehicleMeshBundle {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const matTankBlack = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2, metalness: 0.6 });
  const matLeather = new THREE.MeshLambertMaterial({ color: 0x241812 });

  // Main tubular frame
  const frameBar = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 1.4, 8).rotateX(Math.PI / 4), matBlackMetal);
  frameBar.position.set(0, 0.55, -0.05);
  body.add(frameBar);

  // Single-cylinder engine block with cooling fins
  const engineBlock = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.36, 0.38), matBlackMetal);
  engineBlock.position.set(0, 0.42, 0.05);
  const headFins = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.22, 10), matChrome);
  headFins.position.set(0, 0.62, 0.08);
  body.add(engineBlock, headFins);

  // Teardrop fuel tank
  const tank = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), matTankBlack);
  tank.scale.set(0.9, 0.8, 1.8);
  tank.position.set(0, 0.82, 0.24);
  body.add(tank);

  // Solo sprung leather saddle
  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.38), matLeather);
  saddle.position.set(0, 0.74, -0.22);
  body.add(saddle);

  // Chrome upswept exhaust pipe
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.04, 1.3, 8).rotateX(Math.PI / 2), matChrome);
  exhaust.position.set(0.18, 0.28, -0.45);
  body.add(exhaust);

  // Front steering fork
  const frontSteerGroup = new THREE.Group();
  frontSteerGroup.position.set(0, 0.33, 0.78);

  // Spoked front wheel
  const fWheel = createWheel(0.33, 0.09, 12);
  frontSteerGroup.add(fWheel);

  const forkL = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.75, 6), matChrome);
  forkL.position.set(-0.09, 0.32, 0);
  const forkR = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.75, 6), matChrome);
  forkR.position.set(0.09, 0.32, 0);
  const handlebar = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.62, 8).rotateZ(Math.PI / 2), matChrome);
  handlebar.position.set(0, 0.74, -0.06);

  // Round headlamp nacelle
  const hlMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d0, emissiveIntensity: 0.9 })
  );
  hlMesh.position.set(0, 0.65, 0.10);
  frontSteerGroup.add(forkL, forkR, handlebar, hlMesh);
  body.add(frontSteerGroup);

  // Spoked rear wheel
  const rWheel = createWheel(0.33, 0.10, 12);
  rWheel.position.set(0, 0.33, -0.68);
  body.add(rWheel);

  // Taillight
  const tailMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.05, 8).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xd61818, emissive: 0xd61818, emissiveIntensity: 0.8 })
  );
  tailMesh.position.set(0, 0.58, -0.92);
  body.add(tailMesh);

  return {
    root,
    body,
    frontSteerGroup,
    wheels: [fWheel, rWheel],
    headlights: [hlMesh],
    taillights: [tailMesh],
    type: 'bike',
  };
}

export function createVehicleMesh(category: VehicleCategory): VehicleMeshBundle {
  switch (category) {
    case 'taxi':
      return buildAmbassadorTaxiMesh();
    case 'police':
      return buildPoliceCruiserMesh();
    case 'bike':
      return buildBullet350Mesh();
    case 'auto':
    default:
      return buildElectricAutoMesh();
  }
}
