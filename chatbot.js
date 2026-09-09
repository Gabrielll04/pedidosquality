/**
 * Chatbot Público de Pedidos + IA
 * - Fluxo guiado por etapas
 * - IA local (heurísticas PT-BR) sempre ativa
 * - IA avançada via Groq (modelo openai/gpt-oss) + fallback local
 * - Grava automaticamente na tabela `pedidos` do Supabase
 */

// ===== Config Supabase (mesma do painel) =====
const SUPABASE_URL = 'https://zkhaowtylugnjksofbcv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_hKZ6gh7n_Xc_7C8xhhW_og_HemVWF2-';

// ===== Config Groq (modelo gpt-oss) =====
// NUNCA coloque a chave da API direto neste arquivo: o GitHub bloqueia o push
// (push protection) e a chave ficaria exposta a todos os visitantes.
// Como configurar:
//  1. Simples (este navegador): abra o chatbot, clique em "IA" e cole sua
//     chave da Groq (console.groq.com -> API Keys). Fica salva só em
//     localStorage, sem ir para o Git.
//  2. Recomendado (todos os visitantes): crie um proxy que guarda a chave em
//     segredo (ex: Cloudflare Worker, já que o site está na Cloudflare) e
//     informe a URL em GROQ_PROXY_URL. O chatbot chama o proxy em vez da Groq.
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
// Tenta o 120B primeiro (mais capaz); cai para o 20B se indisponível.
const GROQ_MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'];
// URL do proxy opcional (Cloudflare Worker). Vazio = chamada direta à Groq
// usando a chave salva neste navegador (modal "IA").
const GROQ_PROXY_URL = '';

const SETORES_VALIDOS = ['Pet Shop', 'Oficina', 'Confeitaria', 'Salão', 'Gráfica', 'Geral'];

const SECTOR_KEYWORDS = {
  'Pet Shop': ['pet', 'banho', 'tosa', 'cachorro', 'gato', 'cão', 'cao', 'thor', 'golden', 'pata', 'veterin'],
  'Oficina': ['oficina', 'carro', 'moto', 'óleo', 'oleo', 'freio', 'pneu', 'motor', 'troca de', 'revisão', 'revisao', 'mecanic'],
  'Confeitaria': ['bolo', 'doce', 'festa', 'brigadeiro', 'chocolate', 'confeitaria', 'cupcake', 'encomenda de bolo', 'kg de bolo'],
  'Salão': ['salao', 'salão', 'corte', 'cabelo', 'unha', 'barba', 'escova', 'manicure', 'pedicure', 'progressiva', 'maquiagem'],
  'Gráfica': ['grafica', 'gráfica', 'banner', 'cartão', 'cartao', 'impress', 'panfleto', 'adesivo', 'folder', 'camisa estampada', 'arte']
};

let chatState = {
  step: 'welcome', // welcome -> coletando -> confirm -> saving -> done
  data: { cliente: '', telefone: '', setor: '', servico: '', valor: null, data_pedido: '', observacoes: '' },
  awaitingCorrection: false,
  supabaseClient: null,
  busy: false
};

let el = {};

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  el = {
    messages: document.getElementById('chat-messages'),
    form: document.getElementById('chat-form'),
    input: document.getElementById('chat-input'),
    quick: document.getElementById('chat-quick-replies'),
    typing: document.getElementById('chat-typing'),
    toast: document.getElementById('toast-container'),
    engineLabel: document.getElementById('chat-engine-label'),
    iaDot: document.getElementById('ia-status-dot'),
    iaModal: document.getElementById('ia-modal'),
    groqKey: document.getElementById('groq-key'),
    iaMode: document.getElementById('ia-current-mode')
  };

  initThemeChat();
  initSupabaseChat();
  updateEngineLabel();

  el.form.addEventListener('submit', onSubmit);
  document.getElementById('btn-restart-chat').addEventListener('click', restartChat);
  document.getElementById('btn-restart-side').addEventListener('click', restartChat);
  document.getElementById('btn-chat-theme').addEventListener('click', toggleThemeChat);

  // Modal IA
  document.getElementById('btn-ia-config').addEventListener('click', openIaModal);
  document.getElementById('btn-close-ia').addEventListener('click', closeIaModal);
  document.getElementById('btn-ia-save').addEventListener('click', saveIaKey);
  document.getElementById('btn-ia-remove').addEventListener('click', removeIaKey);
  el.iaModal.addEventListener('click', (e) => { if (e.target === el.iaModal) closeIaModal(); });

  // Mensagem de boas-vindas
  setTimeout(() => {
    botSay('Olá! 👋 Eu sou a <strong>assistente virtual</strong> da loja. Vou te ajudar a fazer seu pedido em menos de 1 minuto.');
    setTimeout(() => {
      botSay('Você pode <strong>escrever tudo de uma vez</strong> — por exemplo:<br><em>"Sou Ana, quero bolo de chocolate 2kg para sábado, meu zap é 11 99876-1234"</em><br><br>Ou ir respondendo passo a passo. Vamos começar?');
      setTimeout(() => askNextMissing(true), 600);
    }, 700);
  }, 400);
});

