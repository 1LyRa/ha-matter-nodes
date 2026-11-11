import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getRecentLogs, clearLogs } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createWebServer(config, matterManager, haClient) {
  const app = express();
  app.use(express.json());

  const publicDir = path.join(__dirname, 'public');
  app.use(express.static(publicDir));

  app.get('/api/status', (req, res) => {
    res.json({
      haConnected: haClient.isConnected,
      haVersion: haClient.haVersion || null,
      startPort: config.startPort,
      activeCount: matterManager.nodes.size,
      totalDiscovered: matterManager.discoveredDevices.size,
      storagePath: config.storagePath,
    });
  });

  app.get('/api/nodes', (req, res) => {
    res.json(matterManager.getAllEntitiesInfo());
  });

  app.get('/api/settings', (req, res) => {
    res.json({
      showAllSensors: matterManager.showAllSensors,
    });
  });

  app.post('/api/settings', (req, res) => {
    const { showAllSensors } = req.body;
    if (typeof showAllSensors === 'boolean') {
      matterManager.setShowAllSensors(showAllSensors);
    }
    res.json({ ok: true, showAllSensors: matterManager.showAllSensors });
  });

  app.get('/api/logs', (req, res) => {
    res.json({ logs: getRecentLogs() });
  });

  app.post('/api/logs/clear', (req, res) => {
    clearLogs();
    res.json({ ok: true });
  });

  app.post('/api/nodes/:deviceId/enable', async (req, res) => {
    const { deviceId } = req.params;
    try {
      const info = await matterManager.startNodeForDevice(deviceId);
      res.json({ ok: true, info });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/nodes/:deviceId/disable', async (req, res) => {
    const { deviceId } = req.params;
    try {
      await matterManager.stopNodeForDevice(deviceId);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/nodes/:deviceId/reset', async (req, res) => {
    const { deviceId } = req.params;
    try {
      const info = await matterManager.resetNodeForDevice(deviceId);
      res.json({ ok: true, info });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/nodes/:deviceId/toggle', async (req, res) => {
    const { deviceId } = req.params;
    const entityId = req.body?.entityId || req.query?.entityId;
    const success = await matterManager.toggleFromWeb(deviceId, entityId);
    if (success) {
      res.json({ ok: true });
    } else {
      res.status(500).json({ error: 'Failed to toggle device in Home Assistant' });
    }
  });

  app.use((req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  return app;
}
