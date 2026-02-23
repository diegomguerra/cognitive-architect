#!/usr/bin/env node

/**
 * patch-ios.mjs
 * Run after `npx cap sync ios` to configure HealthKit entitlements and usage descriptions.
 *
 * Usage: node scripts/patch-ios.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const IOS_DIR = join(process.cwd(), 'ios', 'App', 'App');
const PBXPROJ = join(process.cwd(), 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');

// 1. Patch Info.plist
function patchInfoPlist() {
  const plistPath = join(IOS_DIR, 'Info.plist');
  if (!existsSync(plistPath)) {
    console.error('❌ Info.plist not found at', plistPath);
    process.exit(1);
  }

  let plist = readFileSync(plistPath, 'utf8');

  const healthDescriptions = `
	<key>NSHealthShareUsageDescription</key>
	<string>VYR precisa acessar seus dados de saúde para calcular seu estado cognitivo diário, incluindo frequência cardíaca, variabilidade cardíaca, sono e SpO2.</string>
	<key>NSHealthUpdateUsageDescription</key>
	<string>VYR registra dados de performance cognitiva no Apple Health para manter seu histórico integrado.</string>`;

  if (!plist.includes('NSHealthShareUsageDescription')) {
    // Insert before closing </dict>
    plist = plist.replace(
      /<\/dict>\s*<\/plist>/,
      `${healthDescriptions}\n</dict>\n</plist>`
    );
    writeFileSync(plistPath, plist);
    console.log('✅ Info.plist patched with HealthKit usage descriptions');
  } else {
    console.log('ℹ️  Info.plist already has HealthKit descriptions');
  }
}

// 2. Create/patch App.entitlements
function patchEntitlements() {
  const entPath = join(IOS_DIR, 'App.entitlements');
  const entitlements = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.developer.healthkit</key>
	<true/>
	<key>com.apple.developer.healthkit.access</key>
	<array>
		<string>health-records</string>
	</array>
</dict>
</plist>`;

  writeFileSync(entPath, entitlements);
  console.log('✅ App.entitlements created with HealthKit capability');
}

// 3. Patch project.pbxproj to add HealthKit SystemCapability
function patchPbxproj() {
  if (!existsSync(PBXPROJ)) {
    console.error('❌ project.pbxproj not found at', PBXPROJ);
    return;
  }

  let pbx = readFileSync(PBXPROJ, 'utf8');

  if (!pbx.includes('com.apple.HealthKit')) {
    // Add HealthKit to system capabilities
    const capabilityEntry = `\t\t\tSystemCapabilities = {\n\t\t\t\tcom.apple.HealthKit = {\n\t\t\t\t\tenabled = 1;\n\t\t\t\t};\n\t\t\t};`;

    // Try to insert after existing SystemCapabilities or after buildSettings
    if (pbx.includes('SystemCapabilities')) {
      pbx = pbx.replace(
        /SystemCapabilities = \{/,
        `SystemCapabilities = {\n\t\t\t\tcom.apple.HealthKit = {\n\t\t\t\t\tenabled = 1;\n\t\t\t\t};`
      );
    }
    writeFileSync(PBXPROJ, pbx);
    console.log('✅ project.pbxproj patched with HealthKit capability');
  } else {
    console.log('ℹ️  project.pbxproj already has HealthKit capability');
  }

  // Ensure entitlements file is referenced
  if (!pbx.includes('App.entitlements')) {
    pbx = readFileSync(PBXPROJ, 'utf8');
    pbx = pbx.replace(
      /CODE_SIGN_ENTITLEMENTS = ""/g,
      'CODE_SIGN_ENTITLEMENTS = "App/App.entitlements"'
    );
    writeFileSync(PBXPROJ, pbx);
    console.log('✅ Entitlements reference added to project.pbxproj');
  }
}

// Run all patches
console.log('🔧 Patching iOS project for HealthKit...\n');
patchInfoPlist();
patchEntitlements();
patchPbxproj();
console.log('\n🎉 iOS patch complete!');
