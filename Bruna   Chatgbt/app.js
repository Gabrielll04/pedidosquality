/* ============================================================
   Bruna AI — Chat (layout ref. Chatterbox)
   Vanilla JS · Supabase (conversas + mensagens) · Groq gpt-oss
   via proxy Cloudflare /api/chat (chave nunca no frontend).
   Fallback: localStorage quando Supabase indisponível.
   ============================================================ */

const DEFAULTS = {
  SUPABASE_URL: "https://zkhaowtylugnjksofbcv.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_hKZ6gh7n_Xc_7C8xhhW_og_HemVWF2-",
  SYSTEM_PROMPT:
    "Você é Bruna, uma assessora direta e sofisticada. Responda em português (pt-BR), com clareza, precisão e tom profissional discreto. Sem emojis, sem jargão de IA, sem frases feitas. Estruture com títulos e listas quando útil. Seja concisa salvo pedido em contrário.",
  CHAT_ENDPOINT: "/api/chat",
};

const store = {
  get(k, fb = "") { try { const v = localStorage.getItem(k); return v ?? fb; } catch { return fb; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

const cfg = {
  name: store.get("bruna_name", ""),
  supabaseUrl: store.get("bruna_sb_url", DEFAULTS.SUPABASE_URL),
  supabaseKey: store.get("bruna_sb_key", DEFAULTS.SUPABASE_ANON_KEY),
  groqKey: store.get("bruna_groq_key", ""), // só teste local
  system: store.get("bruna_system", DEFAULTS.SYSTEM_PROMPT),
};

let sb = null;
let dbMode = "local";
let convs = [];
let activeId = null;
let messages = [];
let sending = false;
let reasoning = false;
let deep = false;

const $ = (id) => document.getElementById(id);
const els = {};
const LOCAL_KEY = "bruna_chats_v1";

/* ---------------- boot ---------------- */
document.addEventListener("DOMContentLoaded", () => {
  [
    "thread", "hero", "greeting", "conv-list", "search", "input", "send",
    "composer", "typing", "db-status", "db-status-text", "toast-root",
    "btn-new", "btn-history", "history", "btn-menu", "menu",
    "btn-export", "btn-settings", "theme-toggle",
    "settings-modal", "set-name", "set-supabase-url", "set-supabase-key",
    "set-groq-key", "set-system",
    "btn-close-settings", "btn-settings-cancel", "btn-settings-save",
    "btn-wipe-local", "btn-reason", "btn-deep", "btn-mic",
    "btn-attach", "file", "btn-bell", "btn-account",
    "sb-badge", "groq-badge", "btn-test-sb", "btn-test-groq",
    "eye-sb", "eye-groq",
  ].forEach((id) => { els[id] = $(id); });

  initTheme();
  setGreeting();
  bindUI();
  autoGrow();
  initDB().then(() => loadConvs());
});

function bindUI() {
  els.composer.addEventListener("submit", onSend);
  els.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(e); }
  });
  els.input.addEventListener("input", autoGrow);

  els["btn-new"].addEventListener("click", () => { newConversation(); closeHistory(); });
  els.search.addEventListener("input", renderConvList);

  // menu da conversa
  els["btn-menu"].addEventListener("click", (e) => {
    e.stopPropagation();
    els.menu.hidden = !els.menu.hidden;
  });
  document.addEventListener("click", () => { els.menu.hidden = true; });
  els.menu.querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      els.menu.hidden = true;
      const act = b.dataset.m;
      if (act === "rename") renameActive();
      if (act === "export") exportActive();
      if (act === "delete") deleteActive();
    })
  );

  // toggles reasoning / deep
  els["btn-reason"].addEventListener("click", () => {
    reasoning = !reasoning;
    els["btn-reason"].classList.toggle("on", reasoning);
    els["btn-reason"].setAttribute("aria-pressed", String(reasoning));
  });
  els["btn-deep"].addEventListener("click", () => {
    deep = !deep;
    els["btn-deep"].classList.toggle("on", deep);
    els["btn-deep"].setAttribute("aria-pressed", String(deep));
  });

  // anexo de texto
  els["btn-attach"].addEventListener("click", () => els.file.click());
  els.file.addEventListener("change", onAttach);

  // microfone (Web Speech API)
  els["btn-mic"].addEventListener("click", toggleMic);

  // histórico mobile
  els["btn-history"].addEventListener("click", () => els.history.classList.toggle("open"));
  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => {
      if (t.classList.contains("active")) return;
      toast(`"${t.dataset.tab}" em breve — o Chat IA já está ativo.`);
    })
  );
  els["btn-bell"].addEventListener("click", () => toast("Nenhuma notificação nova."));
  els["btn-account"].addEventListener("click", openSettings);

  // trilho lateral
  document.querySelectorAll(".rbtn").forEach((b) =>
    b.addEventListener("click", () => {
      const act = b.dataset.act;
      if (act === "new") { newConversation(); }
      if (act === "search") { openHistory(); els.search.focus(); }
      if (act === "export") exportActive();
      if (act === "prompts") { openHistory(); toast("Escolha uma sugestão na tela inicial."); }
      if (act === "grid") openHistory();
      if (act === "settings") openSettings();
      if (act === "logout") toast("Sessão local — nada a encerrar.");
    })
  );

  // sugestões do herói
  document.querySelectorAll(".sug").forEach((b) =>
    b.addEventListener("click", () => { els.input.value = b.dataset.sug; autoGrow(); els.input.focus(); })
  );

  els["btn-export"].addEventListener("click", exportActive);
  els["btn-settings"].addEventListener("click", openSettings);
  els["theme-toggle"].addEventListener("click", toggleTheme);

  els["btn-settings-save"].addEventListener("click", saveSettings);
  els["btn-settings-cancel"].addEventListener("click", closeSettings);
  els["btn-close-settings"].addEventListener("click", closeSettings);
  els["settings-modal"].addEventListener("click", (e) => { if (e.target === els["settings-modal"]) closeSettings(); });
  els["btn-wipe-local"].addEventListener("click", () => {
    store.del(LOCAL_KEY);
    toast("Dados locais apagados.");
  });
  // testes de credenciais + mostrar/ocultar
  els["btn-test-sb"].addEventListener("click", testSupabase);
  els["btn-test-groq"].addEventListener("click", testGroq);
  els["eye-sb"].addEventListener("click", () => toggleEye("set-supabase-key"));
  els["eye-groq"].addEventListener("click", () => toggleEye("set-groq-key"));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSettings(); });
}

