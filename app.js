/**
 * Sistema de Gestão e Controle de Pedidos
 * Integrado ao Supabase com Dupla Camada (SDK Oficial + Fallback REST API Nativa)
 */

// Supabase Configuration
const SUPABASE_URL = 'https://zkhaowtylugnjksofbcv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_hKZ6gh7n_Xc_7C8xhhW_og_HemVWF2-';

// Global Application State
let state = {
  pedidos: [],
  filteredPedidos: [],
  activeView: 'list', // 'list' | 'table' | 'cards'
  searchQuery: '',
  filterSetor: 'todos',
  filterStatus: 'todos',
  sortBy: 'recents',
  pendingDeleteId: null,
  pendingDeleteName: '',
  supabaseClient: null,
  isUsingFallback: false
};

// DOM Element References (initialized on DOMContentLoaded)
let elements = {};

// Sector Icon & CSS Badge Mapping
const SECTOR_CONFIG = {
  'Pet Shop': { icon: 'fa-paw', class: 'sector-pet' },
  'Oficina': { icon: 'fa-wrench', class: 'sector-oficina' },
  'Confeitaria': { icon: 'fa-cake-candles', class: 'sector-confeitaria' },
  'Salão': { icon: 'fa-scissors', class: 'sector-salao' },
  'Gráfica': { icon: 'fa-print', class: 'sector-grafica' },
  'Geral': { icon: 'fa-box', class: 'sector-geral' }
};

/* ==========================================================================
   SUPABASE INITIALIZATION & DUAL CONNECTION ARCHITECTURE
   ========================================================================== */

function initSupabase() {
  try {
    if (window.supabase && typeof window.supabase.createClient === 'function') {
      state.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      console.log('Client Supabase JS SDK inicializado com sucesso.');
      updateStatusBadge('Supabase SDK Conectado', 'success');
      return true;
    }
  } catch (err) {
    console.warn('Erro ao inicializar SDK do Supabase, usando Fallback REST API:', err);
  }

  // Fallback to Native REST API mode
  state.isUsingFallback = true;
  console.log('Modo Fallback REST API ativado.');
  updateStatusBadge('Conectado via REST API Direct', 'info');
  return false;
}

function updateStatusBadge(text, mode = 'success') {
  const badgeText = document.getElementById('status-text');
  if (badgeText) {
    badgeText.textContent = text;
  }
}

/* ==========================================================================
   REST API DIRECT FALLBACK METHODS
   ========================================================================== */

const restHeaders = {
  'apikey': SUPABASE_ANON_KEY,
  'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

async function restFetchPedidos() {
  const url = `${SUPABASE_URL}/rest/v1/pedidos?select=*&order=id.desc`;
  const response = await fetch(url, { headers: restHeaders });
  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`HTTP ${response.status}: ${errBody}`);
  }
  return await response.json();
}

