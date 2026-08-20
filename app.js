const express = require('express')
const client = require('prom-client')

const app = express()
const PORT = process.env.PORT || 8080

// ─── MÉTRICAS PROMETHEUS ───────────────────────────────────────────
const register = new client.Registry()
client.collectDefaultMetrics({ register })

// Contador de requests totales
const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total de requests HTTP',
  labelNames: ['method', 'route', 'status'],
  registers: [register]
})

// Histograma de latencia
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_ms',
  help: 'Duración de requests HTTP en ms',
  labelNames: ['method', 'route', 'status'],
  buckets: [10, 50, 100, 200, 500, 1000, 2000, 5000],
  registers: [register]
})

// Gauge de requests concurrentes activos
const activeRequests = new client.Gauge({
  name: 'http_active_requests',
  help: 'Requests activos en este momento',
  registers: [register]
})

// ─── MIDDLEWARE DE MÉTRICAS ────────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now()
  activeRequests.inc()

  res.on('finish', () => {
    const duration = Date.now() - start
    const route = req.route?.path || req.path
    const labels = { method: req.method, route, status: res.statusCode }

    httpRequestsTotal.inc(labels)
    httpRequestDuration.observe(labels, duration)
    activeRequests.dec()
  })

  next()
})

// ─── ENDPOINTS ─────────────────────────────────────────────────────

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'cicdtraining',
    version: process.env.K_REVISION || 'local',
    timestamp: new Date().toISOString()
  })
})

// Simula trabajo con delay configurable
app.get('/api/work', async (req, res) => {
  const ms = Math.min(parseInt(req.query.ms) || 100, 10000)
  const fail = req.query.fail === 'true'

  await new Promise(resolve => setTimeout(resolve, ms))

  if (fail) {
    return res.status(500).json({ error: 'Error simulado', ms })
  }

  res.json({ ok: true, worked_ms: ms, timestamp: new Date().toISOString() })
})

// Prueba de concurrencia — dispara N requests internos en paralelo
app.get('/api/stress', async (req, res) => {
  const connections = Math.min(parseInt(req.query.connections) || 10, 3000)
  const ms = Math.min(parseInt(req.query.ms) || 100, 5000)

  const start = Date.now()

  const results = await Promise.allSettled(
    Array.from({ length: connections }, () =>
      new Promise(resolve => setTimeout(() => resolve('ok'), ms))
    )
  )

  const fulfilled = results.filter(r => r.status === 'fulfilled').length
  const rejected  = results.filter(r => r.status === 'rejected').length
  const elapsed   = Date.now() - start

  res.json({
    connections,
    fulfilled,
    rejected,
    elapsed_ms: elapsed,
    throughput_rps: Math.round((fulfilled / elapsed) * 1000),
    timestamp: new Date().toISOString()
  })
})

// Endpoint de métricas para Prometheus / Cloud Monitoring
app.get('/metrics', async (req, res) => {
  res.setHeader('Content-Type', register.contentType)
  res.send(await register.metrics())
})

// ─── CONFIGURACIÓN GEMINI ──────────────────────────────────────────
// ─── CONFIGURACIÓN GEMINI ──────────────────────────────────
const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({
  vertexai: true,
  project: 'cicdtraining-498421',
  location: 'global',
});

async function callGemini(prompt) {
  const response = await ai.models.generateContent({
    model: 'gemini-3.5-flash',
    contents: prompt,
  });
  return response.text;
}

// ─── ENDPOINT 1: Análisis de resultados k6 ────────────────────────
app.post('/api/ai/analyze', express.json(), async (req, res) => {
  try {
    const k6Results = req.body;

    const prompt = `Eres un experto en SRE. Analiza estos resultados de una prueba de carga k6 
y determina si se cumplen los SLOs definidos:
- SLO Disponibilidad: errores < 0.5%
- SLO Latencia: p95 < 500ms
- SLO Tasa de errores: 5xx < 0.5%

Resultados k6:
${JSON.stringify(k6Results, null, 2)}

Responde en español con:
1. Estado de cada SLO (cumplido/roto)
2. Análisis de lo que pasó
3. Recomendaciones concretas`;

    const analysis = await callGemini(prompt);
    res.json({ analysis, timestamp: new Date().toISOString() });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── ENDPOINT 2: Asistente SRE ────────────────────────────────────
app.post('/api/ai/sre', express.json(), async (req, res) => {
  try {
    const { question } = req.body;

    // Recolectar métricas actuales
    const metrics = await register.getMetricsAsJSON();
    const requestsTotal = metrics.find(m => m.name === 'http_requests_total');
    const duration = metrics.find(m => m.name === 'http_request_duration_ms');

    const prompt = `Eres un asistente SRE experto. 
El usuario pregunta: "${question}"

Estado actual del servicio cicdtraining en Cloud Run:
- Métricas de requests: ${JSON.stringify(requestsTotal?.values || [], null, 2)}
- Métricas de latencia: ${JSON.stringify(duration?.values?.slice(0,5) || [], null, 2)}

SLOs definidos:
- Disponibilidad: ≥ 99.5%
- Latencia p95: < 500ms  
- Tasa de errores: ≤ 0.5%

Responde en español de forma clara y concisa.`;

    const answer = await callGemini(prompt);
    res.json({ answer, timestamp: new Date().toISOString() });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── ENDPOINT 3: Predicción de ruptura de SLO ─────────────────────
app.post('/api/ai/predict', express.json(), async (req, res) => {
  try {
    const { metrics_history } = req.body;

    const prompt = `Eres un experto en SRE y análisis predictivo.
Analiza esta serie de métricas de los últimos minutos y predice si algún SLO está en riesgo:

Historial de métricas:
${JSON.stringify(metrics_history, null, 2)}

SLOs a vigilar:
- Disponibilidad: ≥ 99.5%
- Latencia p95: < 500ms
- Tasa de errores: ≤ 0.5%

Responde en español con:
1. Nivel de riesgo: BAJO / MEDIO / ALTO
2. Qué SLO está en riesgo y por qué
3. En cuánto tiempo podría romperse
4. Acción inmediata recomendada`;

    const prediction = await callGemini(prompt);
    res.json({ prediction, risk_evaluated_at: new Date().toISOString() });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});



// ─── ARRANQUE ──────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en puerto ${PORT}`)
})
