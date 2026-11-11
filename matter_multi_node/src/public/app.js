// Determine API base path to work both under Home Assistant Ingress and direct port access
const apiBase = window.location.pathname.replace(/\/+$/, '');

const haStatusBadge = document.getElementById('haStatusBadge');
const nodeCountBadge = document.getElementById('nodeCountBadge');
const startPortLabel = document.getElementById('startPortLabel');
const searchInput = document.getElementById('searchInput');
const cardsGrid = document.getElementById('cardsGrid');

let allNodes = [];

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

    startPortLabel.textContent = data.startPort || '5541';
  } catch (err) {
    haStatusBadge.textContent = 'HA Offline';
    haStatusBadge.className = 'status-badge connecting';
  }
}

async function fetchNodes() {
  try {
    const res = await fetch(`${apiBase}/api/nodes`);
    if (!res.ok) return;
    allNodes = await res.json();

    const commissionedCount = allNodes.filter(n => n.isCommissioned).length;
    nodeCountBadge.textContent = `${allNodes.length} Nodes (${commissionedCount} Paired)`;

    renderCards();
  } catch (err) {
    console.error('Failed to fetch nodes:', err);
  }
}

function renderCards() {
  const query = (searchInput.value || '').trim().toLowerCase();
  const filtered = allNodes.filter(n => {
    return n.friendlyName.toLowerCase().includes(query) ||
           n.entityId.toLowerCase().includes(query) ||
           String(n.port).includes(query);
  });

  if (filtered.length === 0) {
    if (allNodes.length === 0) {
      cardsGrid.innerHTML = `
        <div class="empty-state">
          <p>No switches discovered from Home Assistant yet.</p>
          <p class="subtitle">Ensure you have entities starting with <code>switch.</code> or <code>input_boolean.</code>, or check add-on configuration.</p>
        </div>`;
    } else {
      cardsGrid.innerHTML = `
        <div class="empty-state">
          <p>No switches matching "${query}".</p>
        </div>`;
    }
    return;
  }

  cardsGrid.innerHTML = filtered.map(node => {
    const isPaired = node.isCommissioned;
    const statusPill = isPaired
      ? `<span class="pill paired">✓ Paired to Fabric</span>`
      : `<span class="pill unpaired">⏳ Ready to Pair</span>`;

    // Format manual code e.g. 3497-011-2332
    let formattedCode = node.manualPairingCode;
    if (formattedCode && formattedCode.length === 11) {
      formattedCode = `${formattedCode.slice(0, 4)}-${formattedCode.slice(4, 7)}-${formattedCode.slice(7)}`;
    }

    return `
      <div class="card" data-entity-id="${node.entityId}">
        <div class="card-header">
          <div>
            <div class="card-title">${escapeHtml(node.friendlyName)}</div>
            <div class="card-entity-id">${escapeHtml(node.entityId)}</div>
          </div>
        </div>

        <div class="pill-container">
          ${statusPill}
          <span class="pill">UDP ${node.port}</span>
          <span class="pill">Disc: ${node.discriminator}</span>
        </div>

        <div class="qr-box">
          ${node.qrCodeDataUrl ? `<img src="${node.qrCodeDataUrl}" alt="Matter QR Code for ${escapeHtml(node.friendlyName)}">` : '<p>Generating QR Code...</p>'}
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
            <span>State: ${node.isOn ? 'ON' : 'OFF'}</span>
          </div>
          <button class="btn-toggle ${node.isOn ? 'active' : ''}" onclick="toggleDevice('${node.entityId}')">
            ${node.isOn ? 'Turn Off' : 'Turn On'}
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

window.copyToClipboard = function(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const originalText = btn.textContent;
    btn.textContent = 'Copied!';
    btn.style.background = '#22c55e';
    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.background = '';
    }, 1500);
  }).catch(err => {
    console.error('Copy failed:', err);
  });
};

window.toggleDevice = async function(entityId) {
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

// Periodic live refresh every 3 seconds
setInterval(() => {
  fetchStatus();
  fetchNodes();
}, 3000);
