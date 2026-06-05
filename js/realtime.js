/* ============================================================
   ZARAI – Real-Time Data Connector
   Handles WebSocket from Raspberry Pi + LoRa data display
   ============================================================ */

'use strict';

/* ============================================================
   CONFIG — change PI_IP to your Raspberry Pi's IP address
   ============================================================ */
const CONFIG = {
  PI_IP:          '192.168.1.100',   // ← YOUR RASPBERRY PI IP
  API_PORT:       8000,
  WS_RECONNECT:   3000,              // ms before reconnect
  DEMO_MODE:      true,              // true = use simulated data if Pi unreachable
};

CONFIG.API_URL = `http://${CONFIG.PI_IP}:${CONFIG.API_PORT}/api`;
CONFIG.WS_URL  = `ws://${CONFIG.PI_IP}:${CONFIG.API_PORT}/ws`;

/* ============================================================
   CONNECTION STATE
   ============================================================ */
const CONN = {
  ws:          null,
  connected:   false,
  retries:     0,
  maxRetries:  10,
  demoTimer:   null,
};

/* ============================================================
   CONNECT WEBSOCKET
   ============================================================ */
function connectToBackend() {
  // Try connecting to Pi
  console.log(`[ZARAI] Connecting to ${CONFIG.WS_URL}...`);

  try {
    CONN.ws = new WebSocket(CONFIG.WS_URL);

    CONN.ws.onopen = () => {
      CONN.connected = true;
      CONN.retries   = 0;
      console.log('[ZARAI] ✅ Connected to Raspberry Pi');
      updateConnectionStatus(true);
      stopDemoMode();
    };

    CONN.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch (e) {
        console.error('[ZARAI] Message parse error:', e);
      }
    };

    CONN.ws.onclose = () => {
      CONN.connected = false;
      updateConnectionStatus(false);
      console.warn('[ZARAI] WebSocket closed');

      // Start demo mode while disconnected
      if (CONFIG.DEMO_MODE) startDemoMode();

      // Reconnect
      if (CONN.retries < CONN.maxRetries) {
        CONN.retries++;
        console.log(`[ZARAI] Reconnecting in ${CONFIG.WS_RECONNECT}ms (attempt ${CONN.retries})...`);
        setTimeout(connectToBackend, CONFIG.WS_RECONNECT);
      }
    };

    CONN.ws.onerror = () => {
      console.warn('[ZARAI] Cannot reach Pi — using demo data');
      if (CONFIG.DEMO_MODE) startDemoMode();
    };

  } catch (e) {
    console.warn('[ZARAI] WebSocket not available:', e);
    if (CONFIG.DEMO_MODE) startDemoMode();
  }
}

/* ============================================================
   HANDLE MESSAGES FROM PI
   ============================================================ */
function handleServerMessage(msg) {

  switch (msg.type) {

    // Initial full state when first connecting
    case 'initial_state':
      console.log('[ZARAI] Got initial state from Pi');
      Object.entries(msg.fields || {}).forEach(([fieldId, data]) => {
        updateFieldDisplay(fieldId, data);
      });
      break;

    // Live sensor update from LoRa packet
    case 'sensor_update':
      console.log(`[ZARAI] Sensor update — Field ${msg.field}`);
      updateFieldDisplay(msg.field, msg.data);

      // Show signal info (LoRa RSSI/SNR)
      if (msg.data.rssi) {
        updateSignalBadge(msg.field, msg.data.rssi, msg.data.snr);
      }

      // Handle threshold alerts from backend
      if (msg.alerts && msg.alerts.length > 0) {
        msg.alerts.forEach(alert => {
          const icon = alert.type === 'critical' ? '🔴' : '🟠';
          showToast(`${icon} ${alert.message}`, alert.type === 'critical' ? 'error' : 'warn', 7000);
          addLiveAlert(alert);
        });
      }
      break;

    // Camera / disease detection result
    case 'camera_update':
      console.log(`[ZARAI] Camera update — Field ${msg.field}`);
      handleDiseaseResult(msg.field, msg.disease);
      break;

    // General notification from backend
    case 'notification':
      showToast(msg.message, msg.level || 'ok');
      break;

    default:
      console.log('[ZARAI] Unknown message type:', msg.type);
  }
}

/* ============================================================
   UPDATE ALL UI ELEMENTS FOR A FIELD
   ============================================================ */
