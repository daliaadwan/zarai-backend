/* ============================================================
   ZARAI – Main Application JavaScript
   Routing · State · Chart · Map · i18n · Theme
   ============================================================ */

'use strict';

/* -------- APP STATE -------- */
const APP = {
  lang:  localStorage.getItem('zarai_lang')  || 'en',
  theme: localStorage.getItem('zarai_theme') || 'light',
  page:  'dashboard',
  user:  { name: 'Jonathan S.', role: 'Farm Manager', initials: 'JS' },
  map:   null,
  chart: null,
  leafletLayer: null,
};

/* -------- SENSOR DATA -------- */
const SENSOR_DATA = {
  temperature: 32,
  soilHumidity: 28,
  airHumidity: 61,
  light: 7.4,
};

const FIELDS = [
  { id:'a3', name:'🌻 Sunflower A3', lat:36.302, lng:6.598, color:'#DD6B20', status:'warn',   ha:'4.2', soil:28,  temp:32 },
  { id:'b1', name:'🌾 Wheat B1',     lat:36.315, lng:6.612, color:'#E53E3E', status:'danger', ha:'3.1', soil:55,  temp:31 },
  { id:'c2', name:'🥬 Vegetables C2',lat:36.295, lng:6.618, color:'#2ECC71', status:'ok',     ha:'1.5', soil:62,  temp:30 },
  { id:'d4', name:'🌻 Sunflower D4', lat:36.308, lng:6.585, color:'#2ECC71', status:'ok',     ha:'5.0', soil:48,  temp:33 },
];

const CHART_DATA = {
  '24h': {
    labels: ['00','02','04','06','08','10','12','14','16','18','20','22'],
    temp:   [24,23,22,24,26,29,31,32,33,32,30,28],
    soil:   [55,53,50,48,42,38,33,30,28,27,26,28],
    air:    [72,70,68,65,62,60,58,60,61,62,63,61],
  },
  '7d': {
    labels: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
    temp:   [29,31,33,30,28,26,30],
    soil:   [50,45,38,30,28,32,40],
    air:    [65,62,58,61,67,70,64],
  },
  '30d': {
    labels: Array.from({length:30},(_,i)=>`D${i+1}`),
    temp:   Array.from({length:30},()=>Math.round(25+Math.random()*12)),
    soil:   Array.from({length:30},()=>Math.round(25+Math.random()*40)),
    air:    Array.from({length:30},()=>Math.round(50+Math.random()*30)),
  },
};

/* ====================================================
   TRANSLATION HELPER
   ==================================================== */
function t(key) {
  const T = window.TRANSLATIONS;
  return (T[APP.lang] && T[APP.lang][key]) ? T[APP.lang][key] : (T['en'][key] || key);
}

/* ====================================================
   APPLY LANGUAGE
   ==================================================== */
function applyLang(lang) {
  APP.lang = lang;
  localStorage.setItem('zarai_lang', lang);

  const isRtl = lang === 'ar';
  document.documentElement.lang = lang;
  document.body.classList.toggle('rtl', isRtl);
  document.body.setAttribute('dir', isRtl ? 'rtl' : 'ltr');

  // Update all data-i18n elements
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const val = t(key);
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.placeholder = val;
    } else {
      el.textContent = val;
    }
  });

  // Update all data-i18n-placeholder
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });

  // Sync language selectors
  document.querySelectorAll('.lang-select').forEach(s => { s.value = lang; });
}

/* ====================================================
   APPLY THEME
   ==================================================== */
function applyTheme(theme) {
  APP.theme = theme;
  localStorage.setItem('zarai_theme', theme);
  document.documentElement.setAttribute('data-theme', theme);

  // Sync toggles
  const tog = document.getElementById('dark-mode-toggle');
  if (tog) tog.checked = theme === 'dark';
}

function toggleTheme() {
  applyTheme(APP.theme === 'dark' ? 'light' : 'dark');
}

/* ====================================================
   ROUTING
   ==================================================== */
function navigateTo(page) {
  APP.page = page;

  // Update sidebar active
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });

  // Show/hide views
  document.querySelectorAll('.page-view, .page-view-map').forEach(v => v.classList.remove('active'));

  const target = document.getElementById('view-' + page);
  if (target) target.classList.add('active');

  // Lazy-init sub-modules
  if (page === 'dashboard') initDashboard();
  if (page === 'mapview')   initMap();
  if (page === 'ai')        initAI();
}

