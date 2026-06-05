/* ============================================================
   ZARAI – Firebase Realtime Database Connector
   DB URL: https://smartsunflower-e2073-default-rtdb.firebaseio.com
   Path:   /iot/SOL_01/latest
   ============================================================

   HOW IT WORKS:
   ─────────────
   ESP32 / Raspberry Pi writes sensor data to Firebase path:
     /iot/SOL_01/latest → { temperature, humidity, soil, light, ... }

   This file:
   1. Connects to Firebase using the SDK
   2. Listens in REAL-TIME with onValue() — updates instantly when data changes
   3. Maps Firebase fields → ZARAI display elements
   4. Triggers alerts when thresholds exceeded
   5. Falls back to demo mode if Firebase unreachable
   ============================================================ */

'use strict';

/* ============================================================
   🔧 YOUR FIREBASE CONFIG
   Get this from: Firebase Console → Project Settings → Your Apps
   ============================================================ */
const FIREBASE_CONFIG = {
  apiKey:            "PASTE_YOUR_API_KEY_HERE",
  authDomain:        "smartsunflower-e2073.firebaseapp.com",
  databaseURL:       "https://smartsunflower-e2073-default-rtdb.firebaseio.com",
  projectId:         "smartsunflower-e2073",
  storageBucket:     "smartsunflower-e2073.appspot.com",
  messagingSenderId: "PASTE_YOUR_SENDER_ID",
  appId:             "PASTE_YOUR_APP_ID"
};

/* ============================================================
   FIREBASE PATHS — all your sensor nodes
   Add more nodes as you add more ESP32/LoRa devices
   ============================================================ */
const FB_PATHS = {
  // Main sensor nodes (LoRa / ESP32)
  SOL_01: "iot/SOL_01/latest",   // Field A3 — Sunflower
  SOL_02: "iot/SOL_02/latest",   // Field B1 — Wheat       (add when ready)
  SOL_03: "iot/SOL_03/latest",   // Field C2 — Vegetables  (add when ready)
  SOL_04: "iot/SOL_04/latest",   // Field D4 — Sunflower   (add when ready)

  // Camera / AI detection results
  CAM_01: "iot/CAM_01/latest",   // ESP32-CAM Field A3

  // History (if your ESP32 writes timestamped logs)
  HISTORY: "iot/SOL_01/history",
};

/* ============================================================
   FIELD → NODE MAPPING
   Maps your sensor node IDs to ZARAI field display IDs
   ============================================================ */
const NODE_TO_FIELD = {
  SOL_01: "A3",
  SOL_02: "B1",
  SOL_03: "C2",
  SOL_04: "D4",
};

/* ============================================================
   EXPECTED FIREBASE DATA STRUCTURE
   This is what your ESP32/LoRa node should write to Firebase.
   Adjust field names below to match YOUR actual Firebase keys.
   ============================================================

   Example Firebase node at /iot/SOL_01/latest:
   {
     "temperature":   32.5,       // °C
     "humidity":      61.2,       // % air humidity  (or "air_humidity")
     "soil_moisture": 28.3,       // % soil          (or "soil" or "moisture")
     "light":         7.4,        // klux            (or "lux" or "light_intensity")
     "timestamp":     1716000000, // Unix timestamp  (or "time" or "ts")
     "rssi":         -95,         // LoRa signal dBm (optional)
     "battery":       87,         // % battery       (optional)
     "node_id":       "SOL_01"    // node identifier (optional)
   }

   ⚠️ If your keys are different, change the FIELD_MAP below!
   ============================================================ */
const FIELD_MAP = {
  // Firebase key  →  internal name used by ZARAI
  temperature:    "temperature",    // rename if your key differs
  humidity:       "air_humidity",   // "humidity" or "air_humidity" or "hum"
  air_humidity:   "air_humidity",   // accept both
  soil_moisture:  "soil",           // "soil_moisture" or "soil" or "moisture"
  soil:           "soil",           // accept both
  moisture:       "soil",           // accept "moisture" too
  light:          "light",          // "light" or "lux" or "light_intensity"
  lux:            "light",
  light_intensity:"light",
  rssi:           "rssi",
  battery:        "battery",
  timestamp:      "timestamp",
  time:           "timestamp",
  ts:             "timestamp",
};

