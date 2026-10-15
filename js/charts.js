/**
 * MANIHOT — Chart.js Controller Module
 */
window.Manihot = window.Manihot || {};

window.Manihot.Charts = (() => {
  let mainChart = null;
  let impactChart = null;
  let replayChart = null;
  let maxPoints = 40;
  let isPaused = false;

  function initCharts() {
    if (typeof Chart === 'undefined') return;

    const mainCtx = document.getElementById('telemetryMainChart')?.getContext('2d');
    if (mainCtx) {
      if (mainChart) mainChart.destroy();
      mainChart = new Chart(mainCtx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: 'Suhu Kulit (T_skin °C)',
              data: [],
              borderColor: '#10b981',
              backgroundColor: 'rgba(16, 185, 129, 0.12)',
              borderWidth: 2.5,
              tension: 0.35,
              fill: true,
              pointRadius: 2,
              yAxisID: 'yTemp'
            },
            {
              label: 'Suhu Perban (T_material °C)',
              data: [],
              borderColor: '#f59e0b',
              backgroundColor: 'rgba(245, 158, 11, 0.05)',
              borderWidth: 2,
              borderDash: [4, 4],
              tension: 0.35,
              fill: false,
              pointRadius: 1.5,
              yAxisID: 'yTemp'
            },
            {
              label: 'Cahaya (Lux)',
              data: [],
              borderColor: '#0ea5e9',
              backgroundColor: 'rgba(14, 165, 233, 0.08)',
              borderWidth: 1.5,
              tension: 0.3,
              fill: false,
              pointRadius: 1,
              hidden: true,
              yAxisID: 'yLux'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 250 },
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { labels: { font: { family: 'Plus Jakarta Sans', size: 11, weight: 'bold' } } },
            tooltip: {
              callbacks: {
                label(ctx) {
                  const val = ctx.parsed.y;
                  if (ctx.datasetIndex === 2) return ` ${ctx.dataset.label}: ${Math.round(val).toLocaleString('id-ID')} lx`;
                  return ` ${ctx.dataset.label}: ${val.toFixed(2)} °C`;
                }
              }
            }
          },
          scales: {
            x: { ticks: { maxTicksLimit: 7, font: { family: 'JetBrains Mono', size: 10 } } },
            yTemp: {
              type: 'linear',
              position: 'left',
              suggestedMin: 34,
              suggestedMax: 46,
              title: { display: true, text: 'Temperatur (°C)', font: { size: 11, weight: 'bold' } }
            },
            yLux: {
              type: 'linear',
              position: 'right',
              suggestedMin: 0,
              suggestedMax: 40000,
              grid: { drawOnChartArea: false },
              title: { display: true, text: 'Lux', font: { size: 11, weight: 'bold' } }
            }
          }
        }
      });
    }

    const impactCtx = document.getElementById('impactTrendChart')?.getContext('2d');
    if (impactCtx) {
      if (impactChart) impactChart.destroy();
      impactChart = new Chart(impactCtx, {
        type: 'bar',
        data: {
          labels: [],
          datasets: [
            {
              label: 'Nyeri Sebelum',
              data: [],
              backgroundColor: 'rgba(245, 158, 11, 0.75)',
              borderRadius: 6
            },
            {
              label: 'Nyeri Sesudah',
              data: [],
              backgroundColor: 'rgba(16, 185, 129, 0.85)',
              borderRadius: 6
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: { min: 0, max: 10, ticks: { stepSize: 2 } }
          }
        }
      });
    }
  }

  function pushLivePoint(rec) {
    if (!mainChart || isPaused) return;
    const timeLabel = new Date(rec.timestamp).toLocaleTimeString('id-ID', { hour12: false });
    mainChart.data.labels.push(timeLabel);
    mainChart.data.datasets[0].data.push(rec.t_skin);
    mainChart.data.datasets[1].data.push(rec.t_material);
    mainChart.data.datasets[2].data.push(rec.lux);

    while (mainChart.data.labels.length > maxPoints) {
      mainChart.data.labels.shift();
      mainChart.data.datasets.forEach(ds => ds.data.shift());
    }
    mainChart.update('none');
  }

  function toggleSeries(index, visible) {
    if (!mainChart || !mainChart.data.datasets[index]) return;
    mainChart.data.datasets[index].hidden = !visible;
    mainChart.update();
  }

  function setMaxPoints(val) {
    const parsed = parseInt(val, 10);
    if (Number.isFinite(parsed) && parsed >= 10) {
      maxPoints = parsed;
      if (mainChart) {
        while (mainChart.data.labels.length > maxPoints) {
          mainChart.data.labels.shift();
          mainChart.data.datasets.forEach(ds => ds.data.shift());
        }
        mainChart.update();
      }
    }
  }

  function toggleChartPause() {
    isPaused = !isPaused;
    const badge = document.getElementById('chart-live-badge');
    const btnText = document.getElementById('btn-pause-chart-text');
    if (badge) {
      badge.textContent = isPaused ? 'PAUSED' : 'LIVE';
      badge.className = isPaused
        ? 'px-2.5 py-0.5 text-[10px] font-mono font-bold rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
        : 'px-2.5 py-0.5 text-[10px] font-mono font-bold rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300';
    }
    if (btnText) btnText.textContent = isPaused ? 'Lanjutkan' : 'Bekukan';
  }

  function renderImpactChart(records) {
    if (!impactChart) return;
    const ordered = [...records].reverse();
    impactChart.data.labels = ordered.map(r =>
      new Date(r.recorded_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })
    );
    impactChart.data.datasets[0].data = ordered.map(r => r.pain_score_before);
    impactChart.data.datasets[1].data = ordered.map(r => r.pain_score_after);
    impactChart.update();
  }

  function renderReplayChart(sessionMeta, readings) {
    const panel = document.getElementById('history-replay-panel');
    const title = document.getElementById('replay-session-title');
    const expBtn = document.getElementById('btn-replay-export-csv');
    if (!panel) return;
    panel.classList.remove('hidden');
    if (title) {
      title.textContent = `Detail Grafik Sesi (${new Date(sessionMeta.started_at).toLocaleString('id-ID')})`;
    }
    if (expBtn && window.App?.Export) {
      expBtn.onclick = () => window.App.Export.downloadSessionCSV(sessionMeta, readings);
    }

    const ctx = document.getElementById('historyReplayChart')?.getContext('2d');
    if (!ctx) return;
    if (replayChart) replayChart.destroy();
    replayChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: readings.map(r => new Date(r.timestamp).toLocaleTimeString('id-ID', { hour12: false })),
        datasets: [
          {
            label: 'T_skin (°C)',
            data: readings.map(r => r.t_skin),
            borderColor: '#10b981',
            tension: 0.3,
            borderWidth: 2
          },
          {
            label: 'T_material (°C)',
            data: readings.map(r => r.t_material),
            borderColor: '#f59e0b',
            borderDash: [4, 4],
            tension: 0.3,
            borderWidth: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false
      }
    });
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  return {
    initCharts,
    pushLivePoint,
    toggleSeries,
    setMaxPoints,
    toggleChartPause,
    renderImpactChart,
    renderReplayChart
  };
})();