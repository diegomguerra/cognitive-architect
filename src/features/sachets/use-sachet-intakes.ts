import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type SachetIntake = {
  id: string;
  sachetType: 'BOOT' | 'HOLD' | 'CLEAR';
  takenAt: string;
  hour: number;
};

export function useSachetIntakes(day: string) {
  const [intakes, setIntakes] = useState<SachetIntake[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setIntakes([]); setLoading(false); return; }

    const { data } = await supabase
      .from('vyr_sachet_intakes')
      .select('id,sachet_type,taken_at')
      .eq('user_id', user.id)
      .eq('day', day)
      .order('taken_at', { ascending: true });

    setIntakes((data ?? []).map((r: Record<string, unknown>) => {
      const dt = new Date(r.taken_at as string);
      return {
        id: r.id as string,
        sachetType: (r.sachet_type as string).toUpperCase() as 'BOOT' | 'HOLD' | 'CLEAR',
        takenAt: r.taken_at as string,
        hour: dt.getHours() + dt.getMinutes() / 60,
      };
    }));
    setLoading(false);
  }, [day]);

  useEffect(() => { load(); }, [load]);
  return { intakes, loading, reload: load };
}