function openHistory() {
  if (window.matchMedia("(max-width: 1080px)").matches) els.history.classList.add("open");
}
function closeHistory() {
  if (window.matchMedia("(max-width: 1080px)").matches) els.history.classList.remove("open");
}

/* ---------------- saudação ---------------- */
function setGreeting() {
  const h = new Date().getHours();
  const part = h < 6 ? "Boa madrugada" : h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
  const who = cfg.name ? `, ${cfg.name}` : "";
  els.greeting.innerHTML = `${part}${who}.<br>Como posso ajudar?`;
}

/* ---------------- tema (escuro padrão) ---------------- */
function initTheme() {
  if (store.get("bruna_theme", "dark") === "light") document.body.classList.add("light");
}
function toggleTheme() {
  const light = document.body.classList.toggle("light");
  store.set("bruna_theme", light ? "light" : "dark");
}

/* ---------------- Supabase ---------------- */
async function initDB() {
  setDbStatus("local", "A ligar…");
  try {
    if (window.supabase?.createClient && cfg.supabaseUrl && cfg.supabaseKey) {
      sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
      const { error } = await sb.from("conversas").select("id", { count: "exact", head: true });
      if (error) throw error;
      dbMode = "supabase";
      setDbStatus("ok", "Supabase ligado");
      return;
    }
    throw new Error("SDK indisponível");
  } catch (e) {
    console.warn("Supabase indisponível, modo local:", e?.message);
    sb = null; dbMode = "local";
    setDbStatus("local", "Modo local (sem Supabase)");
  }
}
function setDbStatus(mode, text) {
  els["db-status"].className = "db-status " + (mode === "ok" ? "" : mode);
  els["db-status-text"].textContent = text;
}

/* ---------------- conversas ---------------- */
function readLocal() {
  try { return JSON.parse(store.get(LOCAL_KEY, '{"convs":[]}')); } catch { return { convs: [] }; }
}
function writeLocal(data) { store.set(LOCAL_KEY, JSON.stringify(data)); }

async function loadConvs() {
  if (dbMode === "supabase") {
    const { data, error } = await sb.from("conversas").select("*").order("updated_at", { ascending: false }).limit(100);
    if (error) { setDbStatus("err", "Falha Supabase — modo local"); dbMode = "local"; return loadConvs(); }
    convs = data || [];
  } else {
    const d = readLocal();
    convs = (d.convs || []).map((c) => ({ id: c.id, titulo: c.titulo, updated_at: c.updated_at, created_at: c.created_at }));
  }
  renderConvList();
  if (convs.length) selectConversation(convs[0].id);
  else newConversation(true);
}

