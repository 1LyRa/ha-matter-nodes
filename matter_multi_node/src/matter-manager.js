import { ServerNode, Environment } from '@matter/main';
import {
  OnOffPlugInUnitDevice,
  TemperatureSensorDevice,
  HumiditySensorDevice,
  OnOffLightDevice,
  DimmableLightDevice,
  ColorTemperatureLightDevice,
  ExtendedColorLightDevice,
  ThermostatDevice,
} from '@matter/main/devices';
import { PowerSourceServer } from '@matter/main/behaviors/power-source';
import { ThermostatServer } from '@matter/main/behaviors/thermostat';
import { ThermostatUserInterfaceConfigurationServer } from '@matter/main/behaviors/thermostat-user-interface-configuration';
import { Thermostat } from '@matter/main/clusters';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';

function convertTemperatureToMatter(value, unit) {
  if (value === null || value === undefined || isNaN(value)) return null;
  let celsius = Number(value);
  if (unit === '°F' || unit === 'F') {
    celsius = (celsius - 32) * (5 / 9);
  }
  return Math.round(celsius * 100);
}

function convertMatterToTemperature(value, unit) {
  if (value === null || value === undefined || isNaN(value)) return null;
  let celsius = value / 100;
  if (unit === '°F' || unit === 'F') {
    return Math.round(((celsius * 9) / 5 + 32) * 10) / 10;
  }
  return Math.round(celsius * 10) / 10;
}

function haModeToMatterSystemMode(mode) {
  switch (mode) {
    case 'off': return Thermostat.SystemMode.Off;
    case 'cool': return Thermostat.SystemMode.Cool;
    case 'heat': return Thermostat.SystemMode.Heat;
    case 'emergency_heat': return Thermostat.SystemMode.EmergencyHeat;
    case 'auto':
    case 'heat_cool': return Thermostat.SystemMode.Auto;
    case 'fan_only': return Thermostat.SystemMode.FanOnly;
    case 'dry': return Thermostat.SystemMode.Dry;
    case 'sleep': return Thermostat.SystemMode.Sleep;
    default: return Thermostat.SystemMode.Off;
  }
}

function matterSystemModeToHa(mode, supported = []) {
  switch (mode) {
    case Thermostat.SystemMode.Off: return 'off';
    case Thermostat.SystemMode.Cool: return 'cool';
    case Thermostat.SystemMode.Heat: return 'heat';
    case Thermostat.SystemMode.EmergencyHeat: return supported.includes('emergency_heat') ? 'emergency_heat' : 'heat';
    case Thermostat.SystemMode.Auto: return supported.includes('auto') ? 'auto' : (supported.includes('heat_cool') ? 'heat_cool' : 'cool');
    case Thermostat.SystemMode.FanOnly: return supported.includes('fan_only') ? 'fan_only' : 'off';
    case Thermostat.SystemMode.Dry: return supported.includes('dry') ? 'dry' : 'off';
    case Thermostat.SystemMode.Sleep: return supported.includes('sleep') ? 'sleep' : 'off';
    default: return 'off';
  }
}

function convertHumidityToMatter(value) {
  if (value === null || value === undefined || isNaN(value)) return null;
  return Math.round(Number(value) * 100);
}

function convertBatteryToMatter(value) {
  if (value === null || value === undefined || isNaN(value)) return null;
  return Math.min(200, Math.max(0, Math.round(Number(value) * 2)));
}

