/**
 * @file charts.js
 * @description Pengelola instansiasi dan pembaruan grafik real-time Chart.js pada Admin Dashboard.
 * Memperbarui array data secara langsung tanpa membuat ulang elemen canvas pada setiap sampel.
 */

export class ManihotChartsManager {
  constructor() {
    this.charts = {
      temp: null,
      delta: null,
      rate: null,
      lux: null
    };
    this.isInitialized = false;
  }

  /**
   * Menginisialisasi ke-4 grafik pada elemen canvas yang tersedia di admin.html.
   * @param {Object} canvasIds { tempCanvasId, deltaCanvasId, rateCanvasId, luxCanvasId }
   * @param {Object} config Konfigurasi aktif
   */
  initCharts(canvasIds, config) {
    if (typeof window.Chart === 'undefined') {
      return false;
    }

    this.destroyAll();

    const commonOptions = (yAxisLabel) => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            boxWidth: 12,
            font: { size: 11 }
          }
        },
        tooltip: {
          enabled: true
        }
      },
      scales: {
        x: {
          title: {
            display: true,
            text: 'Waktu Pengukuran (HH:MM:SS)',
            font: { size: 11 }
          },
          ticks: {
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 7,
            font: { size: 10 }
          }
        },
        y: {
          title: {
            display: true,
            text: yAxisLabel,
            font: { size: 11 }
          },
          ticks: {
            font: { size: 10 }
          }
        }
      }
    });

    // 1. Grafik Suhu Material & Suhu Antarmuka Kulit + Batas Rancangan
    const tempCtx = document.getElementById(canvasIds.tempCanvasId);
    if (tempCtx) {
      this.charts.temp = new window.Chart(tempCtx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: 'Suhu Material Fototermal (\u00B0C)',
              data: [],
              borderColor: '#0f766e',
              backgroundColor: 'rgba(15, 118, 110, 0.08)',
              borderWidth: 2,
              pointRadius: 2,
              tension: 0.2
            },
            {
              label: 'Suhu Antarmuka Kulit (\u00B0C)',
              data: [],
              borderColor: '#0284c7',
              backgroundColor: 'rgba(2, 132, 199, 0.08)',
              borderWidth: 2,
              pointRadius: 2,
              tension: 0.2
            },
            {
              label: `Batas Atas Rancangan (${config.tempMaxDesign.toFixed(1)} \u00B0C)`,
              data: [],
              borderColor: '#dc2626',
              borderWidth: 1.2,
              borderDash: [5, 5],
              pointRadius: 0,
              fill: false
            },
            {
              label: `Batas Bawah Rancangan (${config.tempMinDesign.toFixed(1)} \u00B0C)`,
              data: [],
              borderColor: '#64748b',
              borderWidth: 1.2,
              borderDash: [4, 4],
              pointRadius: 0,
              fill: false
            }
          ]
        },
        options: commonOptions('Temperatur (\u00B0C)')
      });
    }

    // 2. Grafik Selisih Suhu (\Delta T)
    const deltaCtx = document.getElementById(canvasIds.deltaCanvasId);
    if (deltaCtx) {
      this.charts.delta = new window.Chart(deltaCtx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: '\u0394T = T_material - T_kulit (\u00B0C)',
              data: [],
              borderColor: '#7c3aed',
              backgroundColor: 'rgba(124, 58, 237, 0.1)',
              borderWidth: 2,
              pointRadius: 2,
              fill: true,
              tension: 0.2
            }
          ]
        },
        options: commonOptions('Selisih Suhu \u0394T (\u00B0C)')
      });
    }

    // 3. Grafik Laju Perubahan Suhu (dT/dt)
    const rateCtx = document.getElementById(canvasIds.rateCanvasId);
    if (rateCtx) {
      this.charts.rate = new window.Chart(rateCtx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: 'Laju Suhu Kulit dT/dt (\u00B0C/menit)',
              data: [],
              borderColor: '#ea580c',
              backgroundColor: 'rgba(234, 88, 12, 0.08)',
              borderWidth: 2,
              pointRadius: 2,
              tension: 0.2
            },
            {
              label: 'Laju Suhu Material dT/dt (\u00B0C/menit)',
              data: [],
              borderColor: '#64748b',
              borderWidth: 1.5,
              borderDash: [3, 3],
              pointRadius: 1.5,
              tension: 0.2
            }
          ]
        },
        options: commonOptions('Laju Perubahan (\u00B0C/menit)')
      });
    }

    // 4. Grafik Iluminansi (lux)
    const luxCtx = document.getElementById(canvasIds.luxCanvasId);
    if (luxCtx) {
      this.charts.lux = new window.Chart(luxCtx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: 'Iluminansi BH1750 (lux)',
              data: [],
              borderColor: '#ca8a04',
              backgroundColor: 'rgba(202, 138, 4, 0.12)',
              borderWidth: 2,
              pointRadius: 2,
              fill: true,
              tension: 0.2
            }
          ]
        },
        options: commonOptions('Iluminansi (lux)')
      });
    }

    this.isInitialized = true;
    return true;
  }

  /**
   * Memperbarui seluruh grafik berdasarkan daftar riwayat sampel dan batas titik maksimum.
   * @param {Array<Object>} history Daftar sampel dari data-store.js
   * @param {Object} config Konfigurasi aktif
   */
  syncWithHistory(history, config) {
    if (!this.isInitialized) return;

    const maxPoints = Number(config.maxChartPoints) || 60;
    const validSlice = history.filter((item) => item && item.isValid).slice(-maxPoints);

    const labels = validSlice.map((item) => {
      const d = new Date(item.timestamp);
      return d.toLocaleTimeString('id-ID', { hour12: false });
    });

    if (this.charts.temp) {
      const c = this.charts.temp;
      c.data.labels = labels;
      c.data.datasets[0].data = validSlice.map((s) => s.tempMaterial);
      c.data.datasets[1].data = validSlice.map((s) => s.tempSkin);
      c.data.datasets[2].label = `Batas Atas Rancangan (${config.tempMaxDesign.toFixed(1)} \u00B0C)`;
      c.data.datasets[2].data = validSlice.map(() => config.tempMaxDesign);
      c.data.datasets[3].label = `Batas Bawah Rancangan (${config.tempMinDesign.toFixed(1)} \u00B0C)`;
      c.data.datasets[3].data = validSlice.map(() => config.tempMinDesign);
      c.update('none');
    }

    if (this.charts.delta) {
      const c = this.charts.delta;
      c.data.labels = labels;
      c.data.datasets[0].data = validSlice.map((s) => s.deltaTemp);
      c.update('none');
    }

    if (this.charts.rate) {
      const c = this.charts.rate;
      c.data.labels = labels;
      c.data.datasets[0].data = validSlice.map((s) => s.skinRatePerMin);
      c.data.datasets[1].data = validSlice.map((s) => s.materialRatePerMin);
      c.update('none');
    }

    if (this.charts.lux) {
      const c = this.charts.lux;
      c.data.labels = labels;
      c.data.datasets[0].data = validSlice.map((s) => s.illuminance);
      c.update('none');
    }
  }

  /**
   * Menghancurkan instance Chart.js dengan aman apabila halaman ditutup atau di-reset.
   */
  destroyAll() {
    Object.keys(this.charts).forEach((key) => {
      if (this.charts[key]) {
        this.charts[key].destroy();
        this.charts[key] = null;
      }
    });
    this.isInitialized = false;
  }
}