/* ============================================================
   ALERT THRESHOLDS — customize per your crop needs
   ============================================================ */
const THRESHOLDS = {
  soil: {
    critical: 25,   // below this → red alert "Irrigate NOW"
    warning:  35,   // below this → orange alert "Irrigate soon"
    high:     80,   // above this → "Over-watering risk"
  },
  temperature: {
    low:      10,   // below this → frost risk
    warning:  36,   // above this → heat warning
    critical: 40,   // above this → critical heat
  },
  air_humidity: {
    low:      30,   // too dry
    high:     90,   // too humid → disease risk
  },
  battery: {
    low:      20,   // low battery on node
    critical: 10,
  },
};

/* ============================================================
   FIREBASE STATE
   ============================================================ */
const FB = {
  app:        null,
  db:         null,
  listeners:  {},     // active Firebase listeners
  connected:  false,
  lastData:   {},     // last received data per node
  history:    [],     // chart history buffer
};

/* ============================================================
   INITIALIZE FIREBASE
   ============================================================ */
function initFirebase() {
  // Check if Firebase SDK is loaded
  if (typeof firebase === 'undefined') {
    console.error('[Firebase] SDK not loaded! Check your script tags.');
    startDemoMode();
    return;
  }

  try {
    // Initialize app (avoid duplicate initialization)
    if (!firebase.apps || firebase.apps.length === 0) {
      FB.app = firebase.initializeApp(FIREBASE_CONFIG);
    } else {
      FB.app = firebase.apps[0];
    }

    FB.db = firebase.database();
    console.log('[Firebase] ✅ Connected to smartsunflower-e2073');
    updateConnectionStatus(true);
    stopDemoMode();

    // Start listening to all sensor nodes
    listenToNode('SOL_01');
    // Uncomment when you add more nodes:
    // listenToNode('SOL_02');
    // listenToNode('SOL_03');
    // listenToNode('SOL_04');
    // listenToCamera('CAM_01');

    // Listen to connection state
    firebase.database().ref('.info/connected').on('value', (snap) => {
      FB.connected = snap.val() === true;
      updateConnectionStatus(FB.connected);
      if (FB.connected) {
        stopDemoMode();
        showToast('📡 Firebase connected — live data active', 'ok', 3000);
      } else {
        startDemoMode();
      }
    });

  } catch (err) {
    console.error('[Firebase] Init error:', err);
    showToast('Firebase init error — check your config', 'error', 5000);
    startDemoMode();
  }
}

/* ============================================================
   LISTEN TO A SENSOR NODE IN REAL-TIME
   ============================================================ */
function listenToNode(nodeId) {
  const path    = FB_PATHS[nodeId];
  const fieldId = NODE_TO_FIELD[nodeId];

  if (!path || !fieldId) {
    console.warn(`[Firebase] Unknown node: ${nodeId}`);
    return;
  }

  console.log(`[Firebase] 👂 Listening to ${path} → Field ${fieldId}`);

  const ref = FB.db.ref(path);

  // onValue fires IMMEDIATELY with current data, then on every change
  const listener = ref.on('value', (snapshot) => {
    const raw = snapshot.val();

    if (!raw) {
      console.warn(`[Firebase] No data at ${path}`);
      return;
    }

    console.log(`[Firebase] 📥 ${nodeId}:`, raw);
    FB.lastData[nodeId] = raw;

    // Normalize Firebase keys → ZARAI internal names
    const data = normalizeData(raw);

    // Update all UI elements
    updateFieldDisplay(fieldId, data);

    // Check thresholds → create alerts
    checkThresholds(fieldId, nodeId, data);

    // Add to chart history
    addToHistory(fieldId, data);

    // Update last-seen timestamp
    updateLastSeen(fieldId, data.timestamp);

  }, (error) => {
    console.error(`[Firebase] Read error on ${path}:`, error);
    showToast(`Firebase read error: ${error.message}`, 'error', 5000);
  });

  FB.listeners[nodeId] = { ref, listener };
}