// ===== Supabase =====
function initSupabaseChat() {
  try {
    if (window.supabase && typeof window.supabase.createClient === 'function') {
      chatState.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
  } catch (e) { console.warn('Supabase SDK indisponível, usando REST.', e); }
}

function restHeaders() {
  return {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };
}

async function insertPedidoSupabase(payload) {
  // Tenta SDK primeiro, depois REST direto
  if (chatState.supabaseClient) {
    try {
      const { data, error } = await chatState.supabaseClient.from('pedidos').insert([payload]).select();
      if (!error) return data;
      console.warn('SDK falhou, tentando REST:', error.message);
    } catch (e) { console.warn('SDK exception, tentando REST:', e); }
  }
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/pedidos`, {
    method: 'POST',
    headers: restHeaders(),
    body: JSON.stringify(payload)
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Supabase recusou o pedido (HTTP ${resp.status}). ${t.slice(0, 200)}`);
  }
  return await resp.json();
}

// ===== IA: Groq (gpt-oss) + Local (sempre) =====
// Chave lida SÓ do navegador (modal "IA" -> localStorage). Nada de segredo no código.
function getGroqKey() {
  return (localStorage.getItem('chatbot_groq_key') || '').trim();
}

// Há IA avançada disponível? Via proxy (vale p/ todos) ou chave neste navegador.
function hasAdvancedAI() {
  return !!GROQ_PROXY_URL || !!getGroqKey();
}

function updateEngineLabel() {
  const hasKey = hasAdvancedAI();
  if (el.engineLabel) {
    el.engineLabel.innerHTML = hasKey
      ? '<i class="fa-solid fa-brain"></i> GPT-OSS (Groq) ativa · online agora'
      : '<i class="fa-solid fa-bolt"></i> IA local ativa · online agora';
  }
  if (el.iaDot) {
    el.iaDot.className = 'ia-dot ' + (hasKey ? 'ia-dot-gemini' : 'ia-dot-local');
    el.iaDot.title = hasKey ? 'GPT-OSS via Groq conectado' : 'IA local ativa (sem chave)';
  }
  if (el.iaMode) {
    el.iaMode.innerHTML = hasKey
      ? '✅ <strong>GPT-OSS via Groq conectado.</strong> O chatbot está usando compreensão avançada.'
      : '⚡ <strong>Modo IA local.</strong> Funciona sem chave. Adicione a chave da Groq para compreensão ainda mais avançada.';
  }
}

function openIaModal() {
  if (el.groqKey) el.groqKey.value = (localStorage.getItem('chatbot_groq_key') || '').trim();
  updateEngineLabel();
  el.iaModal.classList.remove('hidden');
}
function closeIaModal() { el.iaModal.classList.add('hidden'); }
function saveIaKey() {
  const v = (el.groqKey.value || '').trim();
  if (!v) { toast('Cole uma chave válida ou use o modo IA local.', 'error'); return; }
  localStorage.setItem('chatbot_groq_key', v);
  updateEngineLabel();
  closeIaModal();
  toast('IA avançada (GPT-OSS via Groq) ativada!', 'success');
  botSay('🧠 <strong>IA avançada ativada (GPT-OSS)!</strong> Agora entendo frases ainda mais complexas. Pode continuar de onde parou.');
}
function removeIaKey() {
  localStorage.removeItem('chatbot_groq_key');
  if (el.groqKey) el.groqKey.value = '';
  updateEngineLabel();
  toast('Chave removida. Voltamos à IA local.', 'info');
}

