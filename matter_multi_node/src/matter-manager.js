import { ServerNode, Environment } from '@matter/main';
import { OnOffPlugInUnitDevice } from '@matter/main/devices';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';

export class MatterManager {
  constructor(config, haClient) {
    this.config = config;
    this.haClient = haClient;
    this.nodes = new Map(); // entity_id -> { node, endpoint, info, setFromHA }
    this.discoveredEntities = new Map(); // entity_id -> { friendlyName, state, rawState }
    this.enabledEntitiesFile = path.join(this.config.storagePath, 'enabled_entities.json');
    this.enabledConfig = this.loadEnabledConfig(); // entityId -> { port, discriminator, enabled: true }

    // Configure Matter root storage
    if (this.config.storagePath) {
      if (!fs.existsSync(this.config.storagePath)) {
        fs.mkdirSync(this.config.storagePath, { recursive: true });
      }
      Environment.default.vars.set('path.root', this.config.storagePath);
      console.log(`[Matter Manager] Root storage set to: ${this.config.storagePath}`);
    }
  }

  loadEnabledConfig() {
    try {
      if (fs.existsSync(this.enabledEntitiesFile)) {
        const raw = fs.readFileSync(this.enabledEntitiesFile, 'utf8');
        const data = JSON.parse(raw);
        console.log(`[Matter Manager] Loaded ${Object.keys(data).length} saved device configurations.`);
        return data;
      }
    } catch (err) {
      console.warn('[Matter Manager] Could not load enabled_entities.json:', err.message);
    }
    return {};
  }

  saveEnabledConfig() {
    try {
      const dir = path.dirname(this.enabledEntitiesFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.enabledEntitiesFile, JSON.stringify(this.enabledConfig, null, 2), 'utf8');
    } catch (err) {
      console.error('[Matter Manager] Failed to save enabled_entities.json:', err.message);
    }
  }

  allocatePortAndDiscriminator(entityId) {
    // If already assigned in config, preserve it
    if (this.enabledConfig[entityId]?.port) {
      return {
        port: this.enabledConfig[entityId].port,
        discriminator: this.enabledConfig[entityId].discriminator,
      };
    }

    // Find all currently used ports and discriminators
    const usedPorts = new Set(Object.values(this.enabledConfig).map((c) => c.port).filter(Boolean));
    const usedDiscs = new Set(Object.values(this.enabledConfig).map((c) => c.discriminator).filter(Boolean));

    let port = this.config.startPort;
    while (usedPorts.has(port)) {
      port++;
    }

    let discriminator = this.config.discriminatorStart;
    while (usedDiscs.has(discriminator)) {
      discriminator = (discriminator + 1) % 4096;
    }

    return { port, discriminator };
  }

  shouldIncludeEntity(entityId) {
    if (this.config.includeEntities.length > 0) {
      return this.config.includeEntities.includes(entityId);
    }
    if (this.config.excludeEntities.includes(entityId)) {
      return false;
    }
    const domain = entityId.split('.')[0];
    return this.config.filterDomains.includes(domain);
  }

  async syncWithHAStates(statesMap) {
    console.log('[Matter Manager] Synchronizing discovered entities with Home Assistant...');

    for (const [entityId, stateObj] of statesMap.entries()) {
      if (!this.shouldIncludeEntity(entityId)) {
        continue;
      }

      const friendlyName = stateObj.attributes?.friendly_name || entityId;
      const isOn = stateObj.state === 'on';

      this.discoveredEntities.set(entityId, {
        entityId,
        friendlyName,
        isOn,
        rawState: stateObj.state,
      });

      // If already running, update state
      if (this.nodes.has(entityId)) {
        const entry = this.nodes.get(entityId);
        await entry.setFromHA(isOn);
        continue;
      }

      // Check if entity is explicitly enabled
      const isEnabled = this.enabledConfig[entityId]?.enabled === true;
      if (isEnabled) {
        await this.startNodeForEntity(entityId);
      }
    }

    console.log(`[Matter Manager] Discovered ${this.discoveredEntities.size} eligible HA switches (${this.nodes.size} active Matter nodes).`);
  }

