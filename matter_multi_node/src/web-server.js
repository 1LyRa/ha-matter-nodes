import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createWebServer(config, matterManager, haClient) {
  const app = express();
  app.use(express.json());

  // Serve static files
  const publicDir = path.join(__dirname, 'public');
  app.use(express.static(publicDir));

  // Status & Nodes endpoint
  app.get('/api/status', (req, res) => {
    res.json({
      haConnected: haClient.isConnected,
      startPort: config.startPort,
      nodesCount: matterManager.nodes.size,
      storagePath: config.storagePath,
    });
  });

  app.get('/api/nodes', (req, res) => {
    res.json(matterManager.getNodesInfo());
  });

  // Toggle switch endpoint
  app.post('/api/nodes/:entityId/toggle', async (req, res) => {
    const { entityId } = req.params;
    const success = await matterManager.toggleFromWeb(entityId);
    if (success) {
      res.json({ ok: true });
    } else {
      res.status(500).json({ error: 'Failed to toggle device in Home Assistant' });
    }
  });

  // Fallback to index.html for SPA/Ingress
  app.use((req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  return app;
}
