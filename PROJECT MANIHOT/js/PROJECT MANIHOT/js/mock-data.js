/**
 * @file mock-data.js
 * @description Generator data simulasi untuk Mode DEMO aplikasi MANIHOT.
 * Seluruh data yang dihasilkan selalu diberi penanda DEMO / SIMULASI dan
 * hanya digunakan untuk pengujian antarmuka serta evaluasi alur perhitungan.
 */

export const DEMO_SCENARIOS = Object.freeze({
  NORMAL: {
    id: 'NORMAL',
    name: 'Skenario Normal (Penyerapan & Penyangga PCM 38\u201341 \u00B0C)',
    description: 'Menyimulasikan pemanasan fototermal bertahap di bawah iluminansi ~850 lux hingga stabil pada rentang perubahan fase PCM.'
  },
  OVERHEAT: {
    id: 'OVERHEAT',
    name: 'Skenario Melewati Ambang (> 41.0 \u00B0C)',
    description: 'Menyimulasikan iluminansi tinggi (~1650 lux) sehingga suhu antarmuka kulit melewati batas atas rancangan 41.0 \u00B0C.'
  },
  LOW_LIGHT: {
    id: 'LOW_LIGHT',
    name: 'Skenario Iluminansi Rendah (< 38.0 \u00B0C)',
    description: 'Menyimulasikan kondisi pencahayaan redup (~140 lux) di mana suhu komposit tetap berada di bawah rentang rancangan.'
  },
  SENSOR_FAULT: {
    id: 'SENSOR_FAULT',
    name: 'Skenario Gangguan Pembacaan Sensor',
    description: 'Menyimulasikan pembacaan sensor yang sesekali berada di luar rentang fisik (NaN / ekstrem) untuk menguji filter validasi.'
  },
  STALE_FREEZE: {
    id: 'STALE_FREEZE',
    name: 'Skenario Data Kedaluwarsa (Stale Data)',
    description: 'Menghentikan pengiriman sampel baru untuk menguji deteksi otomatis data kedaluwarsa pada antarmuka pasien dan admin.'
  }
});

export class MockTelemetryGenerator {
  /**
   * @param {Object} handlers { onSampleGenerated, onLog }
   */
  constructor(handlers = {}) {
    this.onSampleGenerated = handlers.onSampleGenerated || (() => {});
    this.onLog = handlers.onLog || (() => {});

    this.timerId = null;
    this.scenario = 'NORMAL';
    this.stepCount = 0;

    // Variabel keadaan termal internal simulasi (ilustrasi)
    this.currentMaterialTemp = 34.2;
    this.currentSkinTemp = 33.6;
    this.currentLux = 820.0;
  }

  /**
   * Memulai timer pembangkitan data simulasi.
   * @param {number} intervalMs Interval pembangkitan dalam milidetik
   * @param {string} scenario Id skenario dari DEMO_SCENARIOS
   */
  start(intervalMs = 1000, scenario = 'NORMAL') {
    this.stop();
    this.scenario = DEMO_SCENARIOS[scenario] ? scenario : 'NORMAL';
    this.stepCount = 0;
    this._resetInitialStateForScenario(this.scenario);

    this.onLog(
      'INFO',
      'DEMO_START',
      `Mode DEMO diaktifkan dengan skenario "${DEMO_SCENARIOS[this.scenario].name}" (Interval: ${intervalMs} ms).`
    );

    // Hasilkan sampel pertama segera
    this._tick();

    this.timerId = window.setInterval(() => {
      this._tick();
    }, intervalMs);
  }

  /**
   * Menghentikan timer simulasi dengan bersih.
   */
  stop() {
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  /**
   * Mengubah skenario simulasi saat sesi DEMO sedang berjalan.
   * @param {string} newScenario
   */
  setScenario(newScenario) {
    if (!DEMO_SCENARIOS[newScenario]) return;
    this.scenario = newScenario;
    this.onLog('INFO', 'DEMO_SCENARIO', `Skenario simulasi diubah ke: "${DEMO_SCENARIOS[newScenario].name}".`);
  }

  /**
   * Menyesuaikan interval timer apabila konfigurasi interval diubah.
   * @param {number} newIntervalMs
   */
  updateInterval(newIntervalMs) {
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = window.setInterval(() => {
        this._tick();
      }, newIntervalMs);
    }
  }

  _resetInitialStateForScenario(scenario) {
    if (scenario === 'LOW_LIGHT') {
      this.currentMaterialTemp = 35.0;
      this.currentSkinTemp = 34.4;
      this.currentLux = 135.0;
    } else if (scenario === 'OVERHEAT') {
      this.currentMaterialTemp = 40.8;
      this.currentSkinTemp = 39.6;
      this.currentLux = 1650.0;
    } else {
      this.currentMaterialTemp = 36.2;
      this.currentSkinTemp = 35.4;
      this.currentLux = 850.0;
    }
  }

  _tick() {
    this.stepCount++;

    // Apabila skenario STALE_FREEZE dipilih, hentikan pengiriman paket setelah sampel ke-2
    if (this.scenario === 'STALE_FREEZE' && this.stepCount > 2) {
      return;
    }

    const noise = (amplitude) => (Math.random() - 0.5) * 2 * amplitude;

    let targetMat = 40.6;
    let targetSkin = 39.4;
    let baseLux = 860;

    switch (this.scenario) {
      case 'NORMAL':
        targetMat = 40.8 + Math.sin(this.stepCount * 0.08) * 0.35;
        targetSkin = 39.5 + Math.sin(this.stepCount * 0.08 - 0.4) * 0.3;
        baseLux = 860 + Math.sin(this.stepCount * 0.05) * 45;
        break;

      case 'OVERHEAT':
        targetMat = 44.2 + Math.sin(this.stepCount * 0.06) * 0.3;
        targetSkin = 42.3 + Math.sin(this.stepCount * 0.06) * 0.25;
        baseLux = 1680 + Math.sin(this.stepCount * 0.05) * 60;
        break;

      case 'LOW_LIGHT':
        targetMat = 36.4 + Math.sin(this.stepCount * 0.05) * 0.2;
        targetSkin = 35.8 + Math.sin(this.stepCount * 0.05) * 0.15;
        baseLux = 140 + Math.sin(this.stepCount * 0.04) * 15;
        break;

      case 'SENSOR_FAULT':
        targetMat = 40.2;
        targetSkin = 39.1;
        baseLux = 800;
        break;

      default:
        break;
    }

    // Pendekatan relaksasi termal orde satu sederhana (ilustrasi simulasi)
    this.currentMaterialTemp += (targetMat - this.currentMaterialTemp) * 0.18 + noise(0.06);
    this.currentSkinTemp += (targetSkin - this.currentSkinTemp) * 0.15 + noise(0.04);
    this.currentLux = Math.max(0, baseLux + noise(8.0));

    let outMat = this.currentMaterialTemp;
    let outSkin = this.currentSkinTemp;
    let outLux = this.currentLux;

    // Pada skenario SENSOR_FAULT, setiap kelipatan 4 sampel kirimkan nilai tidak valid
    if (this.scenario === 'SENSOR_FAULT' && this.stepCount % 4 === 0) {
      outSkin = -12.5; // Di luar rentang fisik TMP117 untuk memicu peringatan validasi
      outLux = -50;
    }

    this.onSampleGenerated({
      timestamp: Date.now(),
      tempMaterial: Number(outMat.toFixed(2)),
      tempSkin: Number(outSkin.toFixed(2)),
      illuminance: Number(outLux.toFixed(1)),
      sourceMode: 'DEMO',
      isSimulated: true
    });
  }
}