/** Tenta extrair dados via Groq (gpt-oss); retorna objeto parcial ou null */
async function groqExtract(text) {
  // 1. Via proxy (recomendado): a chave fica em segredo no servidor/Worker.
  //    O proxy deve aceitar POST { text } e devolver o JSON de campos.
  if (GROQ_PROXY_URL) {
    try {
      const resp = await fetch(GROQ_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.slice(0, 800) })
      });
      if (resp.ok) {
        const parsed = await resp.json();
        const clean = sanitizeExtracted(parsed);
        if (clean && Object.keys(clean).length > 0) return clean;
      } else {
        console.warn('Proxy Groq HTTP', resp.status);
      }
    } catch (e) {
      console.warn('Proxy Groq falhou:', e);
    }
  }

  // 2. Chamada direta (só funciona neste navegador se a chave foi salva no modal "IA").
  const key = getGroqKey();
  if (!key) return null;
  const system = `Você é um extrator de dados de pedidos de uma loja com setores: Pet Shop, Oficina, Confeitaria, Salão, Gráfica, Geral.
Responda APENAS com JSON válido, sem markdown, sem explicação, neste formato exato:
{"cliente": nome da pessoa ou "", "telefone": só dígitos com DDD ou "", "setor": um dos setores ou "", "servico": descrição do serviço/produto ou "", "valor": número (ex 150.00) ou null, "data_pedido": texto da data/horário como dito ou "", "observacoes": detalhes extras ou ""}
Regras: campo ausente -> "" (ou null para valor). Setor: infira por palavras-chave (banho/tosa->Pet Shop; carro/moto/óleo->Oficina; bolo/doce->Confeitaria; corte/cabelo/unha->Salão; banner/impressão->Gráfica).`;

  for (const model of GROQ_MODELS) {
    try {
      const resp = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + key
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: text.slice(0, 800) }
          ]
        })
      });
      if (!resp.ok) {
        console.warn('Groq HTTP', resp.status, 'modelo', model);
        if (resp.status === 401) {
          toast('Chave da Groq inválida. Usando IA local.', 'error');
          return null;
        }
        if (resp.status === 429) {
          toast('Limite da Groq atingido. Usando IA local.', 'error');
          return null;
        }
        continue; // tenta próximo modelo
      }
      const json = await resp.json();
      const raw = json?.choices?.[0]?.message?.content || '';
      const parsed = JSON.parse(raw);
      const clean = sanitizeExtracted(parsed);
      if (clean && Object.keys(clean).length > 0) return clean;
      return null;
    } catch (e) {
      console.warn('Groq falhou no modelo', model, ':', e);
    }
  }
  console.warn('Groq falhou em todos os modelos, usando IA local.');
  return null;
}

function sanitizeExtracted(o) {
  if (!o || typeof o !== 'object') return null;
  const out = {};
  if (o.cliente) out.cliente = String(o.cliente).slice(0, 80);
  if (o.telefone) out.telefone = String(o.telefone).replace(/\D/g, '').slice(0, 13);
  if (o.setor && SETORES_VALIDOS.includes(o.setor)) out.setor = o.setor;
  if (o.servico) out.servico = String(o.servico).slice(0, 200);
  if (o.valor !== null && o.valor !== undefined && o.valor !== '') {
    const v = parseFloat(String(o.valor).replace(',', '.'));
    if (!isNaN(v) && v >= 0 && v < 1000000) out.valor = v;
  }
  if (o.data_pedido) out.data_pedido = String(o.data_pedido).slice(0, 80);
  if (o.observacoes) out.observacoes = String(o.observacoes).slice(0, 300);
  return out;
}