function updateFieldDisplay(fieldId, data) {
  if (!data) return;

  // Round values for display
  const temp  = parseFloat(data.temperature  || data.t || 0).toFixed(1);
  const soil  = parseFloat(data.soil         || data.s || 0).toFixed(1);
  const air   = parseFloat(data.air_humidity || data.h || 0).toFixed(1);
  const light = parseFloat(data.light        || data.l || 0).toFixed(1);

  // Store in global APP state
  if (!APP.liveData) APP.liveData = {};
  APP.liveData[fieldId] = { temp, soil, air, light, timestamp: new Date() };

  // ---- Update dashboard stat cards (show first field's data or average) ----
  updateStatCards({ temp, soil, air, light });

  // ---- Update sensor list rows ----
  updateSensorRows(fieldId, { temp, soil, air, light });

  // ---- Update battery if present ----
  if (data.battery !== undefined) {
    const bat = parseFloat(data.battery);
    const batEl = document.getElementById('sensor-val-battery');
    const batBar = document.getElementById('bar-battery');
    const batStatus = document.getElementById('sensor-status-battery');
    if (batEl) batEl.textContent = bat.toFixed(0) + '%';
    if (batBar) {
      batBar.style.width = bat + '%';
      batBar.style.background = bat > 50 ? '#2ECC71' : bat > 20 ? '#DD6B20' : '#E53E3E';
    }
    if (batStatus) {
      batStatus.textContent = bat > 50 ? 'OK' : bat > 20 ? 'LOW' : 'CRITICAL';
      batStatus.className = bat > 50 ? 'badge badge-ok' : bat > 20 ? 'badge badge-warn' : 'badge badge-danger';
    }
  }

  // ---- Update field photo card status dot ----
  updateFieldCard(fieldId, soil);

  // ---- Update map popup if open ----
  updateMapPopup(fieldId, { temp, soil, air, light });

  // ---- Add to chart history ----
  addChartPoint({ temp: parseFloat(temp), soil: parseFloat(soil), air: parseFloat(air) });
}

/* ---- Stat Cards (top row) ---- */
function updateStatCards({ temp, soil, air, light }) {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = val;
      el.classList.add('value-updated');
      setTimeout(() => el.classList.remove('value-updated'), 600);
    }
  };

  set('live-temp',  temp  + '°C');
  set('live-soil',  soil  + '%');
  set('live-air',   air   + '%');
  set('live-light', light + ' klux');

  // Color soil red if below threshold
  const soilEl = document.getElementById('live-soil');
  if (soilEl) soilEl.style.color = parseFloat(soil) < 35 ? 'var(--red)' : 'var(--text-dark)';

  // Update stat sub-text
  updateStatTrend('stat-soil-trend', parseFloat(soil), 35, 65);
  updateStatTrend('stat-temp-trend', parseFloat(temp), 15, 38);

  // Animate sensor bars
  const bar = (id, val, max) => {
    const b = document.getElementById(id);
    if (b) b.style.width = Math.min(100, (val / max) * 100) + '%';
  };
  bar('bar-temp',  parseFloat(temp),  50);
  bar('bar-soil',  parseFloat(soil),  100);
  bar('bar-air',   parseFloat(air),   100);
  bar('bar-light', parseFloat(light), 10);

  // Bar colors
  const soilBar = document.getElementById('bar-soil');
  if (soilBar) soilBar.style.background = parseFloat(soil) < 35 ? '#E53E3E' : '#2ECC71';
  const tempBar = document.getElementById('bar-temp');
  if (tempBar) tempBar.style.background = parseFloat(temp) > 36 ? '#DD6B20' : '#2ECC71';
}

function updateStatTrend(id, val, min, max) {
  const el = document.getElementById(id);
  if (!el) return;
  if (val < min) {
    el.textContent = `⚠ ${t('stat_low')}`;
    el.className = 'stat-trend trend-warn';
  } else if (val > max) {
    el.textContent = `⚠ High`;
    el.className = 'stat-trend trend-down';
  } else {
    el.textContent = `✓ ${t('stat_ok')}`;
    el.className = 'stat-trend trend-up';
  }
}

/* ---- Sensor list rows ---- */
function updateSensorRows(fieldId, { temp, soil, air, light }) {
  // Update displayed values in sensor list
  const rows = {
    'sensor-val-temp':  temp  + '°C',
    'sensor-val-soil':  soil  + '%',
    'sensor-val-air':   air   + '%',
    'sensor-val-light': light + ' klux',
  };
  Object.entries(rows).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  });

  // Update pill statuses
  setSensorStatus('sensor-status-soil', parseFloat(soil), 35, 100);
  setSensorStatus('sensor-status-temp', parseFloat(temp), 10, 38);
}

function setSensorStatus(id, val, min, max) {
  const el = document.getElementById(id);
  if (!el) return;
  if (val < min) {
    el.textContent = t('sensor_low');
    el.className = 'badge badge-warn';
  } else if (val > max) {
    el.textContent = 'HIGH';
    el.className = 'badge badge-danger';
  } else {
    el.textContent = t('sensor_ok');
    el.className = 'badge badge-ok';
  }
}

