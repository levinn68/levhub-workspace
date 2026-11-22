#!/usr/bin/env node
/**
 * LEVHUB — Phase 0 Technical Discovery & Contract Verification Script
 * Verifies live Router API compatibility and optional OVERDRIVE runtime endpoints
 * without fabricating or hardcoding upstream schemas.
 */
const routerBase = (process.env.ROUTER_BASE_URL || 'https://router.overdriveai.my.id/v1').replace(/\/+$/, '');
const routerKey = process.env.ROUTER_API_KEY || '';
const runtimeBase = (process.env.OVERDRIVE_BASE_URL || '').replace(/\/+$/, '');
const runtimeToken = process.env.OVERDRIVE_API_TOKEN || '';

async function probe(name, url, options = {}) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(12000),
    });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    return {
      name,
      url,
      ok: res.ok,
      status: res.status,
      latencyMs: Date.now() - started,
      contentType: res.headers.get('content-type') || 'unknown',
      summary: parsed
        ? Array.isArray(parsed.data)
          ? `data[] count=${parsed.data.length}`
          : `json keys=${Object.keys(parsed).slice(0, 8).join(',')}`
        : `text len=${text.length}`,
    };
  } catch (err) {
    return {
      name,
      url,
      ok: false,
      status: 0,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

const results = [];
const routerHeaders = routerKey ? { Authorization: `Bearer ${routerKey}` } : {};

results.push(await probe('Router GET /models', `${routerBase}/models`, { headers: routerHeaders }));

if (runtimeBase) {
  const rtHeaders = runtimeToken ? { Authorization: `Bearer ${runtimeToken}` } : {};
  const mcpPath = process.env.OVERDRIVE_MCP_LIST_PATH || '/v1/mcp/servers';
  const skillsPath = process.env.OVERDRIVE_SKILLS_LIST_PATH || '/v1/skills';
  results.push(await probe('Runtime MCP Discovery', `${runtimeBase}${mcpPath}`, { headers: rtHeaders }));
  results.push(await probe('Runtime Skills Discovery', `${runtimeBase}${skillsPath}`, { headers: rtHeaders }));
} else {
  results.push({
    name: 'Runtime Discovery',
    ok: false,
    status: 0,
    summary: 'OVERDRIVE_BASE_URL belum dikonfigurasi (lewati jika belum tersedia).',
  });
}

console.log(JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
