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
const countSensors = document.getElementById('countSensors');
const countActive = document.getElementById('countActive');
const countInactive = document.getElementById('countInactive');
const searchInput = document.getElementById('searchInput');
const cardsGrid = document.getElementById('cardsGrid');
const filterTabs = document.querySelectorAll('.tab-btn');

let allDevices = [];
let activeTab = 'all';

// Tab Switching
filterTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    filterTabs.forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    activeTab = tab.getAttribute('data-tab');
    renderCards();
  });
});

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

    const switchCount = allDevices.filter((d) => d.deviceKind === 'switch').length;
    const lightCount = allDevices.filter((d) => d.deviceKind === 'light').length;
    const sensorCount = allDevices.filter((d) => d.deviceKind === 'sensor').length;
    const activeCount = allDevices.filter((d) => d.isAnnounced).length;
    const inactiveCount = allDevices.length - activeCount;

    countAll.textContent = allDevices.length;
    countSwitches.textContent = switchCount;
    if (countLights) countLights.textContent = lightCount;
    countSensors.textContent = sensorCount;
    countActive.textContent = activeCount;
    countInactive.textContent = inactiveCount;

    renderCards();
  } catch (err) {
    console.error('Failed to fetch devices:', err);
  }
}

function renderCards() {
  const query = (searchInput.value || '').trim().toLowerCase();

  const filtered = allDevices.filter((dev) => {
    // Tab filtering
    if (activeTab === 'switch' && dev.deviceKind !== 'switch') return false;
    if (activeTab === 'light' && dev.deviceKind !== 'light') return false;
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

  if (filtered.length === 0) {
    if (allDevices.length === 0) {
      cardsGrid.innerHTML = `
        <div class="empty-state">
          <p>No devices discovered from Home Assistant yet.</p>
          <p class="subtitle">Ensure you have entities starting with <code>switch.</code>, <code>light.</code>, <code>input_boolean.</code>, or temperature/humidity sensors.</p>
        </div>`;
    } else {
      cardsGrid.innerHTML = `
        <div class="empty-state">
          <p>No devices matching "${escapeHtml(query)}" in this tab.</p>
        </div>`;
    }
    return;
  }

  cardsGrid.innerHTML = filtered.map((dev) => renderCard(dev)).join('');
}

function renderCard(dev) {
  const isSwitch = dev.deviceKind === 'switch';
  const isLight = dev.deviceKind === 'light';
  const isSensor = dev.deviceKind === 'sensor';
  const isPaired = dev.isCommissioned;
  const statusPill = isPaired
    ? `<span class="pill paired">✓ Paired to Fabric</span>`
    : dev.isAnnounced
    ? `<span class="pill ready">⏳ Ready to Pair</span>`
    : `<span class="pill idle">Dormant</span>`;

  let typePill = '<span class="pill type-badge">Device</span>';
  if (isSwitch) {
    typePill = '<span class="pill type-badge">Switch</span>';
  } else if (isLight) {
    if (dev.lightType === 'extended_color') {
      typePill = '<span class="pill type-badge">Color Light</span>';
    } else if (dev.lightType === 'color_temp') {
      typePill = '<span class="pill type-badge">White Spectrum Light</span>';
    } else if (dev.lightType === 'dimmable') {
      typePill = '<span class="pill type-badge">Dimmable Light</span>';
    } else {
      typePill = '<span class="pill type-badge">Light</span>';
    }
  } else if (isSensor) {
    typePill = '<span class="pill type-badge">Multi-Sensor</span>';
  }

  let formattedCode = dev.manualPairingCode || 'N/A';
  if (formattedCode.length === 11) {
    formattedCode = `${formattedCode.slice(0, 4)}-${formattedCode.slice(4, 7)}-${formattedCode.slice(7)}`;
  }

  // Metrics block (Sensors & Lights)
  let metricsHtml = '';
  if (isSensor) {
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
                <span class="metric-value">🌡️ ${dev.colorTemp} mireds</span>
              </div>`
            : ''
        }
      </div>
    `;
  }

  // Body content: Announced vs Unannounced
  let bodyContent = '';
  if (dev.isAnnounced) {
    bodyContent = `
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
  } else {
    bodyContent = `
      <div class="unannounced-box">
        <p>This ${isSwitch ? 'switch' : isLight ? 'light' : 'sensor'} is dormant. Announce it to allocate a Matter UDP port and pairing QR code.</p>
        <button class="btn-announce" onclick="enableAnnouncement('${escapeHtml(dev.id)}', this)">
          ⚡ Announce as Matter Device
        </button>
      </div>
    `;
  }

  // Footer content
  let footerContent = '';
  if (isSwitch || isLight) {
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

window.copyToClipboard = function (text, btn) {
  if (!text || text === 'N/A') return;
  navigator.clipboard
    .writeText(text)
    .then(() => {
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      btn.style.background = 'var(--success)';
      setTimeout(() => {
        btn.textContent = orig;
        btn.style.background = '';
      }, 1500);
    })
    .catch((err) => console.error('Copy failed:', err));
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

searchInput.addEventListener('input', renderCards);

// Initial load
fetchStatus();
fetchNodes();

// Live refresh every 3 seconds
setInterval(() => {
  fetchStatus();
  fetchNodes();
}, 3000);