/* ============================================================
   LISTEN TO CAMERA / DISEASE DETECTION NODE
   ============================================================ */
function listenToCamera(nodeId) {
  const path    = FB_PATHS[nodeId];
  const fieldId = NODE_TO_FIELD[nodeId.replace('CAM', 'SOL')];

  if (!path) return;

  FB.db.ref(path).on('value', (snapshot) => {
    const raw = snapshot.val();
    if (!raw) return;

    console.log(`[Firebase] 📷 Camera update ${nodeId}:`, raw);

    const disease = {
      disease:    raw.disease    || raw.disease_name  || 'Unknown',
      confidence: raw.confidence || raw.score         || 0,
      healthy:    raw.healthy    !== undefined ? raw.healthy : (raw.disease === 'Healthy'),
      image_url:  raw.image_url  || raw.photo_url     || null,
    };

    handleDiseaseResult(fieldId || 'A3', disease);
  });
}

/* ============================================================
   NORMALIZE DATA — map Firebase keys to ZARAI internal names
   ============================================================ */
function normalizeData(raw) {
  const data = {};

  // Map each raw Firebase key through FIELD_MAP
  Object.entries(raw).forEach(([key, value]) => {
    const mapped = FIELD_MAP[key.toLowerCase()];
    if (mapped) {
      data[mapped] = value;
    } else {
      // Keep unmapped fields as-is (rssi, battery, node_id, etc.)
      data[key] = value;
    }
  });

  // Ensure numeric types
  if (data.temperature   !== undefined) data.temperature   = parseFloat(data.temperature);
  if (data.soil          !== undefined) data.soil          = parseFloat(data.soil);
  if (data.air_humidity  !== undefined) data.air_humidity  = parseFloat(data.air_humidity);
  if (data.light         !== undefined) data.light         = parseFloat(data.light);
  if (data.battery       !== undefined) data.battery       = parseFloat(data.battery);

  return data;
}

/* ============================================================
   CHECK THRESHOLDS → GENERATE ALERTS
   ============================================================ */
const alertCooldown = {}; // prevent spam

function checkThresholds(fieldId, nodeId, data) {
  const now    = Date.now();
  const coolMs = 5 * 60 * 1000; // 5 min between same alert

  const alert = (type, msg) => {
    const key = `${fieldId}-${type}`;
    if (alertCooldown[key] && now - alertCooldown[key] < coolMs) return;
    alertCooldown[key] = now;

    showToast(
      `${type === 'critical' ? '🔴' : '🟠'} ${msg}`,
      type === 'critical' ? 'error' : 'warn',
      8000
    );
    addLiveAlert({ type, field: fieldId, message: msg });
  };

  // Soil humidity
  if (data.soil !== undefined) {
    if (data.soil < THRESHOLDS.soil.critical) {
      alert('critical', `${t('alert_soil_title')} — ${data.soil.toFixed(1)}%`);
    } else if (data.soil < THRESHOLDS.soil.warning) {
      alert('warning', `Low soil humidity in Field ${fieldId}: ${data.soil.toFixed(1)}%`);
    }
  }

  // Temperature
  if (data.temperature !== undefined) {
    if (data.temperature > THRESHOLDS.temperature.critical) {
      alert('critical', `Critical heat in Field ${fieldId}: ${data.temperature.toFixed(1)}°C`);
    } else if (data.temperature > THRESHOLDS.temperature.warning) {
      alert('warning', `High temperature in Field ${fieldId}: ${data.temperature.toFixed(1)}°C`);
    }
  }

  // Battery
  if (data.battery !== undefined) {
    if (data.battery < THRESHOLDS.battery.critical) {
      alert('critical', `Node ${nodeId} battery critical: ${data.battery}%`);
    } else if (data.battery < THRESHOLDS.battery.low) {
      alert('warning', `Node ${nodeId} battery low: ${data.battery}%`);
    }
  }
}