async function loadMessages(id) {
  if (dbMode === "supabase") {
    const { data } = await sb.from("mensagens").select("*").eq("conversa_id", id).order("created_at", { ascending: true }).limit(500);
    messages = (data || []).map((m) => ({ papel: m.papel, conteudo: m.conteudo, created_at: m.created_at }));
  } else {
    const d = readLocal();
    const c = d.convs.find((x) => x.id === id);
    messages = c?.messages || [];
  }
}

async function persistMessage(conversaId, papel, conteudo) {
  const row = { papel, conteudo, created_at: new Date().toISOString() };
  if (dbMode === "supabase") {
    const { error } = await sb.from("mensagens").insert([{ conversa_id: conversaId, papel, conteudo }]);
    if (error) throw error;
    await sb.from("conversas").update({ updated_at: row.created_at }).eq("id", conversaId);
  } else {
    const d = readLocal();
    const c = d.convs.find((x) => x.id === conversaId);
    if (c) { c.messages.push(row); c.updated_at = row.created_at; writeLocal(d); }
  }
}

async function createConversationRow(titulo = "Nova conversa") {
  if (dbMode === "supabase") {
    const { data, error } = await sb.from("conversas").insert([{ titulo }]).select().single();
    if (error) throw error;
    return data;
  }
  const row = { id: "local-" + Date.now().toString(36), titulo, messages: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  const d = readLocal(); d.convs.unshift(row); writeLocal(d);
  return row;
}

async function newConversation(silent = false) {
  try {
    const row = await createConversationRow();
    convs.unshift({ id: row.id, titulo: row.titulo, updated_at: row.updated_at, created_at: row.created_at });
    renderConvList();
    await selectConversation(row.id);
    if (!silent) els.input.focus();
  } catch { toast("Não foi possível criar a conversa.", true); }
}

async function selectConversation(id) {
  activeId = id;
  renderConvList();
  await loadMessages(id);
  renderThread();
}

async function renameActive() {
  const c = convs.find((x) => x.id === activeId);
  if (!c) return;
  const v = prompt("Nome da conversa:", c.titulo);
  if (!v || !v.trim()) return;
  const titulo = v.trim().slice(0, 80);
  if (dbMode === "supabase") await sb.from("conversas").update({ titulo }).eq("id", c.id);
  else { const d = readLocal(); const x = d.convs.find((y) => y.id === c.id); if (x) { x.titulo = titulo; writeLocal(d); } }
  c.titulo = titulo;
  renderConvList();
}

async function deleteActive() {
  if (!activeId) return;
  if (!confirm("Apagar esta conversa e todas as mensagens?")) return;
  if (dbMode === "supabase") await sb.from("conversas").delete().eq("id", activeId);
  else { const d = readLocal(); d.convs = d.convs.filter((x) => x.id !== activeId); writeLocal(d); }
  convs = convs.filter((x) => x.id !== activeId);
  activeId = null;
  renderConvList();
  if (convs.length) selectConversation(convs[0].id);
  else newConversation(true);
}

/* ---- histórico agrupado (Hoje / 5 dias / 7 dias / Anteriores) ---- */
function groupOf(iso) {
  if (!iso) return "Anteriores";
  const days = (Date.now() - new Date(iso).getTime()) / 864e5;
  if (days < 1) return "Hoje";
  if (days < 5) return "Últimos 5 dias";
  if (days < 7) return "Últimos 7 dias";
  return "Anteriores";
}

function renderConvList() {
  const q = (els.search.value || "").toLowerCase();
  const list = els["conv-list"];
  list.innerHTML = "";
  const filtered = convs.filter((c) => c.titulo.toLowerCase().includes(q));
  if (!filtered.length) {
    list.innerHTML = `<div class="hempty">Nenhuma conversa encontrada.<br>Crie uma nova para começar.</div>`;
    return;
  }
  const order = ["Hoje", "Últimos 5 dias", "Últimos 7 dias", "Anteriores"];
  const groups = {};
  filtered.forEach((c) => { const g = groupOf(c.updated_at); (groups[g] = groups[g] || []).push(c); });
  order.forEach((g) => {
    if (!groups[g]) return;
    const h = document.createElement("div");
    h.className = "hgroup"; h.textContent = g;
    list.appendChild(h);
    groups[g].forEach((c) => {
      const b = document.createElement("button");
      b.className = "hitem" + (c.id === activeId ? " active" : "");
      b.innerHTML = `<span class="hic"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span><span></span>`;
      b.querySelector("span:last-child").textContent = c.titulo;
      b.title = c.titulo;
      b.addEventListener("click", () => { selectConversation(c.id); closeHistory(); });
      list.appendChild(b);
    });
  });
}

/* ---------------- thread ---------------- */
function renderThread() {
  const t = els.thread;
  t.innerHTML = "";
  const showHero = messages.length === 0;
  els.hero.style.display = showHero ? "" : "none";
  t.hidden = showHero;
  if (showHero) { setGreeting(); return; }
  messages.forEach((m) => t.appendChild(msgNode(m.papel, m.conteudo, m.created_at, false)));
  scrollBottom(false);
}

function msgNode(papel, conteudo, when, animate = true) {
  const div = document.createElement("div");
  div.className = `msg ${papel === "user" ? "user" : "assistant"}`;
  if (!animate) div.style.animation = "none";
  const d = when ? new Date(when) : new Date();
  div.innerHTML = `
    <div class="msg-avatar">${papel === "user" ? "V" : "B"}</div>
    <div class="msg-body"><div class="msg-text"></div><div class="msg-time"></div></div>`;
  div.querySelector(".msg-text").innerHTML = renderMarkdown(conteudo);
  div.querySelector(".msg-time").textContent = isNaN(d)
    ? "" : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return div;
}

function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function renderMarkdown(src) {
  let h = esc(src);
  const blocks = [];
  h = h.replace(/```(\w*)\n([\s\S]*?)```/g, (_, _l, code) => {
    blocks.push(`<pre><code>${code.replace(/\n$/, "")}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  h = h.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");
  h = h.replace(/^#{1,3} (.+)$/gm, "<strong>$1</strong>");
  h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/(^|\n)- (.+)/g, "$1• $2");
  h = h.replace(/`([^`]+)`/g, "<code>$1</code>");
  h = h.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  h = h.split(/\n{2,}/).map((p) => (/^(<pre|<blockquote|•)/.test(p.trim()) ? p : `<p>${p.replace(/\n/g, "<br>")}</p>`)).join("");
  h = h.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[+i]);
  return h;
}

/* ---------------- envio ---------------- */
async function onSend(e) {
  e.preventDefault();
  const text = els.input.value.trim();
  if (!text || sending) return;
  if (!activeId) await newConversation(true);
  if (!activeId) return;
  sending = true;
  els.send.disabled = true;
  els.input.value = ""; autoGrow();

  const now = new Date().toISOString();
  messages.push({ papel: "user", conteudo: text, created_at: now });
  appendLive("user", text, now, false);
  try { await persistMessage(activeId, "user", text); }
  catch (err) { console.warn("Falha ao salvar:", err); toast("Mensagem enviada, mas não foi salva (verifique o Supabase).", true); }
  maybeTitle(text);

  els.typing.hidden = false;
  scrollBottom();

  try {
    const reply = await askAI(messages);
    els.typing.hidden = true;
    const at = new Date().toISOString();
    messages.push({ papel: "assistant", conteudo: reply, created_at: at });
    appendLive("assistant", reply, at, true);
    try { await persistMessage(activeId, "assistant", reply); } catch (err) { console.warn(err); }
    const c = convs.find((x) => x.id === activeId);
    if (c) { c.updated_at = at; renderConvList(); }
  } catch (err) {
    els.typing.hidden = true;
    toast(err.message || "Falha ao obter resposta.", true);
  } finally {
    sending = false;
    els.send.disabled = false;
    els.input.focus();
  }
}

function appendLive(papel, conteudo, when, typewriter = false) {
  els.hero.style.display = "none";
  els.thread.hidden = false;
  const node = msgNode(papel, typewriter ? "" : conteudo, when);
  els.thread.appendChild(node);
  const box = node.querySelector(".msg-text");
  if (typewriter) {
    box.classList.add("caret");
    let i = 0;
    const step = () => {
      i += 4;
      box.innerHTML = renderMarkdown(conteudo.slice(0, i));
      scrollBottom();
      if (i < conteudo.length) requestAnimationFrame(step);
      else box.classList.remove("caret");
    };
    requestAnimationFrame(step);
  }
  scrollBottom();
}

function scrollBottom(smooth = true) {
  requestAnimationFrame(() => {
    try { els.thread.scrollTo({ top: els.thread.scrollHeight, behavior: smooth ? "smooth" : "auto" }); } catch {}
  });
}

async function maybeTitle(firstText) {
  const c = convs.find((x) => x.id === activeId);
  if (!c || c.titulo !== "Nova conversa") return;
  const titulo = firstText.slice(0, 46) + (firstText.length > 46 ? "…" : "");
  c.titulo = titulo;
  renderConvList();
  try {
    if (dbMode === "supabase") await sb.from("conversas").update({ titulo }).eq("id", c.id);
    else { const d = readLocal(); const x = d.convs.find((y) => y.id === c.id); if (x) { x.titulo = titulo; writeLocal(d); } }
  } catch (e) { console.warn(e); }
}

/* ---------------- IA ---------------- */
async function askAI(hist) {
  const payload = {
    system: cfg.system,
    reasoning, deep,
    messages: hist.slice(-20).map((m) => ({ role: m.papel === "user" ? "user" : "assistant", content: m.conteudo })),
  };
  try {
    const r = await fetch(DEFAULTS.CHAT_ENDPOINT, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (r.ok) {
      const j = await r.json();
      if (j.reply) return j.reply;
      throw new Error(j.error || "Resposta vazia do servidor.");
    }
    if (r.status === 404) throw new Error("LOCAL404");
    const t = await r.text().catch(() => "");
    throw new Error(`Servidor (${r.status}): ${t.slice(0, 160) || "indisponível"}`);
  } catch (e) {
    if (e.message && e.message.startsWith("Servidor")) throw e;
    if (e.message !== "LOCAL404") console.warn("Proxy falhou, tentando modo local:", e);
  }
  if (cfg.groqKey) return await askGroqDirect(payload);
  throw new Error("Proxy /api/chat indisponível. Faça o redeploy na Cloudflare com a GROQ_API_KEY ou informe a chave em Definições (teste local).");
}

async function askGroqDirect({ system, messages, reasoning: rs, deep: dp }) {
  const sys = system + (rs ? "\nRaciocine passo a passo antes de responder." : "") + (dp ? "\nDê uma resposta aprofundada e completa." : "");
  const models = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];
  let last = "";
  for (const model of models) {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.groqKey },
      body: JSON.stringify({
        model, temperature: rs ? 0.2 : 0.4,
        max_tokens: dp ? 2500 : 1200,
        messages: [{ role: "system", content: sys }, ...messages],
      }),
    });
    if (r.ok) {
      const j = await r.json();
      const txt = j.choices?.[0]?.message?.content?.trim();
      if (txt) return txt;
    } else {
      last = `Groq ${r.status}`;
      if (r.status === 401) throw new Error("Chave Groq inválida (401). Confira em Definições.");
      if (r.status === 429) throw new Error("Limite da Groq atingido (429). Aguarde e tente de novo.");
    }
  }
  throw new Error("Groq indisponível (" + last + ").");
}

/* ---------------- anexo / mic ---------------- */
function onAttach() {
  const f = els.file.files?.[0];
  els.file.value = "";
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    const txt = String(reader.result || "").slice(0, 6000);
    els.input.value = `[Anexo: ${f.name}]\n${txt}\n\n${els.input.value}`;
    autoGrow(); els.input.focus();
    toast("Anexo incluído no texto.");
  };
  reader.readAsText(f);
}

