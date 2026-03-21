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

// -- 1. Patch Info.plist (merge, don't overwrite) --
function patchInfoPlist() {
  const plistPath = join(IOS_DIR, 'Info.plist');
  if (!existsSync(plistPath)) {
    console.error('Info.plist not found at', plistPath);
    process.exit(1);
  }

  let plist = readFileSync(plistPath, 'utf8');
  let changed = false;

  if (!plist.includes('NSHealthShareUsageDescription')) {
    const desc = `\t<key>NSHealthShareUsageDescription</key>
\t<string>VYR Labs reads steps, body temperature, sleep analysis, heart rate, heart rate variability (HRV/SDNN), blood pressure (systolic and diastolic), VO2 Max, blood oxygen saturation (SpO2), active energy burned, and resting heart rate to compute your daily cognitive insights.</string>`;
    plist = plist.replace(/<\/dict>\s*<\/plist>/, `${desc}\n</dict>\n</plist>`);
    changed = true;
    console.log('[patch-ios] Added NSHealthShareUsageDescription');
  } else {
    console.log('[patch-ios] NSHealthShareUsageDescription already present');
  }

  if (!plist.includes('NSHealthUpdateUsageDescription')) {
    const desc = `\t<key>NSHealthUpdateUsageDescription</key>
\t<string>VYR Labs writes samples for steps, body temperature, sleep, heart rate, HRV (SDNN), blood pressure (systolic + diastolic), VO2 Max, SpO2, and active energy burned to Apple Health when you grant permission. Stress is never written to Apple Health.</string>`;
    plist = plist.replace(/<\/dict>\s*<\/plist>/, `${desc}\n</dict>\n</plist>`);
    changed = true;
    console.log('[patch-ios] Added NSHealthUpdateUsageDescription');
  } else {
    console.log('[patch-ios] NSHealthUpdateUsageDescription already present');
  }

  if (changed) writeFileSync(plistPath, plist);
}

function ensureEntitlementKey(xml, key, valueXml) {
  if (xml.includes(`<key>${key}</key>`)) {
    const pattern = new RegExp(`<key>${key}<\\/key>\\s*(<true\\/>|<false\\/>|<array>[\\s\\S]*?<\\/array>)`, 'm');
    return xml.replace(pattern, `<key>${key}</key>\n\t${valueXml}`);
  }
  return xml.replace('</dict>', `\t<key>${key}</key>\n\t${valueXml}\n</dict>`);
}

// -- 2. Create/patch App.entitlements --
function patchEntitlements() {
  const entPath = join(IOS_DIR, 'App.entitlements');
  const defaultXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
</dict>
</plist>`;

  let xml = existsSync(entPath) ? readFileSync(entPath, 'utf8') : defaultXml;

  xml = ensureEntitlementKey(xml, 'com.apple.developer.healthkit', '<true/>');
  xml = ensureEntitlementKey(xml, 'com.apple.developer.healthkit.background-delivery', '<true/>');

  // Remove health-records if accidentally present (we don't use clinical data)
  xml = xml.replace(/\s*<key>com\.apple\.developer\.healthkit\.access<\/key>\s*<array>[\s\S]*?<\/array>/g, '');
  xml = xml.replace(/\s*<string>health-records<\/string>\s*/g, '');

  writeFileSync(entPath, xml);
  console.log('[patch-ios] App.entitlements merged (idempotent)');
}

// -- 3. Patch project.pbxproj --
function patchPbxproj() {
  if (!existsSync(PBXPROJ)) {
    console.error('[patch-ios] project.pbxproj not found at', PBXPROJ);
    return;
  }

  let pbx = readFileSync(PBXPROJ, 'utf8');

  if (!pbx.includes('com.apple.HealthKit')) {
    if (pbx.includes('SystemCapabilities = {')) {
      pbx = pbx.replace(
        /SystemCapabilities = \{/,
        `SystemCapabilities = {\n\t\t\t\tcom.apple.HealthKit = {\n\t\t\t\t\tenabled = 1;\n\t\t\t\t};`,
      );
      writeFileSync(PBXPROJ, pbx);
      console.log('[patch-ios] project.pbxproj patched with HealthKit capability');
    }
  } else {
    console.log('[patch-ios] project.pbxproj already has HealthKit capability');
  }

  // Re-read in case it was written above
  pbx = readFileSync(PBXPROJ, 'utf8');
  if (!pbx.includes('CODE_SIGN_ENTITLEMENTS = "App/App.entitlements"')) {
    pbx = pbx.replace(/CODE_SIGN_ENTITLEMENTS = ""/g, 'CODE_SIGN_ENTITLEMENTS = "App/App.entitlements"');
    writeFileSync(PBXPROJ, pbx);
    console.log('[patch-ios] project.pbxproj entitlements path set');
  } else {
    console.log('[patch-ios] project.pbxproj entitlements already correct');
  }
}

console.log('[patch-ios] Patching iOS project for HealthKit...\n');
patchInfoPlist();
patchEntitlements();
patchPbxproj();
console.log('\n[patch-ios] iOS patch complete!');