async function restInsertPedido(payload) {
  const url = `${SUPABASE_URL}/rest/v1/pedidos`;
  const response = await fetch(url, {
    method: 'POST',
    headers: restHeaders,
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json();
}

async function restUpdatePedido(id, payload) {
  const url = `${SUPABASE_URL}/rest/v1/pedidos?id=eq.${id}`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: restHeaders,
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json();
}

async function restDeletePedido(id) {
  const url = `${SUPABASE_URL}/rest/v1/pedidos?id=eq.${id}`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: restHeaders
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return true;
}

/* ==========================================================================
   MAIN DATA OPERATIONS (SELECT, INSERT, UPDATE, DELETE)
   ========================================================================== */

async function fetchPedidos() {
  try {
    showLoadingState();

    let data = [];

    if (state.supabaseClient && !state.isUsingFallback) {
      const { data: sdkData, error } = await state.supabaseClient
        .from('pedidos')
        .select('*')
        .order('id', { ascending: false });

      if (error) {
        console.warn('Erro via SDK, recorrendo ao REST API direct...', error);
        data = await restFetchPedidos();
      } else {
        data = sdkData;
      }
    } else {
      data = await restFetchPedidos();
    }

    state.pedidos = data || [];
    hideErrorState();
    applyFiltersAndRender();
  } catch (err) {
    console.error('Erro ao buscar pedidos:', err);
    showErrorState(err.message || 'Sem conexão com o Supabase.');
    showToast(`Erro ao carregar dados: ${err.message}`, 'error');
  } finally {
    hideLoadingState();
  }
}

function subscribeToRealtime() {
  if (state.supabaseClient && typeof state.supabaseClient.channel === 'function') {
    try {
      state.supabaseClient
        .channel('public:pedidos')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () => {
          console.log('Sinal Realtime recebido!');
          fetchPedidos();
          showToast('Dados atualizados em tempo real!', 'info');
        })
        .subscribe();
    } catch (e) {
      console.warn('Falha na inscrição Realtime:', e);
    }
  }
}

async function handleSavePedido(e) {
  e.preventDefault();

  const id = elements.pedidoId.value;
  const sector = elements.formSetor.value;
  const status = elements.formStatus.value;
  const client = elements.formCliente.value.trim();
  const phone = elements.formTelefone.value.trim() || null;
  const service = elements.formServico.value.trim();
  const value = parseFloat(elements.formValor.value) || 0;
  const orderDate = elements.formDataPedido.value.trim() || null;
  const obs = elements.formObservacoes.value.trim() || null;

  if (!sector || !status || !client || !service || isNaN(value)) {
    showToast('Por favor, preencha todos os campos obrigatórios (*).', 'error');
    return;
  }

  const payload = {
    setor: sector,
    status: status,
    cliente: client,
    telefone: phone,
    servico: service,
    valor: value,
    data_pedido: orderDate,
    observacoes: obs
  };

  const btnSave = document.getElementById('btn-save-pedido');
  btnSave.disabled = true;
  btnSave.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';

  try {
    if (id) {
      // Update
      if (state.supabaseClient && !state.isUsingFallback) {
        const { error } = await state.supabaseClient.from('pedidos').update(payload).eq('id', id);
        if (error) await restUpdatePedido(id, payload);
      } else {
        await restUpdatePedido(id, payload);
      }
      showToast('Pedido atualizado com sucesso!', 'success');
    } else {
      // Insert
      if (state.supabaseClient && !state.isUsingFallback) {
        const { error } = await state.supabaseClient.from('pedidos').insert([payload]);
        if (error) await restInsertPedido(payload);
      } else {
        await restInsertPedido(payload);
      }
      showToast('Novo pedido cadastrado com sucesso!', 'success');
    }

    closeModal();
    fetchPedidos();
  } catch (err) {
    console.error('Erro ao salvar pedido:', err);
    showToast(`Falha ao salvar: ${err.message}`, 'error');
  } finally {
    btnSave.disabled = false;
    btnSave.innerHTML = '<i class="fa-solid fa-check"></i> <span>Salvar Pedido</span>';
  }
}

async function updateStatusQuickly(id, newStatus) {
  try {
    if (state.supabaseClient && !state.isUsingFallback) {
      const { error } = await state.supabaseClient.from('pedidos').update({ status: newStatus }).eq('id', id);
      if (error) await restUpdatePedido(id, { status: newStatus });
    } else {
      await restUpdatePedido(id, { status: newStatus });
    }
    showToast(`Status alterado para "${newStatus}"!`, 'success');
    fetchPedidos();
  } catch (err) {
    console.error('Erro ao alterar status:', err);
    showToast(`Erro ao atualizar status: ${err.message}`, 'error');
  }
}

async function executeDeletePedido() {
  if (!state.pendingDeleteId) return;

  const btn = elements.btnConfirmDelete;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Excluindo...';

  try {
    if (state.supabaseClient && !state.isUsingFallback) {
      const { error } = await state.supabaseClient.from('pedidos').delete().eq('id', state.pendingDeleteId);
      if (error) await restDeletePedido(state.pendingDeleteId);
    } else {
      await restDeletePedido(state.pendingDeleteId);
    }

    showToast('Pedido excluído com sucesso!', 'success');
    closeDeleteModal();
    fetchPedidos();
  } catch (err) {
    console.error('Erro ao excluir pedido:', err);
    showToast(`Erro ao excluir: ${err.message}`, 'error');
  } finally {
    elements.btnConfirmDelete.disabled = false;
    elements.btnConfirmDelete.innerHTML = '<i class="fa-solid fa-trash"></i> Sim, Excluir';
  }
}

/* ==========================================================================
   UI UTILITIES & FILTERING LOGIC
   ========================================================================== */

function getStatusClass(status) {
  if (!status) return 'status-pendente';
  const s = status.toLowerCase();
  if (s.includes('confirm') || s.includes('concl')) return 'status-confirmado';
  if (s.includes('pendent') || s.includes('orçamento') || s.includes('arte')) return 'status-pendente';
  if (s.includes('agend') || s.includes('andamento')) return 'status-agendado';
  if (s.includes('produç')) return 'status-em-producao';
  if (s.includes('cancel')) return 'status-cancelado';
  return 'status-pendente';
}

function formatCurrency(val) {
  const num = parseFloat(val) || 0;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(num);
}

/* Número do pedido por ordem de chegada (coluna `numero`; fallback pela posição) */
function getNumero(item) {
  if (item.numero != null) return Number(item.numero);
  const ordered = [...state.pedidos].sort((a, b) => a.id - b.id);
  const idx = ordered.findIndex(p => p.id === item.id);
  return idx >= 0 ? idx + 1 : null;
}

function formatNumero(item) {
  const n = getNumero(item);
  return n != null ? `Nº ${n}` : '—';
}

function formatWhatsAppLink(phone, clientName, service) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) return null;
  
  let fullPhone = digits;
  if (digits.length === 10 || digits.length === 11) {
    fullPhone = '55' + digits;
  }
  
  const msg = encodeURIComponent(`Olá ${clientName}, tudo bem? Entramos em contato referente ao seu pedido: ${service}.`);
  return `https://wa.me/${fullPhone}?text=${msg}`;
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let icon = 'fa-circle-info';
  if (type === 'success') icon = 'fa-circle-check';
  if (type === 'error') icon = 'fa-circle-exclamation';

  toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
  elements.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function showLoadingState() {
  if (elements.loadingState) elements.loadingState.classList.remove('hidden');
  if (elements.emptyState) elements.emptyState.classList.add('hidden');
  if (elements.errorState) elements.errorState.classList.add('hidden');
}

