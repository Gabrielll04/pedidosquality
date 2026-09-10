// Cloudflare Pages Function — POST /api/chat
// Proxy seguro para a Groq (modelo GPT-OSS). A chave fica em segredo
// nas variáveis de ambiente da Cloudflare (GROQ_API_KEY) e nunca
// aparece no frontend nem no repositório.
//
// Deploy (Cloudflare Pages):
//   1. Suba esta pasta ("Bruna Chatgbt") como projeto Pages.
//      Build command: (vazio) · Output directory: /
//   2. Pages → Settings → Environment variables → Add:
//      GROQ_API_KEY = gsk_...
//   3. Redeploy. O frontend chama /api/chat automaticamente.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: cors });
}

export async function onRequestPost({ request, env }) {
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) {
    return json({ error: "GROQ_API_KEY não configurada na Cloudflare (Pages → Settings → Environment variables)." }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corpo JSON inválido. Envie { messages: [...] }." }, 400);
  }

  let system = String(body.system || "").slice(0, 2000);
  const reasoning = body.reasoning === true;
  const deep = body.deep === true;
  if (reasoning) system += "\nRaciocine passo a passo antes de responder.";
  if (deep) system += "\nDê uma resposta aprofundada e completa.";
  const temperature = reasoning ? 0.2 : 0.4;
  const max_tokens = deep ? 2500 : 1200;
  const messages = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
  if (!messages.length) return json({ error: "Nenhuma mensagem recebida." }, 400);

  const chat = [
    ...(system ? [{ role: "system", content: system }] : []),
    ...messages
      .filter((m) => m && typeof m.content === "string")
      .map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: String(m.content).slice(0, 4000),
      })),
  ];

  for (const model of MODELS) {
    try {
      const resp = await fetch(GROQ_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, temperature, max_tokens, messages: chat }),
      });
      if (!resp.ok) continue; // tenta o próximo modelo
      const data = await resp.json();
      const reply = data?.choices?.[0]?.message?.content?.trim();
      if (reply) return json({ reply, model });
    } catch {
      // tenta o próximo modelo
    }
  }
  return json({ error: "A Groq está indisponível no momento. Tente novamente em instantes." }, 502);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
