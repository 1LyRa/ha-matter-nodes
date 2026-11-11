// Determine API base path to work both under Home Assistant Ingress and direct port access
const apiBase = window.location.pathname.replace(/\/+$/, '');

// Theme Management
const htmlEl = document.documentElement;
const themeSwitcher = document.getElementById('themeSwitcher');
let currentTheme = localStorage.getItem('theme_preference') || 'auto';

function applyTheme(theme) {
  currentTheme = theme;
  localStorage.setItem('theme_preference', theme);
  htmlEl.setAttribute('data-theme', theme);

  document.querySelectorAll('.theme-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-theme') === theme);
  });
}

themeSwitcher.addEventListener('click', (e) => {
  const btn = e.target.closest('.theme-btn');
  if (btn) {
    applyTheme(btn.getAttribute('data-theme'));
  }
});

applyTheme(currentTheme);

// DOM References
const haStatusBadge = document.getElementById('haStatusBadge');
const nodeCountBadge = document.getElementById('nodeCountBadge');
const countAll = document.getElementById('countAll');
const countSwitches = document.getElementById('countSwitches');
const countLights = document.getElementById('countLights');
const countClimate = document.getElementById('countClimate');
const countSensors = document.getElementById('countSensors');
const countActive = document.getElementById('countActive');
const countInactive = document.getElementById('countInactive');
const searchInput = document.getElementById('searchInput');
const cardsGrid = document.getElementById('cardsGrid');
const filterTabs = document.querySelectorAll('.tab-btn');
const btnToggleLogs = document.getElementById('btnToggleLogs');
const btnCloseLogs = document.getElementById('btnCloseLogs');
const logsContainer = document.getElementById('logsContainer');
const logsTerminal = document.getElementById('logsTerminal');
const autoScrollCheck = document.getElementById('autoScrollCheck');
const btnRefreshLogs = document.getElementById('btnRefreshLogs');
const btnCopyLogs = document.getElementById('btnCopyLogs');
const btnClearLogs = document.getElementById('btnClearLogs');
const btnSettings = document.getElementById('btnSettings');
const settingsModal = document.getElementById('settingsModal');
const btnCloseSettings = document.getElementById('btnCloseSettings');
const toggleShowAllSensors = document.getElementById('toggleShowAllSensors');

let allDevices = [];
let activeTab = 'all';
let cachedLogs = [];
let logsPollTimer = null;
let isLogsOpen = false;
const expandedPairingInfo = new Set();
let lastCardsRenderKey = '';

function openLogsView() {
  isLogsOpen = true;
  cardsGrid.style.display = 'none';
  logsContainer.style.display = 'block';
  if (searchInput && searchInput.parentElement) {
    searchInput.parentElement.style.display = 'none';
  }
  filterTabs.forEach((t) => t.classList.remove('active'));
  if (btnToggleLogs) btnToggleLogs.classList.add('active');
  fetchLogs();
  if (!logsPollTimer) {
    logsPollTimer = setInterval(fetchLogs, 2500);
  }
}

function closeLogsView() {
  isLogsOpen = false;
  cardsGrid.style.display = 'grid';
  logsContainer.style.display = 'none';
  if (searchInput && searchInput.parentElement) {
    searchInput.parentElement.style.display = 'block';
  }
  if (btnToggleLogs) btnToggleLogs.classList.remove('active');
  filterTabs.forEach((t) => {
    if (t.getAttribute('data-tab') === activeTab) {
      t.classList.add('active');
    }
  });
  if (logsPollTimer) {
    clearInterval(logsPollTimer);
    logsPollTimer = null;
  }
  renderCards();
}

function toggleLogsView() {
  if (isLogsOpen) {
    closeLogsView();
  } else {
    openLogsView();
  }
}

if (btnToggleLogs) {
  btnToggleLogs.addEventListener('click', toggleLogsView);
}

if (btnCloseLogs) {
  btnCloseLogs.addEventListener('click', closeLogsView);
}

// Settings Modal
function openSettings() {
  if (settingsModal) settingsModal.style.display = 'flex';
}

function closeSettings() {
  if (settingsModal) settingsModal.style.display = 'none';
}

if (btnSettings) {
  btnSettings.addEventListener('click', openSettings);
}

if (btnCloseSettings) {
  btnCloseSettings.addEventListener('click', closeSettings);
}

