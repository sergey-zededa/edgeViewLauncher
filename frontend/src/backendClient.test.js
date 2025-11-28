import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

// Import the shared helper from the project root
// Path: frontend/src -> ../../backendClient.js
// backendClient is CommonJS, but Vitest can import it via require semantics.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { callJSON } = require('../../backendClient.js');

const originalFetch = global.fetch;

describe('backendClient.callJSON', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    // Restore original fetch (if any) after all tests
    global.fetch = originalFetch;
  });

  it('returns an empty object when response body is empty but status is OK', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(''),
    };

    const mockFetch = vi.fn().mockResolvedValue(mockResponse);
    global.fetch = mockFetch;

    const result = await callJSON('http://localhost:8080/api/tunnels?nodeId=node-1', 'GET');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({});
  });

  it('parses valid JSON body when present', async () => {
    const payload = { success: true, data: [{ id: 't1' }] };

    const mockResponse = {
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(JSON.stringify(payload)),
    };

    const mockFetch = vi.fn().mockResolvedValue(mockResponse);
    global.fetch = mockFetch;

    const result = await callJSON('http://localhost:8080/api/tunnels?nodeId=node-1', 'GET');

    expect(result).toEqual(payload);
  });

  it('throws an error with backend message when non-OK and JSON error is present', async () => {
    const payload = { success: false, error: 'Something went wrong' };

    const mockResponse = {
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue(JSON.stringify(payload)),
    };

    const mockFetch = vi.fn().mockResolvedValue(mockResponse);
    global.fetch = mockFetch;

    await expect(
      callJSON('http://localhost:8080/api/tunnels?nodeId=node-1', 'GET'),
    ).rejects.toThrow('Something went wrong');
  });

  it('throws a generic error when non-OK and body is empty', async () => {
    const mockResponse = {
      ok: false,
      status: 502,
      text: vi.fn().mockResolvedValue(''),
    };

    const mockFetch = vi.fn().mockResolvedValue(mockResponse);
    global.fetch = mockFetch;

    await expect(
      callJSON('http://localhost:8080/api/tunnels?nodeId=node-1', 'GET'),
    ).rejects.toThrow('API call failed with status 502');
  });
});
