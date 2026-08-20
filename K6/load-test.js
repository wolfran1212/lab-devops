import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ─── MÉTRICAS PERSONALIZADAS ───────────────────────────────────────
const errorRate = new Rate('error_rate');
const latencyTrend = new Trend('latency_ms');

// ─── CONFIGURACIÓN DEL TEST ────────────────────────────────────────
export const options = {
  stages: [
    { duration: '30s', target: 50  },  // Rampa: 0 → 50 usuarios
    { duration: '60s', target: 50  },  // Sostenido: 50 usuarios por 1 min
    { duration: '30s', target: 200 },  // Pico: sube a 200 usuarios
    //{ duration: '60s', target: 200 },  // Sostenido: 200 usuarios por 1 min
    { duration: '2m',  target: 200 },  // Pico sostenido 2 minutos ← clave

    { duration: '30s', target: 0   },  // Bajada: regresa a 0
  ],
  thresholds: {
    // SLOs definidos
    'http_req_failed':   ['rate<0.005'],  // Errores < 0.5%
    'http_req_duration': ['p(95)<500'],   // Latencia p95 < 500ms
    'error_rate':        ['rate<0.005'],  // Tasa de error custom < 0.5%
  },
};

const BASE_URL = 'https://mi-app-622078306811.us-central1.run.app';

// ─── ESCENARIO PRINCIPAL ───────────────────────────────────────────
export default function () {
  // 70% tráfico normal
  const r1 = http.get(`${BASE_URL}/api/work?ms=100`);
  check(r1, { 'work 200': (r) => r.status === 200 });
  errorRate.add(r1.status !== 200);
  latencyTrend.add(r1.timings.duration);

  sleep(0.5);

  // 20% tráfico lento
  const r2 = http.get(`${BASE_URL}/api/work?ms=400`);
  check(r2, { 'work slow 200': (r) => r.status === 200 });
  errorRate.add(r2.status !== 200);
  latencyTrend.add(r2.timings.duration);

  sleep(0.5);

  // 10% errores simulados
  if (Math.random() < 0.1) {
    const r3 = http.get(`${BASE_URL}/api/work?ms=100&fail=true`);
    check(r3, { 'error 500': (r) => r.status === 500 });
    errorRate.add(r3.status !== 500);
  }

  sleep(1);
}