/** IA local: heurísticas PT-BR, sem depender de API externa */
function localExtract(text) {
  const out = {};
  const lower = text.toLowerCase();

  // Telefone (prioritário, formato BR)
  const phoneMatch = text.match(/\(?\d{2}\)?[\s-]?\d{4,5}[\s-]?\d{4}/);
  if (phoneMatch && !chatState.data.telefone) {
    out.telefone = phoneMatch[0].trim();
  }

  // Valor: só quando explícito (R$, reais, valor) para não confundir com telefone
  let valorMatch = text.match(/R\$\s?(\d{1,6}(?:[.,]\d{1,2})?)/i)
    || text.match(/(\d{1,6}(?:[.,]\d{1,2})?)\s?reais/i)
    || text.match(/valor\s?(?:de\s?|:\s?|é\s?)?R?\$?\s?(\d{1,6}(?:[.,]\d{1,2})?)/i);
  if (valorMatch && chatState.data.valor == null) {
    const v = parseFloat(valorMatch[1].replace(/\./g, '').replace(',', '.'));
    // evita capturar DDD/telefone como valor
    if (!isNaN(v) && v > 0 && v < 100000 && !phoneMatch) out.valor = v;
    else if (!isNaN(v) && v > 0 && v < 100000 && phoneMatch && !valorMatch[0].includes(phoneMatch[0])) out.valor = v;
  }

  // Setor por palavras-chave
  if (!chatState.data.setor) {
    for (const [setor, kws] of Object.entries(SECTOR_KEYWORDS)) {
      if (kws.some(k => lower.includes(k))) { out.setor = setor; break; }
    }
  }

  // Data / horário
  if (!chatState.data.data_pedido) {
    const dias = ['hoje', 'amanhã', 'amanha', 'segunda', 'terça', 'terca', 'quarta', 'quinta', 'sexta', 'sábado', 'sabado', 'domingo'];
    const hora = text.match(/(\d{1,2})(?::(\d{2}))?\s?h/i);
    const dataNum = text.match(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/);
    const diaNome = dias.find(d => lower.includes(d));
    if (dataNum || diaNome || hora) {
      let composto = '';
      if (diaNome) composto += diaNome;
      if (dataNum) composto += (composto ? ' ' : '') + dataNum[0];
      if (hora) composto += (composto ? ' às ' : '') + hora[0];
      if (composto) out.data_pedido = composto;
      else if (/agendar|marcar|quando/.test(lower)) out.data_pedido = text.slice(0, 80);
    }
  }

  // Nome: "me chamo X", "sou X", "meu nome é X"
  if (!chatState.data.cliente) {
    let nome = null;
    const m1 = text.match(/(?:me chamo|meu nome é|meu nome e|sou (?:o|a)?)\s+([A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+){0,3})/i);
    if (m1) nome = m1[1].trim();
    else {
      // Mensagem curta, só letras, 2-4 palavras, sem verbos de pedido -> provavelmente é o nome
      const cleaned = text.trim();
      const palavras = cleaned.split(/\s+/);
      const temVerboPedido = /(quero|preciso|gostaria|pedido|agendar|marcar|fazer|ola|olá|oi|bom dia|boa tarde|boa noite)/i.test(cleaned);
      if (!temVerboPedido && palavras.length >= 2 && palavras.length <= 4 && /^[A-Za-zÀ-ÿ\s]+$/.test(cleaned) && cleaned.length <= 50) {
        nome = cleaned;
      }
    }
    if (nome) out.cliente = nome.replace(/\b\w/g, c => c.toUpperCase()).slice(0, 80);
  }

  // Serviço: se ainda vazio e texto tem conteúdo descritivo, usa o texto limpo
  if (!chatState.data.servico && text.trim().length > 4) {
    const ehSoNome = out.cliente && text.trim().toLowerCase() === out.cliente.toLowerCase();
    const ehSoTelefone = phoneMatch && text.replace(phoneMatch[0], '').trim().length < 3;
    if (!ehSoNome && !ehSoTelefone) {
      // Remove fragmentos já capturados para não poluir o serviço
      let resto = text;
      if (out.cliente) resto = resto.replace(new RegExp(out.cliente, 'i'), '');
      resto = resto.replace(/^(olá|ola|oi|bom dia|boa tarde|boa noite|por favor|quero|preciso|gostaria de|me chamo.+|sou\s+\w+|meu nome é\s+\w+)[,.\s!]*/i, '').trim();
      if (resto.length > 3) out.servico = resto.slice(0, 200);
    }
  }

  return out;
}

