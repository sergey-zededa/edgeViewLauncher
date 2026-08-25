#!/usr/bin/env node
/**
 * Guards against version drift across the four places this app records its
 * version. These must agree, because the release pipeline mixes them:
 *
 *   - package.json            -> the `version` field written into latest.json
 *   - src-tauri/tauri.conf.json -> the version the *running* app reports, which
 *                                the updater compares against latest.json
 *   - frontend/package.json   -> shipped in the UI
 *   - src-tauri/Cargo.toml    -> crate version
 *
 * If package.json and tauri.conf.json drift, the updater either never offers an
 * update or offers the same one forever.
 *
 * When GITHUB_REF_NAME is a v* tag (i.e. during a release build) the tag is
 * checked too: latest.json takes its `version` from package.json but builds its
 * download URLs from the tag, so a mismatch publishes an unusable manifest.
 *
 * Usage: node scripts/check-versions.js
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const readJSON = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));

/** Extract `version` from the [package] section of a Cargo.toml. */
function cargoVersion(rel) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  const pkg = text.split(/^\[/m).find((section) => section.startsWith('package]'));
  if (!pkg) throw new Error(`${rel}: no [package] section`);
  const match = pkg.match(/^\s*version\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error(`${rel}: no version in [package]`);
  return match[1];
}

const sources = [
  ['package.json', readJSON('package.json').version],
  ['frontend/package.json', readJSON('frontend/package.json').version],
  ['src-tauri/tauri.conf.json', readJSON('src-tauri/tauri.conf.json').version],
  ['src-tauri/Cargo.toml', cargoVersion('src-tauri/Cargo.toml')],
];

// A release build should also match the tag it is building from.
const ref = process.env.GITHUB_REF_NAME;
if (ref && /^v\d/.test(ref)) {
  sources.push([`git tag (${ref})`, ref.replace(/^v/, '')]);
}

const width = Math.max(...sources.map(([label]) => label.length));
for (const [label, version] of sources) {
  console.log(`  ${label.padEnd(width)}  ${version}`);
}

const distinct = [...new Set(sources.map(([, version]) => version))];
if (distinct.length > 1) {
  console.error(`\nVersion mismatch: found ${distinct.map((v) => `"${v}"`).join(', ')}.`);
  console.error('All of the above must carry the same version. See CLAUDE.md "Release Process".');
  process.exit(1);
}

console.log(`\nAll versions agree: ${distinct[0]}`);
