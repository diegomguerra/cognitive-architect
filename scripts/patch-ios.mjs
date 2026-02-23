#!/usr/bin/env node

/**
 * patch-ios.mjs
 * Idempotent merge-based patching for HealthKit entitlements and usage descriptions.
 * Run after `npx cap sync ios`.
 *
 * RULES:
 * - Never overwrites existing keys — only adds missing ones.
 * - Never inserts health-records (we don't use clinical data).
 * - Preserves background-delivery if already present.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const IOS_DIR = join(process.cwd(), 'ios', 'App', 'App');
const PBXPROJ = join(process.cwd(), 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');

// ── 1. Patch Info.plist (merge, don't overwrite) ───────────────────
function patchInfoPlist() {
  const plistPath = join(IOS_DIR, 'Info.plist');
  if (!existsSync(plistPath)) {
    console.error('❌ Info.plist not found at', plistPath);
    process.exit(1);
  }

  let plist = readFileSync(plistPath, 'utf8');
  let changed = false;

  // NSHealthShareUsageDescription
  if (!plist.includes('NSHealthShareUsageDescription')) {
    const desc = `\t<key>NSHealthShareUsageDescription</key>
\t<string>VYR Labs reads your heart rate, resting heart rate, HRV (SDNN), sleep analysis, step count, SpO2, respiratory rate, body temperature, blood pressure, VO2 max, and active energy to calculate your daily cognitive performance score. Data is processed on-device and stored securely. Revoke access anytime in Settings › Privacy › Health.</string>`;
    plist = plist.replace(/<\/dict>\s*<\/plist>/, `${desc}\n</dict>\n</plist>`);
    changed = true;
    console.log('✅ Added NSHealthShareUsageDescription');
  } else {
    console.log('ℹ️  NSHealthShareUsageDescription already present');
  }

  // NSHealthUpdateUsageDescription
  if (!plist.includes('NSHealthUpdateUsageDescription')) {
    const desc = `\t<key>NSHealthUpdateUsageDescription</key>
\t<string>VYR Labs writes steps, heart rate, HRV, sleep, SpO2, body temperature, blood pressure, VO2 max, and active energy back to Apple Health so you can view cognitive wellness trends alongside your health data. No raw data is modified. Disable anytime in Settings › Privacy › Health.</string>`;
    plist = plist.replace(/<\/dict>\s*<\/plist>/, `${desc}\n</dict>\n</plist>`);
    changed = true;
    console.log('✅ Added NSHealthUpdateUsageDescription');
  } else {
    console.log('ℹ️  NSHealthUpdateUsageDescription already present');
  }

  if (changed) writeFileSync(plistPath, plist);
}

// ── 2. Merge entitlements (never overwrite, never add health-records) ──
function patchEntitlements() {
  const entPath = join(IOS_DIR, 'App.entitlements');
  let existing = existsSync(entPath) ? readFileSync(entPath, 'utf8') : '';

  const needsHealthkit = !existing.includes('com.apple.developer.healthkit');
  const needsBgDelivery = !existing.includes('com.apple.developer.healthkit.background-delivery');
  const hasHealthRecords = existing.includes('health-records');

  if (!needsHealthkit && !needsBgDelivery && !hasHealthRecords) {
    console.log('ℹ️  Entitlements already correct');
    return;
  }

  // Remove health-records if present (not needed, risks App Review rejection)
  if (hasHealthRecords) {
    existing = existing.replace(/<string>health-records<\/string>\s*/g, '');
    // Clean up empty access array if it was the only entry
    existing = existing.replace(
      /<key>com\.apple\.developer\.healthkit\.access<\/key>\s*<array>\s*<\/array>/g,
      ''
    );
    console.log('✅ Removed health-records from entitlements');
  }

  // If file doesn't exist or is empty, create from scratch
  if (!existing.includes('<dict>')) {
    existing = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>com.apple.developer.healthkit</key>
\t<true/>
\t<key>com.apple.developer.healthkit.background-delivery</key>
\t<true/>
</dict>
</plist>`;
  } else {
    // Merge missing keys before </dict>
    let insertions = '';
    if (needsHealthkit) {
      insertions += '\t<key>com.apple.developer.healthkit</key>\n\t<true/>\n';
    }
    if (needsBgDelivery) {
      insertions += '\t<key>com.apple.developer.healthkit.background-delivery</key>\n\t<true/>\n';
    }
    if (insertions) {
      existing = existing.replace(/<\/dict>/, `${insertions}</dict>`);
    }
  }

  writeFileSync(entPath, existing);
  console.log('✅ Entitlements patched (merge-safe)');
}

// ── 3. Patch project.pbxproj ───────────────────────────────────────
function patchPbxproj() {
  if (!existsSync(PBXPROJ)) {
    console.error('❌ project.pbxproj not found at', PBXPROJ);
    return;
  }

  let pbx = readFileSync(PBXPROJ, 'utf8');
  let changed = false;

  if (!pbx.includes('com.apple.HealthKit')) {
    if (pbx.includes('SystemCapabilities')) {
      pbx = pbx.replace(
        /SystemCapabilities = \{/,
        `SystemCapabilities = {\n\t\t\t\tcom.apple.HealthKit = {\n\t\t\t\t\tenabled = 1;\n\t\t\t\t};`
      );
      changed = true;
    }
  }

  if (!pbx.includes('App.entitlements') && pbx.includes('CODE_SIGN_ENTITLEMENTS = ""')) {
    pbx = pbx.replace(
      /CODE_SIGN_ENTITLEMENTS = ""/g,
      'CODE_SIGN_ENTITLEMENTS = "App/App.entitlements"'
    );
    changed = true;
  }

  if (changed) {
    writeFileSync(PBXPROJ, pbx);
    console.log('✅ project.pbxproj patched');
  } else {
    console.log('ℹ️  project.pbxproj already correct');
  }
}

// Run
console.log('🔧 Patching iOS project for HealthKit (merge-safe)…\n');
patchInfoPlist();
patchEntitlements();
patchPbxproj();
console.log('\n🎉 iOS patch complete!');