// ===== Fluxo de conversa =====
async function onSubmit(e) {
  e.preventDefault();
  const text = el.input.value.trim();
  if (!text || chatState.busy) return;
  el.input.value = '';
  userSay(text);
  await handleUserMessage(text);
}

function restartChat() {
  chatState.data = { cliente: '', telefone: '', setor: '', servico: '', valor: null, data_pedido: '', observacoes: '' };
  chatState.step = 'coletando';
  chatState.awaitingCorrection = false;
  el.messages.innerHTML = '';
  botSay('Sem problemas! Vamos recomeçar do zero. 🔄');
  setTimeout(() => askNextMissing(true), 600);
}

function firstMissingField() {
  const d = chatState.data;
  if (!d.cliente) return 'cliente';
  if (!d.telefone) return 'telefone';
  if (!d.setor) return 'setor';
  if (!d.servico) return 'servico';
  if (!d.data_pedido) return 'data_pedido';
  if (d.valor == null) return 'valor';
  if (!d.observacoes) return 'observacoes';
  return 'confirm';
}

function askNextMissing(isFirst = false) {
  const field = firstMissingField();
  chatState.step = field === 'confirm' ? 'confirm' : 'coletando';

  if (field === 'cliente') {
    botSay(isFirst ? 'Qual é o <strong>seu nome</strong>?' : 'Só falta seu <strong>nome</strong>. Como posso te chamar?');
    setQuick([]);
  } else if (field === 'telefone') {
    botSay(`Prazer, <strong>${escapeHtml(chatState.data.cliente || 'você')}</strong>! 📱 Qual seu <strong>WhatsApp / telefone</strong> com DDD?<br><span class="text-sm text-muted">Ex: 11 99876-1234</span>`);
    setQuick([{ label: 'Pular', value: 'pular', icon: 'fa-forward' }]);
  } else if (field === 'setor') {
    botSay('Qual <strong>setor</strong> é o seu pedido? Toque numa opção ou escreva (ex: "é para o pet", "bolo", "corte de cabelo"):');
    setQuick([
      { label: 'Pet Shop 🐾', value: 'Pet Shop', icon: 'fa-paw' },
      { label: 'Oficina 🔧', value: 'Oficina', icon: 'fa-wrench' },
      { label: 'Confeitaria 🍰', value: 'Confeitaria', icon: 'fa-cake-candles' },
      { label: 'Salão ✂️', value: 'Salão', icon: 'fa-scissors' },
      { label: 'Gráfica 🖨️', value: 'Gráfica', icon: 'fa-print' }
    ]);
  } else if (field === 'servico') {
    botSay('Descreva o <strong>serviço ou produto</strong> que você precisa:<br><span class="text-sm text-muted">Ex: "banho e tosa no Golden", "troca de óleo do Onix", "bolo de chocolate 2kg", "corte + barba", "100 cartões de visita"</span>');
    setQuick([]);
  } else if (field === 'data_pedido') {
    botSay('Para <strong>quando</strong> é? Pode ser dia e horário juntos:<br><span class="text-sm text-muted">Ex: "sábado às 9h", "15/10 às 14:00", "amanhã de manhã"</span>');
    setQuick([{ label: 'Sem data definida', value: 'pular', icon: 'fa-forward' }]);
  } else if (field === 'valor') {
    botSay('Você já sabe o <strong>valor aproximado</strong>? Se não souber, pode pular que a loja faz o orçamento.<br><span class="text-sm text-muted">Ex: "R$ 150" ou toque em Pular</span>');
    setQuick([{ label: 'Não sei / Pular', value: 'pular', icon: 'fa-forward' }]);
  } else if (field === 'observacoes') {
    botSay('Alguma <strong>observação ou detalhe</strong> importante? (endereço, preferência, tamanho, modelo...)');
    setQuick([{ label: 'Sem observações', value: 'pular', icon: 'fa-forward' }]);
  } else {
    showConfirm();
  }
}

