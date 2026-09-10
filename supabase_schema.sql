-- ==========================================================================
-- Schema do projeto: Sistema de Pedidos + Chatbot público
-- Banco: Supabase Postgres
-- Como aplicar: Supabase Dashboard -> SQL Editor -> New query -> colar -> Run
-- Script idempotente: pode rodar de novo sem duplicar nada.
-- ==========================================================================

-- 1. Sequência do número por ordem de chegada (criada antes da tabela) -------
CREATE SEQUENCE IF NOT EXISTS public.pedidos_numero_seq;

-- 2. Tabela de pedidos (colunas usadas por app.js e chatbot.js) ----------------
CREATE TABLE IF NOT EXISTS public.pedidos (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  numero        BIGINT DEFAULT nextval('public.pedidos_numero_seq'),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  setor         TEXT NOT NULL DEFAULT 'Geral',
  status        TEXT NOT NULL DEFAULT 'Pendente',
  cliente       TEXT NOT NULL,
  telefone      TEXT,
  servico       TEXT NOT NULL,
  valor         NUMERIC(10, 2) NOT NULL DEFAULT 0,
  data_pedido   TEXT,
  observacoes   TEXT
);

-- Garante colunas caso a tabela já exista com formato antigo
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS numero      BIGINT DEFAULT nextval('public.pedidos_numero_seq');
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS setor       TEXT NOT NULL DEFAULT 'Geral';
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS status      TEXT NOT NULL DEFAULT 'Pendente';
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS cliente     TEXT;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS telefone    TEXT;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS servico     TEXT;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS valor       NUMERIC(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS data_pedido TEXT;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS observacoes TEXT;

-- 3. Índices para filtros do painel --------------------------------------------
CREATE INDEX IF NOT EXISTS idx_pedidos_setor  ON public.pedidos (setor);
CREATE INDEX IF NOT EXISTS idx_pedidos_numero ON public.pedidos (numero);
CREATE INDEX IF NOT EXISTS idx_pedidos_status ON public.pedidos (status);
CREATE INDEX IF NOT EXISTS idx_pedidos_id_desc ON public.pedidos (id DESC);

-- 4. Realtime (atualização ao vivo no painel) ------------------------------------
-- Inclui a tabela na publicação do Realtime (ignora se já estiver incluída)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'pedidos'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pedidos;
  END IF;
END
$$;

-- 5. Segurança (RLS) -------------------------------------------------------------
-- O painel (app.js) e o chatbot (chatbot.js) usam a chave ANON pública para
-- ler, criar, atualizar e excluir. As policies abaixo liberam isso.
-- ATENÇÃO: acesso aberto. Quando quiser restringir (ex: login para o painel),
-- me peça que eu ajusto as policies.
ALTER TABLE public.pedidos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Leitura publica dos pedidos"  ON public.pedidos;
CREATE POLICY "Leitura publica dos pedidos"
  ON public.pedidos FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Insert publico de pedidos" ON public.pedidos;
CREATE POLICY "Insert publico de pedidos"
  ON public.pedidos FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "Update publico de pedidos" ON public.pedidos;
CREATE POLICY "Update publico de pedidos"
  ON public.pedidos FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Delete publico de pedidos" ON public.pedidos;
CREATE POLICY "Delete publico de pedidos"
  ON public.pedidos FOR DELETE TO anon USING (true);