function hideLoadingState() {
  if (elements.loadingState) elements.loadingState.classList.add('hidden');
}

function showErrorState(msg) {
  if (elements.errorState) {
    elements.errorState.classList.remove('hidden');
    document.getElementById('error-message-text').textContent = msg;
  }
  if (elements.simpleListView) elements.simpleListView.classList.add('hidden');
  if (elements.tableView) elements.tableView.classList.add('hidden');
  if (elements.cardsView) elements.cardsView.classList.add('hidden');
}

function hideErrorState() {
  if (elements.errorState) elements.errorState.classList.add('hidden');
}

function applyFiltersAndRender() {
  let list = [...state.pedidos];

  // Search Filter
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    list = list.filter(p => 
      (p.cliente && p.cliente.toLowerCase().includes(q)) ||
      (p.servico && p.servico.toLowerCase().includes(q)) ||
      (p.telefone && p.telefone.toLowerCase().includes(q)) ||
      (p.observacoes && p.observacoes.toLowerCase().includes(q)) ||
      (p.setor && p.setor.toLowerCase().includes(q))
    );
  }

  // Setor Filter
  if (state.filterSetor !== 'todos') {
    list = list.filter(p => p.setor === state.filterSetor);
  }

  // Status Filter
  if (state.filterStatus !== 'todos') {
    list = list.filter(p => p.status === state.filterStatus);
  }

  // Sorting
  if (state.sortBy === 'recents') {
    list.sort((a, b) => b.id - a.id);
  } else if (state.sortBy === 'oldest') {
    list.sort((a, b) => a.id - b.id);
  } else if (state.sortBy === 'cliente') {
    list.sort((a, b) => (a.cliente || '').localeCompare(b.cliente || ''));
  } else if (state.sortBy === 'valor-high') {
    list.sort((a, b) => (b.valor || 0) - (a.valor || 0));
  } else if (state.sortBy === 'valor-low') {
    list.sort((a, b) => (a.valor || 0) - (b.valor || 0));
  } else if (state.sortBy === 'numero') {
    list.sort((a, b) => (getNumero(a) ?? Number.MAX_SAFE_INTEGER) - (getNumero(b) ?? Number.MAX_SAFE_INTEGER));
  }

  state.filteredPedidos = list;
  updateKPIs();
  updateSectorButtons();

  elements.showingCount.textContent = `Exibindo ${list.length} de ${state.pedidos.length} pedidos`;

  if (list.length === 0) {
    elements.emptyState.classList.remove('hidden');
    elements.simpleListView.classList.add('hidden');
    elements.tableView.classList.add('hidden');
    elements.cardsView.classList.add('hidden');
  } else {
    elements.emptyState.classList.add('hidden');
    renderCurrentView();
  }
}

