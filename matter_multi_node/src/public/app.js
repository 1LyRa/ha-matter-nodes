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
const countActive = document.getElementById('countActive');
const countInactive = document.getElementById('countInactive');
const searchInput = document.getElementById('searchInput');
const cardsGrid = document.getElementById('cardsGrid');
const filterTabs = document.querySelectorAll('.tab-btn');

let allEntities = [];
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
    allEntities = await res.json();

    const activeCount = allEntities.filter((n) => n.isAnnounced).length;
    const inactiveCount = allEntities.length - activeCount;

    countAll.textContent = allEntities.length;
    countActive.textContent = activeCount;
    countInactive.textContent = inactiveCount;

    renderCards();
  } catch (err) {
    console.error('Failed to fetch nodes:', err);
  }
}

function renderCards() {
  const query = (searchInput.value || '').trim().toLowerCase();

  const filtered = allEntities.filter((node) => {
    // Tab filter
    if (activeTab === 'active' && !node.isAnnounced) return false;
    if (activeTab === 'inactive' && node.isAnnounced) return false;

    // Search query filter
    return (
      node.friendlyName.toLowerCase().includes(query) ||
      node.entityId.toLowerCase().includes(query) ||
      (node.port && String(node.port).includes(query))
    );
  });

  if (filtered.length === 0) {
    if (allEntities.length === 0) {
      cardsGrid.innerHTML = `
        <div class="empty-state">
          <p>No switches discovered from Home Assistant yet.</p>
          <p class="subtitle">Ensure you have entities starting with <code>switch.</code> or <code>input_boolean.</code></p>
        </div>`;
    } else {
      cardsGrid.innerHTML = `
        <div class="empty-state">
          <p>No switches matching "${escapeHtml(query)}" in this tab.</p>
        </div>`;
    }
    return;
  }

  cardsGrid.innerHTML = filtered.map((node) => renderCard(node)).join('');
}

function renderCard(node) {
  if (node.isAnnounced) {
    return renderAnnouncedCard(node);
  } else {
    return renderUnannouncedCard(node);
  }
}

function renderAnnouncedCard(node) {
  const isPaired = node.isCommissioned;
  const statusPill = isPaired
    ? `<span class="pill paired">✓ Paired to Fabric</span>`
    : `<span class="pill ready">⏳ Ready to Pair</span>`;

  let formattedCode = node.manualPairingCode || 'N/A';
  if (formattedCode.length === 11) {
    formattedCode = `${formattedCode.slice(0, 4)}-${formattedCode.slice(4, 7)}-${formattedCode.slice(7)}`;
  }

  return `
    <div class="card" data-entity-id="${escapeHtml(node.entityId)}">
      <div class="card-header">
        <div>
          <div class="card-title">${escapeHtml(node.friendlyName)}</div>
          <div class="card-entity-id">${escapeHtml(node.entityId)}</div>
        </div>
        <button class="btn-stop" onclick="disableAnnouncement('${escapeHtml(node.entityId)}', this)" title="Stop announcing this device on Matter">
          Stop Announcing
        </button>
      </div>

      <div class="pill-container">
        <span class="pill announced">UDP ${node.port}</span>
        <span class="pill">Disc: ${node.discriminator}</span>
        ${statusPill}
      </div>

      <div class="qr-box">
        ${
          node.qrCodeDataUrl
            ? `<img src="${node.qrCodeDataUrl}" alt="Matter QR Code for ${escapeHtml(node.friendlyName)}">`
            : '<div class="spinner"></div>'
        }
      </div>

      <div class="pairing-code-section">
        <div class="code-details">
          <span class="code-label">Manual Pairing Code</span>
          <span class="code-value">${formattedCode}</span>
        </div>
        <button class="btn-copy" onclick="copyToClipboard('${node.manualPairingCode}', this)">Copy</button>
      </div>

      <div class="card-footer">
        <div class="state-indicator">
          <span class="state-dot ${node.isOn ? 'on' : ''}"></span>
          <span>HA State: ${node.isOn ? 'ON' : 'OFF'}</span>
        </div>
        <div class="footer-actions">
          <button class="btn-toggle ${node.isOn ? 'active' : ''}" onclick="toggleDevice('${escapeHtml(node.entityId)}')">
            ${node.isOn ? 'Turn Off' : 'Turn On'}
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderUnannouncedCard(node) {
  return `
    <div class="card unannounced" data-entity-id="${escapeHtml(node.entityId)}">
      <div class="card-header">
        <div>
          <div class="card-title">${escapeHtml(node.friendlyName)}</div>
          <div class="card-entity-id">${escapeHtml(node.entityId)}</div>
        </div>
      </div>

      <div class="pill-container">
        <span class="pill idle">Not Announced</span>
        ${node.port ? `<span class="pill">Assigned: UDP ${node.port}</span>` : ''}
      </div>

      <div class="unannounced-box">
        <p>This device is currently dormant. Enable it to publish its Matter mDNS advertisement and pairing QR code.</p>
        <button class="btn-announce" onclick="enableAnnouncement('${escapeHtml(node.entityId)}', this)">
          ⚡ Announce as Matter Device
        </button>
      </div>

      <div class="card-footer">
        <div class="state-indicator">
          <span class="state-dot ${node.isOn ? 'on' : ''}"></span>
          <span>HA State: ${node.isOn ? 'ON' : 'OFF'}</span>
        </div>
        <div class="footer-actions">
          <button class="btn-toggle ${node.isOn ? 'active' : ''}" onclick="toggleDevice('${escapeHtml(node.entityId)}')">
            ${node.isOn ? 'Turn Off' : 'Turn On'}
          </button>
        </div>
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

window.enableAnnouncement = async function (entityId, btn) {
  btn.disabled = true;
  btn.textContent = 'Starting Matter Node...';
  try {
    const res = await fetch(`${apiBase}/api/nodes/${encodeURIComponent(entityId)}/enable`, {
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

window.disableAnnouncement = async function (entityId, btn) {
  if (!confirm(`Are you sure you want to stop announcing "${entityId}" on Matter?`)) {
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Stopping...';
  try {
    const res = await fetch(`${apiBase}/api/nodes/${encodeURIComponent(entityId)}/disable`, {
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

window.toggleDevice = async function (entityId) {
  try {
    const res = await fetch(`${apiBase}/api/nodes/${encodeURIComponent(entityId)}/toggle`, {
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
