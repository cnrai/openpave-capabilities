#!/usr/bin/env node
/**
 * lint-capabilities.js — schema v1 lint for capabilities.yaml
 * (cnrai/openpave#2638).
 *
 * Validates the cnrai-curated MCP catalog:
 *   - top-level `mcps` map exists (entries may be zero — the seed state)
 *   - ids match ^[a-z0-9][a-z0-9-]*$ (lowercase kebab; runtime id is mcp:<id>)
 *   - transport is `http` (v1: remote only — Streamable HTTP, SSE fallback)
 *   - url is a well-formed https:// URL (loopback http:// allowed for dev)
 *   - auth shape: type none | oauth2 | bearer
 *       oauth2: authorizeUrl/tokenUrl (when present) are https; scopes is a
 *         string array; clientId optional (omitted => RFC 7591 DCR attempted)
 *       bearer: header/prefix/tokenLabel are strings (value NEVER in this file)
 *   - name/description/version are strings when present; tags is a string array
 *   - duplicate ids cannot occur in a YAML map, but near-duplicate ids that
 *     normalize to the same kebab form are flagged (deterministic-id hygiene)
 *
 * Exit 0 = clean; exit 1 = findings printed.
 */

'use strict';

const fs = require('fs');
const path = require('path');

let yaml;
try {
  yaml = require('js-yaml');
} catch (e) {
  console.error('lint-capabilities: js-yaml is required (npm install)');
  process.exit(1);
}

const FILE = process.argv[2] || path.join(__dirname, '..', 'capabilities.yaml');
const findings = [];

function fail(msg) { findings.push(msg); }

function isHttpsUrl(u) {
  if (typeof u !== 'string') return false;
  try {
    const parsed = new URL(u);
    if (parsed.protocol === 'https:') return true;
    // Dev convenience: loopback may be plain http.
    if (parsed.protocol === 'http:'
      && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1')) {
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

const doc = (() => {
  let raw;
  try {
    raw = fs.readFileSync(FILE, 'utf8');
  } catch (e) {
    console.error('lint-capabilities: cannot read ' + FILE + ': ' + e.message);
    process.exit(1);
  }
  try {
    return yaml.load(raw);
  } catch (e) {
    console.error('lint-capabilities: YAML parse error in ' + FILE + ': ' + e.message);
    process.exit(1);
  }
})();

if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
  fail('top-level document must be a mapping');
} else if (!doc.mcps || typeof doc.mcps !== 'object' || Array.isArray(doc.mcps)) {
  fail('missing `mcps:` map (schema v1)');
} else {
  const mcps = doc.mcps;
  const normalized = {};
  for (const id of Object.keys(mcps)) {
    const entry = mcps[id];
    const where = 'mcps.' + id;

    if (!ID_RE.test(id)) {
      fail(where + ': id must match ^[a-z0-9][a-z0-9-]*$ (lowercase kebab)');
    }
    const norm = id.replace(/[^a-z0-9]/g, '');
    if (normalized[norm]) {
      fail(where + ': id normalizes to the same form as "' + normalized[norm] + '" — deterministic-id hygiene');
    } else {
      normalized[norm] = id;
    }

    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      fail(where + ': entry must be a mapping');
      continue;
    }

    if (entry.transport !== 'http') {
      fail(where + '.transport: must be "http" (v1 is remote-only)');
    }
    if (!isHttpsUrl(entry.url)) {
      fail(where + '.url: must be a well-formed https URL (loopback http allowed for dev), got: '
        + JSON.stringify(entry.url));
    }

    const auth = entry.auth === undefined ? { type: 'none' } : entry.auth;
    if (!auth || typeof auth !== 'object' || Array.isArray(auth)) {
      fail(where + '.auth: must be a mapping');
    } else if (auth.type === 'none') {
      // nothing else to check
    } else if (auth.type === 'oauth2') {
      for (const key of ['authorizeUrl', 'tokenUrl']) {
        if (auth[key] !== undefined && !isHttpsUrl(auth[key])) {
          fail(where + '.auth.' + key + ': must be a well-formed https URL (pin/fallback only — runtime discovery is primary)');
        }
      }
      if (auth.scopes !== undefined) {
        if (!Array.isArray(auth.scopes) || auth.scopes.some((s) => typeof s !== 'string')) {
          fail(where + '.auth.scopes: must be an array of strings');
        }
      }
      if (auth.clientId !== undefined && typeof auth.clientId !== 'string') {
        fail(where + '.auth.clientId: must be a string (omitted => RFC 7591 DCR)');
      }
    } else if (auth.type === 'bearer') {
      for (const key of ['header', 'prefix', 'tokenLabel']) {
        if (auth[key] !== undefined && typeof auth[key] !== 'string') {
          fail(where + '.auth.' + key + ': must be a string');
        }
      }
    } else {
      fail(where + '.auth.type: must be none | oauth2 | bearer, got: ' + JSON.stringify(auth.type));
    }

    for (const key of ['name', 'description', 'version']) {
      if (entry[key] !== undefined && typeof entry[key] !== 'string') {
        fail(where + '.' + key + ': must be a string');
      }
    }
    if (entry.tags !== undefined) {
      if (!Array.isArray(entry.tags) || entry.tags.some((t) => typeof t !== 'string')) {
        fail(where + '.tags: must be an array of strings');
      }
    }
  }
}

if (findings.length) {
  console.error('lint-capabilities: ' + findings.length + ' finding(s):');
  for (const f of findings) console.error('  - ' + f);
  process.exit(1);
}

console.log('lint-capabilities: OK (' + FILE + ')');
