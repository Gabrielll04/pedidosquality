-- ==========================================================================
-- Migração: número sequencial do pedido por ordem de chegada (1, 2, 3…)
-- Como aplicar: Supabase Dashboard -> SQL Editor -> New query -> colar -> Run
-- Idempotente: pode rodar de novo sem duplicar nada.
-- Depois de rodar: pedidos novos ganham o número sozinhos; o painel exibe
-- "Nº X" na lista, tabela, cartões e no CSV.
-- ==========================================================================

-- 1. Sequência + coluna (novos pedidos numerados automaticamente) ------------
CREATE SEQUENCE IF NOT EXISTS public.pedidos_numero_seq;

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS numero BIGINT DEFAULT nextval('public.pedidos_numero_seq');

-- 2. Numera os pedidos que já existem, pela ordem de chegada (id crescente) --
WITH ranked AS (
  SELECT id, row_number() OVER (ORDER BY id ASC) AS rn
  FROM public.pedidos
  WHERE numero IS NULL
)
UPDATE public.pedidos p
SET numero = ranked.rn
FROM ranked
WHERE p.id = ranked.id;

-- 3. Ajusta a sequência para continuar do maior número existente --------------
SELECT setval(
  'public.pedidos_numero_seq',
  COALESCE((SELECT max(numero) FROM public.pedidos), 0) + 1,
  false
);

-- 4. Índice para ordenar/filtrar pelo número ----------------------------------
CREATE INDEX IF NOT EXISTS idx_pedidos_numero ON public.pedidos (numero);
