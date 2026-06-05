'use strict';

const RAILWAY_URL = "https://web-production-9f27d.up.railway.app/api";

async function checkRailwayStatus() {
  try {
    const res = await fetch(`${RAILWAY_URL}`);
    const data = await res.json();
    console.log('[Railway] ✅ Backend online:', data.status);
    return true;
  } catch (e) {
    console.warn('[Railway] ⚠️ Backend unreachable:', e.message);
    return false;
  }
}

async function analyzeWithAI(sensorData) {
  try {
    const res = await fetch(`${RAILWAY_URL}/ai-analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        temperature: sensorData.temperature,
        soil:        sensorData.soil,
        air_humidity:sensorData.air_humidity,
        light:       sensorData.light,
        node_id:     sensorData.node_id || 'SOL_01',
        lang:        window.APP ? window.APP.lang : 'en'
      })
    });
    const result = await res.json();
    console.log('[ZARAI AI] 🤖 Analysis:', result);
    handleAIResult(result);
    return result;
  } catch (e) {
    console.error('[ZARAI AI] ❌ Failed:', e.message);
    return null;
  }
}

function handleAIResult(result) {
  if (!result) return;

  // Show alerts
  if (result.alerts && result.alerts.length > 0) {
    result.alerts.forEach(alert => {
      showToast(`🔴 ${alert}`, 'error', 8000);
      addLiveAlert({ type: 'critical', field: 'A3', message: alert });
    });
  }

  // Show summary toast
  if (result.summary) {
    const icon = result.status === 'critical' ? '🔴' : result.status === 'warning' ? '🟠' : '✅';
    showToast(`${icon} ${result.summary}`, result.status === 'ok' ? 'ok' : 'warn', 6000);
  }

  // Update AI chat if open
  const chatBox = document.getElementById('chat-messages');
  if (chatBox) {
    const recs = result.recommendations || [];
    const msg = `🤖 **AI Analysis**\n${result.summary}\n\n${recs.map(r => '• ' + r).join('\n')}`;
    appendChatMsg(msg, 'ai');
  }
}

async function initRailway() {
  const online = await checkRailwayStatus();
  if (online) {
    console.log('[Railway] ✅ Connected');
  }
}

// Auto-analyze every 5 minutes with real sensor data
function startAutoAnalysis() {
  setInterval(async () => {
    if (window.FB && window.FB.lastData && window.FB.lastData.SOL_01) {
      const raw = window.FB.lastData.SOL_01;
      await analyzeWithAI({
        temperature:  raw.temp  || raw.temperature,
        soil:         raw.hum_sol || raw.soil_moisture || raw.soil,
        air_humidity: raw.hum_air || raw.humidity || raw.air_humidity,
        light:        raw.lum  || raw.light,
        node_id:      'SOL_01'
      });
    }
  }, 5 * 60 * 1000); // every 5 minutes
}

window.RAILWAY_URL      = RAILWAY_URL;
window.initRailway      = initRailway;
window.analyzeWithAI    = analyzeWithAI;
window.startAutoAnalysis = startAutoAnalysis;
window.checkRailwayStatus = checkRailwayStatus;
