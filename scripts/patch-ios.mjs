#!/usr/bin/env node

/**
 * patch-ios.mjs
 * Idempotent merge-based patching for HealthKit entitlements and usage descriptions.
 * Run after `npx cap sync ios`.
 *
 * RULES:
 * - Never overwrites existing keys — only adds missing ones.
 * - Never inserts health-records (we don't use clinical data).
 * - Preserves background-delivery entitlement.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const IOS_DIR = join(process.cwd(), 'ios', 'App', 'App');
const PBXPROJ = join(process.cwd(), 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');

function insertBeforeClosingDict(xml, snippet) {
  return xml.replace(/<\/dict>\s*<\/plist>\s*$/, `${snippet}\n</dict>\n</plist>`);
}

function patchInfoPlist() {
  const plistPath = join(IOS_DIR, 'Info.plist');
  if (!existsSync(plistPath)) {
    throw new Error(`Info.plist not found at ${plistPath}`);
  }

  let plist = readFileSync(plistPath, 'utf8');
  let changed = false;

  if (!plist.includes('NSHealthShareUsageDescription')) {
    const shareDescription = `\t<key>NSHealthShareUsageDescription</key>\n\t<string>VYR Labs reads your heart rate, resting heart rate, heart rate variability (HRV), sleep analysis, step count, blood oxygen saturation (SpO2), and respiratory rate to calculate your daily cognitive performance score and provide personalized insights.</string>`;
    plist = insertBeforeClosingDict(plist, `${shareDescription}\n`);
    changed = true;
  }

  if (!plist.includes('NSHealthUpdateUsageDescription')) {
    const updateDescription = `\t<key>NSHealthUpdateUsageDescription</key>\n\t<string>VYR Labs writes steps, heart rate, HRV, sleep, SpO2, body temperature, blood pressure, VO2 max, and active energy back to Apple Health so you can view cognitive wellness trends alongside your health data. No raw data is modified. Disable anytime in Settings › Privacy › Health.</string>`;
    plist = insertBeforeClosingDict(plist, `${updateDescription}\n`);
    changed = true;
  }

  if (changed) {
    writeFileSync(plistPath, plist);
    console.log('✅ Info.plist merged with missing HealthKit descriptions');
  } else {
    console.log('ℹ️  Info.plist already contains HealthKit descriptions');
  }
}

function ensureEntitlementKey(xml, key, valueXml) {
  if (xml.includes(`<key>${key}</key>`)) {
    const pattern = new RegExp(`<key>${key}<\\/key>\\s*(<true\\/>|<false\\/>|<array>[\\s\\S]*?<\\/array>)`, 'm');
    return xml.replace(pattern, `<key>${key}</key>\n\t${valueXml}`);
  }

  return xml.replace('</dict>', `\t<key>${key}</key>\n\t${valueXml}\n</dict>`);
}

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

  // Never keep clinical records access.
  xml = xml.replace(/\s*<key>com\.apple\.developer\.healthkit\.access<\/key>\s*<array>[\s\S]*?<\/array>/g, '');
  xml = xml.replace(/\s*<string>health-records<\/string>\s*/g, '');

  writeFileSync(entPath, xml);
  console.log('✅ App.entitlements merged (idempotent), HealthKit enabled, no health-records');
}

function patchPbxproj() {
  if (!existsSync(PBXPROJ)) {
    throw new Error(`project.pbxproj not found at ${PBXPROJ}`);
  }

  let pbx = readFileSync(PBXPROJ, 'utf8');
  let changed = false;

  if (!pbx.includes('com.apple.HealthKit')) {
    pbx = pbx.replace(
      /SystemCapabilities = \{/,
      `SystemCapabilities = {\n\t\t\t\tcom.apple.HealthKit = {\n\t\t\t\t\tenabled = 1;\n\t\t\t\t};`,
    );
    changed = true;
  }

  if (!pbx.includes('CODE_SIGN_ENTITLEMENTS = "App/App.entitlements"')) {
    pbx = pbx.replace(/CODE_SIGN_ENTITLEMENTS = ""/g, 'CODE_SIGN_ENTITLEMENTS = "App/App.entitlements"');
    changed = true;
  }

  if (changed) {
    writeFileSync(PBXPROJ, pbx);
    console.log('✅ project.pbxproj merged with HealthKit capability and entitlements signing path');
  } else {
    console.log('ℹ️  project.pbxproj already includes HealthKit capability and entitlements path');
  }
}

console.log('🔧 Patching iOS project for HealthKit...\n');
patchInfoPlist();
patchEntitlements();
patchPbxproj();
console.log('\n🎉 iOS patch complete!');