  async startNodeForEntity(entityId) {
    if (this.nodes.has(entityId)) {
      return this.nodes.get(entityId).info;
    }

    const discovered = this.discoveredEntities.get(entityId);
    const friendlyName = discovered?.friendlyName || entityId;
    const initialOn = discovered?.isOn || false;

    const { port, discriminator } = this.allocatePortAndDiscriminator(entityId);

    // Save configuration
    this.enabledConfig[entityId] = {
      port,
      discriminator,
      enabled: true,
    };
    this.saveEnabledConfig();

    const sanitizedId = entityId.replace(/[^a-zA-Z0-9_-]/g, '_');
    console.log(`[Matter Manager] Starting standalone Matter node for [${entityId}] on port ${port}, discriminator ${discriminator}...`);

    try {
      const node = await ServerNode.create({
        id: sanitizedId,
        network: {
          port: port,
          ipv4: true,
        },
        commissioning: {
          passcode: this.config.passcode,
          discriminator: discriminator,
        },
        productDescription: {
          name: friendlyName.slice(0, 32),
          deviceType: OnOffPlugInUnitDevice.deviceType,
          vendorId: 0xfff1,
          productId: 0x8000 + (port % 1000),
        },
      });

      const endpoint = await node.add(OnOffPlugInUnitDevice, {
        id: 'switch',
      });

      if (initialOn) {
        await endpoint.set({ onOff: { onOff: true } });
      }

      const pairingCodes = node.state.commissioning.pairingCodes || {};
      const manualPairingCode = pairingCodes.manualPairingCode || 'N/A';
      const qrPairingCode = pairingCodes.qrPairingCode || '';

      let qrCodeDataUrl = '';
      if (qrPairingCode) {
        try {
          qrCodeDataUrl = await QRCode.toDataURL(qrPairingCode, {
            margin: 1,
            width: 240,
            color: {
              dark: '#000000',
              light: '#ffffff',
            },
          });
        } catch (err) {
          console.warn(`[Matter Manager] QR generation failed for ${entityId}:`, err.message);
        }
      }

      const info = {
        entityId,
        friendlyName,
        port,
        discriminator,
        passcode: this.config.passcode,
        manualPairingCode,
        qrPairingCode,
        qrCodeDataUrl,
        csaQrUrl: qrPairingCode ? `https://project-chip.github.io/connectedhomeip/qrcode.html?data=${encodeURIComponent(qrPairingCode)}` : '',
        isOn: initialOn,
        isCommissioned: !!node.lifecycle.isCommissioned,
        isAnnounced: true,
      };

      let updatingFromHA = false;
      endpoint.events.onOff.events.onOff$Changed.on(async (newValue) => {
        if (updatingFromHA) return;
        console.log(`[Matter Node: ${friendlyName}] Received Matter command: ${newValue ? 'ON' : 'OFF'}`);
        info.isOn = newValue;
        if (discovered) discovered.isOn = newValue;
        await this.haClient.setEntityState(entityId, newValue);
      });

      await node.start();

      node.events.commissioning?.fabrics$Changed?.on?.(() => {
        info.isCommissioned = !!node.lifecycle.isCommissioned;
        console.log(`[Matter Node: ${friendlyName}] Fabrics updated. Commissioned: ${info.isCommissioned}`);
      });

      this.nodes.set(entityId, {
        node,
        endpoint,
        info,
        setFromHA: async (newVal) => {
          if (endpoint.state.onOff.onOff !== newVal) {
            updatingFromHA = true;
            try {
              await endpoint.set({ onOff: { onOff: newVal } });
              info.isOn = newVal;
              if (discovered) discovered.isOn = newVal;
            } finally {
              updatingFromHA = false;
            }
          }
        },
      });

      console.log(`[Matter Node: ${friendlyName}] Announcing on UDP ${port}! Pairing code: ${manualPairingCode}`);
      return info;
    } catch (err) {
      console.error(`[Matter Manager] Failed to start Matter node for ${entityId}:`, err);
      throw err;
    }
  }

  async stopNodeForEntity(entityId) {
    if (this.enabledConfig[entityId]) {
      this.enabledConfig[entityId].enabled = false;
      this.saveEnabledConfig();
    }

    const entry = this.nodes.get(entityId);
    if (!entry) return;

    console.log(`[Matter Manager] Stopping Matter node for ${entityId}...`);
    try {
      await entry.node.close();
    } catch (err) {
      console.warn(`[Matter Manager] Error while closing node for ${entityId}:`, err.message);
    }
    this.nodes.delete(entityId);
  }

  async handleHAStateChange(change) {
    const { entity_id, state } = change;
    const discovered = this.discoveredEntities.get(entity_id);
    if (discovered) {
      discovered.isOn = state;
    }

    const entry = this.nodes.get(entity_id);
    if (entry) {
      await entry.setFromHA(state);
    }
  }

  getAllEntitiesInfo() {
    const result = [];

    for (const [entityId, discovered] of this.discoveredEntities.entries()) {
      const activeEntry = this.nodes.get(entityId);

      if (activeEntry) {
        result.push({
          ...activeEntry.info,
          isCommissioned: !!activeEntry.node.lifecycle.isCommissioned,
          isOn: activeEntry.endpoint.state.onOff.onOff,
          isAnnounced: true,
        });
      } else {
        const savedConfig = this.enabledConfig[entityId];
        result.push({
          entityId,
          friendlyName: discovered.friendlyName,
          port: savedConfig?.port || null,
          discriminator: savedConfig?.discriminator || null,
          passcode: this.config.passcode,
          manualPairingCode: null,
          qrPairingCode: null,
          qrCodeDataUrl: null,
          csaQrUrl: null,
          isOn: discovered.isOn,
          isCommissioned: false,
          isAnnounced: false,
        });
      }
    }

    // Sort: Announced first, then alphabetically by friendlyName
    return result.sort((a, b) => {
      if (a.isAnnounced !== b.isAnnounced) {
        return a.isAnnounced ? -1 : 1;
      }
      return a.friendlyName.localeCompare(b.friendlyName);
    });
  }

  async toggleFromWeb(entityId) {
    const discovered = this.discoveredEntities.get(entityId);
    if (!discovered) return false;
    const newState = !discovered.isOn;
    return await this.haClient.setEntityState(entityId, newState);
  }

  async close() {
    console.log('[Matter Manager] Closing all active Matter nodes...');
    for (const [entityId, entry] of this.nodes.entries()) {
      try {
        await entry.node.close();
      } catch (err) {
        console.warn(`[Matter Manager] Error closing node for ${entityId}:`, err.message);
      }
    }
    this.nodes.clear();
  }
}
