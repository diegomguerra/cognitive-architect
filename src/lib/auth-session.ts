import { supabase } from '@/integrations/supabase/client';

/**
 * Safely preview a token for logging (first 8 chars + length).
 * NEVER logs the full token.
 */
function tokenPreview(token: string | undefined | null): string {
  if (!token) return 'NONE';
  return `${token.slice(0, 8)}…(${token.length})`;
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * FIX P2: Force refresh the Supabase session.
 * No longer calls signOut() on failure — that was destroying sessions for users
 * on slow/transitional networks (e.g. just after a native HealthKit dialog).
 * Throws on failure so callers can decide what to do.
 */
export async function forceRefreshSession(): Promise<void> {
  const { data, error } = await supabase.auth.refreshSession();
  if (error) {
    // Log the failure but DO NOT sign the user out.
    // The caller decides whether to retry or surface an error.
    console.warn('[DB][AUTH] refresh failed (NOT signing out):', error.message);
    throw new Error(`Session refresh failed: ${error.message}`);
  }
  console.info('[DB][AUTH] session refreshed', {
    userId: data.session?.user?.id ?? 'NONE',
    hasToken: !!data.session?.access_token,
    expiresAt: data.session?.expires_at
      ? new Date(data.session.expires_at * 1000).toISOString()
      : 'NONE',
  });
}

/**
 * Require a valid user ID AND access_token from the current session.
 * FIX P2: If session is stale, attempts up to 3 refreshes with exponential backoff
 * before giving up. Never signs the user out.
 */
export async function requireValidUserId(): Promise<string> {
  let { data: { session } } = await supabase.auth.getSession();

  // If no token, attempt refresh with backoff (up to 3 attempts)
  if (!session?.access_token) {
    console.warn('[DB][AUTH] no token on first attempt, refreshing with backoff…');
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await forceRefreshSession();
        const refreshed = await supabase.auth.getSession();
        session = refreshed.data.session;
        if (session?.access_token) break;
      } catch {
        if (attempt < 3) {
          await sleep(attempt * 500); // 500ms, 1000ms, 1500ms
        }
      }
    }
  }

  if (!session?.user?.id || !session?.access_token) {
    console.warn('[DB][AUTH] ABORT — no valid session after retries', {
      userId: session?.user?.id ?? 'NONE',
      hasToken: !!session?.access_token,
    });
    throw new Error('No valid session. Please log in again.');
  }

  console.info('[DB][AUTH] validated', {
    userId: session.user.id,
    hasToken: true,
    tokenPreview: tokenPreview(session.access_token),
    expiresAt: session.expires_at
      ? new Date(session.expires_at * 1000).toISOString()
      : 'NONE',
  });

  return session.user.id;
}

/**
 * Retry wrapper for ALL write operations (insert/update/upsert/delete).
 * On 42501 (RLS violation), refreshes session and retries once.
 * Emits structured diagnostic logs for every outcome.
 */
export async function retryOnAuthErrorLabeled<T>(
  fn: () => Promise<{ data: T; error: { code?: string; message: string; details?: string; hint?: string } | null }>,
  meta?: { table?: string; operation?: string }
): Promise<{ data: T; error: { code?: string; message: string } | null }> {
  const tag = meta?.table ? `[DB][WRITE:${meta.table}]` : '[DB][WRITE]';

  const result = await fn();

  if (result.error) {
    const is42501 = result.error.code === '42501' || result.error.message?.includes('42501');

    console.error(`${tag} error`, {
      table: meta?.table ?? 'unknown',
      operation: meta?.operation ?? 'unknown',
      code: result.error.code,
      message: result.error.message,
      details: (result.error as any).details,
      hint: (result.error as any).hint,
    });

    if (is42501) {
      console.warn(`${tag} 42501 detected — refreshing session and retrying…`);
      try {
        await forceRefreshSession();
      } catch {
        // FIX P2: refresh failed but we don't sign out. Return the original error.
        console.warn(`${tag} session refresh failed during retry — returning original error`);
        return result;
      }
      const retry = await fn();
      if (retry.error) {
        console.error(`${tag} retry FAILED`, {
          code: retry.error.code,
          message: retry.error.message,
        });
      } else {
        console.info(`${tag} retry SUCCESS`);
      }
      return retry;
    }
  } else {
    const rows = Array.isArray(result.data) ? result.data.length : result.data ? 1 : 0;
    console.info(`${tag} OK`, {
      table: meta?.table,
      operation: meta?.operation,
      rowsCount: rows,
    });
  }

  return result;
}
