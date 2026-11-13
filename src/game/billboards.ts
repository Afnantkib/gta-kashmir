import * as THREE from 'three';
import { Advertisement, adPalette, categoryLabel } from '../shared/advertisements.ts';

/** Promenade hoardings facing the boulevard, clear of the east arena wall. */
export const BILLBOARD_SLOTS: { x: number; z: number }[] = [
  { x: 18.55, z: -250 },
  { x: 18.55, z: -150 },
  { x: 18.55, z: -96 },
  { x: 18.55, z: 78 },
  { x: 18.55, z: 190 },
  { x: 18.55, z: 310 },
];

const ROTATE_MS = 8000;

export interface BoulevardAds {
  show: (ads: Advertisement[]) => void;
  tick: (timeMs: number) => void;
  dispose: () => void;
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines - 1) break;
    } else {
      line = next;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

function paintPoster(ad: Advertisement): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 576;
  const ctx = canvas.getContext('2d')!;
  const { accent, ink } = adPalette(ad.category);

  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 1024, 576);
  ctx.strokeStyle = '#e6b325';
  ctx.lineWidth = 22;
  ctx.strokeRect(14, 14, 996, 548);

  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(48, 48, 280, 52);
  ctx.fillStyle = ink;
  ctx.font = '700 28px Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(categoryLabel(ad.category).toUpperCase(), 68, 74);

  ctx.textAlign = 'center';
  let brandSize = 78;
  ctx.font = `700 ${brandSize}px Georgia, serif`;
  while (brandSize > 42 && ctx.measureText(ad.brand).width > 880) {
    brandSize -= 4;
    ctx.font = `700 ${brandSize}px Georgia, serif`;
  }
  ctx.fillText(ad.brand, 512, 168);

  ctx.font = '600 40px Arial, sans-serif';
  const headline = wrapLines(ctx, ad.headline, 880, 2);
  headline.forEach((line, i) => ctx.fillText(line, 512, 250 + i * 48));

  ctx.globalAlpha = 0.88;
  ctx.font = '500 28px Arial, sans-serif';
  const details = wrapLines(ctx, ad.details || 'Posted on the Boulevard.', 860, 2);
  details.forEach((line, i) => ctx.fillText(line, 512, 370 + i * 36));
  ctx.globalAlpha = 1;

  if (ad.offer) {
    ctx.font = '700 30px Arial, sans-serif';
    const w = Math.min(820, ctx.measureText(ad.offer).width + 64);
    ctx.fillStyle = '#e6b325';
    ctx.fillRect(512 - w / 2, 452, w, 52);
    ctx.fillStyle = '#1a140c';
    ctx.fillText(ad.offer, 512, 478);
  }

  ctx.fillStyle = ink;
  ctx.globalAlpha = 0.7;
  ctx.font = '600 20px Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`POSTED BY ${ad.postedBy.toUpperCase()}`, 960, 530);
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function mountBoulevardAds(scene: THREE.Scene): BoulevardAds {
  const root = new THREE.Group();
  root.name = 'BoulevardAdvertisements';
  scene.add(root);

  const timber = new THREE.MeshLambertMaterial({ color: 0x3a2416 });
  const frameMat = new THREE.MeshLambertMaterial({ color: 0x1a140e });
  const gold = new THREE.MeshLambertMaterial({ color: 0xc8962e });
  const faces: THREE.Mesh[] = [];
  const textures: THREE.CanvasTexture[] = [];

  for (const slot of BILLBOARD_SLOTS) {
    const board = new THREE.Group();
    board.position.set(slot.x, 0, slot.z);
    board.rotation.y = -Math.PI / 2;

    const back = new THREE.Mesh(new THREE.BoxGeometry(11.4, 6.5, 0.28), frameMat);
    back.position.set(0, 5.5, 0);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(11.6, 0.18, 0.42), gold);
    lip.position.set(0, 8.7, 0.08);
    const lip2 = lip.clone();
    lip2.position.y = 2.3;

    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(10.6, 5.9),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    face.position.set(0, 5.5, 0.18);
    faces.push(face);

    [-5.35, 5.35].forEach(x => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.38, 9.2, 0.38), timber);
      post.position.set(x, 4.5, -0.2);
      board.add(post);
    });

    board.add(back, lip, lip2, face);
    root.add(board);
  }

  const kiosk = new THREE.Group();
  kiosk.position.set(15.2, 0, -124);
  kiosk.rotation.y = -Math.PI / 2;
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.1, 0.45), frameMat);
  plinth.position.y = 1.4;
  const cap = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.16, 0.55), gold);
  cap.position.y = 1.95;
  const plaqueCanvas = document.createElement('canvas');
  plaqueCanvas.width = 512;
  plaqueCanvas.height = 160;
  const pctx = plaqueCanvas.getContext('2d')!;
  pctx.fillStyle = '#14110e';
  pctx.fillRect(0, 0, 512, 160);
  pctx.fillStyle = '#e6b325';
  pctx.font = '700 42px Georgia, serif';
  pctx.textAlign = 'center';
  pctx.textBaseline = 'middle';
  pctx.fillText('ADVERTISEMENTS', 256, 58);
  pctx.font = '600 24px Arial, sans-serif';
  pctx.fillStyle = '#f6ead0';
  pctx.fillText('PRESS  B  TO LIST', 256, 112);
  const plaqueTex = new THREE.CanvasTexture(plaqueCanvas);
  plaqueTex.colorSpace = THREE.SRGBColorSpace;
  const plaque = new THREE.Mesh(
    new THREE.PlaneGeometry(3.0, 0.9),
    new THREE.MeshBasicMaterial({ map: plaqueTex })
  );
  plaque.position.set(0, 1.42, 0.24);
  kiosk.add(plinth, cap, plaque);
  root.add(kiosk);

  let catalog: Advertisement[] = [];
  let page = 0;
  let nextRotate = 0;

  const paint = () => {
    textures.forEach(tex => tex.dispose());
    textures.length = 0;
    const count = catalog.length;
    faces.forEach((face, i) => {
      const mat = face.material as THREE.MeshBasicMaterial;
      if (!count) {
        mat.map = null;
        mat.color.setHex(0x1b365d);
        mat.needsUpdate = true;
        return;
      }
      const ad = catalog[(page + i) % count];
      const tex = paintPoster(ad);
      textures.push(tex);
      mat.map = tex;
      mat.color.setHex(0xffffff);
      mat.needsUpdate = true;
    });
  };

  return {
    show(ads) {
      catalog = ads.length ? ads : [];
      page = 0;
      nextRotate = performance.now() + ROTATE_MS;
      paint();
    },
    tick(timeMs) {
      if (catalog.length <= faces.length) return;
      if (timeMs < nextRotate) return;
      page = (page + faces.length) % catalog.length;
      nextRotate = timeMs + ROTATE_MS;
      paint();
    },
    dispose() {
      textures.forEach(tex => tex.dispose());
      plaqueTex.dispose();
      scene.remove(root);
    },
  };
}
