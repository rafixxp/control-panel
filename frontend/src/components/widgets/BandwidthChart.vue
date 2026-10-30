<script setup>
import { computed } from 'vue';
import { Chart as ChartJS, CategoryScale, Filler, Legend, LineElement, LinearScale, PointElement, Tooltip } from 'chart.js';
import { Line } from 'vue-chartjs';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

const props = defineProps({
  points: { type: Array, default: () => [] },
  height: { type: Number, default: 220 },
});

const chartData = computed(() => ({
  labels: props.points.map((p) =>
    new Date(p.at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
  ),
  datasets: [
    {
      label: 'In (kbps)',
      data: props.points.map((p) => p.inKbps),
      borderColor: '#4F8EF7',
      backgroundColor: 'rgba(79,142,247,0.15)',
      fill: true,
      tension: 0.35,
      pointRadius: 0,
      borderWidth: 2,
    },
    {
      label: 'Out (kbps)',
      data: props.points.map((p) => p.outKbps),
      borderColor: '#34D399',
      backgroundColor: 'rgba(52,211,153,0.08)',
      fill: true,
      tension: 0.35,
      pointRadius: 0,
      borderWidth: 2,
    },
  ],
}));

const options = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: {
      labels: { color: '#8892A4', boxWidth: 10, boxHeight: 10, usePointStyle: true, font: { size: 11 } },
    },
    tooltip: { backgroundColor: '#1E2435', borderColor: '#2A3147', borderWidth: 1, titleColor: '#E8ECF4', bodyColor: '#8892A4' },
  },
  scales: {
    x: { grid: { color: 'rgba(42,49,71,0.5)' }, ticks: { color: '#8892A4', font: { size: 10 }, maxTicksLimit: 8 } },
    y: { grid: { color: 'rgba(42,49,71,0.5)' }, ticks: { color: '#8892A4', font: { size: 10 } }, beginAtZero: true },
  },
};
</script>

<template>
  <div :style="{ height: `${height}px` }">
    <Line v-if="points.length" :data="chartData" :options="options" />
    <div v-else class="flex h-full items-center justify-center text-sm text-text-muted">
      Belum ada data bandwidth (sampling tiap 5 detik).
    </div>
  </div>
</template>