async function handleUserMessage(text) {
  const lower = text.toLowerCase().trim();

  // Atalhos globais
  if (/^(cancelar|recomeçar|recomecar|reiniciar)/i.test(lower)) { restartChat(); return; }

  // Etapa de confirmação
  if (chatState.step === 'confirm') {
    if (/^(sim|isso|confirmo|confirmar|pode|ok|cert[oa]|perfeito|isso mesmo|finalizar|enviar)/i.test(lower)) {
      await doInsert();
      return;
    }
    if (/^(n[aã]o|corrigir|alterar|editar|errado|quero mudar)/i.test(lower)) {
      chatState.awaitingCorrection = true;
      botSay('Claro! Me diga <strong>o que precisa corrigir</strong> — por exemplo:<br>• "meu nome é ..." <br>• "o telefone é ..." <br>• "o serviço é ..." <br>• "o setor é salão"');
      setQuick([]);
      chatState.step = 'coletando';
      return;
    }
    // Se não for sim/não, tenta extrair correção do texto
    const extra = await extractWithAI(text);
    mergeData(extra);
    if (Object.keys(extra).length > 0) {
      botSay('Anotei a correção! ✅');
      showConfirm();
    } else {
      botSay('Não entendi. Responda <strong>"sim"</strong> para confirmar o pedido ou diga <strong>o que corrigir</strong> (ex: "o telefone é 119...").');
      setQuick([
        { label: 'Sim, confirmar ✅', value: 'sim, pode confirmar', icon: 'fa-check' },
        { label: 'Corrigir ✏️', value: 'quero corrigir', icon: 'fa-pen' }
      ]);
    }
    return;
  }

  // Etapa finalizada
  if (chatState.step === 'done') {
    if (/^(novo|outro|novo pedido|fazer outro)/i.test(lower)) { restartChat(); return; }
    botSay('Seu pedido já foi registrado! ✅ Se quiser fazer <strong>outro pedido</strong>, digite <strong>"novo"</strong> ou toque abaixo.');
    setQuick([{ label: 'Fazer outro pedido ➕', value: 'novo', icon: 'fa-plus' }]);
    return;
  }

  // ===== Coleta normal: IA extrai tudo que conseguir =====
  showTyping(true);
  const extra = await extractWithAI(text);
  showTyping(false);

  const field = firstMissingField();

  // Tratamento de "pular"
  if (lower === 'pular' || lower === 'sem data' || lower.includes('não sei') || lower.includes('nao sei') || lower === 'sem observações' || lower === 'sem observacoes') {
    applySkip(field);
    return;
  }

  // Se a IA extraiu algo relevante, mescla
  if (extra && Object.keys(extra).length > 0) {
    mergeData(extra);
    const got = Object.keys(extra).map(k => labelOf(k)).join(', ');
    botSay(`Entendido! Anotei: <strong>${escapeHtml(got)}</strong>. ✅`);
  } else {
    // Sem extração: atribui diretamente ao campo atual
    assignRawToField(field, text);
  }

  setTimeout(() => askNextMissing(), 500);
}

function applySkip(field) {
  if (field === 'telefone') chatState.data.telefone = '';
  if (field === 'data_pedido') chatState.data.data_pedido = '';
  if (field === 'valor') chatState.data.valor = 0;
  if (field === 'observacoes') chatState.data.observacoes = '';
  botSay('Ok, pulamos essa parte. 👍');
  setTimeout(() => askNextMissing(), 500);
}

function assignRawToField(field, text) {
  if (field === 'cliente') chatState.data.cliente = text.slice(0, 80);
  else if (field === 'telefone') {
    const digits = text.replace(/\D/g, '');
    chatState.data.telefone = digits.length >= 8 ? text.slice(0, 20) : text.slice(0, 20);
  }
  else if (field === 'setor') {
    const found = SETORES_VALIDOS.find(s => text.toLowerCase().includes(s.toLowerCase()));
    chatState.data.setor = found || text.slice(0, 30);
  }
  else if (field === 'servico') chatState.data.servico = text.slice(0, 200);
  else if (field === 'data_pedido') chatState.data.data_pedido = text.slice(0, 80);
  else if (field === 'valor') {
    const v = parseFloat(text.replace('R$', '').replace(',', '.'));
    chatState.data.valor = isNaN(v) ? 0 : v;
  }
  else if (field === 'observacoes') chatState.data.observacoes = text.slice(0, 300);
}