function updateKPIs() {
  const totalCount = state.pedidos.length;
  const totalVal = state.pedidos.reduce((sum, p) => sum + (parseFloat(p.valor) || 0), 0);
  
  const pendingCount = state.pedidos.filter(p => {
    if (!p.status) return true;
    const s = p.status.toLowerCase();
    return s.includes('pendent') || s.includes('orçamento') || s.includes('arte') || s.includes('agend');
  }).length;

  const avgVal = totalCount > 0 ? (totalVal / totalCount) : 0;

  elements.kpiTotalCount.textContent = totalCount;
  elements.kpiTotalValue.textContent = formatCurrency(totalVal);
  elements.kpiPendingCount.textContent = pendingCount;
  elements.kpiAvgValue.textContent = formatCurrency(avgVal);
}

function updateSectorButtons() {
  const counts = {
    todos: state.pedidos.length,
    'Pet Shop': 0,
    'Oficina': 0,
    'Confeitaria': 0,
    'Salão': 0,
    'Gráfica': 0
  };

  state.pedidos.forEach(p => {
    if (p.setor && counts[p.setor] !== undefined) {
      counts[p.setor]++;
    }
  });

  const badgeTodos = document.getElementById('badge-count-todos');
  const badgePet = document.getElementById('badge-count-pet');
  const badgeOficina = document.getElementById('badge-count-oficina');
  const badgeConf = document.getElementById('badge-count-confeitaria');
  const badgeSalao = document.getElementById('badge-count-salao');
  const badgeGrafica = document.getElementById('badge-count-grafica');

  if (badgeTodos) badgeTodos.textContent = counts.todos;
  if (badgePet) badgePet.textContent = counts['Pet Shop'];
  if (badgeOficina) badgeOficina.textContent = counts['Oficina'];
  if (badgeConf) badgeConf.textContent = counts['Confeitaria'];
  if (badgeSalao) badgeSalao.textContent = counts['Salão'];
  if (badgeGrafica) badgeGrafica.textContent = counts['Gráfica'];

  document.querySelectorAll('.sector-action-btn').forEach(btn => {
    const s = btn.getAttribute('data-setor');
    if (s === state.filterSetor) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  if (elements.filterSetor && elements.filterSetor.value !== state.filterSetor) {
    elements.filterSetor.value = state.filterSetor;
  }
}

/* ==========================================================================
   RENDER VIEWS (LIST, TABLE, CARDS)
   ========================================================================== */

function renderCurrentView() {
  elements.simpleListView.classList.add('hidden');
  elements.tableView.classList.add('hidden');
  elements.cardsView.classList.add('hidden');

  if (state.activeView === 'list') {
    elements.simpleListView.classList.remove('hidden');
    renderSimpleList();
  } else if (state.activeView === 'table') {
    elements.tableView.classList.remove('hidden');
    renderTableView();
  } else if (state.activeView === 'cards') {
    elements.cardsView.classList.remove('hidden');
    renderCardsView();
  }
}

// 1. SIMPLE LIST VIEW
function renderSimpleList() {
  elements.simpleListItems.innerHTML = '';

  state.filteredPedidos.forEach(item => {
    const li = document.createElement('li');
    li.className = 'simple-list-item';

    const sectorConf = SECTOR_CONFIG[item.setor] || SECTOR_CONFIG['Geral'];
    const waUrl = formatWhatsAppLink(item.telefone, item.cliente, item.servico);

    li.innerHTML = `
      <div class="list-item-main">
        <span class="numero-badge" title="Pedido interno #${item.id}">${formatNumero(item)}</span>
        <span class="sector-badge ${sectorConf.class}">
          <i class="fa-solid ${sectorConf.icon}"></i> ${item.setor || 'Geral'}
        </span>
        <div class="list-item-details">
          <div class="list-item-client">
            <strong>${escapeHtml(item.cliente)}</strong>
            ${waUrl ? `<a href="${waUrl}" target="_blank" class="whatsapp-link" title="Abrir conversa no WhatsApp"><i class="fa-brands fa-whatsapp"></i> ${escapeHtml(item.telefone)}</a>` : (item.telefone ? `<span class="text-muted text-sm"><i class="fa-solid fa-phone"></i> ${escapeHtml(item.telefone)}</span>` : '')}
          </div>
          <div class="list-item-service">
            <i class="fa-solid fa-screwdriver-wrench text-muted"></i> ${escapeHtml(item.servico)}
            ${item.observacoes ? `<span class="text-muted text-sm" title="${escapeHtml(item.observacoes)}"> (${escapeHtml(item.observacoes)})</span>` : ''}
          </div>
          ${item.data_pedido ? `
            <div class="list-item-meta">
              <span class="meta-date"><i class="fa-regular fa-calendar"></i> ${escapeHtml(item.data_pedido)}</span>
            </div>
          ` : ''}
        </div>
      </div>

      <div class="list-item-right">
        <span class="list-item-price">${formatCurrency(item.valor)}</span>
        
        <select class="status-select-inline" onchange="updateStatusQuickly(${item.id}, this.value)">
          ${getStatusOptionsHtml(item.status)}
        </select>

        <div class="list-item-actions">
          <button class="btn btn-secondary btn-icon-only btn-sm" onclick="openEditModal(${item.id})" title="Editar pedido">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
          <button class="btn btn-secondary btn-icon-only btn-sm text-danger" onclick="openDeleteModal(${item.id}, '${escapeJsString(item.cliente)}')" title="Excluir pedido">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    `;

    elements.simpleListItems.appendChild(li);
  });
}

// 2. TABLE VIEW
function renderTableView() {
  elements.tableBody.innerHTML = '';

  state.filteredPedidos.forEach(item => {
    const tr = document.createElement('tr');
    const sectorConf = SECTOR_CONFIG[item.setor] || SECTOR_CONFIG['Geral'];
    const waUrl = formatWhatsAppLink(item.telefone, item.cliente, item.servico);

    tr.innerHTML = `
      <td><span class="numero-badge" title="Pedido interno #${item.id}">${formatNumero(item)}</span></td>
      <td>
        <span class="sector-badge ${sectorConf.class}">
          <i class="fa-solid ${sectorConf.icon}"></i> ${item.setor || 'Geral'}
        </span>
      </td>
      <td><strong>${escapeHtml(item.cliente)}</strong></td>
      <td>
        ${waUrl ? `<a href="${waUrl}" target="_blank" class="whatsapp-link"><i class="fa-brands fa-whatsapp"></i> ${escapeHtml(item.telefone)}</a>` : (item.telefone ? escapeHtml(item.telefone) : '-')}
      </td>
      <td>${escapeHtml(item.servico)}</td>
      <td>${item.data_pedido ? escapeHtml(item.data_pedido) : '-'}</td>
      <td><strong>${formatCurrency(item.valor)}</strong></td>
      <td>
        <select class="status-select-inline" onchange="updateStatusQuickly(${item.id}, this.value)">
          ${getStatusOptionsHtml(item.status)}
        </select>
      </td>
      <td class="text-sm text-muted">${item.observacoes ? escapeHtml(item.observacoes) : '-'}</td>
      <td class="text-right">
        <button class="btn btn-secondary btn-icon-only btn-sm" onclick="openEditModal(${item.id})" title="Editar">
          <i class="fa-solid fa-pen-to-square"></i>
        </button>
        <button class="btn btn-secondary btn-icon-only btn-sm text-danger" onclick="openDeleteModal(${item.id}, '${escapeJsString(item.cliente)}')" title="Excluir">
          <i class="fa-solid fa-trash"></i>
        </button>
      </td>
    `;
    elements.tableBody.appendChild(tr);
  });
}

// 3. CARDS VIEW
function renderCardsView() {
  elements.cardsGrid.innerHTML = '';

  state.filteredPedidos.forEach(item => {
    const card = document.createElement('div');
    card.className = 'order-card';

    const sectorConf = SECTOR_CONFIG[item.setor] || SECTOR_CONFIG['Geral'];
    const statusClass = getStatusClass(item.status);
    const waUrl = formatWhatsAppLink(item.telefone, item.cliente, item.servico);

    card.innerHTML = `
      <div class="card-top">
        <div class="card-top-left">
          <span class="numero-badge" title="Pedido interno #${item.id}">${formatNumero(item)}</span>
          <span class="sector-badge ${sectorConf.class}">
            <i class="fa-solid ${sectorConf.icon}"></i> ${item.setor || 'Geral'}
          </span>
        </div>
        <span class="status-pill ${statusClass}">${escapeHtml(item.status)}</span>
      </div>

      <div>
        <h3 class="card-client-name">${escapeHtml(item.cliente)}</h3>
        <p class="card-service">${escapeHtml(item.servico)}</p>
      </div>

      <div class="card-details-box">
        ${item.telefone ? `<div class="card-detail-row"><span>Contato:</span> ${waUrl ? `<a href="${waUrl}" target="_blank" class="whatsapp-link"><i class="fa-brands fa-whatsapp"></i> ${escapeHtml(item.telefone)}</a>` : escapeHtml(item.telefone)}</div>` : ''}
        ${item.data_pedido ? `<div class="card-detail-row"><span>Data/Hora:</span> <strong>${escapeHtml(item.data_pedido)}</strong></div>` : ''}
        ${item.observacoes ? `<div class="card-detail-row"><span>Obs:</span> <em>${escapeHtml(item.observacoes)}</em></div>` : ''}
      </div>

      <div class="card-footer">
        <span class="card-price">${formatCurrency(item.valor)}</span>
        <div class="list-item-actions">
          <button class="btn btn-secondary btn-icon-only btn-sm" onclick="openEditModal(${item.id})" title="Editar">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
          <button class="btn btn-secondary btn-icon-only btn-sm text-danger" onclick="openDeleteModal(${item.id}, '${escapeJsString(item.cliente)}')" title="Excluir">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    `;

    elements.cardsGrid.appendChild(card);
  });
}

function getStatusOptionsHtml(currentStatus) {
  const options = [
    'Pendente',
    'Confirmado',
    'Agendado',
    'Em andamento',
    'Em produção',
    'Aguardando orçamento',
    'Aguardando arte',
    'Concluído',
    'Cancelado'
  ];

  return options.map(opt => `
    <option value="${opt}" ${opt === currentStatus ? 'selected' : ''}>${opt}</option>
  `).join('');
}

/* ==========================================================================
   MODALS & EXPORT
   ========================================================================== */

function openNewModal() {
  elements.pedidoId.value = '';
  elements.modalTitle.innerHTML = '<i class="fa-solid fa-file-circle-plus"></i> Novo Pedido';
  elements.pedidoForm.reset();
  elements.formStatus.value = 'Pendente';
  elements.pedidoModal.classList.remove('hidden');
  elements.formCliente.focus();
}

function openEditModal(id) {
  const item = state.pedidos.find(p => p.id === id);
  if (!item) return;

  elements.pedidoId.value = item.id;
  elements.modalTitle.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Editar Pedido #' + item.id;
  
  elements.formSetor.value = item.setor || '';
  elements.formStatus.value = item.status || 'Pendente';
  elements.formCliente.value = item.cliente || '';
  elements.formTelefone.value = item.telefone || '';
  elements.formServico.value = item.servico || '';
  elements.formValor.value = item.valor || '';
  elements.formDataPedido.value = item.data_pedido || '';
  elements.formObservacoes.value = item.observacoes || '';

  elements.pedidoModal.classList.remove('hidden');
}

function closeModal() {
  elements.pedidoModal.classList.add('hidden');
}

function openDeleteModal(id, clientName) {
  state.pendingDeleteId = id;
  state.pendingDeleteName = clientName;
  elements.deleteClientName.textContent = `#${id} - ${clientName}`;
  elements.deleteModal.classList.remove('hidden');
}

function closeDeleteModal() {
  state.pendingDeleteId = null;
  elements.deleteModal.classList.add('hidden');
}

function exportToCSV() {
  if (state.filteredPedidos.length === 0) {
    showToast('Nenhum pedido visível para exportar.', 'error');
    return;
  }

  const headers = ['Nº', 'ID', 'Setor', 'Cliente', 'Telefone', 'Serviço', 'Data/Horário', 'Valor (R$)', 'Status', 'Observações'];
  const rows = state.filteredPedidos.map(p => [
    getNumero(p) ?? '',
    p.id,
    `"${(p.setor || '').replace(/"/g, '""')}"`,
    `"${(p.cliente || '').replace(/"/g, '""')}"`,
    `"${(p.telefone || '').replace(/"/g, '""')}"`,
    `"${(p.servico || '').replace(/"/g, '""')}"`,
    `"${(p.data_pedido || '').replace(/"/g, '""')}"`,
    (p.valor || 0).toFixed(2),
    `"${(p.status || '').replace(/"/g, '""')}"`,
    `"${(p.observacoes || '').replace(/"/g, '""')}"`
  ]);

  const csvContent = '\uFEFF' + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `pedidos_export_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showToast('Relatório CSV exportado com sucesso!', 'success');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeJsString(str) {
  if (!str) return '';
  return String(str).replace(/'/g, "\\'").replace(/"/g, '\\"');
}

/* ==========================================================================
   DOM INITIALIZATION & EVENT BINDINGS
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  // Bind DOM elements safely
  elements = {
    kpiTotalCount: document.getElementById('kpi-total-count'),
    kpiTotalValue: document.getElementById('kpi-total-value'),
    kpiPendingCount: document.getElementById('kpi-pending-count'),
    kpiAvgValue: document.getElementById('kpi-avg-value'),
    searchInput: document.getElementById('search-input'),
    searchClear: document.getElementById('search-clear'),
    filterSetor: document.getElementById('filter-setor'),
    filterStatus: document.getElementById('filter-status'),
    sortBy: document.getElementById('sort-by'),
    showingCount: document.getElementById('showing-count'),
    btnRefresh: document.getElementById('btn-refresh'),
    btnExport: document.getElementById('btn-export'),
    btnNewOrder: document.getElementById('btn-new-order'),
    btnViewList: document.getElementById('view-list'),
    btnViewTable: document.getElementById('view-table'),
    btnViewCards: document.getElementById('view-cards'),
    loadingState: document.getElementById('loading-state'),
    errorState: document.getElementById('error-state'),
    emptyState: document.getElementById('empty-state'),
    simpleListView: document.getElementById('simple-list-view'),
    simpleListItems: document.getElementById('simple-list-items'),
    tableView: document.getElementById('table-view'),
    tableBody: document.getElementById('table-body'),
    cardsView: document.getElementById('cards-view'),
    cardsGrid: document.getElementById('cards-grid'),
    pedidoModal: document.getElementById('pedido-modal'),
    modalTitle: document.getElementById('modal-title'),
    pedidoForm: document.getElementById('pedido-form'),
    pedidoId: document.getElementById('pedido-id'),
    formSetor: document.getElementById('form-setor'),
    formStatus: document.getElementById('form-status'),
    formCliente: document.getElementById('form-cliente'),
    formTelefone: document.getElementById('form-telefone'),
    formServico: document.getElementById('form-servico'),
    formValor: document.getElementById('form-valor'),
    formDataPedido: document.getElementById('form-data-pedido'),
    formObservacoes: document.getElementById('form-observacoes'),
    btnCloseModal: document.getElementById('btn-close-modal'),
    btnCancelModal: document.getElementById('btn-cancel-modal'),
    deleteModal: document.getElementById('delete-modal'),
    deleteClientName: document.getElementById('delete-client-name'),
    btnCloseDeleteModal: document.getElementById('btn-close-delete-modal'),
    btnCancelDelete: document.getElementById('btn-cancel-delete'),
    btnConfirmDelete: document.getElementById('btn-confirm-delete'),
    btnRetryFetch: document.getElementById('btn-retry-fetch'),
    btnThemeToggle: document.getElementById('btn-theme-toggle'),
    themeToggleIcon: document.getElementById('theme-toggle-icon'),
    themeToggleText: document.getElementById('theme-toggle-text'),
    toastContainer: document.getElementById('toast-container')
  };

  // 1. Initialize Theme (Light / Dark mode from localStorage or system)
  initTheme();

  // 2. Initialize Supabase Client
  initSupabase();

  // 3. Fetch Data & Subscribe to Realtime
  fetchPedidos();
  subscribeToRealtime();

  // 4. View Switcher Events
  elements.btnViewList.addEventListener('click', () => {
    state.activeView = 'list';
    elements.btnViewList.classList.add('active');
    elements.btnViewTable.classList.remove('active');
    elements.btnViewCards.classList.remove('active');
    renderCurrentView();
  });

  elements.btnViewTable.addEventListener('click', () => {
    state.activeView = 'table';
    elements.btnViewList.classList.remove('active');
    elements.btnViewTable.classList.add('active');
    elements.btnViewCards.classList.remove('active');
    renderCurrentView();
  });

  elements.btnViewCards.addEventListener('click', () => {
    state.activeView = 'cards';
    elements.btnViewList.classList.remove('active');
    elements.btnViewTable.classList.remove('active');
    elements.btnViewCards.classList.add('active');
    renderCurrentView();
  });

  // 5. Theme Toggle Listener
  if (elements.btnThemeToggle) {
    elements.btnThemeToggle.addEventListener('click', toggleTheme);
  }

  // 6. Sector Action Buttons Listeners
  document.querySelectorAll('.sector-action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const selectedSetor = btn.getAttribute('data-setor');
      state.filterSetor = selectedSetor;
      applyFiltersAndRender();
    });
  });

  // 7. Search & Filter Listeners
  elements.searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    elements.searchClear.classList.toggle('hidden', !state.searchQuery);
    applyFiltersAndRender();
  });

  elements.searchClear.addEventListener('click', () => {
    elements.searchInput.value = '';
    state.searchQuery = '';
    elements.searchClear.classList.add('hidden');
    applyFiltersAndRender();
  });

  elements.filterSetor.addEventListener('change', (e) => {
    state.filterSetor = e.target.value;
    applyFiltersAndRender();
  });

  elements.filterStatus.addEventListener('change', (e) => {
    state.filterStatus = e.target.value;
    applyFiltersAndRender();
  });

  elements.sortBy.addEventListener('change', (e) => {
    state.sortBy = e.target.value;
    applyFiltersAndRender();
  });

  // 7. Action Buttons
  elements.btnRefresh.addEventListener('click', () => {
    fetchPedidos();
    showToast('Dados atualizados com sucesso!', 'info');
  });

  if (elements.btnRetryFetch) {
    elements.btnRetryFetch.addEventListener('click', fetchPedidos);
  }

  elements.btnExport.addEventListener('click', exportToCSV);
  elements.btnNewOrder.addEventListener('click', openNewModal);

  // 8. Modal Listeners
  elements.pedidoForm.addEventListener('submit', handleSavePedido);
  elements.btnCloseModal.addEventListener('click', closeModal);
  elements.btnCancelModal.addEventListener('click', closeModal);

  elements.btnCloseDeleteModal.addEventListener('click', closeDeleteModal);
  elements.btnCancelDelete.addEventListener('click', closeDeleteModal);
  elements.btnConfirmDelete.addEventListener('click', executeDeletePedido);

  elements.pedidoModal.addEventListener('click', (e) => {
    if (e.target === elements.pedidoModal) closeModal();
  });

  elements.deleteModal.addEventListener('click', (e) => {
    if (e.target === elements.deleteModal) closeDeleteModal();
  });
});

/* ==========================================================================
   THEME TOGGLE SYSTEM (DARK MODE / LIGHT MODE)
   ========================================================================== */

function initTheme() {
  const savedTheme = localStorage.getItem('site_pedidos_theme');
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
    applyTheme(true);
  } else {
    applyTheme(false);
  }
}

function applyTheme(isDark) {
  if (isDark) {
    document.body.classList.add('dark-mode');
    if (elements.themeToggleIcon) elements.themeToggleIcon.className = 'fa-solid fa-sun';
    if (elements.themeToggleText) elements.themeToggleText.textContent = 'Modo Claro';
  } else {
    document.body.classList.remove('dark-mode');
    if (elements.themeToggleIcon) elements.themeToggleIcon.className = 'fa-solid fa-moon';
    if (elements.themeToggleText) elements.themeToggleText.textContent = 'Modo Escuro';
  }
}

function toggleTheme() {
  const isCurrentlyDark = document.body.classList.contains('dark-mode');
  const newDarkState = !isCurrentlyDark;
  applyTheme(newDarkState);
  localStorage.setItem('site_pedidos_theme', newDarkState ? 'dark' : 'light');
  showToast(newDarkState ? 'Modo Escuro ativado!' : 'Modo Claro ativado!', 'info');
}