export class MatterManager {
  constructor(config, haClient) {
    this.config = config;
    this.haClient = haClient;
    this.nodes = new Map(); // deviceId -> { node, endpoints, info, updateFromHA }
    this.discoveredDevices = new Map(); // deviceId -> device object
    this.entityToDeviceId = new Map(); // entityId -> deviceId
    this.enabledEntitiesFile = path.join(this.config.storagePath, 'enabled_entities.json');
    this.enabledConfig = this.loadEnabledConfig();

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

  allocatePortAndDiscriminator(deviceId) {
    if (this.enabledConfig[deviceId]?.port) {
      return {
        port: this.enabledConfig[deviceId].port,
        discriminator: this.enabledConfig[deviceId].discriminator,
      };
    }

    const usedPorts = new Set(Object.values(this.enabledConfig).map((c) => c.port).filter(Boolean));
    const usedDiscs = new Set(Object.values(this.enabledConfig).map((c) => c.discriminator).filter(Boolean));

    let port = this.config.startPort || 5541;
    while (usedPorts.has(port)) {
      port++;
    }

    let discriminator = this.config.discriminatorStart || 3841;
    while (usedDiscs.has(discriminator)) {
      discriminator = (discriminator + 1) % 4096;
    }

    return { port, discriminator };
  }

  shouldIncludeEntity(entityId) {
    if (this.config.includeEntities && this.config.includeEntities.length > 0) {
      return this.config.includeEntities.includes(entityId);
    }
    if (this.config.excludeEntities && this.config.excludeEntities.includes(entityId)) {
      return false;
    }
    const domain = entityId.split('.')[0];
    return Array.isArray(this.config.filterDomains) ? this.config.filterDomains.includes(domain) : true;
  }

  async syncWithHAStates(statesMap) {
    console.log('[Matter Manager] Synchronizing entities and sensors with Home Assistant...');

    this.entityToDeviceId.clear();
    this.discoveredDevices.clear();

    const rawSensors = [];

    for (const [entityId, stateObj] of statesMap.entries()) {
      if (!this.shouldIncludeEntity(entityId)) {
        continue;
      }

      const domain = entityId.split('.')[0];

      // 1. Process Switches & Input Booleans
      if (domain === 'switch' || domain === 'input_boolean') {
        const friendlyName = stateObj.attributes?.friendly_name || entityId;
        const isOn = stateObj.state === 'on';

        this.discoveredDevices.set(entityId, {
          id: entityId,
          domain,
          deviceKind: 'switch',
          friendlyName,
          isOn,
          entityId,
        });
        this.entityToDeviceId.set(entityId, entityId);
      }

      // 2. Process Lights
      if (domain === 'light') {
        const friendlyName = stateObj.attributes?.friendly_name || entityId;
        const isOn = stateObj.state === 'on';
        const colorModes = stateObj.attributes?.supported_color_modes || [];
        const brightness = stateObj.attributes?.brightness !== undefined ? stateObj.attributes.brightness : null;

        let colorTemp = null;
        if (stateObj.attributes?.color_temp_kelvin) {
          colorTemp = Math.round(1000000 / stateObj.attributes.color_temp_kelvin);
        } else if (stateObj.attributes?.color_temp) {
          colorTemp = stateObj.attributes.color_temp;
        }

        const xyColor = stateObj.attributes?.xy_color || null;

        let minMireds = 153;
        let maxMireds = 500;
        if (stateObj.attributes?.max_color_temp_kelvin) {
          minMireds = Math.max(1, Math.round(1000000 / stateObj.attributes.max_color_temp_kelvin));
        } else if (stateObj.attributes?.min_mireds) {
          minMireds = stateObj.attributes.min_mireds;
        }

        if (stateObj.attributes?.min_color_temp_kelvin) {
          maxMireds = Math.max(minMireds, Math.round(1000000 / stateObj.attributes.min_color_temp_kelvin));
        } else if (stateObj.attributes?.max_mireds) {
          maxMireds = stateObj.attributes.max_mireds;
        }

        let lightType = 'onoff';
        const hasColor = colorModes.some((m) => ['hs', 'rgb', 'rgbw', 'rgbww', 'xy'].includes(m));
        const hasColorTemp = colorModes.includes('color_temp') || stateObj.attributes?.color_temp_kelvin !== undefined;
        const hasBrightness = colorModes.includes('brightness') || brightness !== null;

        if (hasColor) {
          lightType = 'extended_color';
        } else if (hasColorTemp) {
          lightType = 'color_temp';
        } else if (hasBrightness) {
          lightType = 'dimmable';
        }

        this.discoveredDevices.set(entityId, {
          id: entityId,
          domain,
          deviceKind: 'light',
          lightType,
          friendlyName,
          isOn,
          brightness,
          colorTemp,
          xyColor,
          minMireds,
          maxMireds,
          entityId,
        });
        this.entityToDeviceId.set(entityId, entityId);
      }

      // 3. Process Climate (Thermostats & ACs)
      if (domain === 'climate') {
        const friendlyName = stateObj.attributes?.friendly_name || entityId;
        const supportedModes = stateObj.attributes?.hvac_modes || ['off', 'heat', 'cool'];
        const hasCool = supportedModes.includes('cool');
        const hasHeat = supportedModes.includes('heat');
        const hasAuto = supportedModes.includes('auto') || supportedModes.includes('heat_cool');

        const currentTemp = stateObj.attributes?.current_temperature ?? null;
        const targetTemp = stateObj.attributes?.temperature ?? null;
        const targetTempLow = stateObj.attributes?.target_temp_low ?? null;
        const targetTempHigh = stateObj.attributes?.target_temp_high ?? null;
        const minTemp = stateObj.attributes?.min_temp ?? (stateObj.attributes?.unit_of_measurement === '°F' ? 45 : 7);
        const maxTemp = stateObj.attributes?.max_temp ?? (stateObj.attributes?.unit_of_measurement === '°F' ? 95 : 35);
        const tempUnit = stateObj.attributes?.unit_of_measurement || '°C';
        const hvacMode = stateObj.state;
        const hvacAction = stateObj.attributes?.hvac_action || null;
        const isOn = hvacMode !== 'off';

        this.discoveredDevices.set(entityId, {
          id: entityId,
          domain,
          deviceKind: 'climate',
          friendlyName,
          isOn,
          hvacMode,
          hvacAction,
          supportedModes,
          hasCool: hasCool || (!hasHeat && !hasCool),
          hasHeat,
          hasAuto,
          currentTemp,
          targetTemp,
          targetTempLow,
          targetTempHigh,
          minTemp,
          maxTemp,
          tempUnit,
          entityId,
        });
        this.entityToDeviceId.set(entityId, entityId);
      }

      // 4. Collect Candidate Sensors (Temperature, Humidity, Battery)
      if (domain === 'sensor') {
        const deviceClass = stateObj.attributes?.device_class;
        const unit = stateObj.attributes?.unit_of_measurement;
        const isTemp = deviceClass === 'temperature' || /_(temperature|temp)$/i.test(entityId);
        const isHumid = deviceClass === 'humidity' || /_(humidity|humid)$/i.test(entityId);
        const isBat = deviceClass === 'battery' || /_(battery|bat)$/i.test(entityId);

        if (isTemp || isHumid || isBat) {
          rawSensors.push({
            entityId,
            stateObj,
            role: isTemp ? 'temperature' : isHumid ? 'humidity' : 'battery',
            unit,
          });
        }
      }
    }

    // Group sensors that belong together (e.g. sensor.living_room_*_temperature, *_humidity, *_battery)
    const groupedSensors = new Map(); // baseId -> { baseId, friendlyName, temp, humid, bat }

    for (const s of rawSensors) {
      // Calculate base ID by stripping the role suffix
      const baseId = s.entityId.replace(/_(temperature|temp|humidity|humid|battery|bat)$/i, '');
      const rawFriendly = s.stateObj.attributes?.friendly_name || s.entityId;
      const baseFriendly = rawFriendly.replace(/\s+(Temperature|Humidity|Battery|temp|humid|bat)$/i, '').trim();

      if (!groupedSensors.has(baseId)) {
        groupedSensors.set(baseId, {
          baseId,
          friendlyName: baseFriendly || baseId,
          temp: null,
          humid: null,
          bat: null,
        });
      }

      const group = groupedSensors.get(baseId);
      if (s.role === 'temperature') {
        group.temp = s;
      } else if (s.role === 'humidity') {
        group.humid = s;
      } else if (s.role === 'battery') {
        group.bat = s;
      }
    }

    // Add grouped sensors to discovered devices
    for (const [baseId, group] of groupedSensors.entries()) {
      // Must have at least a temperature or humidity sensor
      if (!group.temp && !group.humid) continue;

      const deviceObj = {
        id: baseId,
        domain: 'sensor',
        deviceKind: 'sensor',
        friendlyName: group.friendlyName,
        tempEntity: group.temp?.entityId || null,
        humidEntity: group.humid?.entityId || null,
        batEntity: group.bat?.entityId || null,
        temperature: group.temp ? parseFloat(group.temp.stateObj.state) : null,
        humidity: group.humid ? parseFloat(group.humid.stateObj.state) : null,
        battery: group.bat ? parseFloat(group.bat.stateObj.state) : null,
        tempUnit: group.temp?.unit || '°C',
      };

      this.discoveredDevices.set(baseId, deviceObj);

      if (group.temp) this.entityToDeviceId.set(group.temp.entityId, baseId);
      if (group.humid) this.entityToDeviceId.set(group.humid.entityId, baseId);
      if (group.bat) this.entityToDeviceId.set(group.bat.entityId, baseId);
    }

    // Re-sync any already running nodes
    for (const [deviceId, dev] of this.discoveredDevices.entries()) {
      if (this.nodes.has(deviceId)) {
        const entry = this.nodes.get(deviceId);
        await entry.updateFromHA(dev);
        continue;
      }

      if (this.enabledConfig[deviceId]?.enabled === true) {
        await this.startNodeForDevice(deviceId);
      }
    }

    console.log(`[Matter Manager] Discovered ${this.discoveredDevices.size} devices (${this.nodes.size} actively announced).`);
  }

  async startNodeForDevice(deviceId) {
    if (this.nodes.has(deviceId)) {
      return this.nodes.get(deviceId).info;
    }

    const dev = this.discoveredDevices.get(deviceId);
    if (!dev) {
      throw new Error(`Device ${deviceId} not found`);
    }

    const { port, discriminator } = this.allocatePortAndDiscriminator(deviceId);

    this.enabledConfig[deviceId] = {
      port,
      discriminator,
      enabled: true,
    };
    this.saveEnabledConfig();

    const sanitizedId = deviceId.replace(/[^a-zA-Z0-9_-]/g, '_');
    console.log(`[Matter Manager] Starting Matter node for [${dev.friendlyName}] (${dev.deviceKind}) on port ${port}, discriminator ${discriminator}...`);

    try {
      let primaryDeviceType;
      let lightDeviceClass = null;

      if (dev.deviceKind === 'switch') {
        primaryDeviceType = OnOffPlugInUnitDevice.deviceType;
      } else if (dev.deviceKind === 'light') {
        if (dev.lightType === 'extended_color') {
          lightDeviceClass = ExtendedColorLightDevice;
        } else if (dev.lightType === 'color_temp') {
          lightDeviceClass = ColorTemperatureLightDevice;
        } else if (dev.lightType === 'dimmable') {
          lightDeviceClass = DimmableLightDevice;
        } else {
          lightDeviceClass = OnOffLightDevice;
        }
        primaryDeviceType = lightDeviceClass.deviceType;
      } else if (dev.deviceKind === 'climate') {
        primaryDeviceType = ThermostatDevice.deviceType;
      } else {
        primaryDeviceType = TemperatureSensorDevice.deviceType;
      }

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
          name: dev.friendlyName.slice(0, 32),
          deviceType: primaryDeviceType,
          vendorId: 0xfff1,
          productId: 0x8000 + (port % 1000),
        },
        basicInformation: {
          vendorName: 'Home Assistant',
          vendorId: 0xfff1,
          productId: 0x8000 + (port % 1000),
          nodeLabel: dev.friendlyName.slice(0, 32),
          productName: dev.friendlyName.slice(0, 32),
          productLabel: dev.friendlyName.slice(0, 64),
          serialNumber: (dev.entityId || sanitizedId).slice(0, 32),
          hardwareVersion: 1,
          hardwareVersionString: '1.0',
          softwareVersion: 1,
          softwareVersionString: '1.4.0',
        },
      });