/* ====================================================
   TOAST NOTIFICATIONS
   ==================================================== */
function showToast(msg, type = 'ok', duration = 3500) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type !== 'ok' ? type : ''}`;
  const icons = { ok: '✅', warn: '⚠️', error: '🔴' };
  toast.innerHTML = `<span>${icons[type] || '✅'}</span><span>${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(30px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 320);
  }, duration);
}

/* ====================================================
   DASHBOARD
   ==================================================== */
function initDashboard() {
  if (!document.getElementById('trend-chart')) return;
  if (APP.chart) return; // Already initialised
  buildChart('24h');
}

function buildChart(range) {
  const ctx = document.getElementById('trend-chart');
  if (!ctx) return;
  const d = CHART_DATA[range];

  const isDark = APP.theme === 'dark';
  const gridColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)';
  const tickColor = isDark ? 'rgba(232,245,238,0.5)' : '#7A8C7A';

  if (APP.chart) APP.chart.destroy();

  APP.chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: d.labels,
      datasets: [
        {
          label: t('sensor_temp') + ' (°C)',
          data: d.temp,
          borderColor: '#2ECC71',
          backgroundColor: 'rgba(46,204,113,0.07)',
          tension: 0.4, fill: true, pointRadius: 3, pointBackgroundColor: '#2ECC71',
        },
        {
          label: t('sensor_soil') + ' (%)',
          data: d.soil,
          borderColor: '#DD6B20',
          backgroundColor: 'rgba(221,107,32,0.07)',
          tension: 0.4, fill: true, pointRadius: 3, pointBackgroundColor: '#DD6B20',
        },
        {
          label: t('sensor_air') + ' (%)',
          data: d.air,
          borderColor: '#3182CE',
          backgroundColor: 'rgba(49,130,206,0.06)',
          tension: 0.4, fill: true, pointRadius: 3, pointBackgroundColor: '#3182CE',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: tickColor, font: { size: 11, family: 'DM Sans' }, boxWidth: 14 } },
      },
      scales: {
        x: { ticks: { color: tickColor, font: { size: 10 } }, grid: { color: gridColor } },
        y: { ticks: { color: tickColor, font: { size: 10 } }, grid: { color: gridColor } },
      },
    },
  });
}

function setChartRange(btn, range) {
  document.querySelectorAll('.time-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (APP.chart) APP.chart.destroy();
  APP.chart = null;
  buildChart(range);
}

/* ====================================================
   LEAFLET MAP
   ==================================================== */
const MAP_LAYERS = {
  satellite: () => L.tileLayer(
    'https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}',
    { maxZoom:20, subdomains:['mt0','mt1','mt2','mt3'], attribution:'© Google' }
  ),
  terrain: () => L.tileLayer(
    'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    { maxZoom:17, attribution:'© OpenTopoMap' }
  ),
  street: () => L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxZoom:19, attribution:'© OpenStreetMap' }
  ),
};

function initMap() {
  if (APP.map) return;
  const container = document.getElementById('leaflet-map');
  if (!container) return;

  APP.map = L.map(container, { zoomControl: false }).setView([36.305, 6.601], 13);
  L.control.zoom({ position: 'bottomright' }).addTo(APP.map);

  APP.leafletLayer = MAP_LAYERS.satellite();
  APP.leafletLayer.addTo(APP.map);

  // Inject popup styles
  const s = document.createElement('style');
  s.textContent = `
    .zarai-popup .leaflet-popup-content-wrapper {
      background:#fff; border:1.5px solid #DDD5C8; border-radius:14px;
      color:#1A2E1A; font-family:'DM Sans',sans-serif; font-size:13px;
      box-shadow:0 6px 28px rgba(0,0,0,0.12);
    }
    .zarai-popup .leaflet-popup-tip { background:#fff; }
    @keyframes markerPulse { 0%,100%{transform:scale(1);opacity:0.35} 50%{transform:scale(2.2);opacity:0} }
  `;
  document.head.appendChild(s);

  FIELDS.forEach(f => addFieldMarker(f));
}