/* ---- Field photo cards status dots ---- */
function updateFieldCard(fieldId, soil) {
  const dot = document.getElementById(`field-dot-${fieldId}`);
  if (!dot) return;
  const isCritical = parseFloat(soil) < 35;
  dot.style.background = isCritical ? '#E53E3E' : '#2ECC71';
  dot.style.animation  = isCritical ? 'pulseGlow 1.5s infinite' : 'none';

  const label = document.getElementById(`field-label-${fieldId}`);
  if (label) label.textContent = isCritical ? `⚠ Soil ${soil}% — Low` : `✓ Soil ${soil}% — OK`;
}

/* ---- LoRa signal badge ---- */
function updateSignalBadge(fieldId, rssi, snr) {
  const el = document.getElementById('lora-signal');
  if (!el) return;
  const quality = rssi > -100 ? 'Strong' : rssi > -120 ? 'Medium' : 'Weak';
  const icon    = rssi > -100 ? '📶' : rssi > -120 ? '📶' : '📡';
  el.textContent = `${icon} LoRa: ${rssi} dBm (${quality})`;
  el.style.color  = rssi > -100 ? 'var(--green-mid)' : rssi > -120 ? 'var(--orange)' : 'var(--red)';
}

/* ---- Map popup update ---- */
function updateMapPopup(fieldId, { temp, soil }) {
  // Find the field and update its popup content
  const field = FIELDS.find(f => f.id.toLowerCase() === fieldId.toLowerCase());
  if (field) {
    field.temp = parseFloat(temp);
    field.soil = parseFloat(soil);
  }
}

/* ---- Live chart update ---- */
let chartBuffer = [];
function addChartPoint(point) {
  if (!APP.chart) return;
  const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  // Only update 24h view in real-time
  const dataset = APP.chart.data;
  if (dataset.labels.length > 60) {
    dataset.labels.shift();
    dataset.datasets.forEach(d => d.data.shift());
  }

  dataset.labels.push(now);
  dataset.datasets[0].data.push(point.temp);
  dataset.datasets[1].data.push(point.soil);
  dataset.datasets[2].data.push(point.air);

  APP.chart.update('none'); // no animation for smooth live update
}

/* ---- Disease detection ---- */
function handleDiseaseResult(fieldId, disease) {
  if (!disease) return;

  const cameraStatus = document.getElementById('sensor-camera-status');
  if (cameraStatus) {
    if (disease.healthy) {
      cameraStatus.textContent = t('sensor_nodisease');
      cameraStatus.style.color = 'var(--green-mid)';
    } else {
      cameraStatus.textContent = `⚠ ${disease.disease} (${disease.confidence}%)`;
      cameraStatus.style.color = 'var(--red)';
    }
  }

  if (!disease.healthy) {
    showToast(`📷 ${t('nav_ai')}: ${disease.disease} — Field ${fieldId} (${disease.confidence}%)`, 'error', 8000);
    addLiveAlert({
      type:    'critical',
      field:   fieldId,
      message: `${disease.disease} detected in Field ${fieldId} — Confidence: ${disease.confidence}%`
    });
  }
}

/* ---- Add alert to the alerts view dynamically ---- */
function addLiveAlert(alert) {
  const container = document.getElementById('live-alerts-feed');
  if (!container) return;

  const div = document.createElement('div');
  div.className = `alert-row ${alert.type === 'critical' ? 'critical' : 'warning'}`;
  div.style.animation = 'slideIn 0.35s ease both';
  div.innerHTML = `
    <div class="alert-row-icon">${alert.type === 'critical' ? '🔴' : '🟠'}</div>
    <div class="alert-row-body">
      <h5>${alert.message}</h5>
      <p>Field ${alert.field} — ${new Date().toLocaleTimeString()}</p>
    </div>
    <div class="alert-row-time">now</div>
  `;

  // Insert at top
  container.insertBefore(div, container.firstChild);

  // Keep max 10 live alerts
  while (container.children.length > 10) {
    container.removeChild(container.lastChild);
  }

  // Update badge count
  const badge = document.querySelector('.nav-badge');
  const mobBadge = document.querySelector('.mob-nav-badge');
  const count = container.children.length;
  if (badge) badge.textContent = count;
  if (mobBadge) mobBadge.textContent = count;
}

/* ============================================================
   CONNECTION STATUS UI
   ============================================================ */