      const endpoints = {};
      let updateFromHA = async () => {};

      // Build endpoints depending on deviceKind
      if (dev.deviceKind === 'switch') {
        const endpoint = await node.add(OnOffPlugInUnitDevice, { id: 'switch' });
        endpoints.switch = endpoint;

        if (dev.isOn) {
          await endpoint.set({ onOff: { onOff: true } });
        }

        let updatingFromHA = false;
        endpoint.events.onOff.events.onOff$Changed.on(async (newValue) => {
          if (updatingFromHA) return;
          console.log(`[Matter Node: ${dev.friendlyName}] Received command: ${newValue ? 'ON' : 'OFF'}`);
          dev.isOn = newValue;
          info.isOn = newValue;
          await this.haClient.setEntityState(dev.entityId, newValue);
        });

        updateFromHA = async (newDev) => {
          if (endpoint.state.onOff.onOff !== newDev.isOn) {
            updatingFromHA = true;
            try {
              await endpoint.set({ onOff: { onOff: newDev.isOn } });
              info.isOn = newDev.isOn;
            } finally {
              updatingFromHA = false;
            }
          }
        };
      } else if (dev.deviceKind === 'sensor') {
        // Temperature Endpoint (with Battery PowerSource if battery entity exists)
        if (dev.tempEntity) {
          const hasBattery = !!dev.batEntity;
          const TempClass = hasBattery
            ? TemperatureSensorDevice.with(PowerSourceServer.with('Battery'))
            : TemperatureSensorDevice;

          const tempEndpoint = await node.add(TempClass, { id: 'temperature' });
          endpoints.temp = tempEndpoint;

          const initialTemp = convertTemperatureToMatter(dev.temperature, dev.tempUnit);
          await tempEndpoint.set({
            temperatureMeasurement: {
              measuredValue: initialTemp,
              minMeasuredValue: -4000,
              maxMeasuredValue: 10000,
            },
          });

          if (hasBattery) {
            const initialBat = convertBatteryToMatter(dev.battery);
            await tempEndpoint.set({
              powerSource: {
                batPercentRemaining: initialBat,
                status: 0,
                order: 0,
                description: 'Battery',
              },
            });
          }
        }

        // Humidity Endpoint
        if (dev.humidEntity) {
          const humidEndpoint = await node.add(HumiditySensorDevice, { id: 'humidity' });
          endpoints.humid = humidEndpoint;

          const initialHumid = convertHumidityToMatter(dev.humidity);
          await humidEndpoint.set({
            relativeHumidityMeasurement: {
              measuredValue: initialHumid,
              minMeasuredValue: 0,
              maxMeasuredValue: 10000,
            },
          });
        }

        updateFromHA = async (newDev) => {
          if (endpoints.temp && newDev.temperature !== undefined) {
            const mTemp = convertTemperatureToMatter(newDev.temperature, newDev.tempUnit);
            await endpoints.temp.set({
              temperatureMeasurement: { measuredValue: mTemp },
            });
            info.temperature = newDev.temperature;
          }

          if (endpoints.temp && endpoints.temp.state.powerSource && newDev.battery !== undefined) {
            const mBat = convertBatteryToMatter(newDev.battery);
            await endpoints.temp.set({
              powerSource: { batPercentRemaining: mBat },
            });
            info.battery = newDev.battery;
          }

          if (endpoints.humid && newDev.humidity !== undefined) {
            const mHumid = convertHumidityToMatter(newDev.humidity);
            await endpoints.humid.set({
              relativeHumidityMeasurement: { measuredValue: mHumid },
            });
            info.humidity = newDev.humidity;
          }
        };
      } else if (dev.deviceKind === 'light') {
        const initialLevel = dev.brightness ? Math.max(1, Math.min(254, Math.round((dev.brightness / 255) * 254))) : 254;
        const minM = dev.minMireds || 153;
        const maxM = dev.maxMireds || 500;
        const initialMireds = dev.colorTemp ? Math.max(minM, Math.min(maxM, dev.colorTemp)) : 250;

        const endpointConfig = {
          id: 'light',
          onOff: { onOff: dev.isOn },
        };

        if (dev.lightType === 'dimmable' || dev.lightType === 'color_temp' || dev.lightType === 'extended_color') {
          endpointConfig.levelControl = { currentLevel: initialLevel };
        }

        if (dev.lightType === 'color_temp' || dev.lightType === 'extended_color') {
          endpointConfig.colorControl = {
            colorMode: 2,
            colorTempPhysicalMinMireds: minM,
            colorTempPhysicalMaxMireds: maxM,
            colorTemperatureMireds: initialMireds,
            coupleColorTempToLevelMinMireds: minM,
          };
          if (dev.lightType === 'extended_color' && dev.xyColor) {
            endpointConfig.colorControl.currentX = Math.round(dev.xyColor[0] * 65536);
            endpointConfig.colorControl.currentY = Math.round(dev.xyColor[1] * 65536);
            endpointConfig.colorControl.colorMode = 1;
          }
        }

        const endpoint = await node.add(lightDeviceClass, endpointConfig);
        endpoints.light = endpoint;

        let updatingFromHA = false;
        let debounceTimer = null;
        const pendingPayload = {};

        const sendLightUpdateToHA = (turnOn, data = {}) => {
          Object.assign(pendingPayload, data);
          if (!turnOn) {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = null;
            dev.isOn = false;
            info.isOn = false;
            this.haClient.setEntityState(dev.entityId, false);
            return;
          }

          dev.isOn = true;
          info.isOn = true;
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(async () => {
            debounceTimer = null;
            const toSend = { ...pendingPayload };
            for (const k of Object.keys(pendingPayload)) delete pendingPayload[k];
            console.log(`[Matter Node: ${dev.friendlyName}] Syncing light to HA:`, toSend);
            await this.haClient.setEntityState(dev.entityId, true, toSend);
          }, 80);
        };

        endpoint.events.onOff.events.onOff$Changed.on(async (newValue) => {
          if (updatingFromHA) return;
          console.log(`[Matter Node: ${dev.friendlyName}] Light onOff command: ${newValue ? 'ON' : 'OFF'}`);
          sendLightUpdateToHA(newValue);
        });

        if (endpoint.events.levelControl?.events?.currentLevel$Changed) {
          endpoint.events.levelControl.events.currentLevel$Changed.on(async (newLevel) => {
            if (updatingFromHA || newLevel === null || newLevel === undefined) return;
            const haBrightness = Math.max(1, Math.min(255, Math.round((newLevel / 254) * 255)));
            console.log(`[Matter Node: ${dev.friendlyName}] Light brightness command: ${haBrightness}/255 (Matter: ${newLevel})`);
            dev.brightness = haBrightness;
            info.brightness = haBrightness;
            sendLightUpdateToHA(true, { brightness: haBrightness });
          });
        }

        if (endpoint.events.colorControl?.events?.colorTemperatureMireds$Changed) {
          endpoint.events.colorControl.events.colorTemperatureMireds$Changed.on(async (mireds) => {
            if (updatingFromHA || !mireds) return;
            const kelvin = Math.round(1000000 / mireds);
            console.log(`[Matter Node: ${dev.friendlyName}] Light colorTemp command: ${mireds} mireds (${kelvin}K)`);
            dev.colorTemp = mireds;
            info.colorTemp = mireds;
            sendLightUpdateToHA(true, { color_temp_kelvin: kelvin });
          });
        }

        if (endpoint.events.colorControl?.events?.currentX$Changed && endpoint.events.colorControl?.events?.currentY$Changed) {
          const handleXyChange = () => {
            if (updatingFromHA) return;
            const x = endpoint.state.colorControl.currentX / 65536;
            const y = endpoint.state.colorControl.currentY / 65536;
            console.log(`[Matter Node: ${dev.friendlyName}] Light xy color command: [${x.toFixed(4)}, ${y.toFixed(4)}]`);
            dev.xyColor = [x, y];
            info.xyColor = [x, y];
            sendLightUpdateToHA(true, { xy_color: [x, y] });
          };
          endpoint.events.colorControl.events.currentX$Changed.on(handleXyChange);
          endpoint.events.colorControl.events.currentY$Changed.on(handleXyChange);
        }

        updateFromHA = async (newDev) => {
          updatingFromHA = true;
          try {
            if (endpoint.state.onOff.onOff !== newDev.isOn) {
              await endpoint.set({ onOff: { onOff: newDev.isOn } });
              info.isOn = newDev.isOn;
            }

            if (endpoints.light.behaviors.supported.levelControl && newDev.brightness !== null && newDev.brightness !== undefined) {
              const mLevel = Math.max(1, Math.min(254, Math.round((newDev.brightness / 255) * 254)));
              if (endpoint.state.levelControl.currentLevel !== mLevel) {
                await endpoint.set({ levelControl: { currentLevel: mLevel } });
                info.brightness = newDev.brightness;
              }
            }

            if (endpoints.light.behaviors.supported.colorControl) {
              if (newDev.colorTemp) {
                const minVal = endpoint.state.colorControl.colorTempPhysicalMinMireds || 153;
                const maxVal = endpoint.state.colorControl.colorTempPhysicalMaxMireds || 500;
                const clampedM = Math.max(minVal, Math.min(maxVal, newDev.colorTemp));
                if (endpoint.state.colorControl.colorTemperatureMireds !== clampedM) {
                  await endpoint.set({
                    colorControl: {
                      colorMode: 2,
                      colorTemperatureMireds: clampedM,
                    },
                  });
                  info.colorTemp = newDev.colorTemp;
                }
              }
              if (newDev.xyColor && Array.isArray(newDev.xyColor) && newDev.xyColor.length === 2) {
                const mX = Math.round(newDev.xyColor[0] * 65536);
                const mY = Math.round(newDev.xyColor[1] * 65536);
                if (endpoint.state.colorControl.currentX !== mX || endpoint.state.colorControl.currentY !== mY) {
                  await endpoint.set({
                    colorControl: {
                      colorMode: 1,
                      currentX: mX,
                      currentY: mY,
                    },
                  });
                  info.xyColor = newDev.xyColor;
                }
              }
            }
          } finally {
            updatingFromHA = false;
          }
        };
      } else if (dev.deviceKind === 'climate') {
        const features = [];
        if (dev.hasHeat) features.push(Thermostat.Feature.Heating);
        if (dev.hasCool) features.push(Thermostat.Feature.Cooling);
        if (dev.hasAuto) features.push(Thermostat.Feature.AutoMode);

        const ThermostatClass = ThermostatDevice.with(
          ThermostatServer.with(...features),
          ThermostatUserInterfaceConfigurationServer
        );

        const localTemp = convertTemperatureToMatter(dev.currentTemp, dev.tempUnit) ?? 2100;
        const mTarget = dev.targetTemp !== null ? convertTemperatureToMatter(dev.targetTemp, dev.tempUnit) : 2200;

        let mCool = dev.hasAuto && dev.targetTempHigh !== null
          ? convertTemperatureToMatter(dev.targetTempHigh, dev.tempUnit)
          : (dev.hvacMode === 'cool' ? mTarget : 2400);

        let mHeat = dev.hasAuto && dev.targetTempLow !== null
          ? convertTemperatureToMatter(dev.targetTempLow, dev.tempUnit)
          : (dev.hvacMode === 'heat' ? mTarget : 2000);

        mHeat = Math.max(700, Math.min(3000, mHeat));
        mCool = Math.max(1600, Math.min(3200, mCool));
        if (dev.hasAuto && mCool < mHeat + 150) {
          mCool = Math.min(3200, mHeat + 150);
        }

        const mControlSeq = (dev.hasHeat && dev.hasCool)
          ? Thermostat.ControlSequenceOfOperation.CoolingAndHeating
          : dev.hasCool
          ? Thermostat.ControlSequenceOfOperation.CoolingOnly
          : Thermostat.ControlSequenceOfOperation.HeatingOnly;

        const mSystemMode = haModeToMatterSystemMode(dev.hvacMode);

        const tConfig = {
          localTemperature: localTemp,
          systemMode: mSystemMode,
          controlSequenceOfOperation: mControlSeq,
        };

        if (dev.hasCool) {
          tConfig.occupiedCoolingSetpoint = mCool;
          tConfig.minCoolSetpointLimit = 1600;
          tConfig.maxCoolSetpointLimit = 3200;
        }

        if (dev.hasHeat) {
          tConfig.occupiedHeatingSetpoint = mHeat;
          tConfig.minHeatSetpointLimit = 700;
          tConfig.maxHeatSetpointLimit = 3000;
        }

        if (dev.hasAuto) {
          tConfig.minSetpointDeadBand = 15;
        }

        const endpoint = await node.add(ThermostatClass, {
          id: 'thermostat',
          thermostat: tConfig,
          thermostatUserInterfaceConfiguration: {
            temperatureDisplayMode: (dev.tempUnit === '°F' || dev.tempUnit === 'F') ? 1 : 0,
          },
        });
        endpoints.thermostat = endpoint;

        let updatingFromHA = false;
        let tempDebounceTimer = null;
        const pendingSetpoints = {};

        const sendSetpointsToHA = () => {
          if (tempDebounceTimer) clearTimeout(tempDebounceTimer);
          tempDebounceTimer = setTimeout(async () => {
            tempDebounceTimer = null;
            try {
              if (dev.hasAuto && (dev.hvacMode === 'auto' || dev.hvacMode === 'heat_cool')) {
                const payload = {};
                if (pendingSetpoints.cooling !== undefined) payload.target_temp_high = pendingSetpoints.cooling;
                if (pendingSetpoints.heating !== undefined) payload.target_temp_low = pendingSetpoints.heating;
                console.log(`[Matter Node: ${dev.friendlyName}] Syncing dual setpoints to HA:`, payload);
                await this.haClient.callService('climate', 'set_temperature', dev.entityId, payload);
              } else {
                const targetVal = dev.hvacMode === 'heat'
                  ? (pendingSetpoints.heating ?? pendingSetpoints.cooling)
                  : (pendingSetpoints.cooling ?? pendingSetpoints.heating);
                if (targetVal !== undefined) {
                  console.log(`[Matter Node: ${dev.friendlyName}] Syncing target temp to HA:`, targetVal);
                  await this.haClient.callService('climate', 'set_temperature', dev.entityId, { temperature: targetVal });
                }
              }
            } finally {
              delete pendingSetpoints.cooling;
              delete pendingSetpoints.heating;
            }
          }, 120);
        };

        endpoint.events.thermostat.events.systemMode$Changed.on(async (newMode) => {
          if (updatingFromHA) return;
          const targetHaMode = matterSystemModeToHa(newMode, dev.supportedModes);
          console.log(`[Matter Node: ${dev.friendlyName}] Thermostat systemMode changed: ${newMode} -> HA mode: ${targetHaMode}`);
          dev.hvacMode = targetHaMode;
          dev.isOn = targetHaMode !== 'off';
          info.hvacMode = targetHaMode;
          info.isOn = dev.isOn;
          await this.haClient.callService('climate', 'set_hvac_mode', dev.entityId, { hvac_mode: targetHaMode });
        });

        if (endpoint.events.thermostat.events.occupiedCoolingSetpoint$Changing) {
          endpoint.events.thermostat.events.occupiedCoolingSetpoint$Changing.on((newCool) => {
            if (updatingFromHA || !newCool) return;
            const haTemp = convertMatterToTemperature(newCool, dev.tempUnit);
            console.log(`[Matter Node: ${dev.friendlyName}] Cooling setpoint command: ${newCool} (HA: ${haTemp}°${dev.tempUnit})`);
            pendingSetpoints.cooling = haTemp;
            info.targetTemp = haTemp;
            sendSetpointsToHA();
          });
        }

        if (endpoint.events.thermostat.events.occupiedHeatingSetpoint$Changing) {
          endpoint.events.thermostat.events.occupiedHeatingSetpoint$Changing.on((newHeat) => {
            if (updatingFromHA || !newHeat) return;
            const haTemp = convertMatterToTemperature(newHeat, dev.tempUnit);
            console.log(`[Matter Node: ${dev.friendlyName}] Heating setpoint command: ${newHeat} (HA: ${haTemp}°${dev.tempUnit})`);
            pendingSetpoints.heating = haTemp;
            info.targetTemp = haTemp;
            sendSetpointsToHA();
          });
        }

        updateFromHA = async (newDev) => {
          updatingFromHA = true;
          try {
            if (newDev.currentTemp !== null && newDev.currentTemp !== undefined) {
              const mLocal = convertTemperatureToMatter(newDev.currentTemp, newDev.tempUnit);
              if (endpoint.state.thermostat.localTemperature !== mLocal) {
                await endpoint.set({ thermostat: { localTemperature: mLocal } });
                info.currentTemp = newDev.currentTemp;
              }
            }

            const targetMMode = haModeToMatterSystemMode(newDev.hvacMode);
            if (endpoint.state.thermostat.systemMode !== targetMMode) {
              await endpoint.set({ thermostat: { systemMode: targetMMode } });
              info.hvacMode = newDev.hvacMode;
              info.isOn = newDev.hvacMode !== 'off';
            }

            if (newDev.targetTemp !== null && newDev.targetTemp !== undefined) {
              const mVal = convertTemperatureToMatter(newDev.targetTemp, newDev.tempUnit);
              if (newDev.hvacMode === 'heat' && dev.hasHeat) {
                const clamped = Math.max(700, Math.min(3000, mVal));
                if (endpoint.state.thermostat.occupiedHeatingSetpoint !== clamped) {
                  await endpoint.set({ thermostat: { occupiedHeatingSetpoint: clamped } });
                  info.targetTemp = newDev.targetTemp;
                }
              } else if (dev.hasCool) {
                const clamped = Math.max(1600, Math.min(3200, mVal));
                if (endpoint.state.thermostat.occupiedCoolingSetpoint !== clamped) {
                  await endpoint.set({ thermostat: { occupiedCoolingSetpoint: clamped } });
                  info.targetTemp = newDev.targetTemp;
                }
              }
            } else if (newDev.targetTempLow !== null && newDev.targetTempHigh !== null && dev.hasAuto) {
              const mLow = Math.max(700, Math.min(3000, convertTemperatureToMatter(newDev.targetTempLow, newDev.tempUnit)));
              let mHigh = Math.max(1600, Math.min(3200, convertTemperatureToMatter(newDev.targetTempHigh, newDev.tempUnit)));
              if (mHigh < mLow + 150) mHigh = Math.min(3200, mLow + 150);

              const toSet = {};
              if (endpoint.state.thermostat.occupiedHeatingSetpoint !== mLow) toSet.occupiedHeatingSetpoint = mLow;
              if (endpoint.state.thermostat.occupiedCoolingSetpoint !== mHigh) toSet.occupiedCoolingSetpoint = mHigh;
              if (Object.keys(toSet).length > 0) {
                await endpoint.set({ thermostat: toSet });
                info.targetTempLow = newDev.targetTempLow;
                info.targetTempHigh = newDev.targetTempHigh;
              }
            }
          } finally {
            updatingFromHA = false;
          }
        };
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
            color: { dark: '#000000', light: '#ffffff' },
          });
        } catch (err) {
          console.warn(`[Matter Manager] QR generation failed for ${deviceId}:`, err.message);
        }
      }

      const info = {
        id: deviceId,
        entityId: dev.entityId || deviceId,
        friendlyName: dev.friendlyName,
        deviceKind: dev.deviceKind,
        lightType: dev.lightType || null,
        hvacMode: dev.hvacMode || null,
        hvacAction: dev.hvacAction || null,
        currentTemp: dev.currentTemp ?? null,
        targetTemp: dev.targetTemp ?? null,
        targetTempLow: dev.targetTempLow ?? null,
        targetTempHigh: dev.targetTempHigh ?? null,
        supportedModes: dev.supportedModes || [],
        port,
        discriminator,
        passcode: this.config.passcode,
        manualPairingCode,
        qrPairingCode,
        qrCodeDataUrl,
        csaQrUrl: qrPairingCode ? `https://project-chip.github.io/connectedhomeip/qrcode.html?data=${encodeURIComponent(qrPairingCode)}` : '',
        isOn: dev.isOn,
        brightness: dev.brightness,
        colorTemp: dev.colorTemp,
        xyColor: dev.xyColor,
        temperature: dev.temperature,
        humidity: dev.humidity,
        battery: dev.battery,
        tempUnit: dev.tempUnit,
        isCommissioned: !!node.lifecycle.isCommissioned,
        isAnnounced: true,
      };

      await node.start();

      node.events.commissioning?.fabrics$Changed?.on?.(() => {
        info.isCommissioned = !!node.lifecycle.isCommissioned;
        console.log(`[Matter Node: ${dev.friendlyName}] Fabrics updated. Commissioned: ${info.isCommissioned}`);
      });

      this.nodes.set(deviceId, {
        node,
        endpoints,
        info,
        updateFromHA,
      });

      console.log(`[Matter Node: ${dev.friendlyName}] Announcing on UDP ${port}! Pairing code: ${manualPairingCode}`);
      return info;
    } catch (err) {
      console.error(`[Matter Manager] Failed to start Matter node for ${deviceId}:`, err);
      throw err;
    }
  }

  async stopNodeForDevice(deviceId) {
    if (this.enabledConfig[deviceId]) {
      this.enabledConfig[deviceId].enabled = false;
      this.saveEnabledConfig();
    }

    const entry = this.nodes.get(deviceId);
    if (!entry) return;

    console.log(`[Matter Manager] Stopping Matter node for ${deviceId}...`);
    try {
      await entry.node.close();
    } catch (err) {
      console.warn(`[Matter Manager] Error while closing node for ${deviceId}:`, err.message);
    }
    this.nodes.delete(deviceId);
  }

  async handleHAStateChange(change) {
    const { entity_id, new_state } = change;
    const deviceId = this.entityToDeviceId.get(entity_id);
    if (!deviceId) return;

    const dev = this.discoveredDevices.get(deviceId);
    if (!dev) return;

    const activeEntry = this.nodes.get(deviceId);

    // Update friendly name if changed in HA
    const newFriendlyName = change.attributes?.friendly_name;
    if (newFriendlyName && newFriendlyName !== dev.friendlyName) {
      dev.friendlyName = newFriendlyName;
      if (activeEntry) {
        activeEntry.info.friendlyName = newFriendlyName;
        try {
          await activeEntry.node.set({
            basicInformation: {
              nodeLabel: newFriendlyName.slice(0, 32),
              productName: newFriendlyName.slice(0, 32),
              productLabel: newFriendlyName.slice(0, 64),
            },
          });
        } catch (err) {
          console.warn(`[Matter Node: ${newFriendlyName}] Could not update basicInformation:`, err.message);
        }
      }
    }

    // Update discovered state
    if (dev.deviceKind === 'switch') {
      dev.isOn = change.state;
    } else if (dev.deviceKind === 'light') {
      dev.isOn = change.state;
      if (change.attributes?.brightness !== undefined) {
        dev.brightness = change.attributes.brightness;
      }
      if (change.attributes?.color_temp_kelvin !== undefined && change.attributes.color_temp_kelvin !== null) {
        dev.colorTemp = Math.round(1000000 / change.attributes.color_temp_kelvin);
      } else if (change.attributes?.color_temp !== undefined && change.attributes.color_temp !== null) {
        dev.colorTemp = change.attributes.color_temp;
      }
      if (change.attributes?.xy_color !== undefined) {
        dev.xyColor = change.attributes.xy_color;
      }
    } else if (dev.deviceKind === 'climate') {
      dev.hvacMode = change.raw_state;
      dev.isOn = dev.hvacMode !== 'off';
      if (change.attributes?.current_temperature !== undefined) {
        dev.currentTemp = change.attributes.current_temperature;
      }
      if (change.attributes?.temperature !== undefined) {
        dev.targetTemp = change.attributes.temperature;
      }
      if (change.attributes?.target_temp_low !== undefined) {
        dev.targetTempLow = change.attributes.target_temp_low;
      }
      if (change.attributes?.target_temp_high !== undefined) {
        dev.targetTempHigh = change.attributes.target_temp_high;
      }
      if (change.attributes?.hvac_action !== undefined) {
        dev.hvacAction = change.attributes.hvac_action;
      }
    } else if (dev.deviceKind === 'sensor') {
      const numVal = parseFloat(change.raw_state);
      if (entity_id === dev.tempEntity) {
        dev.temperature = isNaN(numVal) ? null : numVal;
      } else if (entity_id === dev.humidEntity) {
        dev.humidity = isNaN(numVal) ? null : numVal;
      } else if (entity_id === dev.batEntity) {
        dev.battery = isNaN(numVal) ? null : numVal;
      }
    }

    // Update live Matter node if active
    if (activeEntry) {
      await activeEntry.updateFromHA(dev);
    }
  }

  getAllEntitiesInfo() {
    const result = [];

    for (const [deviceId, dev] of this.discoveredDevices.entries()) {
      const activeEntry = this.nodes.get(deviceId);

      if (activeEntry) {
        result.push({
          ...activeEntry.info,
          isCommissioned: !!activeEntry.node.lifecycle.isCommissioned,
          isAnnounced: true,
        });
      } else {
        const savedConfig = this.enabledConfig[deviceId];
        result.push({
          id: deviceId,
          entityId: dev.entityId || deviceId,
          friendlyName: dev.friendlyName,
          deviceKind: dev.deviceKind,
          lightType: dev.lightType || null,
          hvacMode: dev.hvacMode || null,
          hvacAction: dev.hvacAction || null,
          currentTemp: dev.currentTemp ?? null,
          targetTemp: dev.targetTemp ?? null,
          targetTempLow: dev.targetTempLow ?? null,
          targetTempHigh: dev.targetTempHigh ?? null,
          supportedModes: dev.supportedModes || [],
          port: savedConfig?.port || null,
          discriminator: savedConfig?.discriminator || null,
          passcode: this.config.passcode,
          manualPairingCode: null,
          qrPairingCode: null,
          qrCodeDataUrl: null,
          csaQrUrl: null,
          isOn: dev.isOn,
          brightness: dev.brightness,
          colorTemp: dev.colorTemp,
          xyColor: dev.xyColor,
          temperature: dev.temperature,
          humidity: dev.humidity,
          battery: dev.battery,
          tempUnit: dev.tempUnit,
          isCommissioned: false,
          isAnnounced: false,
        });
      }
    }

    return result.sort((a, b) => {
      if (a.isAnnounced !== b.isAnnounced) {
        return a.isAnnounced ? -1 : 1;
      }
      return a.friendlyName.localeCompare(b.friendlyName);
    });
  }

  async toggleFromWeb(deviceId) {
    const dev = this.discoveredDevices.get(deviceId);
    if (!dev) return false;

    if (dev.deviceKind === 'climate') {
      if (dev.hvacMode !== 'off') {
        return await this.haClient.callService('climate', 'set_hvac_mode', dev.entityId, { hvac_mode: 'off' });
      } else {
        const firstActiveMode = dev.supportedModes.find((m) => m !== 'off') || 'cool';
        return await this.haClient.callService('climate', 'set_hvac_mode', dev.entityId, { hvac_mode: firstActiveMode });
      }
    }

    if (dev.deviceKind === 'switch' || dev.deviceKind === 'light') {
      const newState = !dev.isOn;
      return await this.haClient.setEntityState(dev.entityId, newState);
    }

    return false;
  }

  async close() {
    console.log('[Matter Manager] Closing all active Matter nodes...');
    for (const [deviceId, entry] of this.nodes.entries()) {
      try {
        await entry.node.close();
      } catch (err) {
        console.warn(`[Matter Manager] Error closing node for ${deviceId}:`, err.message);
      }
    }
    this.nodes.clear();
  }
}