function addFieldMarker(f) {
  const pulse = f.status !== 'ok';
  const icon = L.divIcon({
    html: `<div style="position:relative">
      ${pulse ? `<div style="position:absolute;width:32px;height:32px;border-radius:50%;background:${f.color};top:-8px;left:-8px;animation:markerPulse 2s infinite"></div>` : ''}
      <div style="width:16px;height:16px;border-radius:50%;background:${f.color};border:3px solid white;box-shadow:0 0 10px ${f.color}"></div>
    </div>`,
    className: '', iconSize: [16,16], iconAnchor: [8,8],
  });

  const popup = `
    <div style="min-width:190px">
      <b style="font-size:14px">${f.name}</b><br>
      <div style="margin:8px 0;display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px">
        <div style="background:#f7f3ee;border-radius:8px;padding:6px;text-align:center">
          <div style="font-size:18px">🌡️</div>
          <div style="font-weight:700">${f.temp}°C</div>
          <div style="color:#7A8C7A;font-size:11px">Temp</div>
        </div>
        <div style="background:#f7f3ee;border-radius:8px;padding:6px;text-align:center">
          <div style="font-size:18px">💧</div>
          <div style="font-weight:700;color:${f.soil<35?'#DD6B20':'#2ECC71'}">${f.soil}%</div>
          <div style="color:#7A8C7A;font-size:11px">Soil</div>
        </div>
      </div>
      <div style="font-size:12px;color:#7A8C7A">📐 ${f.ha} ha</div>
    </div>
  `;

  L.marker([f.lat, f.lng], { icon })
    .addTo(APP.map)
    .bindPopup(popup, { className: 'zarai-popup', maxWidth: 220 });
}

function setMapLayer(btn, type) {
  document.querySelectorAll('.map-layer-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (APP.map && APP.leafletLayer) APP.map.removeLayer(APP.leafletLayer);
  APP.leafletLayer = MAP_LAYERS[type]();
  if (APP.map) APP.leafletLayer.addTo(APP.map);
}

function focusField(fieldId, el) {
  document.querySelectorAll('.map-field-row').forEach(r => r.classList.remove('active'));
  el.classList.add('active');
  const f = FIELDS.find(x => x.id === fieldId);
  if (f && APP.map) APP.map.setView([f.lat, f.lng], 16, { animate: true });
}

/* ====================================================
   AI CHAT
   ==================================================== */
const AI_RESPONSES = {
  en: [
    "Based on current sensor data, I recommend checking your irrigation schedule. Soil humidity in Field A3 is at 28% — below the 35% threshold. Irrigate before 8 AM for best results.",
    "ESP32 cameras show no new disease activity in the last 30 minutes. All cameras are operating normally. Field B1 shows early mildew signs — treatment within 48h is advised.",
    "For optimal yield this season, increase irrigation frequency for sunflower fields by 15% given the upcoming dry period and heat wave on Tuesday.",
    "I've detected a slight humidity drop in Field D4 sensors. This is within normal variation but I'll keep monitoring. No action needed at this time.",
    "Weather forecast analysis: Tuesday will see 38°C peak temperatures. I recommend pre-irrigating all fields Monday evening and installing shade nets on sunflower plots.",
  ],
  fr: [
    "Selon les données capteurs, la rطوبة du sol du champ A3 est à 28% — sous le seuil. Irriguer avant 8h est recommandé.",
    "Les caméras ESP32 ne détectent aucune nouvelle maladie. Le champ B1 montre des signes précoces de mildiou — traitement dans 48h conseillé.",
    "Pour maximiser le rendement, augmentez la fréquence d'irrigation de 15% pour les champs de tournesol vu la vague de chaleur prévue.",
    "Légère baisse d'humidité détectée dans D4. Dans la variation normale — surveillance continue.",
    "Analyse météo : 38°C mardi. Pré-irriguer lundi soir et installer des filets d'ombrage.",
  ],
  ar: [
    "وفقاً لبيانات الحساسات، رطوبة تربة الحقل A3 عند 28% — أقل من الحد الأدنى. يُنصح بالري قبل الساعة 8 صباحاً.",
    "كاميرات ESP32 لا تكشف أي أمراض جديدة. الحقل B1 يُظهر علامات بياض دقيقي مبكر — العلاج خلال 48 ساعة ضروري.",
    "لأفضل إنتاج هذا الموسم، زِد تواتر الري بنسبة 15% لحقول عباد الشمس نظراً لموجة الحر المتوقعة.",
    "انخفاض طفيف في رطوبة D4 — ضمن التباين الطبيعي، المراقبة مستمرة.",
    "تحليل الطقس: 38 درجة يوم الثلاثاء. يُنصح بالري المسبق ليلة الاثنين وتركيب شبكات التظليل.",
  ],
};

function initAI() {
  // Nothing to lazy-init beyond what HTML provides
}

function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;

  appendChatMsg(msg, 'user');
  input.value = '';

  // Simulate typing delay
  const typingEl = appendChatMsg('...', 'ai', true);
  const responses = AI_RESPONSES[APP.lang] || AI_RESPONSES['en'];
  const reply = responses[Math.floor(Math.random() * responses.length)];

  setTimeout(() => {
    typingEl.remove();
    appendChatMsg(reply, 'ai');
  }, 900 + Math.random() * 600);
}

