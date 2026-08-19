const dotenv = require('dotenv');
dotenv.config();

const DEFAULT_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS, 10) || 10000;
const DEFAULT_MAX_RETRIES = parseInt(process.env.MAX_RETRIES, 10) || 3;

// Realistic User-Agent strings
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0'
];

class FetchError extends Error {
  /**
   * @param {string} message 
   * @param {'network_failure' | 'http_status_error' | 'empty_body' | 'timeout'} type 
   * @param {number|null} status 
   */
  constructor(message, type, status = null) {
    super(message);
    this.name = 'FetchError';
    this.type = type;
    this.status = status;
  }
}

/**
 * Returns a random User-Agent string from the list.
 */
function getRandomUserAgent() {
  const index = Math.floor(Math.random() * USER_AGENTS.length);
  return USER_AGENTS[index];
}

/**
 * Helper to pause execution.
 */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetches content from a URL with retry logic, timeout, and rotated headers.
 * 
 * @param {string} url 
 * @param {object} options 
 * @returns {Promise<any>} Response body (JSON)
 */
async function fetchWithRetry(url, options = {}) {
  // Support local mocking in runner simulations and unit tests
  if (options.mockError !== undefined) {
    throw options.mockError;
  }
  if (options.mockData !== undefined) {
    return options.mockData;
  }

  const maxRetries = options.maxRetries !== undefined ? options.maxRetries : DEFAULT_MAX_RETRIES;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

  let attempt = 0;

  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    const ua = getRandomUserAgent();
    
    // Merge standard request-spoofing headers
    const headers = {
      'User-Agent': ua,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Site': 'same-site',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty',
      'Referer': 'https://remoteok.com/',
      ...options.headers
    };

    try {
      console.log(`[HTTP Client] Fetching ${url} (Attempt ${attempt + 1}/${maxRetries + 1}) with User-Agent: ${ua}`);
      
      const requestStart = Date.now();
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal
      });

      const requestDuration = ((Date.now() - requestStart) / 1000).toFixed(2);
      console.log(`Received HTTP ${response.status} in ${requestDuration}s`);

      clearTimeout(timeoutId);

      if (!response.ok) {
        // Retry for 5xx server errors or 429 rate limit
        if ((response.status >= 500 || response.status === 429) && attempt < maxRetries) {
          console.warn(`[HTTP Client] Temporary HTTP status error ${response.status}. Retrying...`);
          throw new FetchError(`HTTP status error ${response.status}`, 'http_status_error', response.status);
        } else {
          // Terminal error for 400s (excluding 429) or when retries are exhausted
          throw new FetchError(`HTTP status error ${response.status}`, 'http_status_error', response.status);
        }
      }

      const contentType = response.headers.get('content-type') || '';
      let data;
      
      if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        const text = await response.text();
        if (!text) {
          throw new FetchError('Empty response body received', 'empty_body');
        }
        try {
          data = JSON.parse(text);
        } catch {
          // If not valid JSON, treat it as text data or error depending on expected type
          data = text;
        }
      }

      if (data === null || data === undefined || (Array.isArray(data) && data.length === 0)) {
        // Check if empty body is an issue
        console.warn('[HTTP Client] Received empty or null body from API.');
      }

      return data;

    } catch (err) {
      clearTimeout(timeoutId);

      let fetchErr = err;
      if (err.name === 'AbortError') {
        fetchErr = new FetchError(`Request timed out after ${timeoutMs}ms`, 'timeout');
      } else if (!(err instanceof FetchError)) {
        fetchErr = new FetchError(`Network request failed: ${err.message}`, 'network_failure');
      }

      // Check if we should retry
      const isRetryable = fetchErr.type === 'network_failure' || fetchErr.type === 'timeout' || (fetchErr.type === 'http_status_error' && (fetchErr.status >= 500 || fetchErr.status === 429));
      
      if (isRetryable && attempt < maxRetries) {
        attempt++;
        // Exponential backoff base 500ms, doubling, plus random jitter of -100ms to 100ms
        const backoffMs = 500 * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 200 - 100;
        const sleepMs = Math.max(100, Math.round(backoffMs + jitter));
        
        console.warn(`[HTTP Client] Retryable error: ${fetchErr.message}. Retrying in ${sleepMs}ms...`);
        await delay(sleepMs);
      } else {
        // Re-throw if not retryable or max retries reached
        throw fetchErr;
      }
    }
  }
}

module.exports = {
  fetchWithRetry,
  FetchError,
  USER_AGENTS // exported for testing UA rotation
};
