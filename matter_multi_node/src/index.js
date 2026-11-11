import { loadConfig } from './config.js';
import { HAClient } from './ha-client.js';
import { MatterManager } from './matter-manager.js';
import { createWebServer } from './web-server.js';

async function main() {
  console.log('====================================================');
  console.log('       Matter Multi-Node Home Assistant Service     ');
  console.log('  Exposing entities as individual Matter nodes      ');
  console.log('====================================================');

  const config = loadConfig();
  console.log(`[Startup] Configuration:
  - Starting Port: ${config.startPort}
  - Web UI Port: ${config.webPort}
  - HA URL: ${config.haWsUrl}
  - Filter Domains: ${config.filterDomains.join(', ')}
  - Storage Path: ${config.storagePath}
  `);

  const haClient = new HAClient(config.haWsUrl, config.haToken);
  const matterManager = new MatterManager(config, haClient);
  const webServer = createWebServer(config, matterManager, haClient);

  // Wire events between HA and Matter
  haClient.on('states_loaded', async (states) => {
    try {
      await matterManager.syncWithHAStates(states);
    } catch (err) {
      console.error('[Main] Error syncing entities with Matter:', err);
    }
  });

  haClient.on('state_changed', async (change) => {
    try {
      await matterManager.handleHAStateChange(change);
    } catch (err) {
      console.error('[Main] Error handling HA state change:', err);
    }
  });

  // Start Web Server
  webServer.listen(config.webPort, '0.0.0.0', () => {
    console.log(`[Web Server] Dashboard listening on http://0.0.0.0:${config.webPort}`);
  });

  // Start Home Assistant Client
  haClient.start();

  // Handle graceful shutdown
  const shutdown = async () => {
    console.log('\n[Main] Shutting down gracefully...');
    haClient.stop();
    await matterManager.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[Main] Fatal error:', err);
  process.exit(1);
});
