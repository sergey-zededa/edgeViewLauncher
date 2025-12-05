#!/usr/bin/env node
/**
 * Build Info Generator
 * 
 * Generates a build-info.json file with build metadata including:
 * - Build number (timestamp-based for uniqueness)
 * - Build date
 * - Git commit hash (if available)
 * 
 * Run automatically via npm prebuild hook.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Generate build number from timestamp (YYYYMMDD.HHMM format)
const now = new Date();
const buildNumber = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '.',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0')
].join('');

// Try to get git commit hash
let gitCommit = 'unknown';
try {
    gitCommit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
} catch (e) {
    // Git not available or not a git repo
}

const buildInfo = {
    buildNumber,
    buildDate: now.toISOString(),
    gitCommit
};

const outputPath = path.join(__dirname, '..', 'build-info.json');
fs.writeFileSync(outputPath, JSON.stringify(buildInfo, null, 2));

console.log(`✓ Generated build-info.json (Build ${buildNumber})`);
