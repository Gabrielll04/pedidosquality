// Supabase Edge Function: groq-extract
// Recebe POST { text } do chatbot público, chama a Groq (gpt-oss) com a
// chave guardada em segredo (GROQ_API_KEY) e devolve os campos do pedido.
// A chave NUNCA aparece no código nem no frontend.
//
// Deploy:
//   supabase link --project-ref zkhaowtylugnjksofbcv
//   supabase secrets set GROQ_API_KEY=gsk_...
//   supabase functions deploy groq-extract

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];
const SETORES = ["Pet Shop", "Oficina", "Confeitaria", "Salão", "Gráfica", "Geral"];

const SYSTEM = `Você é um extrator de dados de pedidos de uma loja com setores: Pet Shop, Oficina, Confeitaria, Salão, Gráfica, Geral.
Responda APENAS com JSON válido, sem markdown, sem explicação, neste formato exato:
{"cliente": nome da pessoa ou "", "telefone": só dígitos com DDD ou "", "setor": um dos setores ou "", "servico": descrição do serviço/produto ou "", "valor": número (ex 150.00) ou null, "data_pedido": texto da data/horário como dito ou "", "observacoes": detalhes extras ou ""}
Regras: campo ausente -> "" (ou null para valor). Setor: infira por palavras-chave (banho/tosa->Pet Shop; carro/moto/óleo->Oficina; bolo/doce->Confeitaria; corte/cabelo/unha->Salão; banner/impressão->Gráfica).`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clean(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (o.cliente) out.cliente = String(o.cliente).slice(0, 80);
  if (o.telefone) out.telefone = String(o.telefone).replace(/\D/g, "").slice(0, 13);
  if (o.setor && SETORES.includes(String(o.setor))) out.setor = o.setor;
  if (o.servico) out.servico = String(o.servico).slice(0, 200);
  if (o.valor !== null && o.valor !== undefined && o.valor !== "") {
    const v = parseFloat(String(o.valor).replace(",", "."));
    if (!isNaN(v) && v >= 0 && v < 1000000) out.valor = v;
  }
  if (o.data_pedido) out.data_pedido = String(o.data_pedido).slice(0, 80);
  if (o.observacoes) out.observacoes = String(o.observacoes).slice(0, 300);
  return out;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Use POST com { text }" }, 405);
  }

  const apiKey = Deno.env.get("GROQ_API_KEY");
  if (!apiKey) {
    return json({ error: "GROQ_API_KEY não configurada nos secrets da function" }, 500);
  }

  let text = "";
  try {
    const body = await req.json();
    text = String(body?.text ?? "").slice(0, 800);
  } catch {
    return json({ error: "Corpo JSON inválido. Envie { text }" }, 400);
  }
  if (!text.trim()) {
    return json({ error: "Campo 'text' vazio" }, 400);
  }

  for (const model of MODELS) {
    try {
      const resp = await fetch(GROQ_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: text },
          ],
        }),
      });

      if (!resp.ok) {
        console.warn(`Groq ${resp.status} no modelo ${model}`);
        continue; // tenta o próximo modelo
      }

      const data = await resp.json();
      const raw = data?.choices?.[0]?.message?.content ?? "";
      const parsed = JSON.parse(raw);
      return json(clean(parsed));
    } catch (e) {
      console.warn(`Falha no modelo ${model}:`, (e as Error).message);
    }
  }

  return json({ error: "Groq indisponível no momento" }, 502);
});
