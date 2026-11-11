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
  PumpDevice,
} from '@matter/main/devices';
import { PowerSourceServer } from '@matter/main/behaviors/power-source';
import { OnOffServer } from '@matter/main/behaviors/on-off';
import { FanControlServer } from '@matter/main/behaviors/fan-control';
import { ThermostatServer } from '@matter/main/behaviors/thermostat';
import { ThermostatUserInterfaceConfigurationServer } from '@matter/main/behaviors/thermostat-user-interface-configuration';
import { PumpConfigurationAndControlServer } from '@matter/main/behaviors/pump-configuration-and-control';
import { Thermostat, FanControl, PumpConfigurationAndControl } from '@matter/main/clusters';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';

function isFountainOrPump(entityId, stateObj) {
  const lowerId = (entityId || '').toLowerCase();
  const lowerName = (stateObj?.attributes?.friendly_name || '').toLowerCase();
  const deviceClass = stateObj?.attributes?.device_class || '';

  const knownFountains = ['switch.bedroom_fountain', 'switch.living_room_fountain'];
  if (knownFountains.includes(lowerId)) return true;

  if (deviceClass === 'pump') return true;

  const patterns = ['fountain', 'pump', 'фонтан', 'насос', 'помпа'];
  if (patterns.some((p) => lowerId.includes(p) || lowerName.includes(p))) {
    return true;
  }
  return false;
}

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

function haFanModesToMatterSequence(modes = []) {
  const lower = modes.map((m) => String(m).toLowerCase());
  const hasAuto = lower.some((m) => m.includes('auto'));
  const hasLow = lower.some((m) => m.includes('low') || m === '1' || m.includes('quiet'));
  const hasMedium = lower.some((m) => m.includes('med') || m.includes('mid') || m === '2');
  if (hasAuto) {
    if (hasLow && hasMedium) return FanControl.FanModeSequence.OffLowMedHighAuto;
    if (hasLow) return FanControl.FanModeSequence.OffLowHighAuto;
    return FanControl.FanModeSequence.OffHighAuto;
  }
  if (hasLow && hasMedium) return FanControl.FanModeSequence.OffLowMedHigh;
  if (hasLow) return FanControl.FanModeSequence.OffLowHigh;
  return FanControl.FanModeSequence.OffHigh;
}

function haFanModeToMatter(mode) {
  if (!mode) return FanControl.FanMode.Auto;
  const m = String(mode).toLowerCase();
  if (m === 'off') return FanControl.FanMode.Off;
  if (m.includes('low') || m === '1' || m.includes('quiet') || m.includes('min')) return FanControl.FanMode.Low;
  if (m.includes('med') || m.includes('mid') || m === '2') return FanControl.FanMode.Medium;
  if (m.includes('high') || m === '3' || m.includes('turbo') || m.includes('max')) return FanControl.FanMode.High;
  if (m.includes('auto')) return FanControl.FanMode.Auto;
  return FanControl.FanMode.On;
}

function sortFanSpeeds(modes) {
  const rank = (mode) => {
    const m = String(mode).toLowerCase().replace(/[-_]/g, ' ').trim();
    if (m === 'off') return 0;
    if (m.includes('mute') || m.includes('silent') || m.includes('quiet') || m.includes('whisper') || m.includes('sleep') || m.includes('night') || m.includes('eco')) return 10;
    if (m.includes('mid low') || m.includes('medium low') || m.includes('low mid') || m.includes('low medium') || m === '2') return 30;
    if (m.includes('low') || m.includes('min') || m === '1') return 20;
    if (m.includes('mid high') || m.includes('medium high') || m.includes('high mid') || m.includes('high medium') || m === '4') return 50;
    if (m.includes('mid') || m.includes('med') || m.includes('normal') || m.includes('standard') || m === '3') return 40;
    if (m.includes('turbo') || m.includes('boost') || m.includes('strong') || m.includes('full') || m.includes('max') || m === '6') return 70;
    if (m.includes('high') || m === '5') return 60;
    if (m.includes('auto')) return 100;
    return 45;
  };

  return [...modes].sort((a, b) => rank(a) - rank(b));
}

function haFanModesToSpeeds(modes = []) {
  const speeds = (modes || []).filter((m) => {
    const l = String(m).toLowerCase();
    return l !== 'off' && l !== 'auto';
  });
  if (speeds.length === 0) return ['low', 'medium', 'high'];
  return sortFanSpeeds(speeds);
}

function getOrderedFanSettings(supportedModes = []) {
  const speeds = haFanModesToSpeeds(supportedModes);
  const autoMode = (supportedModes || []).find((m) => String(m).toLowerCase() === 'auto');
  if (!autoMode) {
    return speeds;
  }
  const half = Math.floor(speeds.length / 2);
  const lower = speeds.slice(0, half);
  const higher = speeds.slice(half);
  return [...lower, autoMode, ...higher];
}

function matterFanModeToHa(matterMode, supportedModes = []) {
  if (!supportedModes || supportedModes.length === 0) return 'auto';
  const speeds = haFanModesToSpeeds(supportedModes);
  const findMatch = (pattern) => speeds.find((item) => String(item).toLowerCase().includes(pattern));

  switch (matterMode) {
    case FanControl.FanMode.Off:
      return supportedModes.find((m) => String(m).toLowerCase() === 'off') || null;
    case FanControl.FanMode.Low:
      return findMatch('low') || findMatch('1') || findMatch('quiet') || findMatch('mute') || findMatch('min') || speeds[0];
    case FanControl.FanMode.Medium:
      return findMatch('med') || findMatch('mid') || findMatch('2') || speeds[Math.floor(speeds.length / 2)] || speeds[0];
    case FanControl.FanMode.High:
      return findMatch('high') || findMatch('3') || findMatch('turbo') || findMatch('max') || speeds[speeds.length - 1];
    case FanControl.FanMode.Auto:
      return supportedModes.find((m) => String(m).toLowerCase() === 'auto') || 'auto';
    default:
      return speeds[0] || 'auto';
  }
}

function haFanModeToPercent(mode, supportedModes = []) {
  if (!mode || String(mode).toLowerCase() === 'off') return 0;
  if (String(mode).toLowerCase() === 'auto') return 50;
  const list = getOrderedFanSettings(supportedModes);
  const idx = list.findIndex((s) => String(s).toLowerCase() === String(mode).toLowerCase());
  if (idx === -1) {
    const m = haFanModeToMatter(mode);
    if (m === FanControl.FanMode.Low) return 25;
    if (m === FanControl.FanMode.Medium) return 65;
    if (m === FanControl.FanMode.High) return 100;
    return 50;
  }
  return Math.round(((idx + 1) / list.length) * 100);
}

function percentToHaFanMode(percent, supportedModes = []) {
  if (!supportedModes || supportedModes.length === 0) return 'auto';
  if (percent === 0 && supportedModes.some((m) => String(m).toLowerCase() === 'off')) {
    return supportedModes.find((m) => String(m).toLowerCase() === 'off');
  }
  const autoMode = supportedModes.find((m) => String(m).toLowerCase() === 'auto');
  if (autoMode && percent >= 45 && percent <= 55) {
    return autoMode;
  }
  const list = getOrderedFanSettings(supportedModes);
  if (list.length === 0) return autoMode || 'auto';

  let best = list[0];
  let minDiff = 999;
  for (let i = 0; i < list.length; i++) {
    const targetPct = String(list[i]).toLowerCase() === 'auto'
      ? 50
      : Math.round(((i + 1) / list.length) * 100);
    const diff = Math.abs(targetPct - percent);
    if (diff < minDiff) {
      minDiff = diff;
      best = list[i];
    }
  }
  return best;
}