let recog = null;
function toggleMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast("Ditadura por voz não suportada neste navegador.", true); return; }
  if (recog) { recog.stop(); return; }
  recog = new SR();
  recog.lang = "pt-BR";
  recog.interimResults = false;
  els["btn-mic"].classList.add("rec");
  recog.onresult = (ev) => {
    const txt = ev.results?.[0]?.[0]?.transcript || "";
    if (txt) { els.input.value += (els.input.value ? " " : "") + txt; autoGrow(); }
  };
  recog.onend = () => { recog = null; els["btn-mic"].classList.remove("rec"); };
  recog.onerror = () => { recog = null; els["btn-mic"].classList.remove("rec"); toast("Falha no microfone.", true); };
  recog.start();
  toast("A ouvir… fale agora.");
}

/* ---------------- misc ---------------- */
function autoGrow() {
  const t = els.input;
  if (!t) return;
  t.style.height = "auto";
  t.style.height = Math.min(t.scrollHeight, 150) + "px";
}
function exportActive() {
  if (!messages.length) return toast("Nada para exportar.");
  const c = convs.find((x) => x.id === activeId);
  const txt = `# ${c?.titulo || "Conversa"}\nExportado em ${new Date().toLocaleString("pt-BR")}\n\n` +
    messages.map((m) => `## ${m.papel === "user" ? "Você" : "Bruna"}\n${m.conteudo}\n`).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([txt], { type: "text/markdown;charset=utf-8" }));
  a.download = `conversa-${(c?.titulo || "bruna").slice(0, 30).replace(/[^\w-]+/g, "-")}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function openSettings() {
  els["set-name"].value = cfg.name;
  els["set-supabase-url"].value = cfg.supabaseUrl;
  els["set-supabase-key"].value = cfg.supabaseKey;
  els["set-groq-key"].value = cfg.groqKey;
  els["set-system"].value = cfg.system;
  setBadge("sb-badge", dbMode === "supabase" ? "ok" : "", dbMode === "supabase" ? "ligado" : "não testado");
  setBadge("groq-badge", cfg.groqKey ? "" : "err", cfg.groqKey ? "chave presente" : "sem chave");
  els["settings-modal"].hidden = false;
}
function closeSettings() { els["settings-modal"].hidden = true; }
function toggleEye(inputId) {
  const i = els[inputId];
  i.type = i.type === "password" ? "text" : "password";
}
function setBadge(id, state, text) {
  const b = els[id];
  b.className = "badge" + (state ? " " + state : "");
  b.textContent = text;
}
/* Testa URL + anon key contra o Supabase (tabela conversas) */
async function testSupabase() {
  const url = els["set-supabase-url"].value.trim();
  const key = els["set-supabase-key"].value.trim();
  if (!url || !key) { setBadge("sb-badge", "err", "preencha os campos"); return; }
  setBadge("sb-badge", "", "a testar…");
  try {
    if (!window.supabase?.createClient) throw new Error("SDK Supabase não carregou.");
    const c = window.supabase.createClient(url, key);
    const { error } = await c.from("conversas").select("id", { count: "exact", head: true });
    if (error) {
      if (/relation .* does not exist|Could not find the table/i.test(error.message))
        throw new Error("Tabelas ausentes — rode o supabase.sql no SQL Editor.");
      throw error;
    }
    setBadge("sb-badge", "ok", "conexão OK");
  } catch (e) {
    setBadge("sb-badge", "err", "falhou");
    toast("Supabase: " + (e.message || e).toString().slice(0, 160), true);
  }
}
/* Valida a API key da Groq (lista modelos) */
async function testGroq() {
  const key = els["set-groq-key"].value.trim();
  if (!key) { setBadge("groq-badge", "err", "cole a chave"); return; }
  setBadge("groq-badge", "", "a testar…");
  try {
    const r = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: "Bearer " + key },
    });
    if (r.ok) setBadge("groq-badge", "ok", "chave válida");
    else if (r.status === 401) { setBadge("groq-badge", "err", "chave inválida"); toast("Groq: chave inválida (401).", true); }
    else { setBadge("groq-badge", "err", "erro " + r.status); toast("Groq respondeu HTTP " + r.status + ".", true); }
  } catch {
    setBadge("groq-badge", "err", "sem acesso");
    toast("Não foi possível alcançar a Groq. Verifique a internet.", true);
  }
}
async function saveSettings() {
  cfg.name = els["set-name"].value.trim().slice(0, 30);
  cfg.supabaseUrl = els["set-supabase-url"].value.trim() || DEFAULTS.SUPABASE_URL;
  cfg.supabaseKey = els["set-supabase-key"].value.trim() || DEFAULTS.SUPABASE_ANON_KEY;
  cfg.groqKey = els["set-groq-key"].value.trim();
  cfg.system = els["set-system"].value.trim() || DEFAULTS.SYSTEM_PROMPT;
  store.set("bruna_name", cfg.name);
  store.set("bruna_sb_url", cfg.supabaseUrl);
  store.set("bruna_sb_key", cfg.supabaseKey);
  store.set("bruna_groq_key", cfg.groqKey);
  store.set("bruna_system", cfg.system);
  closeSettings();
  setGreeting();
  toast("Definições guardadas. A recarregar…");
  await initDB(); await loadConvs();
}
function toast(msg, isErr = false) {
  if (!els["toast-root"]) return;
  const t = document.createElement("div");
  t.className = "toast" + (isErr ? " err" : "");
  t.textContent = msg;
  els["toast-root"].appendChild(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 320); }, 3800);
}
