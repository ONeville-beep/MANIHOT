/**
 * MANIHOT — Global Namespace, Configuration & Shared State
 */
window.Manihot = window.Manihot || {};

window.Manihot.Config = {
  appVersion: '2.6.0-EUREKA',
  storageKeys: {
    theme: 'manihot_theme_pref',
    thresholds: 'manihot_thermal_thresholds',
    ble: 'manihot_ble_config',
    activeUserId: 'manihot_active_user_id',
    cloudConfig: 'manihot_cloud_config'
  },
  thresholds: {
    targetMin: 38.0,
    targetMax: 41.0,
    criticalMin: 44.0,
    pcmMeltMin: 41.0,
    pcmMeltMax: 44.5
  },
  lightCategories: {
    dimMax: 1000,
    moderateMax: 10000
  },
  ble: {
    deviceNamePrefix: 'MANIHOT',
    serviceUUID: '4fafc201-1fb5-459e-8fcc-c5c9c331914b',
    telemetryCharUUID: 'beb5483e-36e1-4688-b7f5-ea07361b26a8',
    commandCharUUID: '82b99a12-43d1-4a9c-9214-7b1f09d5e821'
  },
  cloud: {
    provider: 'supabase',
    endpointUrl: '',
    anonKey: '',
    isConnected: false
  }
};

window.Manihot.State = {
  currentView: 'overview',
  activeUser: null,
  activeRole: 'PATIENT',
  usersList: [],
  sourceMode: 'SIMULATION',
  session: {
    sessionId: '',
    status: 'ACTIVE',
    startedAtMs: Date.now(),
    accumulatedMs: 0,
    lastResumeMs: Date.now(),
    samplingIntervalMs: 1000,
    totalPackets: 0,
    validPackets: 0,
    invalidPackets: 0,
    duplicatePackets: 0,
    warningCount: 0,
    lastSequence: null,
    lastPacketTimestampIso: null,
    lastValidSample: null,
    actualFreqHz: null,
    currentReadingsBuffer: []
  },
  latestMetrics: {
    t_skin: 39.40,
    t_material: 42.10,
    lux: 18500,
    delta_t: 2.70,
    skin_temp_rate: null,
    material_temp_rate: null,
    quality_status: 'VALID'
  },
  impactFilter: 'all'
};

window.Manihot.escapeHtml = function (str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

window.Manihot.Modals = {
  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const colors = {
      success: 'bg-emerald-600 text-white',
      warning: 'bg-amber-500 text-slate-950',
      error: 'bg-rose-600 text-white',
      info: 'bg-slate-900 text-white dark:bg-slate-800'
    };
    const toast = document.createElement('div');
    toast.className = `pointer-events-auto px-4 py-3 rounded-2xl shadow-lg text-xs font-bold transition-all ${colors[type] || colors.info}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 250);
    }, 3000);
  },

  confirm(title, message, onConfirmCallback) {
    const modal = document.getElementById('confirm-modal');
    document.getElementById('confirm-modal-title').textContent = title;
    document.getElementById('confirm-modal-message').textContent = message;
    document.getElementById('confirm-modal-ok-btn').onclick = () => {
      window.Manihot.Modals.closeConfirm();
      if (typeof onConfirmCallback === 'function') onConfirmCallback();
    };
    modal.classList.remove('hidden');
  },

  closeConfirm() {
    document.getElementById('confirm-modal')?.classList.add('hidden');
  }
};