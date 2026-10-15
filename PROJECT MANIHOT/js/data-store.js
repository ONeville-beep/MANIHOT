/**
 * @file data-store.js
 * @description Pengelola state telemetri terpusat, riwayat sampel terbatas (ring buffer),
 * pencatatan log sistem, ekspor CSV, dan sinkronisasi antartab menggunakan
 * BroadcastChannel serta localStorage.
 */

import {
  STORAGE_KEYS,
  BROADCAST_CHANNEL_NAME,
  loadActiveConfig,
  validateConfig
} from './config.js';
import {
  validateSensorSample,
  calculateDeltaTemp,
  calculateHeatingRate,
  computeSessionStatistics
} from './calculations.js';

class ManihotDataStore {
  constructor() {
    this.tabId = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.config = loadActiveConfig();
    this.listeners = new Set();

    this.state = {
      sessionActive: false,
      sessionStartTime: null,
      sourceMode: 'IDLE', // 'IDLE' | 'DEMO' | 'HARDWARE'
      demoScenario: 'NORMAL',
      connectionStatus: 'DISCONNECTED', // 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR'
      deviceName: null,
      lastSample: null,
      sampleCounter: 0,
      controllerTabId: null
    };

    this.history = [];
    this.logs = [];

    this.channel = typeof BroadcastChannel !== 'undefined'
      ? new BroadcastChannel(BROADCAST_CHANNEL_NAME)
      : null;

    this._hydrateFromStorage();
    this._setupSyncListeners();
  }

  /**
   * Memulihkan snapshot terakhir dari localStorage saat halaman baru dibuka.
   */
  _hydrateFromStorage() {
    try {
      const rawSnap = localStorage.getItem(STORAGE_KEYS.STATE_SNAPSHOT);
      if (rawSnap) {
        const parsedSnap = JSON.parse(rawSnap);
        this.state = { ...this.state, ...parsedSnap };
      }

      const rawHist = localStorage.getItem(STORAGE_KEYS.HISTORY);
      if (rawHist) {
        const parsedHist = JSON.parse(rawHist);
        if (Array.isArray(parsedHist)) {
          this.history = parsedHist.slice(-this.config.maxHistorySamples);
        }
      }

      const rawLogs = localStorage.getItem(STORAGE_KEYS.LOGS);
      if (rawLogs) {
        const parsedLogs = JSON.parse(rawLogs);
        if (Array.isArray(parsedLogs)) {
          this.logs = parsedLogs.slice(-this.config.maxLogEntries);
        }
      }
    } catch (err) {
      // Abaikan jika storage korup dan mulai dengan state bersih
    }
  }

  /**
   * Mengatur pendengar BroadcastChannel dan event storage lintas tab pada origin yang sama.
   */
  _setupSyncListeners() {
    if (this.channel) {
      this.channel.onmessage = (event) => {
        const msg = event.data;
        if (!msg || msg.senderTabId === this.tabId) return;
        this._handleIncomingSyncMessage(msg);
      };
    }

    window.addEventListener('storage', (event) => {
      if (event.key === STORAGE_KEYS.STATE_SNAPSHOT || event.key === STORAGE_KEYS.CONFIG) {
        this.config = loadActiveConfig();
        this._hydrateFromStorage();
        this._notifyListeners('STORAGE_SYNC');
      }
    });
  }

  _handleIncomingSyncMessage(msg) {
    switch (msg.type) {
      case 'STATE_UPDATED':
        this.state = { ...this.state, ...msg.payload.state };
        if (msg.payload.latestSample) {
          const lastInHist = this.history[this.history.length - 1];
          if (!lastInHist || lastInHist.sampleNumber !== msg.payload.latestSample.sampleNumber) {
            this.history.push(msg.payload.latestSample);
            if (this.history.length > this.config.maxHistorySamples) {
              this.history.shift();
            }
          }
        }
        this._notifyListeners('REMOTE_STATE_UPDATED');
        break;

      case 'HISTORY_CLEARED':
        this.history = [];
        this.state.lastSample = null;
        this.state.sampleCounter = 0;
        this._notifyListeners('HISTORY_CLEARED');
        break;

      case 'LOG_ADDED':
        if (msg.payload) {
          this.logs.push(msg.payload);
          if (this.logs.length > this.config.maxLogEntries) {
            this.logs.shift();
          }
          this._notifyListeners('LOG_ADDED');
        }
        break;

      case 'CONFIG_UPDATED':
        this.config = loadActiveConfig();
        this._notifyListeners('CONFIG_UPDATED');
        break;

      case 'REMOTE_COMMAND':
        this._notifyListeners('REMOTE_COMMAND', msg.payload);
        break;

      default:
        break;
    }
  }

