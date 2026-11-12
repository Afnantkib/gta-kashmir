import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { roomManager } from './server/roomManager.ts';
import { storage } from './server/storage.ts';

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);

app.use(express.json());
app.use('/assets', express.static(path.resolve(process.cwd(), 'public/assets')));

// API: Get Player Profile
app.get('/api/player/:id', (req, res) => {
  const profile = storage.getOrCreateProfile(req.params.id);
  res.json({ success: true, profile });
});

// API: Claim Mission Reward (Authoritative and Idempotent)
app.post('/api/missions/claim', (req, res) => {
  const { playerId, missionId, nonce, rewardCash, rewardXp, raceTime } = req.body;
  if (!playerId || !missionId || !nonce) {
    return res.status(400).json({ success: false, message: 'Missing required parameters.' });
  }

  const result = storage.recordMissionReward(
    playerId,
    missionId,
    nonce,
    parseInt(rewardCash || 0, 10),
    parseInt(rewardXp || 0, 10),
    raceTime ? parseFloat(raceTime) : undefined
  );

  if (!result.success) {
    return res.status(409).json(result);
  }

  res.json(result);
});

// API: Claim Battle Rewards (Authoritative and Idempotent)
app.post('/api/battle/claim', (req, res) => {
  const { playerId, matchId, nonce, kills, damage, placement, rewardCash, rewardXp, isWin } = req.body;
  if (!playerId || !matchId || !nonce) {
    return res.status(400).json({ success: false, message: 'Missing required battle reward parameters.' });
  }

  const result = storage.recordBattleRewards(
    playerId,
    matchId,
    nonce,
    parseInt(kills || 0, 10),
    parseInt(damage || 0, 10),
    parseInt(placement || 1, 10),
    parseInt(rewardCash || 0, 10),
    parseInt(rewardXp || 0, 10),
    !!isWin
  );

  if (!result.success) {
    return res.status(409).json(result);
  }

  res.json(result);
});

// API: Unlock Vehicle
app.post('/api/vehicles/unlock', (req, res) => {
  const { playerId, vehicleId, price } = req.body;
  const result = storage.unlockVehicle(playerId, vehicleId, parseInt(price || 0, 10));
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// Create HTTP and WebSocket server
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

roomManager.bindServer(wss);

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    // Mount Vite middleware in development
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files in production
    app.use(express.static(path.resolve(process.cwd(), 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(process.cwd(), 'dist', 'index.html'));
    });
  }

  server.listen(port, '0.0.0.0', () => {
    console.log(`[GTA Kashmir] Game server running at http://localhost:${port}`);
    console.log(`[GTA Kashmir] WebSocket server mounted at ws://localhost:${port}/ws`);
  });
}

startServer();
