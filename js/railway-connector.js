/* ============================================================
   ZARAI – Railway Backend Connector
   URL: https://web-production-9f27d.up.railway.app
   ============================================================ */

'use strict';

const RAILWAY_URL = "https://web-production-9f27d.up.railway.app";

/* ============================================================
   CHECK IF BACKEND IS ALIVE
   ============================================================ */
async function checkRailwayStatus() {
  try {
    const res = await fetch(`${RAILWAY_URL}/`);
    const data = await res.json();
    console.log('[Railway] ✅ Backend online:', data.status);
    return true;
  } catch (e) {
    console.warn('[Railway] ⚠️ Backend unreachable:', e.message);
    return false;
  }
}

/* ============================================================
   SEND SENSOR DATA TO BACKEND → FIREBASE
   Called by ESP32 or Raspberry Pi
   ============================================================ */
async function sendSensorData(nodeId, sensorData) {
  try {
    const res = await fetch(`${RAILWAY_URL}/sensors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...sensorData, node_id: nodeId }),
    });
    const data = await res.json();
    console.log('[Railway] ✅ Data sent:', data);
    showToast('📡 Data sent to backend', 'ok', 2000);
    return data;
  } catch (e) {
    console.error('[Railway] ❌ Send failed:', e.message);
    showToast('Backend unreachable — using Firebase directly', 'warn', 3000);
    return null;
  }
}

/* ============================================================
   GET LATEST SENSOR DATA FROM BACKEND
   ============================================================ */
async function getLatestData(nodeId = 'SOL_01') {
  try {
    const res = await fetch(`${RAILWAY_URL}/sensors/${nodeId}`);
    const data = await res.json();
    console.log(`[Railway] 📥 Latest data for ${nodeId}:`, data);
    return data;
  } catch (e) {
    console.error('[Railway] ❌ Fetch failed:', e.message);
    return null;
  }
}

/* ============================================================
   INIT — check backend on app load
   ============================================================ */
async function initRailway() {
  const online = await checkRailwayStatus();
  if (online) {
    showToast('🚀 Railway backend connected', 'ok', 3000);
  }
}

/* ============================================================
   EXPOSE GLOBALLY
   ============================================================ */
window.RAILWAY_URL       = RAILWAY_URL;
window.initRailway       = initRailway;
window.sendSensorData    = sendSensorData;
window.getLatestData     = getLatestData;
window.checkRailwayStatus = checkRailwayStatus;