if (settingsModal) {
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) closeSettings();
  });
}

async function fetchSettings() {
  try {
    const res = await fetch(`${apiBase}/api/settings`);
    if (!res.ok) return;
    const data = await res.json();
    if (toggleShowAllSensors) {
      toggleShowAllSensors.checked = !!data.showAllSensors;
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

if (toggleShowAllSensors) {
  toggleShowAllSensors.addEventListener('change', async () => {
    const showAll = toggleShowAllSensors.checked;
    try {
      await fetch(`${apiBase}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ showAllSensors: showAll }),
      });
      lastCardsRenderKey = '';
      await fetchNodes();
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  });
}

// Tab Switching
filterTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    if (isLogsOpen) {
      isLogsOpen = false;
      if (btnToggleLogs) btnToggleLogs.classList.remove('active');
      logsContainer.style.display = 'none';
      if (logsPollTimer) {
        clearInterval(logsPollTimer);
        logsPollTimer = null;
      }
    }
    filterTabs.forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    activeTab = tab.getAttribute('data-tab');

    cardsGrid.style.display = 'grid';
    if (searchInput && searchInput.parentElement) {
      searchInput.parentElement.style.display = 'block';
    }
    renderCards();
  });
});

async function fetchLogs() {
  try {
    const res = await fetch(`${apiBase}/api/logs`);
    if (!res.ok) return;
    const data = await res.json();
    cachedLogs = data.logs || [];
    renderLogs(cachedLogs);
  } catch (err) {
    console.error('Failed to fetch logs:', err);
  }
}

function renderLogs(logs) {
  if (!logs || logs.length === 0) {
    logsTerminal.innerHTML = '<div class="log-loading">No logs recorded in memory yet.</div>';
    return;
  }

  const html = logs.map((log) => {
    const timeStr = log.time ? (log.time.split(' ')[1] || log.time) : '';
    const lvl = log.level || 'info';
    return `<div class="log-entry">
      <span class="log-time">${escapeHtml(timeStr)}</span>
      <span class="log-badge ${lvl}">[${lvl.toUpperCase()}]</span>
      <span class="log-text">${escapeHtml(log.message)}</span>
    </div>`;
  }).join('');

  logsTerminal.innerHTML = html;

  if (autoScrollCheck && autoScrollCheck.checked) {
    logsTerminal.scrollTop = logsTerminal.scrollHeight;
  }
}

if (btnRefreshLogs) {
  btnRefreshLogs.addEventListener('click', fetchLogs);
}

if (btnCopyLogs) {
  btnCopyLogs.addEventListener('click', () => {
    let text = '';
    if (cachedLogs && cachedLogs.length > 0) {
      text = cachedLogs.map((l) => `[${l.time}] [${(l.level || 'info').toUpperCase()}] ${l.message}`).join('\n');
    } else if (logsTerminal && logsTerminal.innerText) {
      text = logsTerminal.innerText;
    }
    copyToClipboard(text, btnCopyLogs);
  });
}

if (btnClearLogs) {
  btnClearLogs.addEventListener('click', async () => {
    if (!confirm('Clear recent logs in memory?')) return;
    try {
      await fetch(`${apiBase}/api/logs/clear`, { method: 'POST' });
      cachedLogs = [];
      renderLogs([]);
    } catch (err) {
      console.error('Failed to clear logs:', err);
    }
  });
}

async function fetchStatus() {
  try {
    const res = await fetch(`${apiBase}/api/status`);
    if (!res.ok) return;
    const data = await res.json();

    if (data.haConnected) {
      haStatusBadge.textContent = 'Connected to Home Assistant';
      haStatusBadge.className = 'status-badge connected';
    } else {
      haStatusBadge.textContent = 'Connecting to HA...';
      haStatusBadge.className = 'status-badge connecting';
    }

    nodeCountBadge.textContent = `${data.activeCount || 0} Active / ${data.totalDiscovered || 0} Total`;
  } catch (err) {
    haStatusBadge.textContent = 'HA Offline';
    haStatusBadge.className = 'status-badge connecting';
  }
}

async function fetchNodes() {
  try {
    const res = await fetch(`${apiBase}/api/nodes`);
    if (!res.ok) return;
    allDevices = await res.json();

    const switchCount = allDevices.filter((d) => d.deviceKind === 'switch' || d.deviceKind === 'pump').length;
    const lightCount = allDevices.filter((d) => d.deviceKind === 'light').length;
    const climateCount = allDevices.filter((d) => d.deviceKind === 'climate' || d.deviceKind === 'purifier' || d.deviceKind === 'fan').length;
    const sensorCount = allDevices.filter((d) => d.deviceKind === 'sensor').length;
    const activeCount = allDevices.filter((d) => d.isAnnounced).length;
    const inactiveCount = allDevices.length - activeCount;

    countAll.textContent = allDevices.length;
    countSwitches.textContent = switchCount;
    if (countLights) countLights.textContent = lightCount;
    if (countClimate) countClimate.textContent = climateCount;
    countSensors.textContent = sensorCount;
    countActive.textContent = activeCount;
    countInactive.textContent = inactiveCount;

    renderCards();
  } catch (err) {
    console.error('Failed to fetch devices:', err);
  }
}

function getFilteredDevices(query) {
  return allDevices.filter((dev) => {
    // Tab filtering
    if (activeTab === 'switch' && dev.deviceKind !== 'switch' && dev.deviceKind !== 'pump') return false;
    if (activeTab === 'light' && dev.deviceKind !== 'light') return false;
    if (activeTab === 'climate' && dev.deviceKind !== 'climate' && dev.deviceKind !== 'purifier' && dev.deviceKind !== 'fan') return false;
    if (activeTab === 'sensor' && dev.deviceKind !== 'sensor') return false;
    if (activeTab === 'active' && !dev.isAnnounced) return false;
    if (activeTab === 'inactive' && dev.isAnnounced) return false;

    // Search query filter
    return (
      dev.friendlyName.toLowerCase().includes(query) ||
      dev.entityId.toLowerCase().includes(query) ||
      (dev.port && String(dev.port).includes(query))
    );
  });
}

function computeCardsRenderKey(filtered, query) {
  return JSON.stringify({
    tab: activeTab,
    query,
    expanded: Array.from(expandedPairingInfo).sort(),
    devices: filtered.map((d) => ({
      id: d.id,
      name: d.friendlyName,
      state: d.state,
      isAnnounced: d.isAnnounced,
      isCommissioned: d.isCommissioned,
      port: d.port,
      qr: !!d.qrCodeDataUrl,
      code: d.manualPairingCode,
      isSubEntity: !!d.isSubEntity,
      curTemp: d.currentTemp,
      tgtTemp: d.targetTemp,
      tgtLow: d.targetTempLow,
      tgtHigh: d.targetTempHigh,
      hvacMode: d.hvacMode,
      hvacAction: d.hvacAction,
      fanMode: d.fanMode,
      bri: d.brightness,
      ct: d.colorTemp,
      temp: d.temperature,
      hum: d.humidity,
      bat: d.battery,
      pct: d.percentage,
      pm25: d.pm25,
      pm10: d.pm10,
      aq: d.airQuality,
      hepa: d.hepaFilter,
      carb: d.carbonFilter,
      isMultiLight: !!d.isMultiLight,
      channels: d.channels ? d.channels.map((c) => ({ id: c.id, isOn: c.isOn, bri: c.brightness })) : [],
    })),
  });
}

function renderCards() {
  const query = (searchInput.value || '').trim().toLowerCase();
  const filtered = getFilteredDevices(query);

  // State fingerprint to prevent destructive DOM wipes during polling if data hasn't changed
  const currentRenderKey = computeCardsRenderKey(filtered, query);

  if (currentRenderKey === lastCardsRenderKey) {
    return;
  }

  const activeEl = document.activeElement;
  const activeId = activeEl && activeEl.id ? activeEl.id : null;
  const isFocusedInCards = activeEl && cardsGrid.contains(activeEl);

  if (filtered.length === 0) {
    if (allDevices.length === 0) {
      cardsGrid.innerHTML = `
        <div class="empty-state">
          <p>No devices discovered from Home Assistant yet.</p>
          <p class="subtitle">Ensure you have entities starting with <code>switch.</code>, <code>light.</code>, <code>climate.</code>, <code>input_boolean.</code>, or temperature/humidity sensors.</p>
        </div>`;
    } else {
      cardsGrid.innerHTML = `
        <div class="empty-state">
          <p>No devices matching "${escapeHtml(query)}" in this tab.</p>
        </div>`;
    }
    lastCardsRenderKey = currentRenderKey;
    return;
  }

  cardsGrid.innerHTML = filtered.map((dev) => renderCard(dev)).join('');
  lastCardsRenderKey = currentRenderKey;

  // Preserve user focus if active element was inside cardsGrid
  if (activeId && isFocusedInCards) {
    const restored = document.getElementById(activeId);
    if (restored) {
      restored.focus({ preventScroll: true });
    }
  }
}

function renderCard(dev) {
  const isSwitch = dev.deviceKind === 'switch';
  const isPump = dev.deviceKind === 'pump';
  const isLight = dev.deviceKind === 'light';
  const isClimate = dev.deviceKind === 'climate';
  const isPurifier = dev.deviceKind === 'purifier';
  const isFan = dev.deviceKind === 'fan';
  const isSensor = dev.deviceKind === 'sensor';
  const isPaired = dev.isCommissioned;
  const statusPill = isPaired
    ? `<span class="pill paired">✓ Paired to Fabric</span>`
    : dev.isAnnounced
    ? `<span class="pill ready">⏳ Ready to Pair</span>`
    : `<span class="pill idle">Dormant</span>`;

  let typePill = '<span class="pill type-badge">Device</span>';
  if (dev.isSubEntity) {
    typePill = '<span class="pill type-badge sub-entity">⚙️ Child / Config</span>';
  } else if (isPurifier) {
    typePill = '<span class="pill type-badge purifier">🍃 Air Purifier</span>';
  } else if (isFan) {
    typePill = '<span class="pill type-badge fan">💨 Fan</span>';
  } else if (isPump) {
    typePill = '<span class="pill type-badge pump">🌊 Fountain / Pump</span>';
  } else if (isSwitch) {
    typePill = '<span class="pill type-badge">Switch</span>';
  } else if (isLight) {
    if (dev.isMultiLight) {
      typePill = '<span class="pill type-badge">Multi-Channel Light</span>';
    } else if (dev.lightType === 'extended_color') {
      typePill = '<span class="pill type-badge">Color Light</span>';
    } else if (dev.lightType === 'color_temp') {
      typePill = '<span class="pill type-badge">White Spectrum Light</span>';
    } else if (dev.lightType === 'dimmable') {
      typePill = '<span class="pill type-badge">Dimmable Light</span>';
    } else {
      typePill = '<span class="pill type-badge">Light</span>';
    }
  } else if (isClimate) {
    typePill = '<span class="pill type-badge">Climate / AC</span>';
  } else if (isSensor) {
    if (dev.isSubSensor) {
      typePill = '<span class="pill type-badge" style="opacity: 0.85;">Sensor</span>';
    } else {
      typePill = '<span class="pill type-badge">Multi-Sensor</span>';
    }
  }

  let formattedCode = dev.manualPairingCode || 'N/A';
  if (formattedCode.length === 11) {
    formattedCode = `${formattedCode.slice(0, 4)}-${formattedCode.slice(4, 7)}-${formattedCode.slice(7)}`;
  }

  // Metrics block (Sensors, Lights, Climate, Purifier, Fan)
  let metricsHtml = '';
  if (isPurifier) {
    const metrics = [];
    if (dev.percentage !== null && dev.percentage !== undefined) {
      metrics.push(`
        <div class="sensor-metric">
          <span class="metric-label">Fan Speed</span>
          <span class="metric-value">💨 ${dev.percentage}%</span>
        </div>
      `);
    } else if (dev.fanMode) {
      metrics.push(`
        <div class="sensor-metric">
          <span class="metric-label">Fan Mode</span>
          <span class="metric-value" style="text-transform: capitalize;">💨 ${escapeHtml(dev.fanMode)}</span>
        </div>
      `);
    }
    if (dev.pm25 !== null && dev.pm25 !== undefined) {
      metrics.push(`
        <div class="sensor-metric">
          <span class="metric-label">PM2.5</span>
          <span class="metric-value">🌫️ ${dev.pm25} µg/m³</span>
        </div>
      `);
    }
    if (dev.pm10 !== null && dev.pm10 !== undefined) {
      metrics.push(`
        <div class="sensor-metric">
          <span class="metric-label">PM10</span>
          <span class="metric-value">🌫️ ${dev.pm10} µg/m³</span>
        </div>
      `);
    }
    if (dev.airQuality) {
      metrics.push(`
        <div class="sensor-metric">
          <span class="metric-label">Air Quality</span>
          <span class="metric-value" style="text-transform: capitalize;">✨ ${escapeHtml(String(dev.airQuality))}</span>
        </div>
      `);
    }
    if (dev.temperature !== null && dev.temperature !== undefined) {
      const unit = dev.tempUnit === '°F' || dev.tempUnit === 'F' ? '°F' : '°C';
      metrics.push(`
        <div class="sensor-metric">
          <span class="metric-label">Temperature</span>
          <span class="metric-value">🌡️ ${dev.temperature}${unit}</span>
        </div>
      `);
    }
    if (dev.humidity !== null && dev.humidity !== undefined) {
      metrics.push(`
        <div class="sensor-metric">
          <span class="metric-label">Humidity</span>
          <span class="metric-value">💧 ${dev.humidity}%</span>
        </div>
      `);
    }
    if (dev.hepaFilter !== null && dev.hepaFilter !== undefined) {
      metrics.push(`
        <div class="sensor-metric">
          <span class="metric-label">HEPA Filter</span>
          <span class="metric-value">🛡️ ${Math.round(dev.hepaFilter)}%</span>
        </div>
      `);
    }
    if (dev.carbonFilter !== null && dev.carbonFilter !== undefined) {
      metrics.push(`
        <div class="sensor-metric">
          <span class="metric-label">Carbon Filter</span>
          <span class="metric-value">⬛ ${Math.round(dev.carbonFilter)}%</span>
        </div>
      `);
    }
    if ((dev.hepaFilter === null || dev.hepaFilter === undefined) && (dev.carbonFilter === null || dev.carbonFilter === undefined)) {
      metrics.push(`
        <div class="sensor-metric">
          <span class="metric-label">Air Filter</span>
          <span class="metric-value">🛡️ Good (100%)</span>
        </div>
      `);
    }

    if (metrics.length > 0) {
      metricsHtml = `<div class="sensor-readings">${metrics.join('')}</div>`;
    }
  } else if (isFan) {
    const metrics = [];
    if (dev.percentage !== null && dev.percentage !== undefined) {
      metrics.push(`
        <div class="sensor-metric">
          <span class="metric-label">Fan Speed</span>
          <span class="metric-value">💨 ${dev.percentage}%</span>
        </div>
      `);
    } else if (dev.fanMode) {
      metrics.push(`
        <div class="sensor-metric">
          <span class="metric-label">Fan Mode</span>
          <span class="metric-value" style="text-transform: capitalize;">💨 ${escapeHtml(dev.fanMode)}</span>
        </div>
      `);
    }
    if (metrics.length > 0) {
      metricsHtml = `<div class="sensor-readings">${metrics.join('')}</div>`;
    }
  } else if (isClimate) {
    const unit = dev.tempUnit === '°F' || dev.tempUnit === 'F' ? 'F' : 'C';
    const currentStr = dev.currentTemp !== null && dev.currentTemp !== undefined ? `${dev.currentTemp}°${unit}` : '--';
    let targetStr = '--';
    if (dev.targetTemp !== null && dev.targetTemp !== undefined) {
      targetStr = `${dev.targetTemp}°${unit}`;
    } else if (dev.targetTempLow !== null && dev.targetTempHigh !== null) {
      targetStr = `${dev.targetTempLow}° - ${dev.targetTempHigh}°`;
    }
    const modeStr = dev.hvacAction ? `${dev.hvacAction}` : (dev.hvacMode || 'off');

    metricsHtml = `
      <div class="sensor-readings">
        <div class="sensor-metric">
          <span class="metric-label">Current</span>
          <span class="metric-value">🌡️ ${currentStr}</span>
        </div>
        <div class="sensor-metric">
          <span class="metric-label">Target</span>
          <span class="metric-value">🎯 ${targetStr}</span>
        </div>
        <div class="sensor-metric">
          <span class="metric-label">HVAC Mode</span>
          <span class="metric-value" style="font-size: 0.95rem; text-transform: capitalize;">${escapeHtml(modeStr)}</span>
        </div>
        ${
          dev.fanMode
            ? `<div class="sensor-metric">
                <span class="metric-label">Fan Mode</span>
                <span class="metric-value" style="font-size: 0.95rem; text-transform: capitalize;">💨 ${escapeHtml(dev.fanMode)}</span>
              </div>`
            : ''
        }
      </div>
    `;
  } else if (isSensor) {
    metricsHtml = `
      <div class="sensor-readings">
        ${
          dev.temperature !== null && dev.temperature !== undefined
            ? `<div class="sensor-metric">
                <span class="metric-label">Temperature</span>
                <span class="metric-value">🌡️ ${dev.temperature}°${dev.tempUnit === '°F' ? 'F' : 'C'}</span>
              </div>`
            : ''
        }
        ${
          dev.humidity !== null && dev.humidity !== undefined
            ? `<div class="sensor-metric">
                <span class="metric-label">Humidity</span>
                <span class="metric-value">💧 ${dev.humidity}%</span>
              </div>`
            : ''
        }
        ${
          dev.battery !== null && dev.battery !== undefined
            ? `<div class="sensor-metric">
                <span class="metric-label">Battery</span>
                <span class="metric-value">🔋 ${dev.battery}%</span>
              </div>`
            : ''
        }
      </div>
    `;
  } else if (isLight && (dev.brightness !== null || dev.colorTemp !== null)) {
    metricsHtml = `
      <div class="sensor-readings">
        ${
          dev.brightness !== null && dev.brightness !== undefined
            ? `<div class="sensor-metric">
                <span class="metric-label">Brightness</span>
                <span class="metric-value">💡 ${Math.round((dev.brightness / 255) * 100)}%</span>
              </div>`
            : ''
        }
        ${
          dev.colorTemp !== null && dev.colorTemp !== undefined
            ? `<div class="sensor-metric">
                <span class="metric-label">Color Temp</span>
                <span class="metric-value">🌡️ ${Math.round(1000000 / dev.colorTemp)}K</span>
              </div>`
            : ''
        }
      </div>
    `;
  }

  // Body content: Announced vs Unannounced
  let bodyContent = '';
  if (dev.isAnnounced) {
    const pairingDrawerHtml = `
      <div class="qr-box">
        ${
          dev.qrCodeDataUrl
            ? `<img src="${dev.qrCodeDataUrl}" alt="Matter QR Code for ${escapeHtml(dev.friendlyName)}">`
            : '<div class="spinner"></div>'
        }
      </div>

      <div class="pairing-code-section">
        <div class="code-details">
          <span class="code-label">Manual Pairing Code</span>
          <span class="code-value">${formattedCode}</span>
        </div>
        <button class="btn-copy" onclick="copyToClipboard('${dev.manualPairingCode}', this)">Copy</button>
      </div>
    `;

    if (isPaired) {
      const isExpanded = expandedPairingInfo.has(dev.id);
      bodyContent = `
        <div class="paired-status-box">
          <div class="paired-badge-row">
            <span class="paired-icon">✅</span>
            <div class="paired-text">
              <span class="paired-title">Active in Google Home Fabric</span>
              <span class="paired-sub">Matter Node is communicating locally with Google Home.</span>
            </div>
          </div>
          <div class="paired-actions-row">
            <button id="btn-toggle-pairing-${escapeHtml(dev.id)}" class="btn-toggle-pairing" onclick="togglePairingInfo('${escapeHtml(dev.id)}')">
              ${isExpanded ? '✕ Hide Pairing QR & Code' : '📱 Show Pairing QR & Code'}
            </button>
            <button class="btn-reset-pairing" onclick="resetNodePairing('${escapeHtml(dev.id)}', '${escapeHtml(dev.friendlyName)}', this)" title="Reset pairing credentials to pair again as a fresh device">
              🔄 Reset to Re-pair
            </button>
          </div>
          <div id="pairing-info-${escapeHtml(dev.id)}" class="pairing-drawer" style="display: ${isExpanded ? 'block' : 'none'};">
            ${pairingDrawerHtml}
          </div>
        </div>
      `;
    } else {
      bodyContent = pairingDrawerHtml;
    }
  } else {
    bodyContent = `
      <div class="unannounced-box">
        <p>This ${isPurifier ? 'air purifier' : isFan ? 'fan' : isPump ? 'fountain / pump' : isSwitch ? 'switch' : isLight ? 'light' : isClimate ? 'thermostat / AC' : 'sensor'} is dormant. Announce it to allocate a Matter UDP port and pairing QR code.</p>
        <button class="btn-announce" onclick="enableAnnouncement('${escapeHtml(dev.id)}', this)">
          ⚡ Announce as Matter Device
        </button>
      </div>
    `;
  }

  // Footer content
  let footerContent = '';
  if (isClimate) {
    const isRunning = dev.hvacMode && dev.hvacMode !== 'off';
    footerContent = `
      <div class="state-indicator">
        <span class="state-dot ${isRunning ? 'on' : ''}"></span>
        <span>HA Mode: ${(dev.hvacMode || 'off').toUpperCase()}</span>
      </div>
      <div class="footer-actions">
        <button class="btn-toggle ${isRunning ? 'active' : ''}" onclick="toggleDevice('${escapeHtml(dev.id)}')">
          ${isRunning ? 'Turn Off' : 'Turn On'}
        </button>
      </div>
    `;
  } else if (isLight && dev.isMultiLight && Array.isArray(dev.channels) && dev.channels.length > 0) {
    footerContent = `
      <div class="multi-channel-container">
        ${dev.channels
          .map(
            (ch) => `
          <div class="channel-row">
            <div class="channel-info">
              <span class="state-dot ${ch.isOn ? 'on' : ''}"></span>
              <span class="channel-name">${escapeHtml(ch.friendlyName || ch.id)}</span>
            </div>
            <button class="btn-toggle channel-btn ${ch.isOn ? 'active' : ''}" onclick="toggleDeviceChannel('${escapeHtml(dev.id)}', '${escapeHtml(ch.entityId)}')">
              ${ch.isOn ? 'Turn Off' : 'Turn On'}
            </button>
          </div>
        `
          )
          .join('')}
      </div>
    `;
  } else if (isSwitch || isLight || isPump || isPurifier || isFan) {
    footerContent = `
      <div class="state-indicator">
        <span class="state-dot ${dev.isOn ? 'on' : ''}"></span>
        <span>HA State: ${dev.isOn ? 'ON' : 'OFF'}</span>
      </div>
      <div class="footer-actions">
        <button class="btn-toggle ${dev.isOn ? 'active' : ''}" onclick="toggleDevice('${escapeHtml(dev.id)}')">
          ${dev.isOn ? 'Turn Off' : 'Turn On'}
        </button>
      </div>
    `;
  } else {
    footerContent = `
      <div class="state-indicator">
        <span class="state-dot on"></span>
        <span>Sensor Active in HA</span>
      </div>
      <div class="footer-actions">
        ${dev.isAnnounced ? `<span class="pill">Matter Live</span>` : ''}
      </div>
    `;
  }

  return `
    <div class="card ${dev.isAnnounced ? '' : 'unannounced'}" data-device-id="${escapeHtml(dev.id)}">
      <div class="card-header">
        <div>
          <div class="card-title">${escapeHtml(dev.friendlyName)}</div>
          <div class="card-entity-id">${escapeHtml(dev.entityId)}</div>
        </div>
        ${
          dev.isAnnounced
            ? `<button class="btn-stop" onclick="disableAnnouncement('${escapeHtml(dev.id)}', this)" title="Stop announcing this device on Matter">
                Stop Announcing
              </button>`
            : ''
        }
      </div>

      <div class="pill-container">
        ${typePill}
        ${dev.isAnnounced ? `<span class="pill announced">UDP ${dev.port}</span>` : ''}
        ${dev.isAnnounced ? `<span class="pill">Disc: ${dev.discriminator}</span>` : ''}
        ${statusPill}
      </div>

      ${metricsHtml}
      ${bodyContent}

      <div class="card-footer">
        ${footerContent}
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fallbackCopyText(text) {
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.top = '0';
    textArea.style.left = '0';
    textArea.style.width = '2em';
    textArea.style.height = '2em';
    textArea.style.padding = '0';
    textArea.style.border = 'none';
    textArea.style.outline = 'none';
    textArea.style.boxShadow = 'none';
    textArea.style.background = 'transparent';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    return successful;
  } catch (err) {
    console.error('Fallback copy failed:', err);
    return false;
  }
}

window.copyToClipboard = async function (text, btn) {
  if (!text || text === 'N/A') {
    const terminal = document.getElementById('logsTerminal');
    if (terminal && terminal.innerText) {
      text = terminal.innerText;
    }
  }
  if (!text || text === 'N/A') return;

  let copied = false;
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch (err) {
      console.warn('navigator.clipboard failed, attempting fallback:', err);
      copied = fallbackCopyText(text);
    }
  } else {
    copied = fallbackCopyText(text);
  }

  if (copied && btn) {
    const orig = btn.textContent;
    const origBg = btn.style.background;
    btn.textContent = 'Copied!';
    btn.style.background = 'var(--success)';
    setTimeout(() => {
      btn.textContent = orig;
      btn.style.background = origBg;
    }, 1500);
  } else if (!copied) {
    window.prompt('Copy to clipboard (Ctrl+C / Cmd+C, Enter):', text);
  }
};

window.togglePairingInfo = function (deviceId) {
  const el = document.getElementById(`pairing-info-${deviceId}`);
  if (!el) return;
  if (expandedPairingInfo.has(deviceId)) {
    expandedPairingInfo.delete(deviceId);
    el.style.display = 'none';
  } else {
    expandedPairingInfo.add(deviceId);
    el.style.display = 'block';
  }
  const btn = document.getElementById(`btn-toggle-pairing-${deviceId}`) || el.previousElementSibling;
  if (btn) {
    btn.textContent = expandedPairingInfo.has(deviceId) ? '✕ Hide Pairing QR & Code' : '📱 Show Pairing QR & Code';
  }
  // Sync render key so next background poll doesn't detect a spurious change
  const query = (searchInput.value || '').trim().toLowerCase();
  lastCardsRenderKey = computeCardsRenderKey(getFilteredDevices(query), query);
};

window.resetNodePairing = async function (deviceId, friendlyName, btn) {
  const confirmMsg = `Reset Matter pairing for "${friendlyName || deviceId}"?\n\nThis will factory-reset the Matter node, wipe existing Google Home fabric credentials, and generate a fresh QR code and pairing code.`;
  if (!confirm(confirmMsg)) return;

  btn.disabled = true;
  const origText = btn.textContent;
  btn.textContent = 'Resetting...';

  try {
    const res = await fetch(`${apiBase}/api/nodes/${encodeURIComponent(deviceId)}/reset`, {
      method: 'POST',
    });
    if (res.ok) {
      expandedPairingInfo.delete(deviceId);
      await fetchNodes();
    } else {
      const data = await res.json().catch(() => ({}));
      alert(`Failed to reset node: ${data.error || 'Server error'}`);
    }
  } catch (err) {
    console.error('Error resetting node:', err);
    alert('Network error while resetting node.');
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
};

window.enableAnnouncement = async function (deviceId, btn) {
  btn.disabled = true;
  btn.textContent = 'Starting Matter Node...';
  try {
    const res = await fetch(`${apiBase}/api/nodes/${encodeURIComponent(deviceId)}/enable`, {
      method: 'POST',
    });
    if (res.ok) {
      await fetchNodes();
    } else {
      alert('Failed to announce Matter node. Check logs for details.');
    }
  } catch (err) {
    console.error('Error enabling node:', err);
  } finally {
    btn.disabled = false;
  }
};

window.disableAnnouncement = async function (deviceId, btn) {
  if (!confirm(`Are you sure you want to stop announcing "${deviceId}" on Matter?`)) {
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Stopping...';
  try {
    const res = await fetch(`${apiBase}/api/nodes/${encodeURIComponent(deviceId)}/disable`, {
      method: 'POST',
    });
    if (res.ok) {
      await fetchNodes();
    }
  } catch (err) {
    console.error('Error disabling node:', err);
  } finally {
    btn.disabled = false;
  }
};

window.toggleDevice = async function (deviceId) {
  try {
    const res = await fetch(`${apiBase}/api/nodes/${encodeURIComponent(deviceId)}/toggle`, {
      method: 'POST',
    });
    if (res.ok) {
      setTimeout(fetchNodes, 300);
    }
  } catch (err) {
    console.error('Toggle failed:', err);
  }
};

window.toggleDeviceChannel = async function (deviceId, entityId) {
  try {
    const res = await fetch(`${apiBase}/api/nodes/${encodeURIComponent(deviceId)}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityId }),
    });
    if (res.ok) {
      setTimeout(fetchNodes, 300);
    }
  } catch (err) {
    console.error('Toggle channel failed:', err);
  }
};

searchInput.addEventListener('input', renderCards);

// Initial load
fetchStatus();
fetchSettings();
fetchNodes();

// Live refresh every 3 seconds
setInterval(() => {
  fetchStatus();
  fetchNodes();
}, 3000);