  _persistAndBroadcast(type, payload = {}) {
    try {
      localStorage.setItem(STORAGE_KEYS.STATE_SNAPSHOT, JSON.stringify(this.state));
      localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(this.history));
      localStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(this.logs));
    } catch (err) {
      // Tangani batas kuota localStorage dengan memangkas separuh riwayat lama
      if (this.history.length > 20) {
        this.history = this.history.slice(-Math.floor(this.history.length / 2));
      }
    }

    if (this.channel) {
      this.channel.postMessage({
        type,
        senderTabId: this.tabId,
        timestamp: Date.now(),
        payload
      });
    }
  }

  /**
   * Mendaftarkan callback pembaruan UI.
   * @param {Function} callback
   * @returns {Function} Fungsi unsubscribe
   */
  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  _notifyListeners(eventType, extra = null) {
    for (const cb of this.listeners) {
      try {
        cb(this.getSnapshot(), eventType, extra);
      } catch (err) {
        // Jangan biarkan error satu listener menghentikan listener lain
      }
    }
  }

  /**
   * Memeriksa apakah sampel terakhir telah kedaluwarsa berdasarkan konfigurasi aktif.
   * @returns {boolean}
   */
  isDataStale() {
    if (!this.state.lastSample || !this.state.lastSample.timestamp) {
      return true;
    }
    const ageMs = Date.now() - Number(this.state.lastSample.timestamp);
    return ageMs > this.config.staleDataThresholdMs;
  }

  /**
   * Mengambil snapshot lengkap state, riwayat, log, dan statistik untuk kebutuhan render UI.
   */
  getSnapshot() {
    const isStale = this.isDataStale();
    const stats = computeSessionStatistics(this.history, this.config);
    return {
      tabId: this.tabId,
      config: { ...this.config },
      state: { ...this.state },
      isStale,
      history: [...this.history],
      logs: [...this.logs],
      stats
    };
  }

  /**
   * Mencatat log peristiwa teknis dengan timestamp dan kategori.
   * @param {'INFO'|'WARN'|'ERROR'} level
   * @param {string} category
   * @param {string} message
   */
  addLog(level, category, message) {
    const entry = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      level,
      category,
      message
    };

    this.logs.push(entry);
    if (this.logs.length > this.config.maxLogEntries) {
      this.logs.shift();
    }

    this._persistAndBroadcast('LOG_ADDED', entry);
    this._notifyListeners('LOG_ADDED', entry);
  }

  /**
   * Mengubah status sesi dan koneksi perangkat.
   * @param {Object} partialState
   */
  updateSystemState(partialState) {
    this.state = {
      ...this.state,
      ...partialState
    };
    this._persistAndBroadcast('STATE_UPDATED', { state: this.state, latestSample: null });
    this._notifyListeners('STATE_UPDATED');
  }

  /**
   * Mengirimkan perintah antar-tab (misal Patient Interface meminta mulai/henti sesi).
   * @param {string} commandName
   * @param {Object} options
   */
  sendCommand(commandName, options = {}) {
    const cmdPayload = { commandName, options, requestedBy: this.tabId, timestamp: Date.now() };
    if (this.channel) {
      this.channel.postMessage({
        type: 'REMOTE_COMMAND',
        senderTabId: this.tabId,
        timestamp: Date.now(),
        payload: cmdPayload
      });
    }
    this._notifyListeners('REMOTE_COMMAND', cmdPayload);
  }

  /**
   * Memproses, memvalidasi, menghitung turunan matematis, dan menyimpan sampel telemetri baru.
   * @param {Object} rawInput { timestamp, tempMaterial, tempSkin, illuminance, sourceMode, isSimulated }
   */
  ingestTelemetrySample(rawInput) {
    const timestamp = Number(rawInput.timestamp) || Date.now();
    const validation = validateSensorSample({ ...rawInput, timestamp }, this.config);

    // Cari sampel valid terakhir untuk perhitungan dT/dt
    let prevValidSample = null;
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].isValid) {
        prevValidSample = this.history[i];
        break;
      }
    }

    const tempMaterial = Number.isFinite(Number(rawInput.tempMaterial))
      ? Number(Number(rawInput.tempMaterial).toFixed(2))
      : null;
    const tempSkin = Number.isFinite(Number(rawInput.tempSkin))
      ? Number(Number(rawInput.tempSkin).toFixed(2))
      : null;
    const illuminance = Number.isFinite(Number(rawInput.illuminance))
      ? Number(Number(rawInput.illuminance).toFixed(1))
      : null;

    const deltaTemp = validation.isValid
      ? calculateDeltaTemp(tempMaterial, tempSkin)
      : null;

    const skinRate = validation.isValid && prevValidSample
      ? calculateHeatingRate(tempSkin, prevValidSample.tempSkin, timestamp, prevValidSample.timestamp)
      : { perSecond: null, perMinute: null, dtSeconds: null };

    const materialRate = validation.isValid && prevValidSample
      ? calculateHeatingRate(tempMaterial, prevValidSample.tempMaterial, timestamp, prevValidSample.timestamp)
      : { perSecond: null, perMinute: null, dtSeconds: null };

    const nextSampleNumber = (this.state.sampleCounter || 0) + 1;

    const enrichedSample = {
      sampleNumber: nextSampleNumber,
      timestamp,
      tempMaterial,
      tempSkin,
      illuminance,
      deltaTemp,
      skinRatePerSec: skinRate.perSecond,
      skinRatePerMin: skinRate.perMinute,
      materialRatePerMin: materialRate.perMinute,
      dtSeconds: skinRate.dtSeconds,
      isValid: validation.isValid,
      validationErrors: validation.errors,
      sourceMode: rawInput.sourceMode || this.state.sourceMode,
      isSimulated: Boolean(rawInput.isSimulated)
    };

    this.state.sampleCounter = nextSampleNumber;
    this.state.lastSample = enrichedSample;

    this.history.push(enrichedSample);
    if (this.history.length > this.config.maxHistorySamples) {
      this.history.shift();
    }

    if (!validation.isValid) {
      this.addLog('WARN', 'SENSOR_VALIDASI', `Sampel #${nextSampleNumber} tidak valid: ${validation.errors.join(' ')}`);
    } else if (tempSkin > this.config.tempMaxDesign) {
      this.addLog(
        'WARN',
        'AMBANG_TERMAL',
        `Sampel #${nextSampleNumber}: Suhu kulit (${tempSkin.toFixed(2)} \u00B0C) melewati batas atas rancangan (${this.config.tempMaxDesign.toFixed(1)} \u00B0C).`
      );
    }

    this._persistAndBroadcast('STATE_UPDATED', {
      state: this.state,
      latestSample: enrichedSample
    });
    this._notifyListeners('SAMPLE_INGESTED', enrichedSample);

    return enrichedSample;
  }

  /**
   * Menghapus riwayat pengukuran sesi saat ini.
   */
  clearSessionHistory() {
    this.history = [];
    this.state.lastSample = null;
    this.state.sampleCounter = 0;
    this.state.sessionStartTime = this.state.sessionActive ? Date.now() : null;
    this.addLog('INFO', 'SESI', 'Riwayat sampel telemetri sesi telah dibersihkan.');
    this._persistAndBroadcast('HISTORY_CLEARED', {});
    this._notifyListeners('HISTORY_CLEARED');
  }

  /**
   * Memperbarui konfigurasi sistem setelah divalidasi.
   * @param {Object} newConfigCandidate
   * @returns {{isValid: boolean, errors: string[]}}
   */
  updateConfig(newConfigCandidate) {
    const result = validateConfig(newConfigCandidate);
    if (!result.isValid) {
      return { isValid: false, errors: result.errors };
    }

    this.config = result.sanitized;
    localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(this.config));

    if (this.history.length > this.config.maxHistorySamples) {
      this.history = this.history.slice(-this.config.maxHistorySamples);
    }

    this.addLog(
      'INFO',
      'KONFIGURASI',
      `Konfigurasi diperbarui: Rentang rancangan ${this.config.tempMinDesign.toFixed(1)}\u2013${this.config.tempMaxDesign.toFixed(1)} \u00B0C, Interval ${this.config.uiUpdateIntervalMs} ms.`
    );
    this._persistAndBroadcast('CONFIG_UPDATED', this.config);
    this._notifyListeners('CONFIG_UPDATED', this.config);

    return { isValid: true, errors: [] };
  }

  /**
   * Mereset konfigurasi kembali ke DEFAULT_CONFIG.
   */
  resetConfigToDefault() {
    localStorage.removeItem(STORAGE_KEYS.CONFIG);
    this.config = loadActiveConfig();
    this.addLog('INFO', 'KONFIGURASI', 'Konfigurasi dikembalikan ke nilai bawaan (default).');
    this._persistAndBroadcast('CONFIG_UPDATED', this.config);
    this._notifyListeners('CONFIG_UPDATED', this.config);
  }

  /**
   * Mengekspor data telemetri yang benar-benar tercatat ke format CSV.
   * Tidak mengisi data yang hilang dengan angka buatan.
   * @returns {{success: boolean, csvContent: string, filename: string, message: string}}
   */
  exportHistoryToCsv() {
    if (!this.history || this.history.length === 0) {
      return {
        success: false,
        csvContent: '',
        filename: '',
        message: 'Tidak ada data riwayat pengukuran untuk diekspor.'
      };
    }

    const headers = [
      'no_sampel',
      'timestamp_ms',
      'waktu_iso',
      'mode_sumber',
      'simulasi',
      'suhu_material_degC',
      'suhu_kulit_degC',
      'selisih_suhu_degC',
      'laju_pemanasan_kulit_degC_per_s',
      'laju_pemanasan_kulit_degC_per_menit',
      'iluminansi_lux',
      'interval_dt_s',
      'status_validitas',
      'catatan_validasi'
    ];

    const formatCell = (val) => {
      if (val === null || val === undefined || Number.isNaN(val)) {
        return '';
      }
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows = this.history.map((item) => [
      formatCell(item.sampleNumber),
      formatCell(item.timestamp),
      formatCell(new Date(item.timestamp).toISOString()),
      formatCell(item.sourceMode),
      formatCell(item.isSimulated ? 'YA_DEMO' : 'TIDAK_HARDWARE'),
      formatCell(item.tempMaterial),
      formatCell(item.tempSkin),
      formatCell(item.deltaTemp),
      formatCell(item.skinRatePerSec),
      formatCell(item.skinRatePerMin),
      formatCell(item.illuminance),
      formatCell(item.dtSeconds),
      formatCell(item.isValid ? 'VALID' : 'INVALID'),
      formatCell(Array.isArray(item.validationErrors) ? item.validationErrors.join('; ') : '')
    ].join(','));

    const csvContent = [headers.join(','), ...rows].join('\r\n');
    const dateStamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const modeTag = this.state.sourceMode === 'HARDWARE' ? 'HARDWARE' : 'DEMO';
    const filename = `MANIHOT_Telemetri_${modeTag}_${dateStamp}.csv`;

    this.addLog('INFO', 'EKSPOR_CSV', `Berhasil mengekspor ${this.history.length} sampel ke ${filename}.`);

    return {
      success: true,
      csvContent,
      filename,
      message: `Berhasil menyiapkan ${this.history.length} baris data CSV.`
    };
  }
}

export const dataStore = new ManihotDataStore();