function haFanModeToSpeed(mode, supportedModes = []) {
  if (!mode || String(mode).toLowerCase() === 'off') return 0;
  const list = getOrderedFanSettings(supportedModes);
  const idx = list.findIndex((s) => String(s).toLowerCase() === String(mode).toLowerCase());
  if (idx === -1) {
    if (String(mode).toLowerCase() === 'auto') {
      return Math.ceil(list.length / 2);
    }
    const m = haFanModeToMatter(mode);
    if (m === FanControl.FanMode.Low) return 1;
    if (m === FanControl.FanMode.Medium) return Math.ceil(list.length / 2);
    if (m === FanControl.FanMode.High) return list.length;
    return 1;
  }
  return idx + 1;
}

function speedToHaFanMode(speed, supportedModes = []) {
  if (!supportedModes || supportedModes.length === 0) return 'auto';
  if (speed === 0 && supportedModes.some((m) => String(m).toLowerCase() === 'off')) {
    return supportedModes.find((m) => String(m).toLowerCase() === 'off');
  }
  const list = getOrderedFanSettings(supportedModes);
  const idx = Math.max(0, Math.min(list.length - 1, speed - 1));
  return list[idx];
}

function convertHumidityToMatter(value) {
  if (value === null || value === undefined || isNaN(value)) return null;
  return Math.round(Number(value) * 100);
}

function convertBatteryToMatter(value) {
  if (value === null || value === undefined || isNaN(value)) return null;
  return Math.min(200, Math.max(0, Math.round(Number(value) * 2)));
}

function getSensorBaseId(entityId) {
  // Strip sensor role keywords and preserve any numeric instance suffix
  // e.g. sensor.presence_multi_sensor_fp300_temperature_2 -> sensor.presence_multi_sensor_fp300_2
  // binary_sensor.presence_multi_sensor_fp300_occupancy_2 -> sensor.presence_multi_sensor_fp300_2
  // sensor.presence_multi_sensor_fp300_humidity -> sensor.presence_multi_sensor_fp300
  const normalized = entityId.replace(/^(?:binary_sensor|sensor)\./i, 'sensor.');
  return normalized.replace(/_(?:temperature|temp|humidity|humid|battery|bat|battery_level|battery_voltage|battery_type|illuminance|illum|occupancy|motion|presence|power|energy|voltage|current)(?:_(\d+))?$/i, (match, num) => {
    return num ? `_${num}` : '';
  });
}

function cleanDeviceFriendlyName(name, deviceName) {
  let str = (deviceName && deviceName.trim()) ? deviceName.trim() : (name || '').trim();
  if (!str) return '';
  // Strip trailing raw power / raw_power
  str = str.replace(/\s*[-–—:]?\s*\braw\s*power\b/gi, '').trim();
  // If words are duplicated e.g. 'Air conditioner Air conditioner' or 'Bedroom fountain Bedroom fountain'
  const words = str.split(/\s+/);
  if (words.length >= 2 && words.length % 2 === 0) {
    const firstHalf = words.slice(0, words.length / 2).join(' ');
    const secondHalf = words.slice(words.length / 2).join(' ');
    if (firstHalf.toLowerCase() === secondHalf.toLowerCase()) {
      str = firstHalf;
    }
  }
  str = str.replace(/^(.+?)\s+\1\b/i, '$1');
  return str.trim();
}

function extractSensorBaseFriendly(rawFriendly, deviceName) {
  if (deviceName && deviceName.trim()) return cleanDeviceFriendlyName(deviceName);
  if (!rawFriendly) return '';
  const cleaned = cleanDeviceFriendlyName(rawFriendly);
  return cleaned
    .replace(/\s*[-–—:]?\s*(?:Temperature|Humidity|Battery|Battery Level|Battery Voltage|Battery Type|Illuminance|Occupancy|Motion|Presence|Power|Energy|Voltage|Current|temp|humid|bat)(?:\s+\d+)?$/i, '')
    .trim();
}

function isChildOrAuxiliaryEntity(entityId, stateObj, regEntry, allStatesMap, haClient) {
  if (!entityId) return false;

  // Fountains and pumps are primary devices, never hide them as child entities
  if (isFountainOrPump(entityId, stateObj)) {
    return false;
  }

  const domain = entityId.split('.')[0];
  const baseName = entityId.split('.')[1] || '';
  const friendlyName = (stateObj?.attributes?.friendly_name || '').toLowerCase();
  const lowerId = entityId.toLowerCase();

  // 1. Authoritative: HA Entity Registry category
  // In Home Assistant, entities explicitly marked "config" or "diagnostic" are secondary child entities
  if (regEntry?.entity_category === 'config' || regEntry?.entity_category === 'diagnostic') {
    return true;
  }

  // 2. Child entity patterns in entity_id
  const childPatterns = [
    /(?:^|_)child_?lock(?:_\d+)?$/i,
    /(?:^|_)(?:audible_|visual_)?alarm(?:_enabled|_sound|_volume|_timeout|_mode)?(?:_\d+)?$/i,
    /(?:^|_)(?:buzzer|beeper|siren|chime)(?:_enabled|_volume|_sound)?(?:_\d+)?$/i,
    /(?:^|_)raw_?power(?:_\d+)?$/i,
    /(?:^|_)(?:indicator(?:_light)?|status_led|backlight|night_light|display_light)(?:_\d+)?$/i,
    /(?:^|_)led(?:_\d+)?$/i,
    /(?:^|_)(?:power_outage_memory|power_on_state|power_on_behavior|power_recovery)(?:_\d+)?$/i,
    /(?:^|_)(?:auto_off|auto_close|inching|interlock|do_not_disturb|dnd)(?:_\d+)?$/i,
    /(?:^|_)(?:tamper|pairing_mode|self_test|test_mode)(?:_\d+)?$/i,
    /(?:^|_)(?:sensitivity|hold_time|detection_distance|radar_sensitivity|motion_sensitivity)(?:_\d+)?$/i,
    /(?:^|_)(?:firmware|identify)(?:_\d+)?$/i,
    // Vacuum auxiliary controls and schedules
    /(?:^|_)(?:pad_dry|dry_pad|mop_pad|clean_pad|empty_dustbin|self_empty|dock_wash|auto_empty)(?:_\d+)?$/i,
    /(?:^|_)schedule(?:_\d+)?/i,
    // Automation helper flags
    /(?:^|_)owned(?:_\d+)?$/i,
    /(?:^|_)roomba_.*_owned/i,
  ];

  if (childPatterns.some((pattern) => pattern.test(lowerId))) {
    return true;
  }

  // Child patterns in friendly_name
  const childFriendlyPatterns = [
    /\bchild\s*lock\b/i,
    /\b(?:audible|visual)?\s*alarm\s*(?:enabled|sound|volume|timeout|melody)?\b/i,
    /\b(?:buzzer|beeper|siren|chime)\b/i,
    /\braw\s*power\b/i,
    /\bindicator(?:\s+light)?\b/i,
    /\bstatus\s*led\b/i,
    /\bbacklight\b/i,
    /\bnight\s*light\b/i,
    /\bauto[- ]off\b/i,
    /\bauto[- ]close\b/i,
    /\bpower[- ]on state\b/i,
    /\bpower outage memory\b/i,
    /\bdo not disturb\b/i,
    /\bself[- ]test\b/i,
    /\bidentify\b/i,
    /\bsensitivity\b/i,
    /\bhold time\b/i,
    /\bdry pad\b/i,
    /\bpad dry\b/i,
    /\bschedule\b/i,
    /\bowned\b/i,
  ];

  if (childFriendlyPatterns.some((pattern) => pattern.test(friendlyName))) {
    return true;
  }

  // 3. Sensor device auxiliary switch check:
  // If the entity is a switch, but its name or device indicates it is an alarm/setting switch on a sensor device
  if (domain === 'switch') {
    const isSensorDeviceSwitch = /(?:leak|moisture|water_leak|smoke|presence|occupancy|motion|door|window|contact|vibration|temp(?:erature)?|humid(?:ity)?)_sensor/i.test(lowerId) ||
      /\b(?:leak|moisture|water leak|presence|occupancy|smoke|door|contact)\s*sensor\b/i.test(friendlyName);
    if (isSensorDeviceSwitch) {
      return true;
    }
  }

  // 4. Parent match heuristic:
  // If stripping auxiliary suffix yields another entity that exists in HA states
  if (domain === 'switch' && allStatesMap) {
    const stripped = baseName.replace(/_(?:child_lock|raw_power|indicator(?:_light)?|status_led|led|backlight|buzzer|alarm_enabled|audible_alarm_enabled|visual_alarm_enabled|power_outage_memory)(?:_\d+)?$/i, '');
    if (stripped !== baseName) {
      if (allStatesMap.has(`switch.${stripped}`) || allStatesMap.has(`light.${stripped}`) || allStatesMap.has(`climate.${stripped}`)) {
        return true;
      }
    }
  }

  // 5. HA Device Registry association check
  if (regEntry?.device_id && haClient?.entityRegistry) {
    const deviceEntities = [];
    for (const [eId, reg] of haClient.entityRegistry.entries()) {
      if (reg.device_id === regEntry.device_id && eId !== entityId) {
        deviceEntities.push(eId);
      }
    }
    if ((domain === 'switch' || domain === 'input_boolean') && deviceEntities.some((id) => id.startsWith('vacuum.'))) {
      return true;
    }
    if (domain === 'switch' && deviceEntities.some((id) => id.startsWith('climate.'))) {
      return true;
    }
    if (domain === 'switch' && deviceEntities.some((id) => id.startsWith('light.'))) {
      return true;
    }
    if (domain === 'switch' && deviceEntities.length > 0 && deviceEntities.every((id) => id.startsWith('sensor.') || id.startsWith('binary_sensor.') || id.startsWith('switch.'))) {
      const hasSensor = deviceEntities.some((id) => id.startsWith('sensor.') || id.startsWith('binary_sensor.'));
      if (hasSensor) {
        return true;
      }
    }
  }

  // 6. Mobile app / phone tracking switches and helpers
  if (regEntry?.platform === 'mobile_app' || /^(?:switch|input_boolean)\.(?:pixel|iphone|sm_|galaxy|ipad|phone|tablet|watch)_/i.test(entityId)) {
    return true;
  }

  return false;
}