function appendChatMsg(text, sender, isTyping = false) {
  const box = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `chat-msg ${sender}`;
  const av = sender === 'ai'
    ? `<div class="chat-msg-av">🤖</div>`
    : `<div class="chat-msg-av" style="background:linear-gradient(135deg,#4a6280,#2c3e50)">${APP.user.initials}</div>`;
  div.innerHTML = `${sender === 'user' ? '' : av}
    <div class="chat-bubble" style="${isTyping ? 'color:var(--text-muted);font-style:italic' : ''}">${text}</div>
    ${sender === 'user' ? av : ''}`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return div;
}

/* ====================================================
   LOGIN
   ==================================================== */
function doLogin(e) {
  if (e) e.preventDefault();
  const user = document.getElementById('login-username').value.trim();
  const pass = document.getElementById('login-password').value.trim();

  if (!user || !pass) {
    showToast(APP.lang === 'ar' ? 'يرجى ملء جميع الحقول' : APP.lang === 'fr' ? 'Veuillez remplir tous les champs' : 'Please fill in all fields', 'warn');
    return;
  }

  document.getElementById('login-btn-text').textContent =
    APP.lang === 'ar' ? 'جارٍ الدخول...' : APP.lang === 'fr' ? 'Connexion...' : 'Logging in...';

  setTimeout(() => {
    document.getElementById('login-page').classList.remove('active');
    document.getElementById('app-page').classList.add('active');
    navigateTo('dashboard');
    applyLang(APP.lang);

    // Update user display
    document.querySelectorAll('.user-name-display').forEach(el => el.textContent = user || APP.user.name);
    document.querySelectorAll('.user-avatar-display').forEach(el => el.textContent = (user[0] || 'J').toUpperCase() + (user[1] || 'S').toUpperCase());

    showToast(
      APP.lang === 'ar' ? `أهلاً، ${user}! 🌿` : APP.lang === 'fr' ? `Bienvenue, ${user}! 🌿` : `Welcome back, ${user}! 🌿`
    );
  }, 700);
}

function doLogout() {
  document.getElementById('app-page').classList.remove('active');
  document.getElementById('login-page').classList.add('active');
  document.getElementById('login-btn-text').textContent = t('login_btn');
  APP.map = null;
  APP.chart = null;
}

function togglePassword() {
  const input = document.getElementById('login-password');
  const btn = document.querySelector('.eye-toggle svg use, .eye-toggle svg');
  input.type = input.type === 'password' ? 'text' : 'password';
}

/* ====================================================
   ALERTS PAGE
   ==================================================== */
function filterAlerts(btn, type) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active', 'fa', 'fw', 'fg'));
  btn.classList.add('active');
  if (type === 'critical') btn.classList.add('fa');
  if (type === 'warning')  btn.classList.add('fa', 'fw');
  if (type === 'info')     btn.classList.add('fa', 'fg');

  document.querySelectorAll('.alert-full-card').forEach(card => {
    card.style.display = (type === 'all' || card.classList.contains(type)) ? '' : 'none';
  });
}

function exportPDF() {
  showToast(t('export_pdf') + ' — ' + (APP.lang === 'ar' ? 'جارٍ التصدير...' : APP.lang === 'fr' ? 'Export en cours...' : 'Generating...'), 'ok');
}

function exportCSV() {
  const headers = ['Field','Temperature','Soil Humidity','Air Humidity','Light','Date'];
  const rows = FIELDS.map(f => [f.name, f.temp+'°C', f.soil+'%', '61%', '7.4klux', new Date().toLocaleDateString()]);
  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'zarai-data.csv'; a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exported!', 'ok');
}

/* ====================================================
   SETTINGS
   ==================================================== */
