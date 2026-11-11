import fs from 'fs';
import path from 'path';

export function loadConfig() {
  const optionsPath = process.env.OPTIONS_PATH || '/data/options.json';
  let fileOptions = {};

  if (fs.existsSync(optionsPath)) {
    try {
      const raw = fs.readFileSync(optionsPath, 'utf8');
      fileOptions = JSON.parse(raw);
      console.log(`[Config] Loaded options from ${optionsPath}`);
    } catch (err) {
      console.warn(`[Config] Failed to parse ${optionsPath}:`, err.message);
    }
  } else {
    const localConfigPath = path.resolve('./config.json');
    if (fs.existsSync(localConfigPath)) {
      try {
        fileOptions = JSON.parse(fs.readFileSync(localConfigPath, 'utf8'));
        console.log(`[Config] Loaded local fallback config from ${localConfigPath}`);
      } catch (err) {
        console.warn(`[Config] Failed to parse ${localConfigPath}:`, err.message);
      }
    }
  }

  // Determine HA URL and Token
  const supervisorToken = process.env.SUPERVISOR_TOKEN;
  let haWsUrl = fileOptions.ha_url || process.env.HA_URL;
  let haToken = fileOptions.ha_token || process.env.HA_TOKEN;

  if (supervisorToken && !haWsUrl) {
    haWsUrl = 'ws://supervisor/core/websocket';
    haToken = supervisorToken;
    console.log('[Config] Operating inside Home Assistant Supervisor environment.');
  } else if (haWsUrl) {
    haWsUrl = haWsUrl.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://');
    if (!haWsUrl.endsWith('/api/websocket')) {
      haWsUrl = haWsUrl.replace(/\/+$/, '') + '/api/websocket';
    }
  } else {
    haWsUrl = 'ws://supervisor/core/websocket';
    haToken = supervisorToken || '';
  }

  const startPort = parseInt(fileOptions.start_port ?? process.env.START_PORT ?? '5541', 10);
  const discriminatorStart = parseInt(fileOptions.discriminator_start ?? process.env.DISCRIMINATOR_START ?? '3841', 10);
  const passcode = parseInt(fileOptions.passcode ?? process.env.PASSCODE ?? '20202021', 10);
  const webPort = parseInt(fileOptions.web_port ?? process.env.PORT ?? '8099', 10);

  const filterDomains = Array.isArray(fileOptions.filter_domains)
    ? fileOptions.filter_domains
    : ['switch', 'input_boolean', 'sensor'];

  const includeEntities = Array.isArray(fileOptions.include_entities)
    ? fileOptions.include_entities
    : [];

  const excludeEntities = Array.isArray(fileOptions.exclude_entities)
    ? fileOptions.exclude_entities
    : [];

  const storagePath = process.env.STORAGE_PATH || (fs.existsSync('/data') ? '/data/matter' : path.resolve('./data/matter'));

  return {
    haWsUrl,
    haToken,
    startPort,
    discriminatorStart,
    passcode,
    webPort,
    filterDomains,
    includeEntities,
    excludeEntities,
    storagePath,
  };
}
