// api/generate.js (Vercel Serverless Function)

const MODEL_PRIMARY = "gemini-3-flash-preview"; // Gemini 3 (geralmente disponível no free)
const MODEL_FALLBACK = "gemini-2.0-flash";      // fallback se 3 estiver rate-limited

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// retry simples com backoff (1s, 2s, 4s) para 429/503
async function fetchWithRetry(url, options, maxAttempts = 4) {
  let lastErr;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));

    if (res.ok) return { res, data };

    const status = res.status;
    const msg =
      data?.error?.message ||
      data?.error ||
      JSON.stringify(data);

    if ((status === 429 || status === 503) && attempt < maxAttempts) {
      const wait = 1000 * Math.pow(2, attempt - 1); // 1s, 2s, 4s...
      await sleep(wait);
      lastErr = new Error(`${status}: ${msg}`);
      lastErr.status = status;
      continue;
    }

    const err = new Error(`${status}: ${msg}`);
    err.status = status;
    err.data = data;
    throw err;
  }

  throw lastErr || new Error("Falha desconhecida no retry.");
}

async function callGemini({ apiKey, model, prompt }) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }]
  };

  const { data } = await fetchWithRetry(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  return data;
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { prompt } = req.body || {};
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Missing or invalid prompt" });
    }

    // NOME ÚNICO DA VARIÁVEL (SEM CONFUSÃO)
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: "Missing GEMINI_API_KEY env var" });
    }

    // 1) tenta Gemini 3
    try {
      const data = await callGemini({ apiKey, model: MODEL_PRIMARY, prompt });
      return res.status(200).json(data);
    } catch (e) {
      const status = e?.status || 0;

      // se foi rate limit/temporário, faz fallback pro 2
      if (status === 429 || status === 503) {
        const data = await callGemini({ apiKey, model: MODEL_FALLBACK, prompt });
        return res.status(200).json(data);
      }

      throw e;
    }
  } catch (e) {
    return res.status(500).json({
      error: {
        message: e?.message || String(e)
      }
    });
  }
};