function updateConnectionStatus(online) {
  // Topbar indicator
  const indicator = document.getElementById('conn-status');
  if (indicator) {
    if (online) {
      indicator.innerHTML = '<span style="color:var(--green-mid);font-size:0.75rem;font-weight:600">🔥 Live</span>';
      indicator.title = 'Connected to Firebase';
    } else {
      indicator.innerHTML = '<span style="color:var(--orange);font-size:0.75rem;font-weight:600">● Demo</span>';
      indicator.title = 'Firebase offline — demo mode';
    }
  }

  // Settings page indicator
  const settingsEl = document.getElementById('conn-status-settings');
  if (settingsEl) {
    if (online) {
      settingsEl.textContent = '● Connected to Firebase';
      settingsEl.style.color = 'var(--green-mid)';
    } else {
      settingsEl.textContent = '● Offline (demo mode)';
      settingsEl.style.color = 'var(--orange)';
    }
  }

  // LoRa signal badge (show Firebase icon instead)
  const loraEl = document.getElementById('lora-signal');
  if (loraEl) {
    loraEl.textContent = online ? '🔥 Firebase' : '📡 Demo';
    loraEl.style.color = online ? 'var(--green-mid)' : 'var(--orange)';
  }
}

/* ============================================================
   DEMO MODE — simulates LoRa data when Pi unreachable
   ============================================================ */
function startDemoMode() {
  if (CONN.demoTimer) return; // already running

  console.log('[ZARAI] Starting demo mode (simulated LoRa data)');
  updateConnectionStatus(false);

  // Simulate one field at a time, rotating
  let fieldIndex = 0;
  CONN.demoTimer = setInterval(() => {
    const field = FIELDS[fieldIndex % FIELDS.length];
    fieldIndex++;

    // Drift values slightly each tick
    field.temp = clamp(field.temp + (Math.random() - 0.5) * 0.4, 18, 42);
    field.soil = clamp(field.soil + (Math.random() - 0.55) * 0.5, 10, 95);

    const data = {
      temperature:  +field.temp.toFixed(1),
      soil:         +field.soil.toFixed(1),
      air_humidity: +(61 + (Math.random() - 0.5) * 3).toFixed(1),
      light:        +(7.4 + (Math.random() - 0.5) * 0.5).toFixed(1),
      rssi:         -90 - Math.floor(Math.random() * 30),
      snr:          +(8 + (Math.random() - 0.5) * 4).toFixed(1),
      source:       'demo',
    };

    updateFieldDisplay(field.id, data);

    // Simulate alert when soil drops
    if (data.soil < 25) {
      addLiveAlert({ type: 'critical', field: field.id, message: `Low soil humidity in Field ${field.id}: ${data.soil}%` });
    }

  }, 4000); // update every 4 seconds in demo
}

function stopDemoMode() {
  if (CONN.demoTimer) {
    clearInterval(CONN.demoTimer);
    CONN.demoTimer = null;
    console.log('[ZARAI] Demo mode stopped — live data active');
  }
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/* ============================================================
   FETCH INITIAL DATA FROM REST API
   ============================================================ */
async function fetchInitialData() {
  try {
    const res = await fetch(`${CONFIG.API_URL}/sensors`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error('API error');
    const json = await res.json();

    Object.entries(json.fields || {}).forEach(([fieldId, data]) => {
      updateFieldDisplay(fieldId, data);
    });

    console.log('[ZARAI] Initial data loaded from API');
  } catch (e) {
    console.warn('[ZARAI] API not reachable — using demo data');
  }
}

/* ============================================================
   MOBILE SIDEBAR TOGGLE
   ============================================================ */
function openSidebar() {
  document.querySelector('.sidebar').classList.add('open');
  document.querySelector('.sidebar-overlay').classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeSidebar() {
  document.querySelector('.sidebar').classList.remove('open');
  document.querySelector('.sidebar-overlay').classList.remove('show');
  document.body.style.overflow = '';
}

/* ============================================================
   MOBILE NAV
   ============================================================ */
function mobileNav(page) {
  navigateTo(page);
  // Update mobile nav active state
  document.querySelectorAll('.mob-nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  // Sync desktop sidebar
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  closeSidebar();
}

/* ============================================================
   VALUE UPDATE FLASH ANIMATION
   ============================================================ */
const style = document.createElement('style');
style.textContent = `
  @keyframes valueFlash {
    0%   { background: rgba(46,204,113,0.25); border-radius: 4px; }
    100% { background: transparent; }
  }
  .value-updated {
    animation: valueFlash 0.6s ease;
  }
`;
document.head.appendChild(style);

/* ============================================================
   EXPOSE TO GLOBAL SCOPE
   ============================================================ */
window.connectToBackend  = connectToBackend;
window.fetchInitialData  = fetchInitialData;
window.updateFieldDisplay= updateFieldDisplay;
window.openSidebar       = openSidebar;
window.closeSidebar      = closeSidebar;
window.mobileNav         = mobileNav;
