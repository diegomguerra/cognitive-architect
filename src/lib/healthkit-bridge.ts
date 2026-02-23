/**
 * TypeScript wrapper for VYRHealthBridge (native Capacitor plugin).
 * Handles HealthKit operations NOT supported by @capgo/capacitor-health:
 * - Write: bodyTemperature, bloodPressure, vo2Max, activeEnergyBurned
 * - Background Delivery: enableBackgroundDelivery
 *
 * On web, all methods are no-ops returning false.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';

interface VYRHealthBridgePlugin {
  writeBodyTemperature(opts: { value: number; date?: string }): Promise<void>;
  writeBloodPressure(opts: { systolic: number; diastolic: number; date?: string }): Promise<void>;
  writeVO2Max(opts: { value: number; date?: string }): Promise<void>;
  writeActiveEnergy(opts: { kcal: number; startDate?: string; endDate?: string }): Promise<void>;
  enableBackgroundDelivery(): Promise<{ enabled: boolean; types?: number; errors?: string[] }>;
  requestWriteAuthorization(): Promise<{ granted: boolean }>;
}

const VYRHealthBridge = registerPlugin<VYRHealthBridgePlugin>('VYRHealthBridge');

function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

// ── Write operations ─────────────────────────────────────────────────

export async function writeBodyTemperature(degC: number, date?: string): Promise<boolean> {
  if (!isNative()) return false;
  try {
    await VYRHealthBridge.writeBodyTemperature({ value: degC, date });
    console.info('[bridge][WRITE] bodyTemperature', degC);
    return true;
  } catch (e) {
    console.error('[bridge][WRITE] bodyTemperature failed:', e);
    return false;
  }
}

export async function writeBloodPressure(systolic: number, diastolic: number, date?: string): Promise<boolean> {
  if (!isNative()) return false;
  try {
    await VYRHealthBridge.writeBloodPressure({ systolic, diastolic, date });
    console.info('[bridge][WRITE] bloodPressure', { systolic, diastolic });
    return true;
  } catch (e) {
    console.error('[bridge][WRITE] bloodPressure failed:', e);
    return false;
  }
}

export async function writeVO2Max(value: number, date?: string): Promise<boolean> {
  if (!isNative()) return false;
  try {
    await VYRHealthBridge.writeVO2Max({ value, date });
    console.info('[bridge][WRITE] vo2Max', value);
    return true;
  } catch (e) {
    console.error('[bridge][WRITE] vo2Max failed:', e);
    return false;
  }
}

export async function writeActiveEnergy(kcal: number, startDate?: string, endDate?: string): Promise<boolean> {
  if (!isNative()) return false;
  try {
    await VYRHealthBridge.writeActiveEnergy({ kcal, startDate, endDate });
    console.info('[bridge][WRITE] activeEnergy', kcal);
    return true;
  } catch (e) {
    console.error('[bridge][WRITE] activeEnergy failed:', e);
    return false;
  }
}

// ── Background Delivery ──────────────────────────────────────────────

export async function enableBackgroundDelivery(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const result = await VYRHealthBridge.enableBackgroundDelivery();
    console.info('[bridge] background delivery:', result);
    if (result.errors && result.errors.length > 0) {
      console.warn('[bridge] some types failed:', result.errors);
    }
    return result.enabled;
  } catch (e) {
    console.error('[bridge] enableBackgroundDelivery failed:', e);
    return false;
  }
}

// ── Authorization for bridge-only types ──────────────────────────────

export async function requestBridgeWriteAuthorization(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const result = await VYRHealthBridge.requestWriteAuthorization();
    console.info('[bridge] write authorization:', result);
    return result.granted;
  } catch (e) {
    console.error('[bridge] requestWriteAuthorization failed:', e);
    return false;
  }
}
