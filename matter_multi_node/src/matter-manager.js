import { ServerNode, Environment } from '@matter/main';
import { OnOffPlugInUnitDevice } from '@matter/main/devices';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';

export class MatterManager {
  constructor(config, haClient) {
    this.config = config;
    this.haClient = haClient;
    this.nodes = new Map(); // entity_id -> { node, endpoint, info }
    this.isInitialized = false;

    // Configure storage path
    if (this.config.storagePath) {
      if (!fs.existsSync(this.config.storagePath)) {
        fs.mkdirSync(this.config.storagePath, { recursive: true });
      }
      Environment.default.vars.set('path.root', this.config.storagePath);
      console.log(`[Matter Manager] Root storage set to: ${this.config.storagePath}`);
    }
  }

  shouldIncludeEntity(entityId) {
    // If explicit include list is provided
    if (this.config.includeEntities.length > 0) {
      return this.config.includeEntities.includes(entityId);
    }

    // If explicit exclude list
    if (this.config.excludeEntities.includes(entityId)) {
      return false;
    }

    // Domain filter (e.g. switch, input_boolean)
    const domain = entityId.split('.')[0];
    return this.config.filterDomains.includes(domain);
  }

  async syncWithHAStates(statesMap) {
    console.log('[Matter Manager] Synchronizing entities with Home Assistant states...');
    let index = 0;

    for (const [entityId, stateObj] of statesMap.entries()) {
      if (!this.shouldIncludeEntity(entityId)) {
        continue;
      }

      if (this.nodes.has(entityId)) {
        // Node already exists, update state
        const entry = this.nodes.get(entityId);
        const isOn = stateObj.state === 'on';
        if (entry.endpoint.state.onOff.onOff !== isOn) {
          await entry.endpoint.set({ onOff: { onOff: isOn } });
          entry.info.isOn = isOn;
        }
        continue;
      }

      const port = this.config.startPort + index;
      const discriminator = (this.config.discriminatorStart + index) % 4096;
      const friendlyName = stateObj.attributes?.friendly_name || entityId;

      await this.createNodeForEntity(entityId, friendlyName, port, discriminator, stateObj.state === 'on');
      index++;
    }

    this.isInitialized = true;
    console.log(`[Matter Manager] Successfully initialized ${this.nodes.size} standalone Matter nodes.`);
  }

  async createNodeForEntity(entityId, friendlyName, port, discriminator, initialOn) {
    const sanitizedId = entityId.replace(/[^a-zA-Z0-9_-]/g, '_');
    console.log(`[Matter Manager] Creating Matter Node for [${entityId}] ("${friendlyName}") on UDP port ${port}, discriminator ${discriminator}...`);

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

      // Set initial state
      if (initialOn) {
        await endpoint.set({ onOff: { onOff: true } });
      }

      // Codes for pairing
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
          console.warn(`[Matter Manager] Failed to generate QR code data URL for ${entityId}:`, err.message);
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
      };

      // Handle command from Google Home (or other Matter controller)
      let updatingFromHA = false;
      endpoint.events.onOff.events.onOff$Changed.on(async (newValue) => {
        if (updatingFromHA) return;
        console.log(`[Matter Node: ${friendlyName}] Received Matter command: ${newValue ? 'ON' : 'OFF'}`);
        info.isOn = newValue;
        await this.haClient.setEntityState(entityId, newValue);
      });

      // Start the Matter node server
      await node.start();

      // Update commissioned state on changes
      node.events.commissioning?.fabrics$Changed?.on?.(() => {
        info.isCommissioned = !!node.lifecycle.isCommissioned;
        console.log(`[Matter Node: ${friendlyName}] Commissioning fabrics updated. Commissioned: ${info.isCommissioned}`);
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
            } finally {
              updatingFromHA = false;
            }
          }
        },
      });

      console.log(`[Matter Node: ${friendlyName}] Running! Pairing Code: ${manualPairingCode}`);
    } catch (err) {
      console.error(`[Matter Manager] Failed to create node for ${entityId}:`, err);
    }
  }

  async handleHAStateChange(change) {
    const entry = this.nodes.get(change.entity_id);
    if (entry) {
      await entry.setFromHA(change.state);
    }
  }

  getNodesInfo() {
    return Array.from(this.nodes.values()).map((entry) => ({
      ...entry.info,
      isCommissioned: !!entry.node.lifecycle.isCommissioned,
      isOn: entry.endpoint.state.onOff.onOff,
    }));
  }

  async toggleFromWeb(entityId) {
    const entry = this.nodes.get(entityId);
    if (!entry) return false;
    const currentState = entry.endpoint.state.onOff.onOff;
    const newState = !currentState;
    return await this.haClient.setEntityState(entityId, newState);
  }

  async close() {
    console.log('[Matter Manager] Closing all Matter nodes...');
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