async function extractWithAI(text) {
  // 1. Tenta Groq (gpt-oss) via proxy ou chave deste navegador
  if (hasAdvancedAI()) {
    showTyping(true);
    const g = await groqExtract(text);
    showTyping(false);
    if (g && Object.keys(g).length > 0) {
      // Completa lacunas do GPT com a IA local (ex: setor por palavra-chave)
      const l = localExtract(text);
      if (l.setor && !SETORES_VALIDOS.includes(l.setor)) delete l.setor;
      for (const [k, v] of Object.entries(l)) {
        if ((g[k] === undefined || g[k] === '' || g[k] == null) && v !== '' && v != null) g[k] = v;
      }
      return g;
    }
  }
  // 2. IA local (sempre)
  const l = localExtract(text);
  // Valida setor local
  if (l.setor && !SETORES_VALIDOS.includes(l.setor)) delete l.setor;
  return l;
}

function mergeData(extra) {
  if (!extra) return;
  for (const [k, v] of Object.entries(extra)) {
    if (v === '' || v == null) continue;
    if (k === 'valor' && (isNaN(v) || v < 0)) continue;
    chatState.data[k] = v;
  }
}

function labelOf(k) {
  return { cliente: 'nome', telefone: 'telefone', setor: 'setor', servico: 'serviço', valor: 'valor', data_pedido: 'data', observacoes: 'observações' }[k] || k;
}

// ===== Confirmação + gravação =====
function showConfirm() {
  chatState.step = 'confirm';
  const d = chatState.data;
  const valorTxt = (d.valor != null && d.valor > 0) ? formatBRL(d.valor) : 'A combinar / orçamento';
  const html = `
    <div class="confirm-card">
      <h4><i class="fa-solid fa-clipboard-check"></i> Confira seu pedido</h4>
      <div class="confirm-row"><span>Nome:</span><strong>${escapeHtml(d.cliente || '-')}</strong></div>
      <div class="confirm-row"><span>Telefone:</span><strong>${escapeHtml(d.telefone || '—')}</strong></div>
      <div class="confirm-row"><span>Setor:</span><strong>${escapeHtml(d.setor || '-')}</strong></div>
      <div class="confirm-row"><span>Serviço:</span><strong>${escapeHtml(d.servico || '-')}</strong></div>
      <div class="confirm-row"><span>Data:</span><strong>${escapeHtml(d.data_pedido || 'A combinar')}</strong></div>
      <div class="confirm-row"><span>Valor:</span><strong>${escapeHtml(valorTxt)}</strong></div>
      ${d.observacoes ? `<div class="confirm-row"><span>Obs:</span><strong>${escapeHtml(d.observacoes)}</strong></div>` : ''}
      <p class="confirm-q">Está tudo certo? Posso enviar para a loja?</p>
    </div>`;
  botSay(html);
  setQuick([
    { label: 'Sim, confirmar ✅', value: 'sim, pode confirmar', icon: 'fa-check' },
    { label: 'Quero corrigir ✏️', value: 'quero corrigir', icon: 'fa-pen' }
  ]);
}

