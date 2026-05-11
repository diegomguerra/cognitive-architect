import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type Tag = {
  id: string;
  day: string;
  tagCode: string;
  comment: string | null;
  startTime: string | null;
  endTime: string | null;
};

export const FIXED_TAGS: { code: string; label: string }[] = [
  { code: 'cafe',       label: 'Café' },
  { code: 'alcool',     label: 'Álcool' },
  { code: 'exercicio',  label: 'Exercício' },
  { code: 'sono_ruim',  label: 'Sono ruim' },
  { code: 'estresse',   label: 'Estresse' },
];

export function useTags(day: string) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setTags([]); setLoading(false); return; }
    const { data } = await supabase
      .from('vyr_user_tags')
      .select('id,day,tag_code,comment,start_time,end_time')
      .eq('user_id', user.id)
      .eq('day', day)
      .order('created_at', { ascending: true });
    setTags((data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      day: r.day as string,
      tagCode: r.tag_code as string,
      comment: (r.comment as string) ?? null,
      startTime: (r.start_time as string) ?? null,
      endTime: (r.end_time as string) ?? null,
    })));
    setLoading(false);
  }, [day]);

  useEffect(() => { load(); }, [load]);

  const add = useCallback(async (tagCode: string, comment?: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('vyr_user_tags').insert({
      user_id: user.id,
      day,
      tag_code: tagCode,
      comment: comment ?? null,
    });
    await load();
  }, [day, load]);

  const remove = useCallback(async (id: string) => {
    await supabase.from('vyr_user_tags').delete().eq('id', id);
    await load();
  }, [load]);

  return { tags, loading, add, remove, reload: load };
}