function saveSettings() {
  showToast(
    APP.lang === 'ar' ? 'تم حفظ الإعدادات ✓' : APP.lang === 'fr' ? 'Paramètres enregistrés ✓' : 'Settings saved ✓',
    'ok'
  );
}

/* ====================================================
   SIMULATE LIVE SENSOR UPDATE
   ==================================================== */
function simulateLiveSensors() {
  setInterval(() => {
    const drift = (v, d) => Math.max(0, Math.min(100, v + (Math.random()-0.5)*d));
    SENSOR_DATA.temperature   = +(SENSOR_DATA.temperature   + (Math.random()-0.5)*0.4).toFixed(1);
    SENSOR_DATA.soilHumidity  = +(SENSOR_DATA.soilHumidity  + (Math.random()-0.55)*0.3).toFixed(1);
    SENSOR_DATA.airHumidity   = +(SENSOR_DATA.airHumidity   + (Math.random()-0.5)*0.3).toFixed(1);
    SENSOR_DATA.light         = +(SENSOR_DATA.light         + (Math.random()-0.5)*0.1).toFixed(1);

    // Update displayed values
    const el = (id) => document.getElementById(id);
    if (el('live-temp'))  el('live-temp').textContent  = SENSOR_DATA.temperature + '°C';
    if (el('live-soil'))  el('live-soil').textContent  = SENSOR_DATA.soilHumidity + '%';
    if (el('live-air'))   el('live-air').textContent   = SENSOR_DATA.airHumidity + '%';
    if (el('live-light')) el('live-light').textContent = SENSOR_DATA.light + ' klux';

    // Sensor bars
    const sb = (id, val) => { const b = document.getElementById(id); if(b) b.style.width = val+'%'; };
    sb('bar-temp',  (SENSOR_DATA.temperature / 50) * 100);
    sb('bar-soil',   SENSOR_DATA.soilHumidity);
    sb('bar-air',    SENSOR_DATA.airHumidity);
    sb('bar-light', (SENSOR_DATA.light / 10) * 100);

    // Low soil warning
    if (SENSOR_DATA.soilHumidity < 25) {
      const msg = APP.lang === 'ar' ? '⚠ رطوبة التربة منخفضة جداً!' : APP.lang === 'fr' ? '⚠ Humidité sol très basse!' : '⚠ Soil humidity critically low!';
      showToast(msg, 'warn', 5000);
    }
  }, 5000);
}

/* ====================================================
   BOOT
   ==================================================== */
document.addEventListener('DOMContentLoaded', () => {
  // Theme
  applyTheme(APP.theme);

  // Login page language selector
  const loginLang = document.getElementById('login-lang');
  if (loginLang) {
    loginLang.value = APP.lang;
    loginLang.addEventListener('change', e => {
      applyLang(e.target.value);
      applyLang(e.target.value); // double call ensures all elements updated
    });
  }

  // Apply saved language to login page
  applyLang(APP.lang);

  // Topbar language selectors
  document.querySelectorAll('.lang-select').forEach(sel => {
    sel.addEventListener('change', e => applyLang(e.target.value));
  });

  // Dark mode toggle in settings
  const dmToggle = document.getElementById('dark-mode-toggle');
  if (dmToggle) {
    dmToggle.checked = APP.theme === 'dark';
    dmToggle.addEventListener('change', () => applyTheme(dmToggle.checked ? 'dark' : 'light'));
  }

  // Chat input — send on Enter
  const chatInput = document.getElementById('chat-input');
  if (chatInput) {
    chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendChatMessage(); });
  }

  // Login form
  const loginForm = document.getElementById('login-form');
  if (loginForm) loginForm.addEventListener('submit', doLogin);

  // Simulation désactivée — données Firebase réelles utilisées
  // simulateLiveSensors();
   
  // Connect to Railway backend
  initRailway();
startAutoAnalysis();

// Première analyse immédiate après 10 secondes
setTimeout(async () => {
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
}, 10000);

  // Animate sensor bars on load
  setTimeout(() => {
    const sb = (id, val) => { const b = document.getElementById(id); if(b) b.style.width = val+'%'; };
    sb('bar-temp',  (SENSOR_DATA.temperature / 50) * 100);
    sb('bar-soil',   SENSOR_DATA.soilHumidity);
    sb('bar-air',    SENSOR_DATA.airHumidity);
    sb('bar-light', (SENSOR_DATA.light / 10) * 100);
  }, 400);
});
