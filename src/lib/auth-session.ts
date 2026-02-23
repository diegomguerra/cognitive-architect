import { supabase } from '@/integrations/supabase/client';

/**
 * Force refresh the Supabase session unconditionally.
 * MUST be called after any native dialog (HealthKit, permissions, etc.)
 */
export async function forceRefreshSession(): Promise<void> {
  const { error } = await supabase.auth.refreshSession();
  if (error) {
    console.warn('[auth-session] refresh failed, signing out:', error.message);
    await supabase.auth.signOut();
    throw new Error('Session expired. Please log in again.');
  }
}

/**
 * Require a valid user ID from the current session.
 * Never uses supabase.auth.getUser() for write validation.
 */
export async function requireValidUserId(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.id) {
    throw new Error('No valid session. Please log in.');
  }
  return session.user.id;
}

/**
 * Retry wrapper for write operations.
 * If error code is 42501 (RLS violation), refreshes the session and retries once.
 * ALL writes in the app must use this wrapper.
 */
export async function retryOnAuthErrorLabeled<T>(
  fn: () => Promise<{ data: T; error: { code?: string; message: string } | null }>
): Promise<{ data: T; error: { code?: string; message: string } | null }> {
  const result = await fn();

  if (result.error?.code === '42501' || result.error?.message?.includes('42501')) {
    console.warn('[auth-session] 42501 detected, refreshing and retrying...');
    await forceRefreshSession();
    return fn();
  }

  return result;
}
