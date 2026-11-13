import * as THREE from 'three';
import { ROAD_BOUNDS } from '../shared/types.ts';

export interface WorldObjects {
  scene: THREE.Scene;
  houseboats: { group: THREE.Group; baseY: number; z: number }[];
  shikaras: { group: THREE.Group; sp: number; dir: number; baseZ: number; isFlower: boolean }[];
  amberLights: THREE.Mesh[];
  waterMaterial: THREE.MeshLambertMaterial;
  barrierHitZ: number;
  southBarrierHitZ: number;
  nishatFountains: { mesh: THREE.Mesh; baseH: number; phase: number }[];
}

export function buildSrinagarWorld(scene: THREE.Scene): WorldObjects {
  const PI = Math.PI;
  const ZL = 440;

  // Scene background & realistic atmospheric mountain fog
  const SKY = 0xa4cbe8;
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(0xcce2f2, 280, 2400);

  // Helper material generator
  function mat(c: number) {
    return new THREE.MeshLambertMaterial({ color: c, flatShading: true });
  }

  function flat(w: number, l: number, x: number, y: number, c: number) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l).rotateX(-PI / 2), mat(c));
    m.position.set(x, y, 0);
    scene.add(m);
    return m;
  }

  // Lighting Rig
  const hemi = new THREE.HemisphereLight(0xe8f4fc, 0x3e5235, 0.92);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff7ea, 1.0);
  sun.position.set(280, 180, -240);
  scene.add(sun);

  // Sun disc in sky
  const disc = new THREE.Mesh(
    new THREE.SphereGeometry(32, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xfffae8, fog: false })
  );
  disc.position.set(580, 240, -750);
  scene.add(disc);

  // 1. Terrain Ground, Parking Strip, Road, Promenade
  flat(2400, 2400, 0, 0, 0x587842); // Grassy valley ground
  flat(19, 1000, -16.5, 0.03, 0x7d8182); // West pavement & hotel approach
  flat(14, 1000, 0, 0.04, 0x393c40); // 14m 4-Lane Boulevard Road
  flat(10, 1000, 12, 0.05, 0xb8aa8d); // Paved pedestrian promenade

  // Promenade deodar railing
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1, 1000), mat(0xe8e4d8));
  rail.position.set(17.4, 0.5, 0);
  scene.add(rail);

  // 2. Dal Lake Water Surface
  const waterMaterial = new THREE.MeshLambertMaterial({ color: 0x206d6b });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(580, 1500).rotateX(-PI / 2), waterMaterial);
  water.position.set(308, 0.08, 0);
  scene.add(water);

  // Center line road markings
  const N_DASH = 90;
  const dashMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.35, 0.05, 4),
    new THREE.MeshBasicMaterial({ color: 0xfff6db }),
    N_DASH
  );
  const dObj = new THREE.Object3D();
  for (let i = 0; i < N_DASH; i++) {
    dObj.position.set(0, 0.1, -445 + i * 10);
    dObj.updateMatrix();
    dashMesh.setMatrixAt(i, dObj.matrix);
  }
  scene.add(dashMesh);

  // Cast-iron lamp posts on promenade
  const N_POLES = 36;
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.15, 5, 6), mat(0x222629), N_POLES);
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffecb3 }), N_POLES);
  for (let i = 0; i < N_POLES; i++) {
    const z = -430 + i * 25;
    dObj.position.set(16.2, 2.5, z);
    dObj.updateMatrix();
    poles.setMatrixAt(i, dObj.matrix);
    dObj.position.y = 5.1;
    dObj.updateMatrix();
    bulbs.setMatrixAt(i, dObj.matrix);
  }
  scene.add(poles, bulbs);

  // 3. Real Himalayan Mountain Ranges (Zabarwan Range + Mount Mahadev + Shankaracharya + Western Ridges)
  const mountainGroup = new THREE.Group();

  // Create procedural mountain texture (layered rock striations and alpine snow)
  const mountainCanvas = document.createElement('canvas');
  mountainCanvas.width = 512;
  mountainCanvas.height = 512;
  const mCtx = mountainCanvas.getContext('2d')!;
  const grad = mCtx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0.0, '#ffffff'); // Snow peak
  grad.addColorStop(0.18, '#edf4f8'); // Alpine snow field
  grad.addColorStop(0.32, '#85929e'); // Slate granite rock
  grad.addColorStop(0.55, '#4a5863'); // Dark rocky crags
  grad.addColorStop(0.78, '#2d4a36'); // Pine deodar forest
  grad.addColorStop(1.0, '#223829'); // Deep valley green
  mCtx.fillStyle = grad;
  mCtx.fillRect(0, 0, 512, 512);

  // Add realistic crag striations
  mCtx.fillStyle = 'rgba(25, 35, 40, 0.15)';
  for (let i = 0; i < 70; i++) {
    const y = 80 + Math.random() * 380;
    const h = 4 + Math.random() * 18;
    mCtx.fillRect(0, y, 512, h);
  }

  const mountainTex = new THREE.CanvasTexture(mountainCanvas);
  mountainTex.wrapS = mountainTex.wrapT = THREE.RepeatWrapping;

  const matMountainRock = new THREE.MeshStandardMaterial({
    map: mountainTex,
    roughness: 0.9,
    metalness: 0.05,
    flatShading: true,
  });

  const matSnowCap = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.5,
    metalness: 0.1,
    flatShading: true,
  });

  const matFoothill = new THREE.MeshLambertMaterial({
    color: 0x2e4635,
    flatShading: true,
  });

  // A. Continuous Zabarwan Mountain Ridge (East & North-East across Dal Lake)
  // Procedural sculpted mountain ridge geometry using BufferGeometry with realistic ridgelines
  const ridgeWidth = 320;
  const ridgeLength = 2200;
  const ridgeSegmentsX = 42;
  const ridgeSegmentsZ = 72;
  const ridgeGeo = new THREE.PlaneGeometry(ridgeWidth, ridgeLength, ridgeSegmentsX, ridgeSegmentsZ);
  ridgeGeo.rotateX(-Math.PI / 2);

  const pos = ridgeGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const pz = pos.getZ(i);

    // Distance from central spine
    const distFromSpine = Math.abs(px);
    const spineFactor = Math.max(0, 1 - distFromSpine / (ridgeWidth * 0.5));

    // Multiple frequency Perlin-like pseudo noise for craggy ridgelines
    const n1 = Math.sin(pz * 0.007) * 90 + Math.cos(pz * 0.018) * 60;
    const n2 = Math.sin(px * 0.03 + pz * 0.02) * 35;
    const n3 = Math.sin(pz * 0.05) * 15;

    // Base elevation profile (higher near Mount Mahadev around z = -140)
    const mahadevInfluence = Math.exp(-Math.pow((pz + 140) / 360, 2)) * 140;

    let elevation = (190 + n1 + n2 + n3 + mahadevInfluence) * Math.pow(spineFactor, 1.4);
    if (elevation < 0) elevation = 0;

    pos.setY(i, elevation);
  }
  ridgeGeo.computeVertexNormals();

  const mainRidgeMesh = new THREE.Mesh(ridgeGeo, matMountainRock);
  mainRidgeMesh.position.set(520, 0, 0);
  mountainGroup.add(mainRidgeMesh);

  // B. Hero Landmark: Mount Mahadev Majestic Peak (Highest peak behind Nishat/Harwan)
  const mahadevGroup = new THREE.Group();
  mahadevGroup.position.set(560, 0, -140);

  const mahadevBaseGeo = new THREE.ConeGeometry(190, 360, 8);
  const mahadevBase = new THREE.Mesh(mahadevBaseGeo, matMountainRock);
  mahadevBase.position.y = 180;
  mahadevBase.scale.set(1.1, 1.0, 0.85);

  const mahadevSnowGeo = new THREE.ConeGeometry(95, 160, 8);
  const mahadevSnow = new THREE.Mesh(mahadevSnowGeo, matSnowCap);
  mahadevSnow.position.y = 280;
  mahadevSnow.scale.set(1.12, 1.0, 0.86);

  mahadevGroup.add(mahadevBase, mahadevSnow);
  mountainGroup.add(mahadevGroup);

  // C. Shankaracharya Hill (South-East Promontory overlooking Dalgate)
  const shankarGroup = new THREE.Group();
  shankarGroup.position.set(320, 0, 680);
  const shankarHill = new THREE.Mesh(new THREE.ConeGeometry(130, 155, 9), matFoothill);
  shankarHill.position.y = 77;
  const temple = new THREE.Mesh(new THREE.BoxGeometry(12, 10, 12), mat(0xc2b8a7));
  temple.position.y = 158;
  const spire = new THREE.Mesh(new THREE.ConeGeometry(6, 16, 6), mat(0xb8a994));
  spire.position.y = 171;
  shankarGroup.add(shankarHill, temple, spire);
  mountainGroup.add(shankarGroup);

  // D. Western Mountain Flank (Hari Parbat & Old City Hills behind Boulevard Hotels)
  const westRidgeGeo = new THREE.PlaneGeometry(240, 2000, 32, 60);
  westRidgeGeo.rotateX(-Math.PI / 2);
  const wPos = westRidgeGeo.attributes.position;
  for (let i = 0; i < wPos.count; i++) {
    const px = wPos.getX(i);
    const pz = wPos.getZ(i);
    const distFromSpine = Math.abs(px);
    const spineFactor = Math.max(0, 1 - distFromSpine / (240 * 0.5));
    const n = Math.sin(pz * 0.009) * 55 + Math.cos(pz * 0.025) * 30;
    const h = (120 + n) * Math.pow(spineFactor, 1.3);
    wPos.setY(i, Math.max(0, h));
  }
  westRidgeGeo.computeVertexNormals();

  const westRidgeMesh = new THREE.Mesh(westRidgeGeo, matMountainRock);
  westRidgeMesh.position.set(-360, 0, 0);
  mountainGroup.add(westRidgeMesh);

  // Historic Hari Parbat Fort Citadel on Western Ridge
  const fortGroup = new THREE.Group();
  fortGroup.position.set(-350, 130, 80);
  const fortWalls = new THREE.Mesh(new THREE.BoxGeometry(45, 14, 34), mat(0x73695d));
  const fortTower1 = new THREE.Mesh(new THREE.CylinderGeometry(4, 4.5, 20, 8), mat(0x62594e));
  fortTower1.position.set(-20, 3, -15);
  const fortTower2 = new THREE.Mesh(new THREE.CylinderGeometry(4, 4.5, 20, 8), mat(0x62594e));
  fortTower2.position.set(20, 3, 15);
  fortGroup.add(fortWalls, fortTower1, fortTower2);
  mountainGroup.add(fortGroup);

  // E. Dense Deodar Pine Foothills & Spurs buffering Dal Lake
  const pineConeGeo = new THREE.ConeGeometry(24, 52, 6);
  const N_SPURS = 28;
  const spursMesh = new THREE.InstancedMesh(pineConeGeo, matFoothill, N_SPURS);
  const sObj = new THREE.Object3D();
  for (let s = 0; s < N_SPURS; s++) {
    const sz = -680 + s * 50 + (s % 3) * 15;
    const sx = 370 + (s % 4) * 22;
    const sc = 0.8 + (s % 3) * 0.35;
    sObj.position.set(sx, 26 * sc, sz);
    sObj.scale.set(sc, sc, sc);
    sObj.rotation.y = s * 0.7;
    sObj.updateMatrix();
    spursMesh.setMatrixAt(s, sObj.matrix);
  }
  mountainGroup.add(spursMesh);

  scene.add(mountainGroup);

  // 4. Heritage Hotels & Shops on West Flank
  const winC = document.createElement('canvas');
  winC.width = winC.height = 128;
  const ctx = winC.getContext('2d')!;
  ctx.fillStyle = '#362419';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#233a47';
  ctx.fillRect(10, 10, 48, 48);
  ctx.fillRect(70, 10, 48, 48);
  ctx.fillStyle = '#ffd885';
  ctx.fillRect(10, 68, 48, 48);
  ctx.fillRect(70, 68, 48, 48);
  const winTex = new THREE.CanvasTexture(winC);
  winTex.wrapS = winTex.wrapT = THREE.RepeatWrapping;

  function signTex(n: string, bg: string, fg: string) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 112;
    const x = c.getContext('2d')!;
    x.fillStyle = bg;
    x.fillRect(0, 0, 512, 112);
    x.strokeStyle = fg;
    x.lineWidth = 6;
    x.strokeRect(6, 6, 500, 100);
    x.font = 'bold 38px Arial, sans-serif';
    x.fillStyle = fg;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(n, 256, 58);
    return new THREE.CanvasTexture(c);
  }

  const SHOPS = [
    ['Grand Boulevard Hotel', '#1b365d', '#ffffff', 0xf3ede2, 0x3e2718],
    ['Ahdoos Heritage Hotel', '#7a2518', '#ffe8ba', 0x9c4331, 0x2c1a11],
    ['Hotel Pine & Peak', '#1d4334', '#e8f2ea', 0x4f6b58, 0x223627],
    ['Chinar Palace', '#8a281c', '#ffd79e', 0xd9cbbe, 0x4a2e1d],
    ['Lakeside Cedar Cafe', '#3b281c', '#f7e1b5', 0x69462e, 0x26190f],
    ['Wazwan Darbar', '#6e1a1a', '#fce5b8', 0xa34537, 0x381913],
    ['Pashmina Silk Palace', '#4a154b', '#ffffff', 0xebdcd0, 0x382216],
    ['Kahwa & Saffron Lounge', '#b85d19', '#ffffff', 0x785135, 0x2a1a0f],
  ];

  const roofG = new THREE.ConeGeometry(0.53, 0.5, 4).rotateY(PI / 4);

  for (let i = 0; i < 40; i++) {
    // Remove 3 hotels (indices 19, 20, 21 corresponding to z = -13, 9, 31)
    // to open a grand 68m scenic entrance for Nishat Bagh Mughal Garden!
    if (i >= 19 && i <= 21) {
      continue;
    }

    const z = -440 + i * 22 + 9;
    const isBurgerBarn = i === 38;
    const s = isBurgerBarn ? ['BURGER BARN', '#b31414', '#ffe600', 0xdfc29e, 0x8a2318] : SHOPS[i % SHOPS.length];
    const h = isBurgerBarn ? 12 : 14 + (i % 3) * 4;

    const b = new THREE.Mesh(new THREE.BoxGeometry(14, h, 18), mat(s[3] as number));
    b.position.set(-33, h / 2, z);
    scene.add(b);

    const fp = new THREE.Mesh(
      new THREE.PlaneGeometry(13.6, h - 5).rotateY(PI / 2),
      new THREE.MeshLambertMaterial({ map: winTex.clone(), transparent: true })
    );
    fp.position.set(-25.93, 5 + (h - 5) / 2, z);
    scene.add(fp);

    const sg = new THREE.Mesh(
      new THREE.PlaneGeometry(11, 2.4).rotateY(PI / 2),
      new THREE.MeshBasicMaterial({ map: signTex(s[0] as string, s[1] as string, s[2] as string) })
    );
    sg.position.set(-25.88, 3.9, z);
    scene.add(sg);

    const rf = new THREE.Mesh(roofG, mat(0x8b271b));
    rf.scale.set(14.6, 7, 18.6);
    rf.position.set(-33, h + 1.7, z);
    scene.add(rf);

    if (isBurgerBarn) {
      // Outdoor seating tables
      const tableMat = mat(0x8a2318);
      for (let tO = -4; tO <= 4; tO += 4) {
        const tbl = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.8, 8), tableMat);
        tbl.position.set(-23.5, 0.4, z + tO);
        const umb = new THREE.Mesh(new THREE.ConeGeometry(1.8, 0.6, 8), mat(0xf2a900));
        umb.position.set(-23.5, 2.1, z + tO);
        scene.add(tbl, umb);
      }
    }
  }

  // 4b. Nishat Bagh (Garden of Bliss, 1633 AD) — Authentic Mughal Terraced Garden
  const nishatFountains: { mesh: THREE.Mesh; baseH: number; phase: number }[] = [];
  const nishatGroup = new THREE.Group();
  nishatGroup.position.set(0, 0, 9.0); // Exactly centered at the gap between Hotel Pine & Peak (ends at z = -26) and Hotel 22 (starts at z = 44)

  // Load high-resolution authentic facade texture
  const texLoader = new THREE.TextureLoader();
  const nishatTex = texLoader.load('/assets/nishat_bagh_facade.jpg');
  nishatTex.colorSpace = THREE.SRGBColorSpace;

  // Materials for Nishat Bagh
  const matSandstone = mat(0xc9ab85); // Warm Kashmiri devri buff sandstone
  const matRedStone = mat(0x944238);  // Mughal imperial red sandstone
  const matMughalCedar = mat(0x422a1d); // Carved Himalayan cedar woodwork
  const matLawn = mat(0x2d6b38); // Manicured royal emerald Mughal lawn
  const matWaterTurquoise = new THREE.MeshLambertMaterial({ color: 0x19938b, transparent: true, opacity: 0.88 });
  const matChadarRipple = mat(0xbfd7d5); // Texturized scalloped water cascade ramp
  const matJaliWall = mat(0xb09574);

  // A. Entrance Forecourt & Driveway Plaza along Boulevard Road (world z = -26 to +44, local z = -35 to +35)
  const forecourt = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 70).rotateX(-PI / 2),
    mat(0xa89f91)
  );
  forecourt.position.set(-21.5, 0.05, 0);
  nishatGroup.add(forecourt);

  // Roadside Mughal Entry Archway & Pavilion Gatehouse (x = -27.5, z = 0, width 32m)
  const gatehouse = new THREE.Group();
  gatehouse.position.set(-27.5, 0, 0);

  // Main Sandstone Gateway Block
  const gateBlock = new THREE.Mesh(new THREE.BoxGeometry(3.6, 13.5, 30), matSandstone);
  gateBlock.position.set(0, 6.75, 0);
  gatehouse.add(gateBlock);

  // Central Scalloped Arch Passage Cutaway (allowing views and passage through the gate)
  const archPassage = new THREE.Mesh(new THREE.BoxGeometry(3.8, 8.5, 7.5), mat(0x1a2129));
  archPassage.position.set(0, 4.25, 0);
  gatehouse.add(archPassage);

  // Flanking Side Arches
  const sideArchL = new THREE.Mesh(new THREE.BoxGeometry(3.7, 6.5, 4.5), mat(0x283138));
  sideArchL.position.set(0, 3.25, -9);
  const sideArchR = new THREE.Mesh(new THREE.BoxGeometry(3.7, 6.5, 4.5), mat(0x283138));
  sideArchR.position.set(0, 3.25, 9);
  gatehouse.add(sideArchL, sideArchR);

  // Authentic Nishat Bagh Facade Graphic Banner mapped onto the gatehouse front
  const facadePlane = new THREE.Mesh(
    new THREE.PlaneGeometry(28, 13.2).rotateY(PI / 2),
    new THREE.MeshLambertMaterial({ map: nishatTex, transparent: true })
  );
  facadePlane.position.set(1.85, 6.6, 0);
  gatehouse.add(facadePlane);

  // Upper Timber Khatamband Balcony & Pagoda Eaves (Jharokha)
  const jharokha = new THREE.Mesh(new THREE.BoxGeometry(4.4, 3.2, 11), matMughalCedar);
  jharokha.position.set(0, 14.5, 0);
  const jharokhaRoof = new THREE.Mesh(new THREE.ConeGeometry(0.53, 0.5, 4).rotateY(PI / 4), matRedStone);
  jharokhaRoof.scale.set(6, 3.5, 13);
  jharokhaRoof.position.set(0, 16.8, 0);
  gatehouse.add(jharokha, jharokhaRoof);

  // Historic Signboard: NISHAT BAGH · GARDEN OF BLISS
  function nishatSignTex() {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 160;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#0f2922'; // Imperial Mughal deep forest green
    ctx.fillRect(0, 0, 1024, 160);
    ctx.strokeStyle = '#e6b325'; // Regal Gold border
    ctx.lineWidth = 10;
    ctx.strokeRect(10, 10, 1004, 140);
    // Gold lettering
    ctx.fillStyle = '#fce588';
    ctx.textAlign = 'center';
    ctx.font = 'bold 44px Georgia, serif';
    ctx.fillText('NISHAT BAGH · باغِ نشاط', 512, 60);
    ctx.font = '600 28px Arial, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('THE GARDEN OF BLISS · ESTD. 1633 AD (ASIF KHAN)', 512, 112);
    return new THREE.CanvasTexture(c);
  }

  const signMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 2.8).rotateY(PI / 2),
    new THREE.MeshBasicMaterial({ map: nishatSignTex() })
  );
  signMesh.position.set(1.88, 11.2, 0);
  gatehouse.add(signMesh);

  // Heritage Brass Lanterns
  [-13, -4.5, 4.5, 13].forEach(lz => {
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.25, 1.4, 6), mat(0xe5a93c));
    lamp.position.set(2.0, 7.5, lz);
    gatehouse.add(lamp);
  });

  nishatGroup.add(gatehouse);

  // B. Four Stepped Ascending Zodiac Terraces (Extending Westwards from x = -28 to x = -116)
  const terraces = [
    { x1: -28, x2: -50, y: 0.25, name: 'Terrace 1: Public Garden' },
    { x1: -50, x2: -72, y: 1.45, name: 'Terrace 2: Cypress Avenue' },
    { x1: -72, x2: -94, y: 2.85, name: 'Terrace 3: Baradari Summer Pavilion' },
    { x1: -94, x2: -116, y: 4.40, name: 'Terrace 4: Zenana Court' },
  ];

  terraces.forEach((t, idx) => {
    const widthX = t.x1 - t.x2;
    const centerX = (t.x1 + t.x2) / 2;

    // Left lawn plane (z: -32 to -2.5)
    const lawnL = new THREE.Mesh(new THREE.PlaneGeometry(widthX, 29).rotateX(-PI / 2), matLawn);
    lawnL.position.set(centerX, t.y, -16.8);
    // Right lawn plane (z: 2.5 to 32)
    const lawnR = new THREE.Mesh(new THREE.PlaneGeometry(widthX, 29).rotateX(-PI / 2), matLawn);
    lawnR.position.set(centerX, t.y, 16.8);

    // Stone paved walkways flanking the canal
    const walkL = new THREE.Mesh(new THREE.PlaneGeometry(widthX, 2.5).rotateX(-PI / 2), matSandstone);
    walkL.position.set(centerX, t.y + 0.02, -3.5);
    const walkR = new THREE.Mesh(new THREE.PlaneGeometry(widthX, 2.5).rotateX(-PI / 2), matSandstone);
    walkR.position.set(centerX, t.y + 0.02, 3.5);

    nishatGroup.add(lawnL, lawnR, walkL, walkR);

    // Symmetrical geometric Mughal flowerbeds (Charbagh floral parterres)
    const flowerColors = [0xb91c1c, 0xf59e0b, 0xec4899, 0x8b5cf6];
    for (let fz = -26; fz <= 26; fz += 8) {
      if (Math.abs(fz) < 5) continue;
      const bed = new THREE.Mesh(
        new THREE.PlaneGeometry(widthX * 0.45, 3.8).rotateX(-PI / 2),
        mat(flowerColors[(idx + Math.abs(fz)) % flowerColors.length])
      );
      bed.position.set(centerX, t.y + 0.03, fz);
      nishatGroup.add(bed);
    }

    // Terrace Retaining Wall & Water Chadar (at step boundary)
    if (idx < terraces.length - 1) {
      const nextY = terraces[idx + 1].y;
      const wallH = nextY - t.y;
      const wallX = t.x2;

      // Stone retaining walls flanking the central water chute
      const retWallL = new THREE.Mesh(new THREE.BoxGeometry(0.8, wallH + 0.2, 28), matSandstone);
      retWallL.position.set(wallX, t.y + wallH / 2, -16.5);
      const retWallR = new THREE.Mesh(new THREE.BoxGeometry(0.8, wallH + 0.2, 28), matSandstone);
      retWallR.position.set(wallX, t.y + wallH / 2, 16.5);
      nishatGroup.add(retWallL, retWallR);

      // Carved Scalloped Water Ramp (Chadar) where water cascades down to lower terrace
      const chadar = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.4, 4.2), matChadarRipple);
      chadar.rotation.z = Math.atan2(wallH, 2.2);
      chadar.position.set(wallX + 1.0, t.y + wallH / 2, 0);
      nishatGroup.add(chadar);

      // Flanking stone staircases
      const stairL = new THREE.Mesh(new THREE.BoxGeometry(2.2, wallH, 1.8), matSandstone);
      stairL.position.set(wallX + 0.9, t.y + wallH / 2, -3.2);
      const stairR = new THREE.Mesh(new THREE.BoxGeometry(2.2, wallH, 1.8), matSandstone);
      stairR.position.set(wallX + 0.9, t.y + wallH / 2, 3.2);
      nishatGroup.add(stairL, stairR);
    }
  });

  // C. Central Cascading Watercourse & Animated Fountains (x = -26 to -114, z = 0)
  const canalL = 88;
  const canalCenterX = -70;
  const canalFloor = new THREE.Mesh(new THREE.PlaneGeometry(canalL, 4.2).rotateX(-PI / 2), matWaterTurquoise);
  canalFloor.position.set(canalCenterX, 0.18, 0);
  nishatGroup.add(canalFloor);

  // Five Fountain Basins & Vertical Spray Plumes along the central axis
  const fountainPositions = [-36, -50, -64, -80, -104];
  fountainPositions.forEach((fx, fIdx) => {
    // Octagonal / Circular Stone Pool Basin
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.3, 0.4, 8), matSandstone);
    basin.position.set(fx, 0.35, 0);
    nishatGroup.add(basin);

    // Center fountain jet nozzle
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.6, 6), mat(0x1a1a1a));
    nozzle.position.set(fx, 0.6, 0);
    nishatGroup.add(nozzle);

    // Animated Fountain Spray Plume
    const sprayGeo = new THREE.ConeGeometry(0.65, 3.2, 8);
    sprayGeo.translate(0, 1.6, 0);
    const sprayMesh = new THREE.Mesh(sprayGeo, new THREE.MeshBasicMaterial({ color: 0xebf8ff, transparent: true, opacity: 0.72 }));
    sprayMesh.position.set(fx, 0.7, 0);
    nishatGroup.add(sprayMesh);
    nishatFountains.push({ mesh: sprayMesh, baseH: 3.2, phase: fIdx * 1.2 });
  });

  // D. The Iconic Mughal Summer Pavilion (Baradari) on Terrace 3 (x = -80, z = 0)
  const baradariGroup = new THREE.Group();
  baradariGroup.position.set(-80, 2.85, 0);

  // Raised Marble Plinth over the watercourse
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(16, 0.8, 16), matSandstone);
  plinth.position.y = 0.4;
  baradariGroup.add(plinth);

  // 12 Mughal Scalloped Stone Pillars
  const pillarGeo = new THREE.CylinderGeometry(0.35, 0.45, 6, 8);
  const pillarMat = mat(0xe8d8be);
  for (let px = -6; px <= 6; px += 4) {
    for (let pz = -6; pz <= 6; pz += 4) {
      if (Math.abs(px) < 5 && Math.abs(pz) < 5) continue; // open central chamber
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.position.set(px, 3.8, pz);
      baradariGroup.add(pillar);
    }
  }

  // Baradari Overhanging Cedar Timber Roof & Spire
  const baradariRoof = new THREE.Mesh(new THREE.BoxGeometry(18, 0.8, 18), matMughalCedar);
  baradariRoof.position.y = 7.2;
  const baradariDome = new THREE.Mesh(new THREE.ConeGeometry(0.53, 0.5, 4).rotateY(PI / 4), matRedStone);
  baradariDome.scale.set(15, 5.5, 15);
  baradariDome.position.y = 10.2;
  const baradariSpire = new THREE.Mesh(new THREE.ConeGeometry(0.4, 2.5, 6), mat(0xe5a93c));
  baradariSpire.position.y = 14.0;
  baradariGroup.add(baradariRoof, baradariDome, baradariSpire);
  nishatGroup.add(baradariGroup);

  // E. Royal Chinar Trees (Platanus orientalis) & Italian Cypress Avenues
  // Chinar Trees: Multi-tiered sprawling foliage in regal Kashmiri hues
  const chinarPositions = [
    { x: -38, z: -14 }, { x: -38, z: 14 },
    { x: -62, z: -16 }, { x: -62, z: 16 },
    { x: -96, z: -18 }, { x: -96, z: 18 },
  ];

  chinarPositions.forEach((pos, cIdx) => {
    const chinar = new THREE.Group();
    chinar.position.set(pos.x, 0.5, pos.z);

    // Gnarled thick trunk
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.8, 9, 7), mat(0x4a3728));
    trunk.position.y = 4.5;
    chinar.add(trunk);

    // Sprawling multi-level autumn & emerald foliage
    const foliageColors = [0xd97724, 0xb45309, 0x2e6f40, 0xca8a04];
    const col = foliageColors[cIdx % foliageColors.length];
    const can1 = new THREE.Mesh(new THREE.DodecahedronGeometry(6.5), mat(col));
    can1.position.set(0, 11, 0);
    const can2 = new THREE.Mesh(new THREE.DodecahedronGeometry(5.2), mat(col));
    can2.position.set(3, 13, -2);
    const can3 = new THREE.Mesh(new THREE.DodecahedronGeometry(5.4), mat(col));
    can3.position.set(-2.5, 12.5, 2.5);
    chinar.add(can1, can2, can3);

    nishatGroup.add(chinar);
  });

  // Italian Cypress Trees (Sarv) lining the terrace avenues
  const cypressPositions = [
    { x: -34, z: -6 }, { x: -34, z: 6 },
    { x: -44, z: -6 }, { x: -44, z: 6 },
    { x: -56, z: -6 }, { x: -56, z: 6 },
    { x: -68, z: -6 }, { x: -68, z: 6 },
    { x: -88, z: -6 }, { x: -88, z: 6 },
    { x: -100, z: -6 }, { x: -100, z: 6 },
  ];

  const cypressMat = mat(0x194520);
  cypressPositions.forEach(cPos => {
    const cy = new THREE.Group();
    cy.position.set(cPos.x, 1.0, cPos.z);
    const cTrunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 2, 6), mat(0x38281a));
    cTrunk.position.y = 1;
    const cSpire = new THREE.Mesh(new THREE.ConeGeometry(1.1, 9, 7), cypressMat);
    cSpire.position.y = 5.5;
    cy.add(cTrunk, cSpire);
    nishatGroup.add(cy);
  });

  // F. Mughal Perimeter Enclosure Walls (Looking authentic from all sides)
  // South Wall (local z = -35.0, world z = -26.0, flush against Hotel Pine & Peak)
  const wallSouth = new THREE.Mesh(new THREE.BoxGeometry(90, 4.5, 1.2), matJaliWall);
  wallSouth.position.set(-71, 2.4, -35.0);
  // North Wall (local z = +35.0, world z = +44.0, flush against Hotel 22)
  const wallNorth = new THREE.Mesh(new THREE.BoxGeometry(90, 4.5, 1.2), matJaliWall);
  wallNorth.position.set(-71, 2.4, 35.0);
  // Rear Top Terrace Zenana Wall (x = -116, local z in [-35, 35])
  const wallRear = new THREE.Mesh(new THREE.BoxGeometry(1.4, 7.5, 70), matSandstone);
  wallRear.position.set(-116, 4.5, 0);
  nishatGroup.add(wallSouth, wallNorth, wallRear);

  // Corner Octagonal Chhatris (Viewing Turrets overlooking Dal Lake)
  [-34, 34].forEach(cz => {
    const chhatri = new THREE.Group();
    chhatri.position.set(-114, 5.0, cz);
    const chBase = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.8, 3.5, 8), matSandstone);
    chBase.position.y = 1.75;
    const chPillars = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 3.2, 8), mat(0x2a1a0f));
    chPillars.position.y = 5.1;
    const chDome = new THREE.Mesh(new THREE.SphereGeometry(2.6, 8, 8, 0, PI * 2, 0, PI / 2), matRedStone);
    chDome.position.y = 6.6;
    chhatri.add(chBase, chPillars, chDome);
    nishatGroup.add(chhatri);
  });

  scene.add(nishatGroup);

  // 5. JK Police checkpoints at both Boulevard Road endings
  // North: Burger Barn (z = 413). South: Dalgate (z = -430).
  const NORTH_CHECKPOINT_Z = ROAD_BOUNDS.CHECKPOINT_Z;
  const SOUTH_CHECKPOINT_Z = ROAD_BOUNDS.SOUTH_CHECKPOINT_Z;
  const amberLights: THREE.Mesh[] = [];

  function canvasTex(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d')!, w, h);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function makeJerseyTex() {
    const tex = canvasTex((cx, w, h) => {
      cx.fillStyle = '#9e9d99';
      cx.fillRect(0, 0, w, h);
      cx.fillStyle = '#ffb700';
      cx.fillRect(0, 40, w, 50);
      cx.fillStyle = '#1c1b18';
      for (let i = -100; i < 350; i += 40) {
        cx.beginPath();
        cx.moveTo(i, 40);
        cx.lineTo(i + 25, 40);
        cx.lineTo(i - 10, 90);
        cx.lineTo(i - 35, 90);
        cx.closePath();
        cx.fill();
      }
    }, 256, 128);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  function makePoliceBannerTex(subtitle: string) {
    return canvasTex((cx, w, h) => {
      cx.fillStyle = '#0f2038';
      cx.fillRect(0, 0, w, h);
      cx.fillStyle = '#a81919';
      cx.fillRect(0, 0, w, 24);
      cx.fillRect(0, h - 24, w, 24);
      cx.strokeStyle = '#d4af37';
      cx.lineWidth = 4;
      cx.strokeRect(6, 6, w - 12, h - 12);
      cx.textAlign = 'center';
      cx.fillStyle = '#ffea75';
      cx.font = 'bold 22px Arial, sans-serif';
      cx.fillText('JAMMU & KASHMIR POLICE', w / 2, 48);
      cx.fillStyle = '#ffffff';
      cx.font = 'bold 26px Arial, sans-serif';
      cx.fillText('CHECK POST — ALL VEHICLES STOP', w / 2, 84);
      cx.fillStyle = '#ffc107';
      cx.font = 'bold 14px Arial, sans-serif';
      cx.fillText(subtitle, w / 2, 110);
    }, 512, 140);
  }

  function makeRoadClosedSignTex() {
    return canvasTex((cx, w, h) => {
      cx.fillStyle = '#ffcc00';
      cx.fillRect(0, 0, w, h);
      cx.fillStyle = '#d32f2f';
      for (let i = 0; i < w; i += 28) {
        cx.fillRect(i, 0, 14, 14);
        cx.fillRect(i, h - 14, 14, 14);
      }
      cx.strokeStyle = '#b71c1c';
      cx.lineWidth = 6;
      cx.strokeRect(6, 6, w - 12, h - 12);
      cx.textAlign = 'center';
      cx.fillStyle = '#b71c1c';
      cx.font = '900 32px Arial, sans-serif';
      cx.fillText('ROAD CLOSED', w / 2, 48);
      cx.fillStyle = '#111111';
      cx.font = 'bold 21px Arial, sans-serif';
      cx.fillText('NO VEHICLE ENTRY BEYOND THIS POINT', w / 2, 84);
      cx.fillStyle = '#b71c1c';
      cx.font = 'bold 15px Arial, sans-serif';
      cx.fillText('✦ TRESPASSERS WILL BE PROSECUTED ✦', w / 2, 110);
    }, 512, 140);
  }

  function makeMetalBarricadeTex() {
    return canvasTex((cx, w, h) => {
      cx.fillStyle = '#e0e0e0';
      cx.fillRect(0, 0, w, h);
      cx.fillStyle = '#d32f2f';
      for (let i = -50; i < 300; i += 32) {
        cx.beginPath();
        cx.moveTo(i, 0);
        cx.lineTo(i + 16, 0);
        cx.lineTo(i - 10, h);
        cx.lineTo(i - 26, h);
        cx.closePath();
        cx.fill();
      }
      cx.fillStyle = '#0f2038';
      cx.fillRect(30, 14, 196, 36);
      cx.fillStyle = '#ffeb3b';
      cx.font = 'bold 20px Arial, sans-serif';
      cx.textAlign = 'center';
      cx.fillText('JK POLICE', 128, 39);
    }, 256, 64);
  }

  const jerseyTex = makeJerseyTex();
  const metalBarricadeTex = makeMetalBarricadeTex();
  const roadClosedTex = makeRoadClosedSignTex();
  const northPoliceBanner = makePoliceBannerTex('RESTRICTED BORDER ZONE • ENTRY BY PERMIT ONLY');
  const southPoliceBanner = makePoliceBannerTex('DALGATE SECURITY CORDON • NO EXIT BEYOND THIS POINT');

  function buildJkPoliceCheckpoint(opts: {
    z: number;
    facing: 1 | -1;
    postName: string;
    bannerTex: THREE.CanvasTexture;
  }) {
    const { z, facing, postName, bannerTex } = opts;
    const inward = z - facing * 1.8;
    const signZ = z - facing * 0.3;
    const signYaw = facing === 1 ? PI : 0;
    const cp = new THREE.Group();
    const jMat = new THREE.MeshLambertMaterial({ map: jerseyTex });
    const mbMat = new THREE.MeshLambertMaterial({ map: metalBarricadeTex });
    const pipeMat = mat(0x222222);
    const pipeGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6);
    const signSide = THREE.DoubleSide;

    for (let x = -23; x <= 17; x += 4.4) {
      const jb = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.4, 1.4), jMat);
      base.position.y = 0.2;
      const mid = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.6, 0.9), jMat);
      mid.position.y = 0.7;
      const top = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.4, 0.5), jMat);
      top.position.y = 1.2;
      jb.add(base, mid, top);
      jb.position.set(x, 0, z);
      cp.add(jb);
    }

    for (let bx = -21; bx <= 15; bx += 4.8) {
      const bar = new THREE.Group();
      const panel = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.85, 0.08), mbMat);
      panel.position.y = 1.1;
      const postL = new THREE.Mesh(pipeGeo, pipeMat);
      postL.position.set(-2.0, 0.8, 0);
      const postR = new THREE.Mesh(pipeGeo, pipeMat);
      postR.position.set(2.0, 0.8, 0);
      const legL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 1.1), pipeMat);
      legL.position.set(-2.0, 0.05, 0);
      const legR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 1.1), pipeMat);
      legR.position.set(2.0, 0.05, 0);
      bar.add(panel, postL, postR, legL, legR);
      bar.position.set(bx, 0, inward);
      bar.rotation.y = signYaw;
      cp.add(bar);
    }

    const coilGeo = new THREE.TorusGeometry(0.48, 0.03, 5, 12);
    const wireMat = new THREE.MeshStandardMaterial({ color: 0xdfe7ec, roughness: 0.3, metalness: 0.9 });
    const totalCoils = 130;
    const wireMesh = new THREE.InstancedMesh(coilGeo, wireMat, totalCoils);
    const dCoil = new THREE.Object3D();
    let cIdx = 0;
    for (let wx = -23; wx <= 17; wx += 0.6) {
      if (cIdx >= totalCoils) break;
      dCoil.position.set(wx, 1.85, z + Math.sin(wx * 2) * 0.08);
      dCoil.rotation.set(0.1, wx * 1.2, PI / 2);
      dCoil.updateMatrix();
      wireMesh.setMatrixAt(cIdx++, dCoil.matrix);
    }
    for (let wx2 = -22; wx2 <= 16; wx2 += 0.7) {
      if (cIdx >= totalCoils) break;
      dCoil.position.set(wx2, 0.48, z - facing * 0.8);
      dCoil.rotation.set(-0.1, -wx2 * 1.3, PI / 2);
      dCoil.updateMatrix();
      wireMesh.setMatrixAt(cIdx++, dCoil.matrix);
    }
    wireMesh.count = cIdx;
    wireMesh.instanceMatrix.needsUpdate = true;
    cp.add(wireMesh);

    const postGeo = new THREE.BoxGeometry(0.08, 2.4, 0.08);
    const steelMat = mat(0x384147);
    for (let px = -23; px <= 17; px += 3.6) {
      const stP = new THREE.Mesh(postGeo, steelMat);
      stP.position.set(px, 1.2, z);
      const armL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.06), steelMat);
      armL.position.set(0, 1.2, -0.18 * facing);
      armL.rotation.x = 0.6 * facing;
      const armR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.06), steelMat);
      armR.position.set(0, 1.2, 0.18 * facing);
      armR.rotation.x = -0.6 * facing;
      stP.add(armL, armR);
      cp.add(stP);
    }

    const gantryMat = mat(0x283238);
    const pL = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6.2, 0.4), gantryMat);
    pL.position.set(-8.5, 3.1, z);
    const pR = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6.2, 0.4), gantryMat);
    pR.position.set(8.5, 3.1, z);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(17.4, 0.4, 0.4), gantryMat);
    beam.position.set(0, 6.0, z);
    cp.add(pL, pR, beam);

    const rcSign = new THREE.Mesh(
      new THREE.PlaneGeometry(10.5, 2.6),
      new THREE.MeshBasicMaterial({ map: roadClosedTex, side: signSide })
    );
    rcSign.position.set(0, 4.8, signZ);
    rcSign.rotation.y = signYaw;
    cp.add(rcSign);

    const jkSign = new THREE.Mesh(
      new THREE.PlaneGeometry(9.6, 2.4),
      new THREE.MeshBasicMaterial({ map: bannerTex, side: signSide })
    );
    jkSign.position.set(0, 2.5, signZ);
    jkSign.rotation.y = signYaw;
    cp.add(jkSign);

    const amberMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
    [-8.5, -3.5, 3.5, 8.5].forEach(lx => {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), amberMat);
      bulb.position.set(lx, 6.4, z);
      cp.add(bulb);
      amberLights.push(bulb);
    });

    const boothGroup = new THREE.Group();
    boothGroup.position.set(-14.5, 0, z - facing * 3.5);
    const sandbagMat = mat(0xa6957b);
    for (let sy = 0; sy < 3; sy++) {
      for (let sx = -2.4; sx <= 2.4; sx += 1.2) {
        const sb = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.32, 0.7), sandbagMat);
        sb.position.set(sx, 0.16 + sy * 0.3, 1.8 * facing);
        boothGroup.add(sb);
      }
    }

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(3.6, 3.4, 3.6), mat(0x2f4035));
    cabin.position.set(0, 1.7, 0);
    const tinRoof = new THREE.Mesh(new THREE.ConeGeometry(2.8, 1.2, 4).rotateY(PI / 4), mat(0x6e2c24));
    tinRoof.position.set(0, 4.0, 0);
    const slit = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.8), new THREE.MeshBasicMaterial({ color: 0x111c15, side: signSide }));
    slit.position.set(0, 2.2, 1.81 * facing);
    slit.rotation.y = signYaw;
    const boothSignTex = signTex(postName, '#0f2038', '#ffeb3b');
    boothSignTex.colorSpace = THREE.SRGBColorSpace;
    const boothSign = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 0.6),
      new THREE.MeshBasicMaterial({ map: boothSignTex, side: signSide })
    );
    boothSign.position.set(0, 3.2, 1.82 * facing);
    boothSign.rotation.y = signYaw;

    const boomPole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.4, 6), mat(0x111111));
    boomPole.position.set(2.2, 0.7, 1.0 * facing);
    const boomArm = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.18, 0.1), mat(0xff3333));
    boomArm.position.set(5.2, 1.0, 1.0 * facing);
    boothGroup.add(cabin, tinRoof, slit, boothSign, boomPole, boomArm);
    cp.add(boothGroup);

    scene.add(cp);
  }

  buildJkPoliceCheckpoint({
    z: NORTH_CHECKPOINT_Z,
    facing: 1,
    postName: 'JK POLICE POST NO. 4',
    bannerTex: northPoliceBanner,
  });
  buildJkPoliceCheckpoint({
    z: SOUTH_CHECKPOINT_Z,
    facing: -1,
    postName: 'JK POLICE DALGATE POST',
    bannerTex: southPoliceBanner,
  });

  // 6. Dal Lake Luxury Houseboats & Shikaras
  const houseboats: { group: THREE.Group; baseY: number; z: number }[] = [];
  const HB_CONFIGS = [
    { name: 'H.B. Pride of Kashmir', x: 40, z: 365, len: 28, w: 6.2 },
    { name: 'H.B. Sukoon', x: 72, z: 315, len: 26, w: 5.8 },
    { name: 'H.B. Mughal Sheraton', x: 38, z: 235, len: 25, w: 5.6 },
    { name: 'H.B. Queen of Heaven', x: 42, z: 180, len: 29, w: 6.4 },
    { name: 'H.B. Golden Lily', x: 39, z: 60, len: 25, w: 5.6 },
    { name: 'H.B. Fairy Land', x: 41, z: -85, len: 26, w: 5.8 },
    { name: 'H.B. Lake Victoria', x: 40, z: -250, len: 27, w: 6.0 },
    { name: 'H.B. Meena Mahal', x: 42, z: -405, len: 25, w: 5.6 },
  ];

  HB_CONFIGS.forEach(cfg => {
    const g = new THREE.Group();
    const woodMat = mat(0x523623);
    const hull = new THREE.Mesh(new THREE.BoxGeometry(cfg.w, 1.8, cfg.len - 4), woodMat);
    hull.position.y = 0.9;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(cfg.w * 0.86, 3.4, cfg.len - 7), woodMat);
    cabin.position.set(0, 2.9, -1.2);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(cfg.w + 0.8, 0.9, cfg.len - 3.5), mat(0x1e4f35));
    roof.position.set(0, 4.8, -1.2);
    g.add(hull, cabin, roof);

    // Mooring pier
    const pierL = cfg.x - 17.4;
    const pier = new THREE.Mesh(new THREE.BoxGeometry(pierL, 0.3, 1.8), mat(0x23140b));
    pier.position.set(-pierL / 2 - cfg.w / 2, 1.6, cfg.len / 2 - 3.8);
    g.add(pier);

    g.position.set(cfg.x, 0.1, cfg.z);
    scene.add(g);
    houseboats.push({ group: g, baseY: 0.1, z: cfg.z });
  });

  // Shikaras
  const shikaras: { group: THREE.Group; sp: number; dir: number; baseZ: number; isFlower: boolean }[] = [];
  const sColors = [0xe8a33d, 0xb8432f, 0x2e8f8a, 0x9c3d8f, 0xd9722b];
  for (let i = 0; i < 6; i++) {
    const sg = new THREE.Group();
    const sHull = new THREE.Mesh(new THREE.ConeGeometry(1.2, 7, 4).rotateX(-PI / 2), mat(0x543621));
    sHull.scale.set(0.9, 0.38, 1);
    sHull.position.y = 0.25;
    const sRoof = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.2, 3.2), mat(sColors[i % sColors.length]));
    sRoof.position.set(0, 1.2, 0.2);
    sg.add(sHull, sRoof);

    const sx = 65 + (i % 3) * 20;
    const sz = -380 + i * 130;
    sg.position.set(sx, 0.1, sz);
    scene.add(sg);
    shikaras.push({ group: sg, sp: 1.2 + (i % 2) * 0.8, dir: i % 2 ? 1 : -1, baseZ: sz, isFlower: false });
  }

  return {
    scene,
    houseboats,
    shikaras,
    amberLights,
    waterMaterial,
    barrierHitZ: NORTH_CHECKPOINT_Z - 1.6,
    southBarrierHitZ: SOUTH_CHECKPOINT_Z + 1.6,
    nishatFountains,
  };
}