async function doInsert() {
  chatState.step = 'saving';
  chatState.busy = true;
  setQuick([]);
  showTyping(true);
  botSay('Enviando seu pedido para a loja... ⏳');

  const d = chatState.data;
  const valor = (d.valor != null && !isNaN(d.valor)) ? Number(d.valor) : 0;
  const payload = {
    setor: d.setor || 'Geral',
    status: valor > 0 ? 'Pendente' : 'Aguardando orçamento',
    cliente: d.cliente,
    telefone: d.telefone || null,
    servico: d.servico,
    valor: valor,
    data_pedido: d.data_pedido || null,
    observacoes: d.observacoes || null
  };

  try {
    const result = await insertPedidoSupabase(payload);
    showTyping(false);
    chatState.busy = false;
    chatState.step = 'done';
    const id = Array.isArray(result) && result[0]?.id ? ` <strong>#${result[0].id}</strong>` : '';
    botSay(`🎉 <strong>Pedido recebido${id}!</strong><br><br>Obrigado, <strong>${escapeHtml(d.cliente)}</strong>! A loja já pode ver seu pedido de <strong>${escapeHtml(d.servico)}</strong> no sistema e vai entrar em contato${d.telefone ? ` no <strong>${escapeHtml(d.telefone)}</strong>` : ''}.`);
    botSay('Precisa de mais alguma coisa? Posso registrar <strong>outro pedido</strong> para você.');
    setQuick([{ label: 'Fazer outro pedido ➕', value: 'novo', icon: 'fa-plus' }]);
    toast('Pedido criado no Supabase!', 'success');
  } catch (err) {
    console.error(err);
    showTyping(false);
    chatState.busy = false;
    chatState.step = 'confirm';
    const msg = String(err.message || err);
    if (msg.includes('HTTP 401') || msg.includes('JWT') || msg.includes('apikey')) {
      botSay('❌ <strong>Não consegui salvar.</strong> O banco bloqueou o acesso público.<br><br>👉 <strong>Dono da loja:</strong> no Supabase, em <em>Authentication → Policies</em> da tabela <em>pedidos</em>, crie a policy <strong>"Public insert"</strong> com <strong>FOR INSERT · TO anon · WITH CHECK (true)</strong>. Depois tente de novo.');
    } else if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
      botSay('❌ <strong>Sem conexão</strong> com a internet ou com o Supabase. Confira sua conexão e toque em confirmar de novo.');
    } else {
      botSay(`❌ <strong>Falha ao salvar:</strong> ${escapeHtml(msg.slice(0, 300))}<br>Tente confirmar novamente.`);
    }
    setQuick([{ label: 'Tentar de novo 🔄', value: 'sim, pode confirmar', icon: 'fa-rotate-right' }]);
    toast('Erro ao criar pedido: ' + msg.slice(0, 120), 'error');
  }
}

// ===== UI helpers =====
function userSay(text) {
  const div = document.createElement('div');
  div.className = 'msg msg-user';
  div.innerHTML = `<div class="bubble bubble-user">${escapeHtml(text)}</div>`;
  el.messages.appendChild(div);
  scrollBottom();
}

function botSay(html) {
  const div = document.createElement('div');
  div.className = 'msg msg-bot';
  div.innerHTML = `<div class="chat-bot-ico"><i class="fa-solid fa-robot"></i></div><div class="bubble bubble-bot">${html}</div>`;
  el.messages.appendChild(div);
  scrollBottom();
}

function setQuick(options) {
  el.quick.innerHTML = '';
  options.forEach(o => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'quick-btn';
    b.innerHTML = (o.icon ? `<i class="fa-solid ${o.icon}"></i> ` : '') + escapeHtml(o.label);
    b.addEventListener('click', () => {
      userSay(o.label.replace(/ 🐾| 🔧| 🍰| ✂️| 🖨️| ✅| ✏️| ➕/g, ''));
      el.quick.innerHTML = '';
      handleUserMessage(o.value);
    });
    el.quick.appendChild(b);
  });
}

function showTyping(on) {
  el.typing.classList.toggle('hidden', !on);
  if (on) scrollBottom();
}

function scrollBottom() {
  requestAnimationFrame(() => { el.messages.scrollTop = el.messages.scrollHeight; });
}

function toast(message, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  const icon = type === 'success' ? 'fa-circle-check' : type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-info';
  t.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${escapeHtml(message)}</span>`;
  el.toast.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 4500);
}

function formatBRL(v) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ===== Tema (claro/escuro, igual ao painel) =====
function initThemeChat() {
  const saved = localStorage.getItem('site_pedidos_theme');
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyThemeChat(saved === 'dark' || (!saved && prefersDark));
}
function applyThemeChat(isDark) {
  document.body.classList.toggle('dark-mode', isDark);
  const i = document.getElementById('chat-theme-icon');
  const t = document.getElementById('chat-theme-text');
  if (i) i.className = isDark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  if (t) t.textContent = isDark ? 'Modo Claro' : 'Modo Escuro';
}
function toggleThemeChat() {
  const dark = !document.body.classList.contains('dark-mode');
  applyThemeChat(dark);
  localStorage.setItem('site_pedidos_theme', dark ? 'dark' : 'light');
}
