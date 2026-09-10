-- ============================================================
-- Bruna Chat — schema Supabase para armazenar conversas
-- Como aplicar: Supabase Dashboard → SQL Editor → New query
-- → colar este ficheiro → Run. Idempotente.
-- ============================================================

-- 1. Conversas -------------------------------------------------
create table if not exists public.conversas (
  id         uuid primary key default gen_random_uuid(),
  titulo     text not null default 'Nova conversa',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Mensagens -------------------------------------------------
create table if not exists public.mensagens (
  id          uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references public.conversas(id) on delete cascade,
  papel       text not null check (papel in ('user','assistant','system')),
  conteudo    text not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_conversas_updated on public.conversas (updated_at desc);
create index if not exists idx_mensagens_conversa on public.mensagens (conversa_id, created_at);

-- 3. Mantém updated_at fresco ----------------------------------
create or replace function public.touch_conversa()
returns trigger language plpgsql as $$
begin
  update public.conversas set updated_at = now() where id = new.conversa_id;
  return new;
end $$;

drop trigger if exists trg_touch_conversa on public.mensagens;
create trigger trg_touch_conversa
  after insert on public.mensagens
  for each row execute function public.touch_conversa();

-- 4. Realtime (lista atualiza sozinha) ---------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversas'
  ) then
    alter publication supabase_realtime add table public.conversas;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mensagens'
  ) then
    alter publication supabase_realtime add table public.mensagens;
  end if;
end $$;

-- 5. RLS — acesso aberto com chave ANON (mesmo padrão do painel)
--    Para restringir depois (login), basta trocar as policies.
alter table public.conversas enable row level security;
alter table public.mensagens enable row level security;

drop policy if exists "conversas_select" on public.conversas;
create policy "conversas_select" on public.conversas for select to anon using (true);

drop policy if exists "conversas_insert" on public.conversas;
create policy "conversas_insert" on public.conversas for insert to anon with check (true);

drop policy if exists "conversas_update" on public.conversas;
create policy "conversas_update" on public.conversas for update to anon using (true) with check (true);

drop policy if exists "conversas_delete" on public.conversas;
create policy "conversas_delete" on public.conversas for delete to anon using (true);

drop policy if exists "mensagens_select" on public.mensagens;
create policy "mensagens_select" on public.mensagens for select to anon using (true);

drop policy if exists "mensagens_insert" on public.mensagens;
create policy "mensagens_insert" on public.mensagens for insert to anon with check (true);

drop policy if exists "mensagens_delete" on public.mensagens;
create policy "mensagens_delete" on public.mensagens for delete to anon using (true);
