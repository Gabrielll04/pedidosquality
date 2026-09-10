# Bruna — Chat

Chatbot em **HTML + CSS + JavaScript puro**, com conversas persistidas no **Supabase**,
respostas do modelo **GPT-OSS via Groq** e hospedagem na **Cloudflare**.

Design editorial e minimalista — papel quente, tinta e verde-biblioteca —
com tipografia profissional (Fraunces + Inter) e animações discretas.

## Estrutura

| Ficheiro | Papel |
|---|---|
| `index.html` | Interface: sidebar de conversas + fio de mensagens + composer |
| `styles.css` | Design system completo (claro/escuro, responsivo, animações) |
| `app.js` | Lógica: Supabase, envio, typewriter, markdown, fallback local |
| `supabase.sql` | Tabelas `conversas` + `mensagens`, índices, trigger, RLS, Realtime |
| `functions/api/chat.js` | Proxy Cloudflare Pages → Groq (a chave fica em segredo) |
| `_headers` | Cache e segurança na Cloudflare |

## 1. Banco de dados (Supabase)

1. Abra o projeto no Supabase → **SQL Editor** → **New query**.
2. Cole o conteúdo de `supabase.sql` → **Run**.
3. Pronto: tabelas `conversas` (id, titulo, created_at, updated_at) e
   `mensagens` (id, conversa_id, papel, conteudo, created_at), com RLS
   aberto para a chave anon — mesmo padrão do painel de pedidos.

## 2. Testar localmente

Qualquer servidor estático serve (o proxy `/api/chat` só existe na Cloudflare):

```powershell
cd "Bruna   Chatgbt"
npx serve .
```

- O histórico usa o Supabase configurado (ou modo local em `localStorage`
  se o Supabase falhar).
- Para respostas locais sem deploy: abra **Definições** no app e cole a
  chave `gsk_…` da Groq (console.groq.com → API Keys). Fica só no navegador.
  Em produção, **remova-a** e use o proxy abaixo.

## 3. Hospedar na Cloudflare (Pages + chave segura)

1. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Upload assets** (ou conecte o Git). Suba o conteúdo desta pasta.
   - Build command: *(vazio)* · Output directory: `/`
2. **Pages → Settings → Environment variables** → **Add variable**:
   - `GROQ_API_KEY` = `gsk_…` (marque *Encrypt*). Repita em Production + Preview.
3. **Redeploy**. O frontend chama `POST /api/chat` → `functions/api/chat.js`
   → Groq `openai/gpt-oss-120b` (fallback `openai/gpt-oss-20b`).

## Notas

- Sem chave exposta: `app.js` nunca contém a chave da Groq.
- Animações: entrada das mensagens, indicador de escrita, typewriter da
  resposta, transições de botões e drawer mobile — tudo em CSS/JS puro,
  com respeito a `prefers-reduced-motion`.
