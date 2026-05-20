export async function requestJson(url, options = {}) {
  const attempts = options.attempts ?? 4;
  const retryDelayMs = options.retryDelayMs ?? 1500;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      const text = await response.text();
      const body = text ? safeJsonParse(text) : null;

      if (response.ok) return body;

      const message = body?.error_description || body?.message || text;
      const error = new Error(`${options.method || "GET"} ${url} failed: ${response.status} ${message}`);
      error.status = response.status;

      if (!isRetryable(response.status) || attempt === attempts) throw error;
      lastError = error;
    } catch (error) {
      if (attempt === attempts) throw error;
      lastError = error;
    }

    await pause(retryDelayMs * attempt);
  }

  throw lastError;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isRetryable(status) {
  return status === 429 || status >= 500;
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