function findParentDeviceId(entityId, regEntry, allStatesMap, haClient) {
  const domain = entityId.split('.')[0];
  const baseName = entityId.split('.')[1] || '';

  // 1. Check Device Registry
  if (regEntry?.device_id && haClient?.entityRegistry) {
    for (const [eId, reg] of haClient.entityRegistry.entries()) {
      if (reg.device_id === regEntry.device_id && eId !== entityId) {
        const otherDomain = eId.split('.')[0];
        if (['climate', 'light', 'switch'].includes(otherDomain) && reg.entity_category !== 'config' && reg.entity_category !== 'diagnostic') {
          return eId;
        }
      }
    }
  }

  // 2. Heuristic base name
  const stripped = baseName.replace(/_(?:child_lock|raw_power|indicator(?:_light)?|status_led|led|backlight|buzzer|alarm_enabled|audible_alarm_enabled|visual_alarm_enabled|power_outage_memory)(?:_\d+)?$/i, '');
  if (stripped !== baseName) {
    for (const d of ['switch', 'light', 'climate']) {
      const candidate = `${d}.${stripped}`;
      if (allStatesMap && allStatesMap.has(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function getLightBaseId(entityId, regEntry) {
  if (regEntry?.device_id) {
    return `device_${regEntry.device_id}`;
  }
  return entityId.replace(/_(?:light|channel|relay)?_?(\d+)$/i, '');
}

function extractLightBaseFriendly(rawFriendly, deviceName) {
  if (deviceName && deviceName.trim()) return cleanDeviceFriendlyName(deviceName);
  if (!rawFriendly) return '';
  const cleaned = cleanDeviceFriendlyName(rawFriendly);
  return cleaned
    .replace(/\s*[-–—:]?\s*(?:Light\s*\(\d+\)|Light\s*\d+|Channel\s*\d+|\d+)$/i, '')
    .trim();
}

function getLightDeviceClass(lightType) {
  if (lightType === 'extended_color') {
    return ExtendedColorLightDevice;
  } else if (lightType === 'color_temp') {
    return ColorTemperatureLightDevice;
  } else if (lightType === 'dimmable') {
    return DimmableLightDevice;
  }
  return OnOffLightDevice;
}

function buildLightEndpointConfig(channel, id) {
  const initialLevel = channel.brightness ? Math.max(1, Math.min(254, Math.round((channel.brightness / 255) * 254))) : 254;
  const minM = channel.minMireds || 153;
  const maxM = channel.maxMireds || 500;
  const initialMireds = channel.colorTemp ? Math.max(minM, Math.min(maxM, channel.colorTemp)) : 250;

  const endpointConfig = {
    id: id || 'light',
    onOff: { onOff: channel.isOn },
  };

  if (channel.lightType === 'dimmable' || channel.lightType === 'color_temp' || channel.lightType === 'extended_color') {
    endpointConfig.levelControl = { currentLevel: initialLevel };
  }

  if (channel.lightType === 'color_temp' || channel.lightType === 'extended_color') {
    endpointConfig.colorControl = {
      colorMode: 2,
      colorTempPhysicalMinMireds: minM,
      colorTempPhysicalMaxMireds: maxM,
      colorTemperatureMireds: initialMireds,
      coupleColorTempToLevelMinMireds: minM,
    };
    if (channel.lightType === 'extended_color' && channel.xyColor) {
      endpointConfig.colorControl.currentX = Math.round(channel.xyColor[0] * 65536);
      endpointConfig.colorControl.currentY = Math.round(channel.xyColor[1] * 65536);
      endpointConfig.colorControl.colorMode = 1;
    }
  }

  return endpointConfig;
}

export class MatterManager {
  constructor(config, haClient) {
    this.config = config;
    this.haClient = haClient;
    this.nodes = new Map(); // deviceId -> { node, endpoints, info, updateFromHA }
    this.discoveredDevices = new Map(); // deviceId -> device object
    this.entityToDeviceId = new Map(); // entityId -> deviceId
    this.showAllSensors = config.showAllSensors ?? false;
    this.lastStates = null;
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

  setShowAllSensors(showAll) {
    this.showAllSensors = !!showAll;
    console.log(`[Matter Manager] showAllSensors set to: ${this.showAllSensors}`);
    if (this.lastStates) {
      this.syncWithHAStates(this.lastStates);
    }
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
    this.lastStates = statesMap;
    console.log('[Matter Manager] Synchronizing entities and sensors with Home Assistant...');

    this.entityToDeviceId.clear();
    this.discoveredDevices.clear();

    const primaryDeviceIds = new Set();
    const primaryBaseIds = new Set();
    const rawLights = [];
    const rawSensors = [];

    for (const [entityId, stateObj] of statesMap.entries()) {
      if (!this.shouldIncludeEntity(entityId)) {
        continue;
      }

      const domain = entityId.split('.')[0];
      const baseName = entityId.split('.')[1] || '';

      // Track primary device affiliations from HA Entity Registry
      const reg = this.haClient?.entityRegistry?.get(entityId);
      if (domain === 'switch' || domain === 'input_boolean' || domain === 'light' || domain === 'climate') {
        if (reg?.device_id) primaryDeviceIds.add(reg.device_id);
        primaryBaseIds.add(baseName);
      }

      // 1. Process Switches & Input Booleans (including Fountains / Pumps)
      if (domain === 'switch' || domain === 'input_boolean') {
        const rawFriendly = stateObj.attributes?.friendly_name || entityId;
        const regDeviceName = reg?.device_id ? this.haClient?.deviceRegistry?.get(reg.device_id)?.name : null;
        const friendlyName = cleanDeviceFriendlyName(rawFriendly, regDeviceName);
        const isOn = stateObj.state === 'on';
        const isPump = isFountainOrPump(entityId, stateObj);
        const isSub = isChildOrAuxiliaryEntity(entityId, stateObj, reg, statesMap, this.haClient);
        const isAnnounced = this.enabledConfig[entityId]?.enabled === true || this.nodes.has(entityId);

        if (isSub) {
          const parentId = findParentDeviceId(entityId, reg, statesMap, this.haClient);
          if (parentId) {
            this.entityToDeviceId.set(entityId, parentId);
          }
        }

        if (!isSub || this.showAllSensors || isAnnounced) {
          this.discoveredDevices.set(entityId, {
            id: entityId,
            domain,
            deviceKind: isPump ? 'pump' : 'switch',
            friendlyName,
            isOn,
            entityId,
            isSubEntity: isSub,
          });
          if (!this.entityToDeviceId.has(entityId)) {
            this.entityToDeviceId.set(entityId, entityId);
          }
        }
      }

      // 2. Collect Candidate Lights (to group multi-channel lights / multi-gang switches)
      if (domain === 'light') {
        const isSub = isChildOrAuxiliaryEntity(entityId, stateObj, reg, statesMap, this.haClient);
        const isAnnounced = this.enabledConfig[entityId]?.enabled === true || this.nodes.has(entityId);

        if (isSub) {
          const parentId = findParentDeviceId(entityId, reg, statesMap, this.haClient);
          if (parentId) {
            this.entityToDeviceId.set(entityId, parentId);
          }
        }

        if (!isSub || this.showAllSensors || isAnnounced) {
          rawLights.push({
            entityId,
            stateObj,
            reg,
            isSub,
            isAnnounced,
          });
        }
      }

      // 3. Process Climate (Thermostats & ACs)
      if (domain === 'climate') {
        const rawFriendly = stateObj.attributes?.friendly_name || entityId;
        const regDeviceName = reg?.device_id ? this.haClient?.deviceRegistry?.get(reg.device_id)?.name : null;
        const friendlyName = cleanDeviceFriendlyName(rawFriendly, regDeviceName);
        const supportedModes = stateObj.attributes?.hvac_modes || ['off', 'heat', 'cool'];
        const hasCool = supportedModes.includes('cool');
        const hasHeat = supportedModes.includes('heat');
        const hasAuto = supportedModes.includes('auto') || supportedModes.includes('heat_cool');

        const supportedFeatures = stateObj.attributes?.supported_features || 0;
        // ClimateEntityFeature.FAN_MODE is bit 3 (value 8)
        const hasNativeFanMode = Boolean((supportedFeatures & 8) || (Array.isArray(stateObj.attributes?.fan_modes) && stateObj.attributes.fan_modes.length > 0));
        const rawFanModes = Array.isArray(stateObj.attributes?.fan_modes) ? stateObj.attributes.fan_modes : [];
        let fanMode = stateObj.attributes?.fan_mode || null;
        const presetModes = Array.isArray(stateObj.attributes?.preset_modes) ? stateObj.attributes.preset_modes : [];
        const presetMode = stateObj.attributes?.preset_mode || null;

        // Check for companion fan or select entity on the same physical device
        let companionFanEntity = null;
        let companionSelectFan = null;
        if (reg?.device_id && this.haClient?.entityRegistry) {
          for (const [eId, eReg] of this.haClient.entityRegistry.entries()) {
            if (eReg.device_id === reg.device_id && eId !== entityId) {
              if (eId.startsWith('fan.')) {
                companionFanEntity = eId;
              } else if (eId.startsWith('select.') && /fan|speed/i.test(eId)) {
                companionSelectFan = eId;
              }
            }
          }
        }

        // Fallback name-based heuristic for companion fan
        if (!companionFanEntity && statesMap) {
          const baseName = entityId.split('.')[1];
          for (const cand of [`fan.${baseName}`, `fan.${baseName}_fan`, `fan.${baseName}_speed`]) {
            if (statesMap.has(cand)) {
              companionFanEntity = cand;
              break;
            }
          }
        }

        let fanModes = [];
        if (hasNativeFanMode && rawFanModes.length > 0) {
          fanModes = rawFanModes;
        } else if (companionFanEntity) {
          const fanState = statesMap.get(companionFanEntity);
          fanModes = Array.isArray(fanState?.attributes?.preset_modes) && fanState.attributes.preset_modes.length > 0
            ? fanState.attributes.preset_modes
            : ['auto', 'low', 'medium', 'high'];
          if (!fanMode) fanMode = fanState?.attributes?.preset_mode || (fanState?.state === 'on' ? 'high' : 'off');
        } else if (companionSelectFan) {
          const selState = statesMap.get(companionSelectFan);
          fanModes = Array.isArray(selState?.attributes?.options) && selState.attributes.options.length > 0
            ? selState.attributes.options
            : ['auto', 'low', 'medium', 'high'];
          if (!fanMode) fanMode = selState?.state || null;
        } else if (presetModes.length > 0) {
          fanModes = presetModes;
          if (!fanMode) fanMode = presetMode;
        } else {
          fanModes = ['auto', 'low', 'medium', 'high'];
        }

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
          fanModes,
          fanMode,
          presetModes,
          presetMode,
          hasNativeFanMode,
          companionFanEntity,
          companionSelectFan,
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
        if (companionFanEntity) {
          this.entityToDeviceId.set(companionFanEntity, entityId);
        }
        if (companionSelectFan) {
          this.entityToDeviceId.set(companionSelectFan, entityId);
        }
      }

      // 4. Collect Candidate Sensors (Temperature, Humidity, Battery, Occupancy, Illuminance)
      if (domain === 'sensor' || domain === 'binary_sensor') {
        // Exclude mobile app / phone tracker sensors
        const isMobileDevice = /^(?:sensor|binary_sensor)\.(?:pixel|iphone|sm_|galaxy|ipad|phone|tablet|watch)_/i.test(entityId) ||
          reg?.platform === 'mobile_app';
        if (isMobileDevice) continue;

        // Exclude vacuum cleaner battery sensors
        const isVacuum = /^(?:sensor|binary_sensor)\..*?(?:roomba|vacuum|dreame|roborock).*?battery/i.test(entityId);
        if (isVacuum) continue;

        const deviceClass = stateObj.attributes?.device_class;
        const unit = stateObj.attributes?.unit_of_measurement;
        const isTemp = deviceClass === 'temperature' || /_(temperature|temp)(?:_\d+)?$/i.test(entityId);
        const isHumid = deviceClass === 'humidity' || /_(humidity|humid)(?:_\d+)?$/i.test(entityId);
        const isBat = (deviceClass === 'battery' || /_(battery|bat)(?:_\d+)?$/i.test(entityId)) && !/voltage|type/i.test(entityId);
        const isIllum = deviceClass === 'illuminance' || /illuminance/i.test(entityId);
        const isOcc = deviceClass === 'occupancy' || deviceClass === 'motion' || deviceClass === 'presence' || /occupancy|motion|presence/i.test(entityId);

        let role = 'other';
        if (isTemp) role = 'temperature';
        else if (isHumid) role = 'humidity';
        else if (isBat) role = 'battery';
        else if (isIllum) role = 'illuminance';
        else if (isOcc) role = 'occupancy';

        if (role !== 'other') {
          rawSensors.push({
            entityId,
            stateObj,
            role,
            unit,
          });
        }
      }
    }

    // 2b. Group Lights: Single lights remain individual, Multi-channel lights (multi-gang switches) are grouped
    const groupedLightsMap = new Map();
    for (const l of rawLights) {
      const baseId = getLightBaseId(l.entityId, l.reg);
      if (!groupedLightsMap.has(baseId)) {
        const regEntry = l.reg;
        const devReg = regEntry?.device_id ? this.haClient?.deviceRegistry?.get(regEntry.device_id) : null;
        const fallbackFriendly = extractLightBaseFriendly(l.stateObj.attributes?.friendly_name, devReg?.name_by_user || devReg?.name);
        const deviceName = devReg?.name_by_user || devReg?.name || fallbackFriendly;

        groupedLightsMap.set(baseId, {
          baseId,
          deviceId: regEntry?.device_id || null,
          friendlyName: deviceName || fallbackFriendly || baseId,
          channels: [],
        });
      }
      groupedLightsMap.get(baseId).channels.push(l);
    }

    const buildLightChannel = (l) => {
      const stateObj = l.stateObj;
      const entityId = l.entityId;
      const rawFriendly = stateObj.attributes?.friendly_name || entityId;
      const friendlyName = cleanDeviceFriendlyName(rawFriendly);
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

      return {
        entityId,
        friendlyName,
        isOn,
        brightness,
        colorTemp,
        xyColor,
        minMireds,
        maxMireds,
        lightType,
        isSub: l.isSub,
      };
    };

    for (const [baseId, grp] of groupedLightsMap.entries()) {
      if (grp.channels.length === 1) {
        // Single light
        const ch = buildLightChannel(grp.channels[0]);
        const entityId = ch.entityId;
        this.discoveredDevices.set(entityId, {
          id: entityId,
          domain: 'light',
          deviceKind: 'light',
          lightType: ch.lightType,
          friendlyName: ch.friendlyName,
          isOn: ch.isOn,
          brightness: ch.brightness,
          colorTemp: ch.colorTemp,
          xyColor: ch.xyColor,
          minMireds: ch.minMireds,
          maxMireds: ch.maxMireds,
          entityId,
          isSubEntity: ch.isSub,
          isMultiLight: false,
        });
        if (!this.entityToDeviceId.has(entityId)) {
          this.entityToDeviceId.set(entityId, entityId);
        }
      } else {
        // Multi-channel light device
        const channels = grp.channels.map(buildLightChannel);
        const overallOn = channels.some((c) => c.isOn);
        const deviceId = baseId;
        this.discoveredDevices.set(deviceId, {
          id: deviceId,
          domain: 'light',
          deviceKind: 'light',
          lightType: channels[0].lightType,
          friendlyName: grp.friendlyName,
          isOn: overallOn,
          brightness: channels[0].brightness,
          colorTemp: channels[0].colorTemp,
          xyColor: channels[0].xyColor,
          minMireds: channels[0].minMireds,
          maxMireds: channels[0].maxMireds,
          entityId: channels[0].entityId,
          isSubEntity: false,
          isMultiLight: true,
          channels,
        });
        this.entityToDeviceId.set(deviceId, deviceId);
        for (const ch of channels) {
          this.entityToDeviceId.set(ch.entityId, deviceId);
        }
      }
    }

    // Group sensors that belong together into physical devices
    const groupedSensors = new Map();

    for (const s of rawSensors) {
      const regEntry = this.haClient?.entityRegistry?.get(s.entityId);
      const devReg = regEntry?.device_id ? this.haClient?.deviceRegistry?.get(regEntry.device_id) : null;

      // Group key: Prefer HA device_id if available, otherwise heuristic base ID
      const baseId = regEntry?.device_id ? `device_${regEntry.device_id}` : getSensorBaseId(s.entityId);
      const rawFallback = s.stateObj.attributes?.friendly_name || s.entityId;
      const fallbackFriendly = extractSensorBaseFriendly(rawFallback);
      const rawDeviceName = devReg?.name_by_user || devReg?.name || fallbackFriendly;
      const deviceName = cleanDeviceFriendlyName(rawDeviceName);

      // Check if this sensor belongs to an existing primary device (switch, light, climate)
      const rawBaseName = s.entityId.split('.')[1]?.replace(/_(?:temperature|temp|humidity|humid|battery|bat|illuminance|occupancy|motion|presence|power|energy|voltage|current)(?:_\d+)?$/i, '');
      const belongsToPrimary = Boolean(
        (regEntry?.device_id && primaryDeviceIds.has(regEntry.device_id)) ||
        primaryBaseIds.has(rawBaseName)
      );

      if (!groupedSensors.has(baseId)) {
        groupedSensors.set(baseId, {
          baseId,
          deviceId: regEntry?.device_id || null,
          friendlyName: deviceName || baseId,
          temp: null,
          humid: null,
          bat: null,
          illum: null,
          occ: null,
          allEntities: [],
          belongsToPrimary,
        });
      }

      const group = groupedSensors.get(baseId);
      group.allEntities.push(s.entityId);
      if (belongsToPrimary) group.belongsToPrimary = true;

      if (s.role === 'temperature' && !group.temp) {
        group.temp = s;
      } else if (s.role === 'humidity' && !group.humid) {
        group.humid = s;
      } else if (s.role === 'battery' && !group.bat) {
        group.bat = s;
      } else if (s.role === 'illuminance' && !group.illum) {
        group.illum = s;
      } else if (s.role === 'occupancy' && !group.occ) {
        group.occ = s;
      }
    }

    // Add grouped sensors to discovered devices
    for (const [baseId, group] of groupedSensors.entries()) {
      const isAnnounced = this.enabledConfig[baseId]?.enabled === true || this.nodes.has(baseId);

      // By default, hide internal sensors belonging to primary devices (ACs, switches, lights) unless announced
      if (group.belongsToPrimary && !this.showAllSensors && !isAnnounced) {
        continue;
      }

      // Must have at least one primary environmental measurement (temperature, humidity, or occupancy)
      const hasPrimarySensor = Boolean(group.temp || group.humid || group.occ);
      if (!hasPrimarySensor && !this.showAllSensors && !isAnnounced) {
        continue;
      }

      const isMulti = Boolean(
        (group.temp && (group.humid || group.bat || group.occ)) ||
        (group.humid && (group.bat || group.occ))
      );

      const representativeEntityId = group.temp?.entityId || group.humid?.entityId || group.occ?.entityId || group.bat?.entityId || group.allEntities[0] || baseId;

      const deviceObj = {
        id: baseId,
        entityId: representativeEntityId,
        domain: 'sensor',
        deviceKind: 'sensor',
        friendlyName: group.friendlyName,
        tempEntity: group.temp?.entityId || null,
        humidEntity: group.humid?.entityId || null,
        batEntity: group.bat?.entityId || null,
        occEntity: group.occ?.entityId || null,
        temperature: group.temp ? parseFloat(group.temp.stateObj.state) : null,
        humidity: group.humid ? parseFloat(group.humid.stateObj.state) : null,
        battery: group.bat ? parseFloat(group.bat.stateObj.state) : null,
        tempUnit: group.temp?.unit || '°C',
        isMultiSensor: !!isMulti,
        isSubSensor: !!group.belongsToPrimary,
        isSubEntity: !!group.belongsToPrimary,
      };

      this.discoveredDevices.set(baseId, deviceObj);

      for (const entId of group.allEntities) {
        this.entityToDeviceId.set(entId, baseId);
      }
    }

    // If showAllSensors is enabled, expose every raw sub-sensor entity individually as well
    if (this.showAllSensors) {
      for (const s of rawSensors) {
        if (!this.discoveredDevices.has(s.entityId)) {
          const friendly = s.stateObj.attributes?.friendly_name || s.entityId;
          this.discoveredDevices.set(s.entityId, {
            id: s.entityId,
            domain: 'sensor',
            deviceKind: 'sensor',
            friendlyName: friendly,
            tempEntity: s.role === 'temperature' ? s.entityId : null,
            humidEntity: s.role === 'humidity' ? s.entityId : null,
            batEntity: s.role === 'battery' ? s.entityId : null,
            temperature: s.role === 'temperature' ? parseFloat(s.stateObj.state) : null,
            humidity: s.role === 'humidity' ? parseFloat(s.stateObj.state) : null,
            battery: s.role === 'battery' ? parseFloat(s.stateObj.state) : null,
            tempUnit: s.unit || '°C',
            isMultiSensor: false,
            isSubSensor: true,
            isSubEntity: true,
          });
          this.entityToDeviceId.set(s.entityId, s.entityId);
        }
      }
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

      if (dev.deviceKind === 'pump') {
        primaryDeviceType = PumpDevice.deviceType;
      } else if (dev.deviceKind === 'switch') {
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
          softwareVersionString: '1.6.1',
        },
      });

      // Ensure stored node basic information is refreshed with current HA friendly name
      try {
        await node.set({
          basicInformation: {
            nodeLabel: dev.friendlyName.slice(0, 32),
            productName: dev.friendlyName.slice(0, 32),
            productLabel: dev.friendlyName.slice(0, 64),
            softwareVersionString: '1.6.1',
          },
        });
      } catch (err) {
        // Ignored if uninitialized
      }

      const endpoints = {};
      let updateFromHA = async () => {};

      // Build endpoints depending on deviceKind
      if (dev.deviceKind === 'switch' || dev.deviceKind === 'pump') {
        let endpoint;
        if (dev.deviceKind === 'pump') {
          const PumpClass = PumpDevice.with(
            OnOffServer,
            PumpConfigurationAndControlServer.with(PumpConfigurationAndControl.Feature.ConstantSpeed)
          );
          endpoint = await node.add(PumpClass, {
            id: 'pump',
            onOff: { onOff: dev.isOn },
            pumpConfigurationAndControl: {
              operationMode: PumpConfigurationAndControl.OperationMode.Normal,
              effectiveOperationMode: PumpConfigurationAndControl.OperationMode.Normal,
              controlMode: PumpConfigurationAndControl.ControlMode.ConstantSpeed,
              effectiveControlMode: PumpConfigurationAndControl.ControlMode.ConstantSpeed,
              maxSpeed: 1000,
              currentSpeed: 1000,
            },
          });
          endpoints.pump = endpoint;
        } else {
          endpoint = await node.add(OnOffPlugInUnitDevice, { id: 'switch' });
          endpoints.switch = endpoint;
          if (dev.isOn) {
            await endpoint.set({ onOff: { onOff: true } });
          }
        }

        let updatingFromHA = false;
        const onOffEvent = endpoint.events.onOff.onOff$Changed || endpoint.events.onOff.events?.onOff$Changed;
        if (onOffEvent) {
          onOffEvent.on(async (newValue) => {
            if (updatingFromHA) return;
            console.log(`[Matter Node: ${dev.friendlyName}] Received command: ${newValue ? 'ON' : 'OFF'}`);
            dev.isOn = newValue;
            if (typeof info !== 'undefined' && info) info.isOn = newValue;
            await this.haClient.setEntityState(dev.entityId, newValue);
          });
        }

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
        let updatingFromHA = false;

        if (dev.isMultiLight && Array.isArray(dev.channels) && dev.channels.length > 1) {
          // Multi-channel light node: Add an endpoint for each physical channel
          const channelEndpoints = new Map();

          for (let i = 0; i < dev.channels.length; i++) {
            const ch = dev.channels[i];
            const epId = `light_${i + 1}`;
            const epClass = getLightDeviceClass(ch.lightType);
            const epConfig = buildLightEndpointConfig(ch, epId);

            const ep = await node.add(epClass, epConfig);
            channelEndpoints.set(ch.entityId, ep);
            endpoints[epId] = ep;

            let chDebounceTimer = null;
            const chPendingPayload = {};

            const sendChannelUpdateToHA = (turnOn, data = {}) => {
              Object.assign(chPendingPayload, data);
              if (!turnOn) {
                if (chDebounceTimer) clearTimeout(chDebounceTimer);
                chDebounceTimer = null;
                ch.isOn = false;
                this.haClient.setEntityState(ch.entityId, false);
                return;
              }

              ch.isOn = true;
              if (chDebounceTimer) clearTimeout(chDebounceTimer);
              chDebounceTimer = setTimeout(async () => {
                chDebounceTimer = null;
                const toSend = { ...chPendingPayload };
                for (const k of Object.keys(chPendingPayload)) delete chPendingPayload[k];
                console.log(`[Matter Node: ${dev.friendlyName}] Syncing channel ${ch.friendlyName} to HA:`, toSend);
                await this.haClient.setEntityState(ch.entityId, true, toSend);
              }, 80);
            };

            const chOnOffEvent = ep.events.onOff.onOff$Changed || ep.events.onOff.events?.onOff$Changed;
            if (chOnOffEvent) {
              chOnOffEvent.on(async (newValue) => {
                if (updatingFromHA) return;
                console.log(`[Matter Node: ${dev.friendlyName} / ${ch.friendlyName}] onOff command: ${newValue ? 'ON' : 'OFF'}`);
                sendChannelUpdateToHA(newValue);
              });
            }

            if (ep.events.levelControl?.events?.currentLevel$Changed) {
              ep.events.levelControl.events.currentLevel$Changed.on(async (newLevel) => {
                if (updatingFromHA || newLevel === null || newLevel === undefined) return;
                const haBrightness = Math.max(1, Math.min(255, Math.round((newLevel / 254) * 255)));
                ch.brightness = haBrightness;
                sendChannelUpdateToHA(true, { brightness: haBrightness });
              });
            }

            if (ep.events.colorControl?.events?.colorTemperatureMireds$Changed) {
              ep.events.colorControl.events.colorTemperatureMireds$Changed.on(async (mireds) => {
                if (updatingFromHA || !mireds) return;
                const kelvin = Math.round(1000000 / mireds);
                ch.colorTemp = mireds;
                sendChannelUpdateToHA(true, { color_temp_kelvin: kelvin });
              });
            }
          }

          updateFromHA = async (newDev) => {
            updatingFromHA = true;
            try {
              if (Array.isArray(newDev.channels)) {
                for (const ch of newDev.channels) {
                  const ep = channelEndpoints.get(ch.entityId);
                  if (!ep) continue;

                  if (ep.state.onOff.onOff !== ch.isOn) {
                    await ep.set({ onOff: { onOff: ch.isOn } });
                  }

                  if (ep.behaviors.supported.levelControl && ch.brightness !== null && ch.brightness !== undefined) {
                    const mLevel = Math.max(1, Math.min(254, Math.round((ch.brightness / 255) * 254)));
                    if (ep.state.levelControl.currentLevel !== mLevel) {
                      await ep.set({ levelControl: { currentLevel: mLevel } });
                    }
                  }

                  if (ep.behaviors.supported.colorControl && ch.colorTemp) {
                    const minVal = ep.state.colorControl.colorTempPhysicalMinMireds || 153;
                    const maxVal = ep.state.colorControl.colorTempPhysicalMaxMireds || 500;
                    const clampedM = Math.max(minVal, Math.min(maxVal, ch.colorTemp));
                    if (ep.state.colorControl.colorTemperatureMireds !== clampedM) {
                      await ep.set({ colorControl: { colorMode: 2, colorTemperatureMireds: clampedM } });
                    }
                  }
                }
              }
            } finally {
              updatingFromHA = false;
            }
          };
        } else {
          // Single light endpoint (Standard)
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

          const lightOnOffEvent = endpoint.events.onOff.onOff$Changed || endpoint.events.onOff.events?.onOff$Changed;
          if (lightOnOffEvent) {
            lightOnOffEvent.on(async (newValue) => {
              if (updatingFromHA) return;
              console.log(`[Matter Node: ${dev.friendlyName}] Light onOff command: ${newValue ? 'ON' : 'OFF'}`);
              sendLightUpdateToHA(newValue);
            });
          }

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
        }
      } else if (dev.deviceKind === 'climate') {
        const features = [];
        if (dev.hasHeat) features.push(Thermostat.Feature.Heating);
        if (dev.hasCool) features.push(Thermostat.Feature.Cooling);
        if (dev.hasAuto) features.push(Thermostat.Feature.AutoMode);

        const hasFanControl = Array.isArray(dev.fanModes) && dev.fanModes.length > 0;
        const fanSeq = haFanModesToMatterSequence(dev.fanModes);
        const currentFM = haFanModeToMatter(dev.fanMode);
        const currentPct = haFanModeToPercent(dev.fanMode, dev.fanModes);
        const speedMax = Math.max(1, getOrderedFanSettings(dev.fanModes).length);
        const currentSpd = haFanModeToSpeed(dev.fanMode, dev.fanModes);

        const ThermostatClass = ThermostatDevice.with(
          ThermostatServer.with(...features),
          ThermostatUserInterfaceConfigurationServer,
          OnOffServer,
          FanControlServer.with(FanControl.Feature.MultiSpeed, FanControl.Feature.Auto)
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

        const endpointConfig = {
          id: 'thermostat',
          thermostat: tConfig,
          thermostatUserInterfaceConfiguration: {
            temperatureDisplayMode: (dev.tempUnit === '°F' || dev.tempUnit === 'F') ? 1 : 0,
          },
          onOff: {
            onOff: dev.isOn,
          },
          fanControl: {
            fanMode: currentFM,
            fanModeSequence: fanSeq,
            percentSetting: currentPct,
            percentCurrent: currentPct,
            speedMax: speedMax,
            speedSetting: currentSpd,
            speedCurrent: currentSpd,
          },
        };

        const endpoint = await node.add(ThermostatClass, endpointConfig);
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

        // Thermostat HVAC Mode changes
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

        // Dedicated On/Off Power Button for Google Home
        const onOffEvent = endpoint.events.onOff?.events?.onOff$Changed || endpoint.events.onOff?.events?.onOff$Changing;
        if (onOffEvent) {
          onOffEvent.on(async (newValue) => {
            if (updatingFromHA) return;
            console.log(`[Matter Node: ${dev.friendlyName}] Climate power toggle command: ${newValue ? 'ON' : 'OFF'}`);
            dev.isOn = newValue;
            info.isOn = newValue;

            if (newValue) {
              try {
                await this.haClient.callService('climate', 'turn_on', dev.entityId);
              } catch (err) {
                const activeMode = dev.supportedModes.find((m) => m !== 'off') || 'cool';
                console.log(`[Matter Node: ${dev.friendlyName}] turn_on fallback to set_hvac_mode: ${activeMode}`);
                await this.haClient.callService('climate', 'set_hvac_mode', dev.entityId, { hvac_mode: activeMode });
              }
            } else {
              try {
                await this.haClient.callService('climate', 'turn_off', dev.entityId);
              } catch (err) {
                console.log(`[Matter Node: ${dev.friendlyName}] turn_off fallback to set_hvac_mode: off`);
                await this.haClient.callService('climate', 'set_hvac_mode', dev.entityId, { hvac_mode: 'off' });
              }
            }
          });
        }

        // Fan Speed & Fan Mode for Google Home (Native on Thermostat Endpoint)
        let fanDebounceTimer = null;

        const applyFanCommand = async (targetHaMode, pct, spd) => {
          if (updatingFromHA) return;
          console.log(`[Matter Node: ${dev.friendlyName}] Fan command -> mode="${targetHaMode}", pct=${pct}%, spd=${spd}`);
          dev.fanMode = targetHaMode;
          info.fanMode = targetHaMode;

          // 1. Companion fan entity (if physical device exposes a linked fan in HA)
          if (dev.companionFanEntity) {
            try {
              if (pct !== null && pct !== undefined) {
                await this.haClient.callService('fan', 'set_percentage', dev.companionFanEntity, { percentage: pct });
              } else {
                await this.haClient.callService('fan', 'set_preset_mode', dev.companionFanEntity, { preset_mode: targetHaMode });
              }
              return;
            } catch (err) {
              console.warn(`[Matter Node: ${dev.friendlyName}] Companion fan service call failed:`, err.message);
            }
          }

          // 2. Companion select entity for fan speed
          if (dev.companionSelectFan) {
            try {
              await this.haClient.callService('select', 'select_option', dev.companionSelectFan, { option: targetHaMode });
              return;
            } catch (err) {
              console.warn(`[Matter Node: ${dev.friendlyName}] Companion select service call failed:`, err.message);
            }
          }

          // 3. Native climate.set_fan_mode (if supported by the climate integration)
          if (dev.hasNativeFanMode) {
            try {
              await this.haClient.callService('climate', 'set_fan_mode', dev.entityId, { fan_mode: targetHaMode });
              return;
            } catch (err) {
              console.warn(`[Matter Node: ${dev.friendlyName}] climate.set_fan_mode failed:`, err.message);
            }
          }

          // 4. Climate preset_mode fallback (e.g. low/medium/high/boost/turbo)
          if (Array.isArray(dev.presetModes) && dev.presetModes.length > 0) {
            const match = dev.presetModes.find((p) => p.toLowerCase() === targetHaMode?.toLowerCase()) ||
              (targetHaMode === 'low' && dev.presetModes.find((p) => /low|quiet|silent|eco/i.test(p))) ||
              (targetHaMode === 'high' && dev.presetModes.find((p) => /high|boost|turbo|max/i.test(p)));
            if (match) {
              try {
                await this.haClient.callService('climate', 'set_preset_mode', dev.entityId, { preset_mode: match });
                return;
              } catch (err) {
                console.warn(`[Matter Node: ${dev.friendlyName}] climate.set_preset_mode failed:`, err.message);
              }
            }
          }

          // 5. Try climate.set_fan_mode safely
          try {
            await this.haClient.callService('climate', 'set_fan_mode', dev.entityId, { fan_mode: targetHaMode });
          } catch (err) {
            console.warn(`[Matter Node: ${dev.friendlyName}] AC entity does not support climate.set_fan_mode and no companion fan entity was found: ${err.message}`);
          }
        };

        if (endpoint.events?.fanControl) {
          const fanModeEvent = endpoint.events.fanControl.events?.fanMode$Changed || endpoint.events.fanControl.events?.fanMode$Changing;
          if (fanModeEvent) {
            fanModeEvent.on(async (newMode) => {
              if (updatingFromHA) return;
              const targetHaMode = matterFanModeToHa(newMode, dev.fanModes);
              if (!targetHaMode) return;
              await applyFanCommand(targetHaMode, null, null);
            });
          }

          const handleSpeedPercentChange = (pct) => {
            if (updatingFromHA || pct === null || pct === undefined) return;
            if (fanDebounceTimer) clearTimeout(fanDebounceTimer);
            fanDebounceTimer = setTimeout(async () => {
              fanDebounceTimer = null;
              const targetHaMode = percentToHaFanMode(pct, dev.fanModes);
              if (!targetHaMode) return;
              await applyFanCommand(targetHaMode, pct, null);
            }, 100);
          };

          const pctEvent = endpoint.events.fanControl.events?.percentSetting$Changing || endpoint.events.fanControl.events?.percentSetting$Changed;
          if (pctEvent) {
            pctEvent.on(handleSpeedPercentChange);
          }

          const spdEvent = endpoint.events.fanControl.events?.speedSetting$Changing || endpoint.events.fanControl.events?.speedSetting$Changed;
          if (spdEvent) {
            spdEvent.on((spd) => {
              if (updatingFromHA || spd === null || spd === undefined) return;
              if (fanDebounceTimer) clearTimeout(fanDebounceTimer);
              fanDebounceTimer = setTimeout(async () => {
                fanDebounceTimer = null;
                const targetHaMode = speedToHaFanMode(spd, dev.fanModes);
                if (!targetHaMode) return;
                await applyFanCommand(targetHaMode, null, spd);
              }, 100);
            });
          }
        }

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

            if (endpoint.state.onOff.onOff !== newDev.isOn) {
              await endpoint.set({ onOff: { onOff: newDev.isOn } });
              info.isOn = newDev.isOn;
            }

            if (newDev.fanMode) {
              const targetFM = haFanModeToMatter(newDev.fanMode);
              const targetPct = haFanModeToPercent(newDev.fanMode, dev.fanModes);
              const targetSpd = haFanModeToSpeed(newDev.fanMode, dev.fanModes);

              const fcUpdates = {};
              const currentM = endpoint.state?.fanControl?.fanMode;
              if (currentM !== targetFM) fcUpdates.fanMode = targetFM;
              if (endpoint.state?.fanControl?.percentSetting !== targetPct) {
                fcUpdates.percentSetting = targetPct;
                fcUpdates.percentCurrent = targetPct;
              }
              if (endpoint.state?.fanControl?.speedSetting !== targetSpd) {
                fcUpdates.speedSetting = targetSpd;
                fcUpdates.speedCurrent = targetSpd;
              }

              if (Object.keys(fcUpdates).length > 0) {
                if (endpoint.state?.fanControl) {
                  await endpoint.set({ fanControl: fcUpdates });
                }
                info.fanMode = newDev.fanMode;
              }
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
        fanModes: dev.fanModes || [],
        fanMode: dev.fanMode || null,
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
    if (entry) {
      console.log(`[Matter Manager] Stopping Matter node for ${deviceId}...`);
      try {
        await entry.node.close();
      } catch (err) {
        console.warn(`[Matter Manager] Error while closing node for ${deviceId}:`, err.message);
      }
      this.nodes.delete(deviceId);
    }

    // Clean up persistent storage so re-announcing always starts fresh
    const sanitizedId = deviceId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const storageDir = path.join(this.config.storagePath, sanitizedId);
    if (fs.existsSync(storageDir)) {
      try {
        fs.rmSync(storageDir, { recursive: true, force: true });
        console.log(`[Matter Manager] Cleared storage for unannounced node: ${sanitizedId}`);
      } catch (err) {
        console.warn(`[Matter Manager] Could not clear storage directory ${storageDir}:`, err.message);
      }
    }
  }

  async resetNodeForDevice(deviceId) {
    console.log(`[Matter Manager] Resetting pairing credentials for ${deviceId}...`);
    const dev = this.discoveredDevices.get(deviceId);
    if (!dev) {
      throw new Error(`Device "${deviceId}" not found.`);
    }

    const sanitizedId = deviceId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const storageDir = path.join(this.config.storagePath, sanitizedId);

    const entry = this.nodes.get(deviceId);
    if (entry) {
      try {
        await entry.node.close();
      } catch (err) {
        console.warn(`[Matter Manager] Error while closing node before reset:`, err.message);
      }
      this.nodes.delete(deviceId);
    }

    // Completely erase node's persistent storage to wipe all fabric credentials
    if (fs.existsSync(storageDir)) {
      try {
        fs.rmSync(storageDir, { recursive: true, force: true });
        console.log(`[Matter Manager] Successfully erased storage for node: ${sanitizedId}`);
      } catch (err) {
        console.warn(`[Matter Manager] Could not erase storage directory ${storageDir}:`, err.message);
      }
    }

    // Ensure device is marked as enabled in configuration
    if (!this.enabledConfig[deviceId]) {
      this.enabledConfig[deviceId] = {
        enabled: true,
        port: this.getNextAvailablePort(),
        discriminator: this.getNextAvailableDiscriminator(),
      };
    } else {
      this.enabledConfig[deviceId].enabled = true;
    }
    this.saveEnabledConfig();

    // Start fresh node
    return await this.startNodeForDevice(deviceId);
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
      if (dev.isMultiLight && Array.isArray(dev.channels)) {
        const ch = dev.channels.find((c) => c.entityId === entity_id);
        if (ch) {
          ch.isOn = change.state;
          if (change.attributes?.brightness !== undefined) ch.brightness = change.attributes.brightness;
          if (change.attributes?.color_temp_kelvin !== undefined && change.attributes.color_temp_kelvin !== null) {
            ch.colorTemp = Math.round(1000000 / change.attributes.color_temp_kelvin);
          } else if (change.attributes?.color_temp !== undefined && change.attributes.color_temp !== null) {
            ch.colorTemp = change.attributes.color_temp;
          }
          if (change.attributes?.xy_color !== undefined) ch.xyColor = change.attributes.xy_color;
        }
        dev.isOn = dev.channels.some((c) => c.isOn);
      } else {
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
      }
    } else if (dev.deviceKind === 'climate') {
      if (dev.companionFanEntity === entity_id) {
        if (change.attributes?.preset_mode !== undefined) {
          dev.fanMode = change.attributes.preset_mode;
        } else if (change.attributes?.percentage !== undefined) {
          dev.fanPercent = change.attributes.percentage;
        }
      } else if (dev.companionSelectFan === entity_id) {
        if (change.raw_state) {
          dev.fanMode = change.raw_state;
        }
      } else {
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
        if (change.attributes?.fan_mode !== undefined) {
          dev.fanMode = change.attributes.fan_mode;
        }
        if (change.attributes?.fan_modes !== undefined && Array.isArray(change.attributes.fan_modes) && change.attributes.fan_modes.length > 0) {
          dev.fanModes = change.attributes.fan_modes;
        }
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
          isSubSensor: !!dev.isSubSensor,
          isSubEntity: !!dev.isSubEntity,
          isMultiSensor: !!dev.isMultiSensor,
          isMultiLight: !!dev.isMultiLight,
          channels: dev.channels || [],
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
          isSubSensor: !!dev.isSubSensor,
          isSubEntity: !!dev.isSubEntity,
          isMultiSensor: !!dev.isMultiSensor,
          isMultiLight: !!dev.isMultiLight,
          channels: dev.channels || [],
          lightType: dev.lightType || null,
          hvacMode: dev.hvacMode || null,
          hvacAction: dev.hvacAction || null,
          currentTemp: dev.currentTemp ?? null,
          targetTemp: dev.targetTemp ?? null,
          targetTempLow: dev.targetTempLow ?? null,
          targetTempHigh: dev.targetTempHigh ?? null,
          supportedModes: dev.supportedModes || [],
          fanModes: dev.fanModes || [],
          fanMode: dev.fanMode || null,
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

  async toggleFromWeb(deviceId, targetEntityId) {
    const dev = this.discoveredDevices.get(deviceId);
    if (!dev) return false;

    if (targetEntityId) {
      const stateObj = this.lastStates?.get(targetEntityId);
      const newState = !(stateObj?.state === 'on');
      return await this.haClient.setEntityState(targetEntityId, newState);
    }

    if (dev.isMultiLight && Array.isArray(dev.channels) && dev.channels.length > 0) {
      const targetState = !dev.isOn;
      let allOk = true;
      for (const ch of dev.channels) {
        const ok = await this.haClient.setEntityState(ch.entityId, targetState);
        if (!ok) allOk = false;
      }
      return allOk;
    }

    if (dev.deviceKind === 'climate') {
      if (dev.hvacMode !== 'off') {
        return await this.haClient.callService('climate', 'set_hvac_mode', dev.entityId, { hvac_mode: 'off' });
      } else {
        const firstActiveMode = dev.supportedModes.find((m) => m !== 'off') || 'cool';
        return await this.haClient.callService('climate', 'set_hvac_mode', dev.entityId, { hvac_mode: firstActiveMode });
      }
    }

    if (dev.deviceKind === 'switch' || dev.deviceKind === 'light' || dev.deviceKind === 'pump') {
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