/* ============================================================
   ADD DATA POINT TO CHART HISTORY
   ============================================================ */
function addToHistory(fieldId, data) {
  const now = new Date();
  const timeLabel = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  FB.history.push({
    time:        timeLabel,
    fieldId,
    temperature: data.temperature,
    soil:        data.soil,
    air_humidity:data.air_humidity,
    light:       data.light,
  });

  // Keep last 100 points
  if (FB.history.length > 100) FB.history.shift();

  // Update chart if it's showing live data
  if (APP.chart && APP.currentChartRange === '24h') {
    addChartPoint({
      temp: data.temperature,
      soil: data.soil,
      air:  data.air_humidity,
    });
  }
}

/* ============================================================
   UPDATE LAST-SEEN TIMESTAMP
   ============================================================ */
function updateLastSeen(fieldId, timestamp) {
  const el = document.getElementById(`sensor-lastseen-${fieldId}`);
  if (!el) return;

  if (timestamp) {
    const d = new Date(typeof timestamp === 'number' && timestamp < 1e12
      ? timestamp * 1000   // Unix seconds → ms
      : timestamp);
    const ago = Math.round((Date.now() - d.getTime()) / 1000);
    if      (ago < 60)   el.textContent = `${ago}s ago`;
    else if (ago < 3600) el.textContent = `${Math.floor(ago/60)}min ago`;
    else                 el.textContent = d.toLocaleTimeString();
  } else {
    el.textContent = 'just now';
  }
}

/* ============================================================
   READ HISTORY FROM FIREBASE (for chart)
   ============================================================ */
async function loadFirebaseHistory(nodeId, hours = 24) {
  if (!FB.db) return [];

  const histPath = `iot/${nodeId}/history`;
  const since    = Date.now() - hours * 3600 * 1000;

  try {
    const snap = await FB.db.ref(histPath)
      .orderByChild('timestamp')
      .startAt(since)
      .limitToLast(288)   // max 288 points (5min × 24h)
      .once('value');

    const raw = snap.val();
    if (!raw) return [];

    return Object.values(raw)
      .map(d => ({
        time:        new Date(d.timestamp * 1000).toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'}),
        temperature: parseFloat(d.temperature || 0),
        soil:        parseFloat(d.soil_moisture || d.soil || 0),
        air:         parseFloat(d.humidity || d.air_humidity || 0),
      }))
      .sort((a, b) => a.timestamp - b.timestamp);

  } catch (e) {
    console.warn('[Firebase] History load failed:', e);
    return [];
  }
}

/* ============================================================
   WRITE DATA TO FIREBASE (for AI recommendations, actions)
   ============================================================ */
async function writeAction(nodeId, action) {
  if (!FB.db) return;

  try {
    await FB.db.ref(`iot/${nodeId}/actions`).push({
      type:      action.type,        // 'irrigate', 'treat', 'alert_ack'
      value:     action.value,       // e.g. duration in minutes
      triggered_by: 'zarai_app',
      timestamp: firebase.database.ServerValue.TIMESTAMP,
    });
    console.log(`[Firebase] ✅ Action written: ${action.type} → ${nodeId}`);
    showToast(`✅ ${action.label || action.type} sent to device`, 'ok');
  } catch (e) {
    console.error('[Firebase] Write error:', e);
    showToast('Failed to send action to device', 'error');
  }
}

/* ============================================================
   STOP ALL LISTENERS (cleanup on logout)
   ============================================================ */
function stopFirebaseListeners() {
  Object.entries(FB.listeners).forEach(([nodeId, { ref, listener }]) => {
    ref.off('value', listener);
    console.log(`[Firebase] Stopped listener: ${nodeId}`);
  });
  FB.listeners = {};
}

/* ============================================================
   EXPOSE GLOBALLY
   ============================================================ */
window.FB           = FB;
window.initFirebase = initFirebase;
window.writeAction  = writeAction;
window.loadFirebaseHistory = loadFirebaseHistory;
window.stopFirebaseListeners = stopFirebaseListeners;
