// Shared HTTP client for Electron main process -> Go backend calls
// Provides tolerant JSON parsing so empty or whitespace-only bodies
// do not cause SyntaxError: Unexpected end of JSON input.

/**
 * Perform an HTTP request expecting a JSON response, but gracefully
 * handle empty or whitespace-only bodies by returning an empty object.
 *
 * @param {string} url - Fully qualified URL to call.
 * @param {string} method - HTTP method (GET, POST, etc.).
 * @param {any} [body] - Optional JSON-serializable request body.
 * @returns {Promise<object>} Parsed JSON object (or {}).
 * @throws {Error} When the response is non-OK or JSON parsing fails.
 */
async function callJSON(url, method = 'GET', body) {
  const options = {
    method: method || 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const raw = await response.text();

  // Debug for tunnel listing issue: log body length and a small prefix
  if (url.includes('/api/tunnels')) {
    const preview = raw && raw.length > 200 ? raw.slice(0, 200) + '...' : raw;
    console.log('[main] callJSON /api/tunnels status', response.status, 'len', raw ? raw.length : 0, 'body preview:', preview);
  }

  let data = null;
  if (raw && raw.trim().length > 0) {
    try {
      data = JSON.parse(raw);
    } catch (err) {
      // Log details to help debug backend issues while still surfacing
      // the parsing error to the caller.
      console.error('Failed to parse JSON response', {
        url,
        status: response.status,
        raw,
      });
      throw err;
    }
  }

  if (!response.ok) {
    const message =
      (data && data.error) ||
      `API call failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  // For empty/whitespace-only bodies, return an empty object instead
  // of null/undefined to keep downstream code simple.
  return data ?? {};
}

module.exports = {
  callJSON,
};
