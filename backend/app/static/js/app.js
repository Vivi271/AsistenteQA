/**
 * PRQA — app.js
 * Asistente QA con IA Local — Ciel Ingeniería S.A.S
 * Lógica completa de la interfaz
 */

// ══════════════════════════════════════════════════════════════
// Configuración
// ══════════════════════════════════════════════════════════════
const API_BASE = '';  // nginx hace proxy de /api/ → backend:8000
let currentModule = 'chat';
let selectedResult = null;
let currentExecutionCaseId = null;
let allTestCases = [];

// ══════════════════════════════════════════════════════════════
// ESPACIO DE TRABAJO POR PROYECTOS (ESTADO GLOBAL Y CRUD)
// ══════════════════════════════════════════════════════════════
let currentProject = localStorage.getItem('prqa-active-project') || 'Proyectos';

function _getCustomProjects() {
  return JSON.parse(localStorage.getItem('prqa-custom-projects') || '[]');
}
function _saveCustomProjects(list) {
  localStorage.setItem('prqa-custom-projects', JSON.stringify(list));
}

function _setActiveProjectUI(name) {
  currentProject = name;
  localStorage.setItem('prqa-active-project', name);
  const el = document.getElementById('activeProjectName');
  if (el) el.textContent = name;
  const projInput = document.getElementById('projectName');
  if (projInput) projInput.value = name;
  // Ocultar botones de gestión si es el proyecto predeterminado General
  const actionRow = document.getElementById('projectActionRow');
  if (actionRow) actionRow.style.display = (name === 'General') ? 'none' : 'flex';
  // Actualizar el check en el dropdown para que siempre apunte al proyecto activo
  renderProjectDropdown(_lastProjectList || []);
}

async function loadProjectsList() {
  // Obtener proyectos del servidor
  let serverProjects = [];
  try {
    const res = await fetch(`${API_BASE}/api/projects`);
    serverProjects = await res.json();
  } catch(e) { /* sin conexión */ }

  const custom = _getCustomProjects();
  const all = [...new Set(['General', ...serverProjects, ...custom])].sort();

  // Actualizar el hidden <select> (legado para compatibilidad)
  const select = document.getElementById('projectSelect');
  if (select) {
    select.innerHTML = '';
    all.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p; opt.textContent = p;
      if (p === currentProject) opt.selected = true;
      select.appendChild(opt);
    });
  }

  // Renderizar dropdown personalizado
  renderProjectDropdown(all);
  _setActiveProjectUI(currentProject);
}

// Guardar lista para poder re-renderizar cuando cambia el proyecto activo
let _lastProjectList = [];

function renderProjectDropdown(projects) {
  if (projects && projects.length > 0) _lastProjectList = projects;
  const list = document.getElementById('projectDropdownList');
  if (!list) return;
  const source = (projects && projects.length > 0) ? projects : _lastProjectList;
  list.innerHTML = source.map(p => `
    <button class="proj-dropdown-item ${p === currentProject ? 'active-proj' : ''}" onclick="selectProject('${p.replace(/'/g, "\\'")}')"
      style="font-family:inherit;">
      <svg class="proj-dropdown-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="12" height="12"
        style="opacity:${p === currentProject ? '1' : '0'};">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      ${p}
    </button>
  `).join('');
}

function toggleProjectDropdown() {
  const dd = document.getElementById('projectDropdown');
  const chevron = document.getElementById('projChevron');
  if (!dd) return;
  const isHidden = dd.classList.contains('hidden');
  dd.classList.toggle('hidden');
  if (chevron) chevron.classList.toggle('open', isHidden);
}

function closeProjectDropdown() {
  const dd = document.getElementById('projectDropdown');
  const chevron = document.getElementById('projChevron');
  if (dd) dd.classList.add('hidden');
  if (chevron) chevron.classList.remove('open');
}

function selectProject(name) {
  closeProjectDropdown();
  if (name === currentProject) return;

  // Ocultar siempre el estado/banner de generación al cambiar de proyecto
  const loading = document.getElementById('generatorLoading');
  if (loading) loading.classList.add('hidden');
  const generateBtn = document.getElementById('generateBtn');
  if (generateBtn) generateBtn.disabled = false;

  _setActiveProjectUI(name);
  showToast(`✓ Proyecto cambiado a «${name}»`, 'success');
  refreshActiveModuleData();
}


// Mantener handleProjectChange para legado
function handleProjectChange(val) {
  if (val === '__new__') { openCreateProjectModal(); return; }
  selectProject(val);
}

// Cerrar dropdown al hacer clic fuera
document.addEventListener('click', function(e) {
  const card = document.getElementById('projectSelectorCard');
  if (card && !card.contains(e.target)) closeProjectDropdown();
});

function openCreateProjectModal() {
  document.getElementById('newProjectName').value = '';
  document.getElementById('createProjectModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('newProjectName').focus(), 80);
}

function closeCreateProjectModal() {
  document.getElementById('createProjectModal').classList.add('hidden');
}

async function submitCreateProject() {
  const input = document.getElementById('newProjectName');
  const name = input.value.trim();
  if (!name) { showToast('El nombre no puede estar vacío', 'error'); return; }

  let custom = _getCustomProjects();
  if (!custom.includes(name)) { custom.push(name); _saveCustomProjects(custom); }

  closeCreateProjectModal();
  await loadProjectsList();
  selectProject(name);
  showToast(`Proyecto "${name}" creado`, 'success');
}

// ── Renombrar proyecto ─────────────────────────────────────────
function openRenameProjectModal() {
  if (currentProject === 'General') { showToast('No puedes renombrar el proyecto predeterminado', 'error'); return; }

  document.getElementById('renameProjectCurrent').textContent = currentProject;
  document.getElementById('renameProjectInput').value = currentProject;
  document.getElementById('renameProjectModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('renameProjectInput').select(), 80);
}

function closeRenameProjectModal() {
  document.getElementById('renameProjectModal').classList.add('hidden');
}

async function submitRenameProject() {
  const newName = document.getElementById('renameProjectInput').value.trim();
  if (!newName) { showToast('El nombre no puede estar vacío', 'error'); return; }
  if (newName === currentProject) { closeRenameProjectModal(); return; }

  const oldName = currentProject;

  // 1. Llamar al backend para renombrar todos los datos (documentos, casos, Excels)
  try {
    const res = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(oldName)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_name: newName })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.detail || 'Error al renombrar en el servidor', 'error');
      return;
    }
  } catch (e) {
    showToast('No se pudo conectar con el servidor', 'error');
    return;
  }

  // 2. Actualizar localStorage
  let custom = _getCustomProjects();
  const idx = custom.indexOf(oldName);
  if (idx >= 0) custom[idx] = newName;
  else custom.push(newName);
  _saveCustomProjects(custom);

  closeRenameProjectModal();
  currentProject = newName;
  localStorage.setItem('prqa-active-project', newName);
  await loadProjectsList();
  _setActiveProjectUI(newName);
  refreshActiveModuleData();
  showToast(`Proyecto renombrado a "${newName}"`, 'success');
}

// ── Eliminar proyecto ──────────────────────────────────────────
function openDeleteProjectModal() {
  if (currentProject === 'General') { showToast('No puedes eliminar el proyecto predeterminado', 'error'); return; }
  document.getElementById('deleteProjectName').textContent = currentProject;
  document.getElementById('deleteProjectModal').classList.remove('hidden');
}

function closeDeleteProjectModal() {
  document.getElementById('deleteProjectModal').classList.add('hidden');
}

async function submitDeleteProject() {
  const deleted = currentProject;

  // 1. Llamar al backend para borrar todos los datos del proyecto (documentos, casos, Excels)
  try {
    const res = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(deleted)}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.detail || 'Error eliminando proyecto del servidor', 'error');
      closeDeleteProjectModal();
      return;
    }
  } catch (e) {
    showToast('No se pudo conectar con el servidor', 'error');
    closeDeleteProjectModal();
    return;
  }

  // 2. Limpiar de localStorage (proyectos personalizados)
  let custom = _getCustomProjects();
  custom = custom.filter(p => p !== deleted);
  _saveCustomProjects(custom);

  closeDeleteProjectModal();
  currentProject = 'General';
  localStorage.setItem('prqa-active-project', 'General');
  await loadProjectsList();
  _setActiveProjectUI('General');
  refreshActiveModuleData();
  showToast(`Proyecto "${deleted}" eliminado`, 'success');
}

function refreshActiveModuleData() {
  if (currentModule === 'chat') {
    clearChat();
  }
  if (currentModule === 'generate') {
    loadDocumentsForGenerator();
    loadTestCasesForGenerator();
    const projInput = document.getElementById('projectName');
    if (projInput) projInput.value = currentProject;
  }
  if (currentModule === 'documents') {
    loadDocuments();
  }
  if (currentModule === 'execution') {
    loadTestCasesForExecution();
  }
  if (currentModule === 'dashboard') {
    loadDashboard();
  }
}

// ══════════════════════════════════════════════════════════════
// Inicialización
// ══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  const savedTheme = localStorage.getItem('prqa-theme') || 'dark';
  toggleTheme(savedTheme);

  checkHealth();
  setInterval(checkHealth, 30000);
  
  await loadProjectsList();
  
  // Set default active project name in generated config projectName field
  const projInput = document.getElementById('projectName');
  if (projInput) projInput.value = currentProject;

  // Start on step 1: Base de Conocimiento
  switchModule('documents');

  loadTestCasesForExecution();
  loadDashboard();

  setupDragDrop();

  // Show onboarding on first visit
  if (!localStorage.getItem('prqa-onboarding-done')) {
    showOnboarding();
  }
});

// ══════════════════════════════════════════════════════════════
// Health Check
// ══════════════════════════════════════════════════════════════
async function checkHealth() {
  const dot = document.getElementById('statusDot');
  const label = document.getElementById('statusLabel');
  const model = document.getElementById('statusModel');

  try {
    const res = await fetch(`${API_BASE}/api/health`);
    const data = await res.json();

    if (data.status === 'ok' && data.rag_ready) {
      dot.className = 'status-dot online';
      label.textContent = 'IA Conectada';
      model.textContent = data.model || 'llama3.1:8b';
    } else {
      dot.className = 'status-dot';
      dot.style.background = '#f59e0b';
      label.textContent = 'Iniciando...';
      model.textContent = data.model || 'llama3.1:8b';
    }
  } catch (e) {
    dot.className = 'status-dot offline';
    label.textContent = 'Sin conexión';
    model.textContent = 'Backend caído';
  }
}

// ══════════════════════════════════════════════════════════════
// Navegación
// ══════════════════════════════════════════════════════════════
function switchModule(name) {
  // Ocultar módulo actual
  document.querySelectorAll('.module').forEach(m => m.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  // Mostrar nuevo módulo
  const moduleEl = document.getElementById(`module${name.charAt(0).toUpperCase() + name.slice(1)}`);
  const navEl = document.getElementById(`nav${name.charAt(0).toUpperCase() + name.slice(1)}`);

  if (moduleEl) moduleEl.classList.add('active');
  if (navEl) navEl.classList.add('active');

  currentModule = name;

  // Recargar datos según módulo
  if (name === 'generate') {
    loadDocumentsForGenerator();
    loadTestCasesForGenerator();
    updateTestTypeChips();
  }
  if (name === 'documents') loadDocuments();
  if (name === 'execution') loadTestCasesForExecution();
  if (name === 'dashboard') loadDashboard();
}

async function loadTestCasesForGenerator() {
  const container = document.getElementById('testCasesContainer');
  if (!container) return;

  try {
    const res = await fetch(`${API_BASE}/api/test-cases/exports?project_name=${encodeURIComponent(currentProject)}`);
    const files = await res.json();

    if (!files || files.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" width="48" height="48">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <p>Sin archivos generados</p>
          <span>Genera casos de prueba a la izquierda para crear tu primera matriz Excel EOPA</span>
        </div>
      `;
      document.getElementById('caseCountBadge').textContent = '0';
      return;
    }

    document.getElementById('caseCountBadge').textContent = files.length;

    container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:0.6rem;width:100%;">
        ${files.map(f => {
          const displayTitle = `Matriz EOPA — ${f.module}`;
          return `
          <div class="excel-file-card" style="
            display:flex;align-items:center;gap:0.75rem;
            background:var(--bg-input);border:1px solid var(--border-subtle);
            border-radius:var(--radius-md);padding:0.75rem 0.875rem;
            transition:var(--transition);
          " onmouseenter="this.style.borderColor='var(--border-accent)';this.style.background='var(--bg-panel-hover)'" onmouseleave="this.style.borderColor='var(--border-subtle)';this.style.background='var(--bg-input)'">
            <!-- Icono Excel (Estilo Ciel Teal corporativo) -->
            <div style="width:38px;height:38px;border-radius:8px;
              background:rgba(0,156,166,0.1);color:var(--accent-primary);
              display:flex;align-items:center;justify-content:center;flex-shrink:0;
              border:1px solid rgba(0,156,166,0.25);">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
            </div>
            <!-- Info profesional limpia -->
            <div style="flex:1;min-width:0;">
              <div style="font-weight:700;font-size:0.83rem;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${f.filename}">
                ${displayTitle}
              </div>
              <div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.2rem;display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
                <span>Módulo: <strong style="color:var(--text-secondary);">${f.module}</strong></span>
                <span>·</span>
                <span>${f.size_kb} KB</span>
                <span>·</span>
                <span>📅 ${f.created_at}</span>
              </div>
            </div>
            <!-- Acciones idénticas a los demás botones principales de la app -->
            <div style="display:flex;gap:0.4rem;flex-shrink:0;">
              <button class="btn-ghost" style="padding:0.42rem 0.75rem;font-size:0.75rem;border-radius:var(--radius-sm);" onclick="goToExecution('${f.module}')" title="Ir a ejecutar las pruebas de este archivo">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                Ejecutar
              </button>
              <button class="btn-primary" style="padding:0.42rem 0.85rem;font-size:0.75rem;border-radius:var(--radius-sm);" onclick="downloadSpecificExcel('${f.filename}')" title="Descargar Excel">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Descargar
              </button>
              <button onclick="deleteExcel('${f.filename}')" title="Eliminar archivo y sus casos de prueba"
                style="padding:0.42rem 0.55rem;font-size:0.75rem;background:rgba(239,68,68,0.08);color:var(--accent-danger);
                  border:1px solid rgba(239,68,68,0.2);border-radius:var(--radius-sm);cursor:pointer;transition:var(--transition);"
                onmouseenter="this.style.background='rgba(239,68,68,0.18)'" onmouseleave="this.style.background='rgba(239,68,68,0.08)'">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
                </svg>
              </button>
            </div>
          </div>
        `}).join('')}
      </div>
    `;

  } catch (e) {
    console.error('Error cargando historial de archivos Excel:', e);
    container.innerHTML = `<div class="empty-state"><p>Error al cargar historial: ${e.message}</p></div>`;
  }
}

async function deleteExcel(filename) {
  if (!confirm(`¿Eliminar "${filename}"?\n\nEsto también eliminará los casos de prueba generados en esa sesión. Esta acción no se puede deshacer.`)) return;
  try {
    const res = await fetch(`${API_BASE}/api/test-cases/exports/delete?project_name=${encodeURIComponent(currentProject)}&filename=${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const err = await res.json();
      showToast(err.detail || 'Error al eliminar archivo', 'error');
      return;
    }
    const result = await res.json();
    const casesMsg = result.db_cases_deleted > 0
      ? ` y ${result.db_cases_deleted} caso${result.db_cases_deleted !== 1 ? 's' : ''} de prueba`
      : '';
    showToast(`Archivo eliminado${casesMsg}`, 'success');
    // Refrescar historial de generados y la lista de ejecuciones siempre
    loadTestCasesForGenerator();
    loadTestCasesForExecution();
  } catch (e) {
    showToast('Error al eliminar: ' + e.message, 'error');
  }
}





async function downloadSpecificExcel(filename) {
  const url = `${API_BASE}/api/test-cases/exports/download?project_name=${encodeURIComponent(currentProject)}&filename=${encodeURIComponent(filename)}&t=${Date.now()}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      showToast('Error al descargar el archivo Excel.', 'error');
      return;
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (e) {
    showToast('Error al descargar el archivo: ' + e.message, 'error');
  }
}



// ══════════════════════════════════════════════════════════════
// MÓDULO 2 — GENERADOR (CARGA DE DOCUMENTOS DESDE EL RAG)
// ══════════════════════════════════════════════════════════════
async function loadDocumentsForGenerator() {
  const select = document.getElementById('docSelect');
  if (!select) return;

  try {
    const res = await fetch(`${API_BASE}/api/documents?project=${encodeURIComponent(currentProject)}`);
    const docs = await res.json();

    // Reset select options
    select.innerHTML = '<option value="">-- Seleccionar documento indexado (Opcional) --</option>';

    docs.forEach(doc => {
      const opt = document.createElement('option');
      opt.value = doc.id;
      opt.textContent = `${doc.filename} (${doc.category === 'mtr' ? 'MTR' : 'Requerimientos'} - ${doc.chunks} partes)`;
      select.appendChild(opt);
    });
  } catch (e) {
    console.error('Error cargando documentos para el generador:', e);
  }
}

async function loadDocToTextarea(docId) {
  const textarea = document.getElementById('requirementText');
  if (!textarea) return;

  if (!docId) {
    textarea.value = '';
    return;
  }

  textarea.placeholder = "Cargando texto indexado del documento...";
  textarea.value = "";
  textarea.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/api/documents/${docId}/content`);
    if (!res.ok) throw new Error('No se pudo obtener el contenido del documento.');
    const data = await res.json();
    textarea.value = data.content || '';
  } catch (e) {
    showToast('Error cargando documento: ' + e.message, 'error');
    textarea.value = '';
  } finally {
    textarea.disabled = false;
    textarea.placeholder = "Selecciona un documento arriba para cargarlo automáticamente, o pega/escribe el requerimiento de forma manual aquí...";
  }
}

// ══════════════════════════════════════════════════════════════
// MÓDULO 1 — CHAT
// ══════════════════════════════════════════════════════════════
function handleChatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function setInput(text) {
  const input = document.getElementById('chatInput');
  input.value = text;
  autoResizeTextarea(input);
  input.focus();
}

function clearChat() {
  const messages = document.getElementById('chatMessages');
  messages.innerHTML = `
    <div class="message assistant-message">
      <div class="message-avatar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
        </svg>
      </div>
      <div class="message-content">
        <div class="message-header">
          <span class="message-sender">PRQA Assistant</span>
          <span class="message-time">Ahora</span>
        </div>
        <div class="message-text"><p>Chat reiniciado. ¿En qué te puedo ayudar?</p></div>
      </div>
    </div>
  `;
}

async function sendMessage() {
  const input = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  const useKB = document.getElementById('useKnowledgeBase').checked;
  const text = input.value.trim();
  if (!text) return;

  // Añadir mensaje del usuario
  appendMessage('user', text);
  input.value = '';
  input.style.height = 'auto';
  sendBtn.disabled = true;

  // Mostrar indicador de escritura
  const typingId = showTypingIndicator();

  try {
    // Usar streaming si está disponible
    const response = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        use_knowledge_base: useKB,
        project_name: currentProject,
      }),
    });

    removeTypingIndicator(typingId);

    if (!response.ok) {
      const err = await response.json();
      appendMessage('assistant', `Error: ${err.detail || 'No se pudo procesar la consulta.'}`, []);
    } else {
      const data = await response.json();
      appendMessage('assistant', data.response, data.sources || []);
    }
  } catch (e) {
    removeTypingIndicator(typingId);
    appendMessage('assistant', `Error de conexión. ¿El backend está corriendo?\n\n\`docker-compose up\``, []);
  }

  sendBtn.disabled = false;
  input.focus();
}

function appendMessage(role, text, sources = []) {
  const messages = document.getElementById('chatMessages');
  const isUser = role === 'user';
  const time = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

  // Convertir markdown simple a HTML
  const formatted = formatMarkdown(text);

  const sourcesHtml = sources.length > 0
    ? `<div class="message-sources">${sources.map(s => `<span class="source-chip">${s}</span>`).join('')}</div>`
    : '';

  const el = document.createElement('div');
  el.className = `message ${isUser ? 'user-message' : 'assistant-message'}`;
  el.innerHTML = `
    <div class="message-avatar">
      ${isUser
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>`
      }
    </div>
    <div class="message-content">
      <div class="message-header">
        <span class="message-sender">${isUser ? 'Tú' : 'PRQA Assistant'}</span>
        <span class="message-time">${time}</span>
      </div>
      <div class="message-text">${formatted}${sourcesHtml}</div>
    </div>
  `;

  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
}

function formatMarkdown(text) {
  return text
    .replace(/```([^`]+)```/g, '<pre><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h4 style="color:var(--accent-secondary);margin:0.5rem 0 0.25rem">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 style="color:var(--accent-secondary);margin:0.75rem 0 0.35rem">$1</h3>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^(?!<)(.+)/, '<p>$1</p>');
}

function showTypingIndicator() {
  const messages = document.getElementById('chatMessages');
  const id = 'typing_' + Date.now();
  const el = document.createElement('div');
  el.id = id;
  el.className = 'message assistant-message typing-indicator';
  el.innerHTML = `
    <div class="message-avatar">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
      </svg>
    </div>
    <div class="message-content">
      <div class="message-text">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    </div>
  `;
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
  return id;
}

function removeTypingIndicator(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

// ══════════════════════════════════════════════════════════════
// LÓGICA DE MULTISELECT DROPDOWN & CHIPS PARA TIPOS DE PRUEBA
// ══════════════════════════════════════════════════════════════
function toggleTestTypesDropdown() {
  const dropdown = document.getElementById('testTypesDropdown');
  if (dropdown) dropdown.classList.toggle('hidden');
}

function updateTestTypeChips() {
  const container = document.getElementById('selectedTestTypeChips');
  const placeholder = document.getElementById('multiselectPlaceholder');
  const checkboxes = document.querySelectorAll('#testTypesDropdown input[type="checkbox"]');
  if (!container || !placeholder) return;

  const checkedList = Array.from(checkboxes).filter(cb => cb.checked);

  if (checkedList.length === 0) {
    placeholder.textContent = 'Seleccionar tipos de prueba...';
    container.innerHTML = '<span style="font-size:0.75rem; color:var(--text-muted); font-style:italic;">Ningún tipo seleccionado. Se usarán Funcionales por defecto.</span>';
    return;
  }

  placeholder.textContent = `${checkedList.length} tipo(s) de prueba seleccionado(s)`;

  container.innerHTML = checkedList.map(cb => {
    const label = cb.getAttribute('data-label') || cb.nextElementSibling.textContent;
    return `
      <span class="test-chip">
        ${label}
        <button type="button" onclick="removeTestType('${cb.value}')" title="Quitar">&times;</button>
      </span>
    `;
  }).join('');
}

function removeTestType(val) {
  const cb = document.querySelector(`#testTypesDropdown input[value="${val}"]`);
  if (cb) {
    cb.checked = false;
    updateTestTypeChips();
  }
}

document.addEventListener('click', function(e) {
  const select = document.getElementById('customTestTypesSelect');
  const dropdown = document.getElementById('testTypesDropdown');
  if (select && dropdown && !select.contains(e.target)) {
    dropdown.classList.add('hidden');
  }
});

// ══════════════════════════════════════════════════════════════
// MÓDULO 2 — GENERADOR DE CASOS DE PRUEBA
// ══════════════════════════════════════════════════════════════
async function generateTestCases() {
  const btn = document.getElementById('generateBtn');
  const loading = document.getElementById('generatorLoading');
  const container = document.getElementById('testCasesContainer');

  const requirementText = document.getElementById('requirementText').value.trim();
  if (!requirementText) {
    showToast('Por favor ingresa el texto del requerimiento.', 'error');
    return;
  }

  const testTypes = Array.from(
    document.querySelectorAll('#testTypesDropdown input:checked')
  ).map(cb => cb.value);

  if (testTypes.length === 0) {
    showToast('Selecciona al menos un tipo de prueba.', 'error');
    return;
  }

  btn.disabled = true;
  loading.classList.remove('hidden');
  // NO limpiamos el container para que el historial previo se siga viendo debajo del overlay

  try {
    const response = await fetch(`${API_BASE}/api/test-cases/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requirement_text: requirementText,
        project_name: document.getElementById('projectName').value || currentProject || 'Proyecto',
        module: document.getElementById('moduleName').value || 'General',
        test_types: testTypes,
        num_cases: parseInt(document.getElementById('numCases').value),
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || 'Error generando casos de prueba');
    }

    // Refrescar el historial de Excels generados
    await loadTestCasesForGenerator();

    showToast(`✅ Matriz EOPA generada: ${data.excel_filename}`, 'success');

    // Descarga automática del Excel recién generado
    if (data.excel_filename) {
      downloadSpecificExcel(data.excel_filename);
    }

  } catch (e) {
    showToast(e.message, 'error');
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40" style="color:var(--accent-danger)">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <p>Error al generar</p>
        <span>${e.message}</span>
      </div>
    `;
  } finally {
    loading.classList.add('hidden');
    btn.disabled = false;
  }
}


async function exportTestCases() {
  const project = document.getElementById('projectName').value || '';
  const url = `${API_BASE}/api/test-cases/export/excel${project ? `?project_name=${encodeURIComponent(project)}` : ''}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      const err = await response.json();
      showToast(err.detail || 'No hay casos para exportar', 'error');
      return;
    }
    const blob = await response.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `CasosPrueba_${project || 'PRQA'}_${new Date().toISOString().slice(0,10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast('Excel exportado exitosamente', 'success');
  } catch (e) {
    showToast('Error al exportar: ' + e.message, 'error');
  }
}

// ══════════════════════════════════════════════════════════════
// MÓDULO 3 — EJECUCIÓN DE PRUEBAS
// ══════════════════════════════════════════════════════════════
async function loadTestCasesForExecution() {
  const grid = document.getElementById('executionGrid');
  const filterStatus = document.getElementById('filterStatus');
  const statusFilter = filterStatus ? filterStatus.value : '';

  let url = `${API_BASE}/api/test-cases?project_name=${encodeURIComponent(currentProject)}`;
  if (statusFilter) url += `&status=${encodeURIComponent(statusFilter)}`;

  try {
    const res = await fetch(url);
    const cases = await res.json();

    if (!cases || cases.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="padding:3rem 2rem;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" width="48" height="48" style="opacity:0.4">
            <polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
          </svg>
          <p style="margin-top:0.75rem;font-weight:700;color:var(--text-secondary);">No hay casos de prueba disponibles</p>
          <span style="font-size:0.82rem;color:var(--text-muted);max-width:320px;text-align:center;display:block;">Los casos de prueba se generan desde <strong>Generar Casos</strong>. Una vez generados aparecerán aquí automáticamente.</span>
          <div style="display:flex;gap:0.75rem;margin-top:1.25rem;">
            <button class="btn-primary" onclick="switchModule('generate')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 5v14M5 12l7-7 7 7"/></svg>
              Ir a Generar Casos
            </button>
            <button class="btn-ghost" onclick="loadTestCasesForExecution()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              Actualizar
            </button>
          </div>
        </div>
      `;
      return;
    }

    grid.innerHTML = renderExecutionGrouped(cases);

  } catch (e) {
    grid.innerHTML = `<div class="empty-state"><p>Error al cargar casos: ${e.message}</p></div>`;
  }
}

// ── Agrupar casos por módulo + sesión de generación (hora truncada a minutos) ──
function renderExecutionGrouped(cases) {
  // Agrupar: clave = "módulo · fecha-hora" (primeros 16 chars del ISO timestamp)
  const groups = {};
  cases.forEach(tc => {
    const sessionKey = `${tc.module}|||${(tc.created_at || '').slice(0, 16)}`;
    if (!groups[sessionKey]) groups[sessionKey] = { module: tc.module, created_at: tc.created_at, cases: [] };
    groups[sessionKey].cases.push(tc);
  });

  const sorted = Object.values(groups).sort((a, b) =>
    (b.created_at || '').localeCompare(a.created_at || '')
  );

  return sorted.map((group, gIdx) => {
    const total = group.cases.length;
    const ejecutados = group.cases.filter(c => c.status === 'Ejecutado').length;
    const cumple = group.cases.filter(c => c.result === 'CUMPLE').length;
    const noCumple = group.cases.filter(c => c.result === 'NO CUMPLE').length;
    const pendientes = total - ejecutados;
    const pct = total > 0 ? Math.round((ejecutados / total) * 100) : 0;

    // Formatear fecha limpia
    const rawDate = group.created_at || '';
    let cleanDate = rawDate;
    try {
      const d = new Date(rawDate);
      cleanDate = d.toLocaleString('es-CO', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true
      });
    } catch(_) {}

    const rows = group.cases.map(tc => {
      const statusMap = {
        'Pendiente': { cls: 'status-pending', label: 'Pendiente' },
        'Ejecutado': tc.result === 'CUMPLE'
          ? { cls: 'status-cumple', label: 'CUMPLE' }
          : { cls: 'status-nocumple', label: 'NO CUMPLE' },
      };
      const status = statusMap[tc.status] || statusMap['Pendiente'];

      return `
        <tr class="exec-table-row">
          <td class="exec-td exec-td-id"><span class="exec-case-id">${tc.case_id}</span></td>
          <td class="exec-td exec-td-title"><div class="exec-title-cell">${tc.title}</div></td>
          <td class="exec-td"><span class="tc-tag tag-type">${tc.test_type}</span></td>
          <td class="exec-td exec-td-status"><span class="exec-status ${status.cls}">${status.label}</span></td>
          <td class="exec-td exec-td-actions">
            <button class="exec-btn-sm exec-btn-cumple" onclick="openExecutionModal('${tc.db_id}', '${tc.case_id}', '${escapeStr(tc.title)}')">&#10003; CUMPLE</button>
            <button class="exec-btn-sm exec-btn-nocumple" onclick="openExecutionModal('${tc.db_id}', '${tc.case_id}', '${escapeStr(tc.title)}')">&#10007; NO CUMPLE</button>
          </td>
        </tr>
      `;
    }).join('');

    return `
      <!-- ── Grupo: ${group.module} · ${cleanDate} ── -->
      <div class="exec-group" style="margin-bottom:1.25rem;border:1px solid var(--border-subtle);border-radius:var(--radius-md);overflow:hidden;">

        <!-- Encabezado colapsable del grupo -->
        <div class="exec-group-header" onclick="toggleExecGroup('group-${gIdx}')"
          style="display:flex;align-items:center;gap:1rem;padding:0.9rem 1.1rem;
            background:var(--bg-panel);cursor:pointer;user-select:none;
            border-bottom:1px solid var(--border-subtle);transition:var(--transition);"
          onmouseenter="this.style.background='var(--bg-panel-hover)'"
          onmouseleave="this.style.background='var(--bg-panel)'">

          <!-- Ícono de colapso -->
          <svg id="chevron-${gIdx}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"
            style="color:var(--accent-primary);flex-shrink:0;transition:transform 0.2s ease;transform:rotate(0deg);">
            <polyline points="6 9 12 15 18 9"/>
          </svg>

          <!-- Módulo e ícono Excel -->
          <div style="width:32px;height:32px;border-radius:6px;background:rgba(0,156,166,0.1);color:var(--accent-primary);
            display:flex;align-items:center;justify-content:center;flex-shrink:0;border:1px solid rgba(0,156,166,0.2);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
            </svg>
          </div>

          <!-- Info del grupo -->
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;font-size:0.875rem;color:var(--text-primary);">
              Módulo: ${group.module}
            </div>
            <div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.1rem;display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;">
              <span>📅 ${cleanDate}</span>
              <span>·</span>
              <span>${total} caso${total !== 1 ? 's' : ''}</span>
            </div>
          </div>

          <!-- Badges de estado de ejecución + Botón Descargar -->
          <div style="display:flex;gap:0.5rem;flex-shrink:0;align-items:center;">
            ${pendientes > 0 ? `<span style="padding:0.2rem 0.55rem;border-radius:20px;font-size:0.68rem;font-weight:700;background:rgba(245,158,11,0.15);color:#f59e0b;border:1px solid rgba(245,158,11,0.25);">${pendientes} pendiente${pendientes !== 1 ? 's' : ''}</span>` : ''}
            ${cumple > 0 ? `<span style="padding:0.2rem 0.55rem;border-radius:20px;font-size:0.68rem;font-weight:700;background:rgba(16,185,129,0.15);color:#10b981;border:1px solid rgba(16,185,129,0.25);">✓ ${cumple} CUMPLE</span>` : ''}
            ${noCumple > 0 ? `<span style="padding:0.2rem 0.55rem;border-radius:20px;font-size:0.68rem;font-weight:700;background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.2);">✗ ${noCumple} FALLA</span>` : ''}
            <!-- Barra de progreso -->
            <div style="width:70px;height:6px;background:var(--border-subtle);border-radius:3px;overflow:hidden;">
              <div style="height:100%;width:${pct}%;background:var(--gradient-main);border-radius:3px;transition:width 0.4s ease;"></div>
            </div>
            <span style="font-size:0.68rem;color:var(--text-muted);min-width:28px;">${pct}%</span>
            <!-- Botón Descargar Resultados del grupo -->
            <button class="btn-primary" style="padding:0.38rem 0.8rem;font-size:0.72rem;border-radius:var(--radius-sm);margin-left:0.25rem;"
              onclick="event.stopPropagation(); exportGroupResults('${group.module}', '${(group.created_at||'').slice(0,16)}')"
              title="Descargar Excel con resultados de esta sesión">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Resultados
            </button>
            <!-- Botón Eliminar esta sesión de pruebas -->
            <button onclick="event.stopPropagation(); deleteModuleGroup('${group.module}')"
              title="Eliminar este módulo y su archivo Excel"
              style="padding:0.38rem 0.55rem;font-size:0.72rem;background:rgba(239,68,68,0.08);color:var(--accent-danger);border:1px solid rgba(239,68,68,0.2);border-radius:var(--radius-sm);cursor:pointer;transition:var(--transition);"
              onmouseenter="this.style.background='rgba(239,68,68,0.18)'" onmouseleave="this.style.background='rgba(239,68,68,0.08)'">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- Tabla de casos del grupo (colapsable) -->
        <div id="group-${gIdx}" style="overflow:hidden;">
          <table class="exec-table" style="border-radius:0;border:none;">
            <thead>
              <tr>
                <th class="exec-th">ID</th>
                <th class="exec-th">Nombre del Caso</th>
                <th class="exec-th">Tipo</th>
                <th class="exec-th">Estado</th>
                <th class="exec-th">Registrar Resultado</th>
              </tr>
            </thead>

            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;
  }).join('');
}

async function syncAndRefresh() {
  // Sincronizar: eliminar de BD los casos cuyo Excel ya no existe en disco
  try {
    const res = await fetch(`${API_BASE}/api/test-cases/sync?project_name=${encodeURIComponent(currentProject)}`, {
      method: 'DELETE'
    });
    if (res.ok) {
      const data = await res.json();
      if (data.deleted_orphaned > 0) {
        showToast(`Sincronizado: ${data.deleted_orphaned} caso${data.deleted_orphaned !== 1 ? 's' : ''} huérfano${data.deleted_orphaned !== 1 ? 's' : ''} eliminado${data.deleted_orphaned !== 1 ? 's' : ''}`, 'info');
      }
    }
  } catch(e) { /* continuar aunque falle la sincronización */ }
  // Recargar la vista de ejecución
  loadTestCasesForExecution();
}

async function clearAllCases() {

  if (!currentProject) { showToast('No hay proyecto activo', 'error'); return; }
  if (!confirm(`¿Eliminar TODOS los casos de prueba de "${currentProject}"?\n\nEsto limpiará la vista de Ejecutar Pruebas. Los archivos Excel en Generar Casos no se eliminan.`)) return;
  try {
    const res = await fetch(`${API_BASE}/api/test-cases/all?project_name=${encodeURIComponent(currentProject)}`, { method: 'DELETE' });
    if (!res.ok) { const e = await res.json(); showToast(e.detail || 'Error al limpiar', 'error'); return; }
    const data = await res.json();
    showToast(`${data.deleted} caso${data.deleted !== 1 ? 's' : ''} eliminado${data.deleted !== 1 ? 's' : ''}`, 'success');
    loadTestCasesForExecution();
  } catch(e) {
    showToast('Error: ' + e.message, 'error');
  }
}

function toggleExecGroup(groupId) {
  const content = document.getElementById(groupId);
  const idx = groupId.replace('group-', '');
  const chevron = document.getElementById(`chevron-${idx}`);
  if (!content) return;

  const isOpen = content.style.maxHeight !== '0px' && content.style.maxHeight !== '';
  if (isOpen) {
    content.style.maxHeight = '0px';
    content.style.overflow = 'hidden';
    if (chevron) chevron.style.transform = 'rotate(-90deg)';
  } else {
    content.style.maxHeight = content.scrollHeight + 'px';
    content.style.overflow = 'visible';
    if (chevron) chevron.style.transform = 'rotate(0deg)';
  }
}

async function exportGroupResults(module, sessionPrefix) {
  /**
   * Descarga el Excel EOPA del módulo/sesión correspondiente desde el historial de generados.
   * Busca el archivo que coincida con el módulo y la sesión (prefijo de fecha).
   */
  try {
    const res = await fetch(`${API_BASE}/api/test-cases/exports?project_name=${encodeURIComponent(currentProject)}`);
    const files = await res.json();

    // Buscar el archivo del módulo + sesión
    const cleanModule = module.replace(/\s+/g, '_');
    const sessionDate = sessionPrefix.replace('T', '_').replace(':', '-').slice(0, 16);

    // Intentar coincidencia por módulo
    const match = files.find(f => {
      const stem = f.filename.replace('.xlsx', '');
      return stem.toLowerCase().includes(cleanModule.toLowerCase()) ||
             f.module.toLowerCase() === module.toLowerCase();
    });

    if (match) {
      showToast(`Descargando resultados: ${match.filename}`, 'info');
      downloadSpecificExcel(match.filename);
    } else {
      // Si no hay coincidencia exacta, exportar todos los casos del módulo como fallback
      const allRes = await fetch(`${API_BASE}/api/test-cases/export/excel?project_name=${encodeURIComponent(currentProject)}&module=${encodeURIComponent(module)}`);
      if (!allRes.ok) {
        showToast('No se encontró el archivo de resultados para este módulo.', 'error');
        return;
      }
      const blob = await allRes.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `Resultados_${module}_${new Date().toLocaleDateString('es-CO').replace(/\//g,'-')}.xlsx`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      showToast('Resultados exportados correctamente', 'success');
    }
  } catch (e) {
    showToast('Error al exportar resultados: ' + e.message, 'error');
  }
}

async function goToExecution(moduleName) {
  // Normalizar nombre para comparación flexible (ignora espacios/guiones bajos, mayúsculas, acentos)
  const normalize = s => (s || '').toLowerCase().replace(/[\s_]+/g, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  try {
    const res = await fetch(`${API_BASE}/api/test-cases?project_name=${encodeURIComponent(currentProject)}`);
    const cases = await res.json();

    // Primero buscar coincidencia exacta del módulo, luego fuzzy
    const moduleCases = cases.filter(c =>
      normalize(c.module) === normalize(moduleName)
    );

    if (moduleCases.length > 0) {
      switchModule('execution');
      showToast(`${moduleCases.length} caso${moduleCases.length !== 1 ? 's' : ''} listos para ejecutar — Módulo: ${moduleName}`, 'success');
    } else if (cases.length > 0) {
      // Hay casos pero de otro módulo — navegar igual y mostrar advertencia
      switchModule('execution');
      showToast(`Módulo "${moduleName}" no tiene casos activos en la sesión actual.`, 'info');
    } else {
      // No hay ningún caso en el proyecto
      showToast('No hay casos de prueba. Ve a Generar Casos primero.', 'error');
      setTimeout(() => switchModule('generate'), 1200);
    }
  } catch (e) {
    switchModule('execution');
  }
}

async function deleteModuleGroup(moduleName) {
  if (!confirm(`¿Eliminar el módulo "${moduleName}" y todos sus casos de prueba?\n\nTambién se eliminará el archivo Excel correspondiente del historial.`)) return;
  try {
    // Buscar el Excel correspondiente a este módulo
    const res = await fetch(`${API_BASE}/api/test-cases/exports?project_name=${encodeURIComponent(currentProject)}`);
    const files = await res.json();
    const match = files.find(f =>
      f.module.toLowerCase() === moduleName.toLowerCase() ||
      f.filename.toLowerCase().includes(moduleName.toLowerCase().replace(/\s+/g, '_'))
    );

    if (match) {
      // Existe un Excel — usar el flujo normal de borrado (archivo + casos BD)
      const delRes = await fetch(
        `${API_BASE}/api/test-cases/exports/delete?project_name=${encodeURIComponent(currentProject)}&filename=${encodeURIComponent(match.filename)}`,
        { method: 'DELETE' }
      );
      const result = await delRes.json();
      const msg = result.db_cases_deleted > 0 ? ` y ${result.db_cases_deleted} casos de prueba` : '';
      showToast(`Módulo eliminado${msg}`, 'success');
    } else {
      // No hay Excel pero sí hay casos huérfanos en BD — borrarlos directo
      await fetch(`${API_BASE}/api/test-cases/all?project_name=${encodeURIComponent(currentProject)}`, { method: 'DELETE' });
      showToast(`Módulo "${moduleName}" eliminado`, 'success');
    }

    // Sincronizar ambas vistas
    loadTestCasesForExecution();
    loadTestCasesForGenerator();
  } catch (e) {
    showToast('Error al eliminar: ' + e.message, 'error');
  }
}




function renderExecutionTable(cases) {
  // Mantener compatibilidad con llamadas existentes — redirige al nuevo agrupado
  return renderExecutionGrouped(cases);
}





function escapeStr(s) {
  return (s || '').replace(/'/g, "\\'").replace(/"/g, '\\"');
}

// ════════════════════════════════════════════════════════════
// BURBUJA FLOTANTE ASISTENTE IA
// ════════════════════════════════════════════════════════════
let chatDrawerOpen = false;

function toggleChatDrawer() {
  const drawer = document.getElementById('chatDrawer');
  const backdrop = document.getElementById('chatDrawerBackdrop');
  const fab = document.getElementById('chatFab');

  chatDrawerOpen = !chatDrawerOpen;

  if (chatDrawerOpen) {
    drawer.classList.add('open');
    backdrop.classList.remove('hidden');
    if (fab) {
      fab.style.opacity = '0';
      fab.style.pointerEvents = 'none';
      fab.style.transform = 'scale(0.8)';
    }
    // Scroll chat to bottom
    const msgs = document.getElementById('chatMessages');
    if (msgs) {
      setTimeout(() => { msgs.scrollTop = msgs.scrollHeight; }, 100);
    }
  } else {
    drawer.classList.remove('open');
    backdrop.classList.add('hidden');
    if (fab) {
      fab.style.opacity = '1';
      fab.style.pointerEvents = 'auto';
      fab.style.transform = '';
    }
  }
}

function openExecutionModal(dbId, caseId, title) {
  currentExecutionCaseId = dbId;
  selectedResult = null;

  document.getElementById('modalTestCaseTitle').textContent = title || 'Registrar Resultado';
  document.getElementById('modalCaseId').textContent = caseId;
  document.getElementById('execNotes').value = '';
  document.getElementById('noCumpleFields').style.display = 'none';
  document.getElementById('saveExecutionBtn').disabled = true;

  document.getElementById('btnCumple').classList.remove('selected');
  document.getElementById('btnNoCumple').classList.remove('selected');

  document.getElementById('executionModal').classList.remove('hidden');
}

function closeExecutionModal() {
  document.getElementById('executionModal').classList.add('hidden');
  currentExecutionCaseId = null;
  selectedResult = null;
}

function selectResult(result) {
  selectedResult = result;
  document.getElementById('btnCumple').classList.toggle('selected', result === 'CUMPLE');
  document.getElementById('btnNoCumple').classList.toggle('selected', result === 'NO CUMPLE');
  document.getElementById('noCumpleFields').style.display = result === 'NO CUMPLE' ? 'block' : 'none';
  document.getElementById('saveExecutionBtn').disabled = false;
}

async function saveExecution() {
  if (!selectedResult || !currentExecutionCaseId) return;

  const saveBtn = document.getElementById('saveExecutionBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Guardando...';

  const payload = {
    test_case_id: currentExecutionCaseId,
    result: selectedResult,
    notes: document.getElementById('execNotes').value.trim() || null,
    tester_name: null,
  };

  if (selectedResult === 'NO CUMPLE') {
    payload.severity = document.getElementById('execSeverity').value;
    payload.incident_type = document.getElementById('execIncidentType').value;
    payload.incident_state = document.getElementById('execIncidentState').value;
  }

  try {
    const res = await fetch(`${API_BASE}/api/execution/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Error al guardar');

    showToast(`${selectedResult === 'CUMPLE' ? '✅' : '❌'} Resultado registrado: ${selectedResult}`, selectedResult === 'CUMPLE' ? 'success' : 'error');
    closeExecutionModal();
    loadTestCasesForExecution();
    loadDashboard();

  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Guardar Resultado';
  }
}

// Cerrar modal al hacer clic fuera
document.getElementById('executionModal').addEventListener('click', function(e) {
  if (e.target === this) closeExecutionModal();
});

// ══════════════════════════════════════════════════════════════
// MÓDULO 4 — BASE DE CONOCIMIENTO
// ══════════════════════════════════════════════════════════════
function setupDragDrop() {
  const zone = document.getElementById('uploadZone');
  if (!zone) return;

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.style.borderColor = 'var(--accent-primary)';
    zone.style.background = 'rgba(99,102,241,0.08)';
  });

  zone.addEventListener('dragleave', () => {
    zone.style.borderColor = '';
    zone.style.background = '';
  });

  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.style.borderColor = '';
    zone.style.background = '';
    const file = e.dataTransfer.files[0];
    if (file) uploadDocument(file);
  });
}

let activeIndexingFile = null;

async function uploadDocument(file) {
  if (!file) return;

  const category = document.querySelector('input[name="category"]:checked')?.value || 'requirements';
  const formData = new FormData();
  formData.append('file', file);

  const zone = document.getElementById('uploadZone');
  const grid = document.getElementById('documentsGrid');

  zone.style.borderColor = 'var(--accent-primary)';
  activeIndexingFile = file.name;

  showToast(`🚀 Subiendo "${file.name}"...`, 'info');

  // Insertar la card de indexación al INICIO del grid (sin borrar los docs existentes)
  if (grid) {
    const indexingCard = document.createElement('div');
    indexingCard.id = 'activeIndexingCard';
    indexingCard.className = 'doc-card indexing-card';
    indexingCard.style.cssText = `
      grid-column: 1 / -1;
      background: rgba(99, 102, 241, 0.08);
      border: 2px dashed var(--accent-primary);
      border-radius: var(--radius-md);
      padding: 1.25rem 1.5rem;
      display: flex;
      align-items: center;
      gap: 1.25rem;
      animation: pulseBorder 2s infinite ease-in-out;
    `;
    indexingCard.innerHTML = `
      <div style="
        width: 36px; height: 36px;
        border: 3px solid rgba(99, 102, 241, 0.2);
        border-top-color: var(--accent-primary);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
        flex-shrink: 0;
      "></div>
      <div style="flex:1;">
        <div style="font-weight: 700; font-size: 0.95rem; color: var(--text-primary); display: flex; align-items: center; gap: 0.5rem;">
          <span>⚡ Indexando documento en la IA:</span>
          <strong style="color: var(--accent-primary);">${file.name}</strong>
        </div>
        <div style="font-size: 0.82rem; color: var(--text-secondary); margin-top: 0.25rem;">
          Extrayendo contenido, fragmentando en bloques y generando embeddings vectoriales en ChromaDB... Por favor espera un momento.
        </div>
      </div>
    `;
    // Insertar al principio sin eliminar el contenido existente
    const emptyState = grid.querySelector('.empty-state');
    if (emptyState) {
      grid.innerHTML = '';
    }
    grid.insertBefore(indexingCard, grid.firstChild);
  }

  try {
    const res = await fetch(`${API_BASE}/api/documents/upload?category=${category}&project=${encodeURIComponent(currentProject)}`, {
      method: 'POST',
      body: formData,
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Error al subir');

    showToast(`"${file.name}" recibido. Indexando fragmentos...`, 'info');

    // Polling inteligente hasta completar la indexación
    pollIndexingCompletion(file.name);

  } catch (e) {
    showToast('Error al subir: ' + e.message, 'error');
    activeIndexingFile = null;
    loadDocuments();
  } finally {
    zone.style.borderColor = '';
    document.getElementById('fileInput').value = '';
  }
}

async function pollIndexingCompletion(filename) {
  let attempts = 0;
  const maxAttempts = 20;

  const interval = setInterval(async () => {
    attempts++;
    try {
      const res = await fetch(`${API_BASE}/api/documents?project=${encodeURIComponent(currentProject)}`);
      const docs = await res.json();
      
      const doc = docs.find(d => d.filename === filename && d.chunks > 0);
      if (doc) {
        clearInterval(interval);
        activeIndexingFile = null;
        // Quitar la card de carga antes de recargar la lista
        const card = document.getElementById('activeIndexingCard');
        if (card) card.remove();
        showToast(`✅ "${filename}" indexado exitosamente (${doc.chunks} fragmentos).`, 'success');
        loadDocuments();
        loadDocumentsForGenerator();
        return;
      }
    } catch (e) {
      console.error('Error en polling de indexación:', e);
    }

    if (attempts >= maxAttempts) {
      clearInterval(interval);
      activeIndexingFile = null;
      loadDocuments();
    }
  }, 1500);
}

async function loadDocuments() {
  const grid = document.getElementById('documentsGrid');
  if (!grid) return;

  try {
    const res = await fetch(`${API_BASE}/api/documents?project=${encodeURIComponent(currentProject)}`);
    const docs = await res.json();

    const categoryLabels = { mtr: 'MTR', requirements: 'Reqs', templates: 'Plantillas' };

    let indexingCardHtml = '';
    if (activeIndexingFile) {
      indexingCardHtml = `
        <div class="doc-card indexing-card" style="
          grid-column: 1 / -1;
          background: rgba(99, 102, 241, 0.08);
          border: 2px dashed var(--accent-primary);
          border-radius: var(--radius-md);
          padding: 1.25rem 1.5rem;
          display: flex;
          align-items: center;
          gap: 1.25rem;
          animation: pulseBorder 2s infinite ease-in-out;
        ">
          <div style="
            width: 36px; height: 36px;
            border: 3px solid rgba(99, 102, 241, 0.2);
            border-top-color: var(--accent-primary);
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            flex-shrink: 0;
          "></div>
          <div style="flex:1;">
            <div style="font-weight: 700; font-size: 0.95rem; color: var(--text-primary); display: flex; align-items: center; gap: 0.5rem;">
              <span>⚡ Indexando en la IA:</span>
              <strong style="color: var(--accent-primary);">${activeIndexingFile}</strong>
            </div>
            <div style="font-size: 0.82rem; color: var(--text-secondary); margin-top: 0.25rem;">
              Extrayendo contenido, fragmentando en bloques y generando embeddings vectoriales en ChromaDB... Por favor espera un momento.
            </div>
          </div>
        </div>
      `;
    }

    if (!docs || docs.length === 0) {
      if (activeIndexingFile) {
        grid.innerHTML = indexingCardHtml;
      } else {
        grid.innerHTML = `
          <div class="empty-state" style="grid-column:1/-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" width="48" height="48">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            <p>No hay documentos indexados</p>
            <span>Sube tus MTR, requerimientos o plantillas para comenzar</span>
          </div>
        `;
      }
      return;
    }

    grid.innerHTML = indexingCardHtml + docs.map(doc => `
      <div class="doc-card">
        <div class="doc-header">
          <div class="doc-icon">${(doc.filename.split('.').pop() || 'DOC').toUpperCase().slice(0,3)}</div>
          <div class="doc-info">
            <div class="doc-name" title="${doc.filename}">${doc.filename}</div>
            <div class="doc-meta">${doc.size_kb} KB • ${categoryLabels[doc.category] || doc.category}</div>
            <div class="doc-chunks">${doc.chunks} fragmentos indexados</div>
          </div>
          <div class="doc-actions" style="display:flex;gap:4px;align-self:flex-start">
            <button class="doc-edit" onclick="openEditDocModal('${doc.id}', '${escapeStr(doc.filename)}', '${doc.category}')" title="Editar" style="background:none;border:none;color:var(--text-secondary);cursor:pointer;padding:4px;border-radius:var(--radius-sm);transition:var(--transition)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4z"/>
              </svg>
            </button>
            <button class="doc-delete" onclick="deleteDocument('${doc.id}', '${escapeStr(doc.filename)}')" title="Eliminar" style="background:none;border:none;color:var(--accent-danger);cursor:pointer;padding:4px;border-radius:var(--radius-sm);transition:var(--transition)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              </svg>
            </button>
          </div>
        </div>
        <div style="font-size:0.65rem;color:var(--text-muted)">
          ${new Date(doc.uploaded_at).toLocaleDateString('es-CO', { day:'2-digit', month:'short', year:'numeric' })}
        </div>
      </div>
    `).join('');

  } catch (e) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><p>Error: ${e.message}</p></div>`;
  }
}

async function deleteDocument(docId, filename) {
  if (!confirm(`¿Eliminar "${filename}" de la base de conocimiento?`)) return;

  try {
    const res = await fetch(`${API_BASE}/api/documents/${docId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail);
    showToast(`"${filename}" eliminado`, 'info');
    loadDocuments();
  } catch (e) {
    showToast('Error al eliminar: ' + e.message, 'error');
  }
}

function openEditDocModal(docId, filename, category) {
  document.getElementById('editDocId').value = docId;
  document.getElementById('editDocName').value = filename;
  document.getElementById('editDocCategory').value = category;
  document.getElementById('editDocModal').classList.remove('hidden');
}

function closeEditDocModal() {
  document.getElementById('editDocModal').classList.add('hidden');
}

async function saveEditDoc() {
  const docId = document.getElementById('editDocId').value;
  const filename = document.getElementById('editDocName').value.trim();
  const category = document.getElementById('editDocCategory').value;

  if (!filename) {
    showToast('El nombre del archivo no puede estar vacío', 'error');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/documents/${docId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, category }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Error al guardar cambios');

    showToast('Documento modificado exitosamente', 'success');
    closeEditDocModal();
    loadDocuments();
  } catch (e) {
    showToast('Error al modificar: ' + e.message, 'error');
  }
}

// ══════════════════════════════════════════════════════════════
// MÓDULO 5 — DASHBOARD
// ══════════════════════════════════════════════════════════════
async function loadDashboard() {
  // Mostrar nombre del proyecto
  const projNameEl = document.getElementById('dashProjectName');
  if (projNameEl) projNameEl.textContent = currentProject || '—';

  const metricsGrid = document.getElementById('metricsGrid');
  const progressSection = document.getElementById('dashProgressSection');
  const typeDiv = document.getElementById('typeDistribution');
  const sevDiv = document.getElementById('severityDistribution');

  // Skeleton loader en KPIs
  if (metricsGrid) metricsGrid.innerHTML = [
    { label: 'Total Casos', color: 'rgba(0,156,166,0.12)', border: 'rgba(0,156,166,0.3)', icon: '📋' },
    { label: 'CUMPLE', color: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)', icon: '✅' },
    { label: 'NO CUMPLE', color: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)', icon: '❌' },
    { label: 'Tasa de Éxito', color: 'rgba(139,92,246,0.12)', border: 'rgba(139,92,246,0.3)', icon: '🎯' },
  ].map(k => `
    <div style="background:${k.color};border:1px solid ${k.border};border-radius:var(--radius-md);padding:1.25rem;display:flex;flex-direction:column;gap:0.5rem;position:relative;overflow:hidden;">
      <div style="font-size:1.4rem;">${k.icon}</div>
      <div style="font-size:2rem;font-weight:800;color:var(--text-primary);line-height:1;">—</div>
      <div style="font-size:0.75rem;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.06em;">${k.label}</div>
    </div>
  `).join('');

  try {
    const res = await fetch(`${API_BASE}/api/execution/metrics?project_name=${encodeURIComponent(currentProject)}`);
    const data = await res.json();

    const total = data.total_cases ?? 0;
    const cumple = data.cumple ?? 0;
    const noCumple = data.no_cumple ?? 0;
    const passRate = data.pass_rate ?? 0;
    const execRate = data.execution_rate ?? 0;
    const pendiente = total - cumple - noCumple;

    // ── KPI Cards Premium ──────────────────────────────────────────
    const kpis = [
      {
        value: total, label: 'Total Casos', sub: 'Generados en el proyecto',
        color: 'rgba(0,156,166,0.12)', border: 'rgba(0,156,166,0.3)',
        textColor: 'var(--accent-primary)',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
        </svg>`
      },
      {
        value: cumple, label: 'CUMPLE', sub: `${total > 0 ? Math.round(cumple/total*100) : 0}% de los casos`,
        color: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)',
        textColor: '#10b981',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="22" height="22">
          <polyline points="20 6 9 17 4 12"/>
        </svg>`
      },
      {
        value: noCumple, label: 'NO CUMPLE', sub: `${total > 0 ? Math.round(noCumple/total*100) : 0}% de los casos`,
        color: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)',
        textColor: '#ef4444',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="22" height="22">
          <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
        </svg>`
      },
      {
        value: `${passRate}%`, label: 'Tasa de Éxito', sub: `Cobertura: ${execRate}% ejecutado`,
        color: 'rgba(139,92,246,0.12)', border: 'rgba(139,92,246,0.3)',
        textColor: '#8b5cf6',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22">
          <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
        </svg>`
      },
    ];

    if (metricsGrid) {
      metricsGrid.innerHTML = kpis.map(k => `
        <div style="background:${k.color};border:1px solid ${k.border};border-radius:var(--radius-md);
          padding:1.25rem 1.4rem;display:flex;flex-direction:column;gap:0.4rem;
          position:relative;overflow:hidden;transition:var(--transition);"
          onmouseenter="this.style.transform='translateY(-2px)'"
          onmouseleave="this.style.transform='translateY(0)'">
          <!-- Icono de fondo decorativo -->
          <div style="position:absolute;right:1rem;top:50%;transform:translateY(-50%);opacity:0.08;color:${k.textColor};">
            <svg viewBox="0 0 24 24" fill="currentColor" width="52" height="52" style="fill:currentColor;">${k.icon}</svg>
          </div>
          <!-- Contenido -->
          <div style="color:${k.textColor};display:flex;align-items:center;gap:0.4rem;">${k.icon}</div>
          <div style="font-size:2.2rem;font-weight:800;color:${k.textColor};line-height:1.1;letter-spacing:-0.02em;">${k.value}</div>
          <div style="font-size:0.8rem;font-weight:700;color:var(--text-primary);text-transform:uppercase;letter-spacing:0.05em;">${k.label}</div>
          <div style="font-size:0.68rem;color:var(--text-muted);">${k.sub}</div>
        </div>
      `).join('');
    }

    // ── Barra de progreso global ──────────────────────────────────
    if (progressSection) {
      progressSection.innerHTML = `
        <div style="background:var(--bg-panel);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:1.25rem 1.5rem;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.875rem;">
            <div>
              <div style="font-weight:700;font-size:0.875rem;color:var(--text-primary);">Progreso de Ejecución Global</div>
              <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.15rem;">${pendiente} pendientes · ${cumple + noCumple} ejecutados de ${total}</div>
            </div>
            <div style="font-size:1.5rem;font-weight:800;background:var(--gradient-main);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">${execRate}%</div>
          </div>
          <div style="height:10px;background:var(--border-subtle);border-radius:5px;overflow:hidden;position:relative;">
            <div style="height:100%;width:0%;background:var(--gradient-main);border-radius:5px;transition:width 1s cubic-bezier(0.4,0,0.2,1);" id="dashExecBar"></div>
          </div>
          <div style="display:flex;gap:1.5rem;margin-top:0.75rem;">
            <div style="display:flex;align-items:center;gap:0.4rem;font-size:0.72rem;color:var(--text-muted);">
              <div style="width:10px;height:10px;border-radius:50%;background:#10b981;"></div>
              <span>CUMPLE: <strong style="color:var(--text-primary);">${cumple}</strong></span>
            </div>
            <div style="display:flex;align-items:center;gap:0.4rem;font-size:0.72rem;color:var(--text-muted);">
              <div style="width:10px;height:10px;border-radius:50%;background:#ef4444;"></div>
              <span>NO CUMPLE: <strong style="color:var(--text-primary);">${noCumple}</strong></span>
            </div>
            <div style="display:flex;align-items:center;gap:0.4rem;font-size:0.72rem;color:var(--text-muted);">
              <div style="width:10px;height:10px;border-radius:50%;background:var(--border-subtle);border:1px solid var(--text-muted);"></div>
              <span>Pendiente: <strong style="color:var(--text-primary);">${pendiente}</strong></span>
            </div>
          </div>
        </div>
      `;
      setTimeout(() => {
        const bar = document.getElementById('dashExecBar');
        if (bar) bar.style.width = `${execRate}%`;
      }, 150);
    }

    // ── Distribución por tipo ─────────────────────────────────────
    const maxType = Math.max(...Object.values(data.by_type || {}), 1);
    const typeColors = {
      'FUNCIONALES': '#009ca6', 'CASOS NEGATIVOS': '#f59e0b',
      'SEGURIDAD': '#ef4444', 'INTEGRACION': '#8b5cf6',
      'NO FUNCIONALES': '#22d3ee', 'CARGA': '#10b981',
      'ESTRESS': '#f97316', 'COMPATIBILIDAD': '#ec4899', 'RESILIENCIA': '#6366f1'
    };
    if (typeDiv) {
      typeDiv.innerHTML = Object.keys(data.by_type || {}).length === 0
        ? '<p style="color:var(--text-muted);font-size:0.8rem;text-align:center;padding:1rem 0;">Sin datos todavía</p>'
        : Object.entries(data.by_type).sort(([,a],[,b]) => b - a).map(([type, count]) => {
          const pct = Math.round(count / maxType * 100);
          const color = typeColors[type] || 'var(--accent-primary)';
          return `
            <div style="margin-bottom:0.75rem;">
              <div style="display:flex;justify-content:space-between;margin-bottom:0.3rem;align-items:center;">
                <span style="font-size:0.78rem;font-weight:600;color:var(--text-primary);">${type}</span>
                <span style="font-size:0.75rem;font-weight:700;color:${color};">${count}</span>
              </div>
              <div style="height:7px;background:var(--border-subtle);border-radius:4px;overflow:hidden;">
                <div style="height:100%;width:${pct}%;background:${color};border-radius:4px;transition:width 0.8s ease;"></div>
              </div>
            </div>
          `;
        }).join('');
    }

    // ── Defectos por severidad ────────────────────────────────────
    const sevColors = {
      'Bloqueante': '#ef4444', 'Crítico': '#f59e0b',
      'Tolerable': '#10b981', 'Interfaz de usuario': '#22d3ee'
    };
    const maxSev = Math.max(...Object.values(data.by_severity || {}), 1);
    if (sevDiv) {
      sevDiv.innerHTML = Object.keys(data.by_severity || {}).length === 0
        ? '<p style="color:var(--text-muted);font-size:0.8rem;text-align:center;padding:1rem 0;">Sin defectos registrados ✓</p>'
        : Object.entries(data.by_severity).sort(([,a],[,b]) => b - a).map(([sev, count]) => {
          const pct = Math.round(count / maxSev * 100);
          const color = sevColors[sev] || 'var(--accent-primary)';
          return `
            <div style="margin-bottom:0.75rem;">
              <div style="display:flex;justify-content:space-between;margin-bottom:0.3rem;align-items:center;">
                <div style="display:flex;align-items:center;gap:0.4rem;">
                  <div style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></div>
                  <span style="font-size:0.78rem;font-weight:600;color:var(--text-primary);">${sev}</span>
                </div>
                <span style="font-size:0.75rem;font-weight:700;color:${color};">${count}</span>
              </div>
              <div style="height:7px;background:var(--border-subtle);border-radius:4px;overflow:hidden;">
                <div style="height:100%;width:${pct}%;background:${color};border-radius:4px;transition:width 0.8s ease;"></div>
              </div>
            </div>
          `;
        }).join('');
    }

  } catch (e) {
    console.warn('Error cargando dashboard:', e.message);
    if (metricsGrid) metricsGrid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:2rem;">Error al cargar métricas: ${e.message}</div>`;
  }
}


// ══════════════════════════════════════════════════════════════
// TOAST NOTIFICATIONS
// ══════════════════════════════════════════════════════════════
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const icons = { success: '✓', error: '✕', info: 'i' };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || 'i'}</span>
    <span>${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'none';
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ══════════════════════════════════════════════════════════════
// CAMBIO DE TEMA (CLARO / OSCURO)
// ══════════════════════════════════════════════════════════════
function toggleTheme(theme) {
  document.body.setAttribute('data-theme', theme);
  localStorage.setItem('prqa-theme', theme);

  const darkBtn = document.getElementById('themeDarkBtn');
  const lightBtn = document.getElementById('themeLightBtn');

  if (!darkBtn || !lightBtn) return;

  if (theme === 'light') {
    darkBtn.classList.remove('active');
    lightBtn.classList.add('active');
  } else {
    lightBtn.classList.remove('active');
    darkBtn.classList.add('active');
  }
}

// ══════════════════════════════════════════════════════════════
// Onboarding — Bienvenida al primer uso
// ══════════════════════════════════════════════════════════════
function showOnboarding() {
  const overlay = document.createElement('div');
  overlay.id = 'onboardingOverlay';
  overlay.style.cssText = `
    position:fixed; inset:0; z-index:9999;
    background: rgba(10,14,26,0.92);
    backdrop-filter: blur(16px);
    display:flex; align-items:center; justify-content:center;
    animation: fadeIn 0.4s ease;
  `;

  overlay.innerHTML = `
    <div style="
      max-width:680px; width:90%; padding:2.5rem;
      background: linear-gradient(135deg, rgba(0,156,166,0.12) 0%, rgba(15,20,32,0.95) 100%);
      border: 1px solid rgba(0,156,166,0.3);
      border-radius: 20px;
      box-shadow: 0 0 60px rgba(0,156,166,0.2);
      font-family: 'Inter', sans-serif;
      color: #f1f5f9;
      text-align: center;
    ">
      <div style="font-size:2.5rem; margin-bottom:0.5rem;">👋</div>
      <h2 style="font-size:1.5rem; font-weight:700; margin:0 0 0.5rem; background: linear-gradient(135deg,#009ca6,#22d3ee); -webkit-background-clip:text; -webkit-text-fill-color:transparent;">Bienvenida a PRQA</h2>
      <p style="color:#94a3b8; margin:0 0 2rem; font-size:0.9rem;">Tu asistente de QA con IA. Sigue estos 3 pasos para empezar:</p>

      <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:1rem; margin-bottom:2rem; text-align:left;">
        <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(0,156,166,0.2); border-radius:12px; padding:1.25rem;">
          <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#009ca6,#22d3ee);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.9rem;margin-bottom:0.75rem;">1</div>
          <div style="font-weight:600; font-size:0.85rem; margin-bottom:0.4rem;">Subir Documentos</div>
          <div style="font-size:0.75rem; color:#94a3b8; line-height:1.5;">Ve a <strong style="color:#22d3ee;">Base de Conocimiento</strong> y sube tu MTR o documento de requerimientos (PDF, DOCX, etc.)</div>
        </div>
        <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(0,156,166,0.2); border-radius:12px; padding:1.25rem;">
          <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#009ca6,#22d3ee);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.9rem;margin-bottom:0.75rem;">2</div>
          <div style="font-weight:600; font-size:0.85rem; margin-bottom:0.4rem;">Generar Casos</div>
          <div style="font-size:0.75rem; color:#94a3b8; line-height:1.5;">Ve a <strong style="color:#22d3ee;">Generar Casos</strong>, selecciona el documento, pega el requerimiento y presiona Generar.</div>
        </div>
        <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(0,156,166,0.2); border-radius:12px; padding:1.25rem;">
          <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#009ca6,#22d3ee);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.9rem;margin-bottom:0.75rem;">3</div>
          <div style="font-weight:600; font-size:0.85rem; margin-bottom:0.4rem;">Ejecutar y Registrar</div>
          <div style="font-size:0.75rem; color:#94a3b8; line-height:1.5;">En <strong style="color:#22d3ee;">Ejecutar Pruebas</strong>, abre cada caso, prueba el sistema y marca CUMPLE o NO CUMPLE.</div>
        </div>
      </div>

      <p style="font-size:0.75rem; color:#475569; margin-bottom:1.5rem;">Usa el <strong style="color:#94a3b8;">Asistente IA</strong> en cualquier momento para hacer preguntas sobre tus documentos o sobre técnicas de prueba.</p>

      <button onclick="closeOnboarding()" style="
        padding: 0.75rem 2.5rem;
        background: linear-gradient(135deg, #009ca6, #22d3ee);
        color: #fff; border: none; border-radius: 10px;
        font-family: 'Inter', sans-serif; font-size: 0.95rem; font-weight: 600;
        cursor: pointer; transition: all 0.2s;
        box-shadow: 0 4px 20px rgba(0,156,166,0.4);
      " onmouseover="this.style.transform='scale(1.04)'" onmouseout="this.style.transform='scale(1)'">
        ¡Comenzar! →
      </button>
    </div>
  `;

  document.body.appendChild(overlay);
}

function closeOnboarding() {
  const overlay = document.getElementById('onboardingOverlay');
  if (overlay) {
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.3s ease';
    setTimeout(() => overlay.remove(), 300);
  }
  localStorage.setItem('prqa-onboarding-done', '1');
  // Navigate to step 1
  switchModule('documents');
}

/* ══════════════════════════════════════════════════════════════
   CIEL AI — Control de Conversación, Formato y Cancelación
   ══════════════════════════════════════════════════════════════ */
let _isAIProcessing = false;
let _activeAbortController = null;
let _transcriptOpen = false;
let _textInputOpen = false;

// Exponer _isAIProcessing al scope global para que voice.js pueda verificarlo
Object.defineProperty(window, '_isAIProcessing', {
  get: () => _isAIProcessing,
  configurable: true,
});

function toggleTranscriptPopup() {
  const popup = document.getElementById('transcriptPopup');
  if (!popup) return;
  _transcriptOpen = !_transcriptOpen;
  popup.classList.toggle('hidden', !_transcriptOpen);
  const btn = document.getElementById('jtbTranscriptToggle');
  if (btn) btn.classList.toggle('active', _transcriptOpen);
  if (_transcriptOpen) {
    const body = document.getElementById('jarvisLogBody');
    if (body) body.scrollTop = body.scrollHeight;
  }
}

function toggleTextInput() {
  const bar = document.getElementById('textInputBar');
  if (!bar) return;
  _textInputOpen = !_textInputOpen;
  bar.classList.toggle('hidden', !_textInputOpen);
  if (_textInputOpen) {
    setTimeout(() => {
      const input = document.getElementById('tibInput');
      if (input) input.focus();
    }, 150);
  }
}

function clearJarvisLog() {
  const body = document.getElementById('jarvisLogBody');
  if (body) {
    body.innerHTML = `<div class="jlp-line jlp-system">
      <span class="jlp-ts">${_jlpTs()}</span>
      <span class="jlp-tag jlp-tag-sys">SYS</span>
      <span class="jlp-text">Historial limpiado · CIEL AI en línea</span>
    </div>`;
  }
}

function _jlpTs() {
  return new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Formateador limpio para que las listas y párrafos no se junten en un bloque
function _formatAIMessage(text) {
  if (!text) return '';
  let str = text.trim();

  // Escapar HTML básico
  let escaped = str.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Convertir **negrita** en <strong> con color sutil (no cyan sobreexpuesto)
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong style="color:var(--text-primary);font-weight:700;">$1</strong>');

  // Dividir en líneas y renderizar separadas
  const lines = escaped.split(/\n+/).map(l => l.trim()).filter(l => l.length > 0);
  const formatted = lines.map(line => {
    if (/^\d+\./.test(line)) {
      // Ítem numerado
      return `<div style="display:flex;gap:8px;margin:5px 0;line-height:1.5;">${line}</div>`;
    }
    if (/^[*\u2022\-]/.test(line)) {
      // Bullet point
      return `<div style="display:flex;gap:8px;margin:4px 0 4px 8px;line-height:1.5;">${line}</div>`;
    }
    return `<p style="margin:0 0 7px 0;line-height:1.55;">${line}</p>`;
  }).join('');

  return formatted;
}

// Texto de la última respuesta de la IA (para releer si se reactiva el audio)
let _lastAIResponse = '';
let _isMuted = false; // Estado de silencio persistente entre respuestas

// Activa/desactiva visualmente el botón DETENER (siempre visible, pero disabled cuando no procesa)
function _setStopBtnActive(active) {
  const btn = document.getElementById('tpStopBtn');
  if (!btn) return;
  if (active) {
    btn.disabled = false;
    btn.style.background = 'rgba(239,68,68,0.25)';
    btn.style.color = '#fca5a5';
    btn.style.border = '1px solid rgba(239,68,68,0.6)';
    btn.style.cursor = 'pointer';
    btn.style.opacity = '1';
    btn.style.boxShadow = '0 0 12px rgba(239,68,68,0.3)';
  } else {
    btn.disabled = true;
    btn.style.background = 'rgba(100,100,120,0.12)';
    btn.style.color = 'rgba(180,180,200,0.3)';
    btn.style.border = '1px solid rgba(180,180,200,0.15)';
    btn.style.cursor = 'not-allowed';
    btn.style.opacity = '0.5';
    btn.style.boxShadow = 'none';
  }
}

// Botón para detener la respuesta en curso y silenciar la voz
function stopAI() {
  if (_activeAbortController) {
    try { _activeAbortController.abort(); } catch(e) {}
    _activeAbortController = null;
  }
  if (window.PRQAVoice && typeof PRQAVoice.stop === 'function') {
    PRQAVoice.stop();
  }
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  if (typeof stopSpeaking === 'function') {
    stopSpeaking();
  }

  _isAIProcessing = false;

  if (window.PRQAVoice) {
    PRQAVoice.setOrbState('idle');
  }

  _setStopBtnActive(false);

  appendJarvisLog('system', '⏹️ Respuesta detenida');
  if (typeof showToast === 'function') showToast('⏹️ CIEL AI detenida', 'info');
}

// Silenciar/Reactivar la voz de CIEL AI (delega en PRQAVoice)
function toggleTTS() {
  if (window.PRQAVoice && typeof PRQAVoice.toggleTTS === 'function') {
    PRQAVoice.toggleTTS();
  }
}

function appendJarvisLog(type, text) {
  const body = document.getElementById('jarvisLogBody');
  if (!body) return;

  const tagMap = {
    user:   { cls: 'jlp-user',   tag: 'USR',     tagCls: 'jlp-tag-user' },
    ai:     { cls: 'jlp-ai',     tag: 'CIEL AI',  tagCls: 'jlp-tag-ai'  },
    system: { cls: 'jlp-system', tag: 'SYS',      tagCls: 'jlp-tag-sys' },
    error:  { cls: 'jlp-error',  tag: 'ERR',      tagCls: 'jlp-tag-err' },
  };

  const m = tagMap[type] || tagMap.system;

  // Para AI y usuario usamos el formateador; para sistema/error texto plano
  const isRich = (type === 'ai' || type === 'user');
  const formatted = isRich
    ? _formatAIMessage(text)
    : `<span style="opacity:0.8;">${text.replace(/</g, '&lt;')}</span>`;

  const line = document.createElement('div');
  line.className = `jlp-line ${m.cls}`;
  // Para mensajes ricos (AI/usuario) usamos layout de columna para que el texto no se solape con el tag
  // Para mensajes cortos (system/error) usamos la fila horizontal del CSS original
  if (isRich) {
    // Layout columna: encabezado en una fila, texto debajo
    line.style.cssText = 'display:block; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.05);';
    line.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;">
        <span class="jlp-ts">${_jlpTs()}</span>
        <span class="jlp-tag ${m.tagCls}">${m.tag}</span>
      </div>
      <div class="jlp-text" style="padding-left:2px;">${formatted}</div>
    `;
  } else {
    // Layout fila: timestamp + tag + texto en una línea (textos cortos)
    line.style.cssText = 'padding:5px 0; border-bottom:1px solid rgba(255,255,255,0.04); display:flex; align-items:baseline; gap:0.5rem;';
    line.innerHTML = `
      <span class="jlp-ts" style="flex-shrink:0;">${_jlpTs()}</span>
      <span class="jlp-tag ${m.tagCls}" style="flex-shrink:0;">${m.tag}</span>
      <span class="jlp-text" style="flex:1;min-width:0;">${formatted}</span>
    `;
  }

  body.appendChild(line);
  body.scrollTop = body.scrollHeight;

  // Abrir popup de transcripción si está cerrado
  if (!_transcriptOpen) {
    toggleTranscriptPopup();
  }
}

// Respuestas inmediatas (< 100ms) para comandos, dudas de navegación y conceptos clave
function _getInstantResponse(query) {
  const q = query.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  // 1. Preguntas de ayuda general / Cómo funciona la app / No entiendo / Por dónde empezar / Guíame
  if (
    q.includes("como funciona") ||
    q.includes("no entiendo") ||
    q.includes("como se usa") ||
    q.includes("por donde empiezo") ||
    q.includes("por donde comienzo") ||
    q.includes("explicame") ||
    q.includes("ayuda") ||
    q.includes("que hago") ||
    q.includes("que es esto") ||
    q.includes("de que trata") ||
    q.includes("que puedes hacer") ||
    q.includes("que sabes hacer") ||
    q.includes("quien eres") ||
    q.includes("instrucciones") ||
    q.includes("guia")
  ) {
    return "¡Con gusto te explico cómo funciona **PRQA**! La plataforma te guía a través de un flujo de 4 pasos para asegurar la calidad de tu software:\n\n" +
      "1️⃣ **Base de Conocimiento (Paso 1):** Sube tus documentos de requerimientos (PDF, Word o Excel como MTR/BRD). El sistema los indexa en ChromaDB para usarlos como contexto.\n" +
      "2️⃣ **Generar Casos (Paso 2):** Elige los tipos de prueba (Funcionales, Negativos, Seguridad, etc.), escribe tu requerimiento y haz clic en **Generar** para obtener tu matriz Excel oficial en formato **EOPA DTR029C**.\n" +
      "3️⃣ **Ejecutar Pruebas (Paso 3):** Revisa cada caso generado y registra si **CUMPLE** o **NO CUMPLE**, asignando la severidad si encuentras algún defecto.\n" +
      "4️⃣ **Tiempos y Dashboard (Paso 4):** Mide la velocidad de ejecución con el cronómetro HUD integrado y monitorea los KPIs del ciclo de calidad en el Dashboard.\n\n" +
      "💡 *¿Sobre cuál de estos pasos te gustaría que te oriente en detalle?*";
  }

  // 2. Saludo simple
  if (/^(hola|buenos dias|buenas tardes|buenas noches|hey|que tal|saludos)[.!? ]*$/.test(q)) {
    return "¡Hola! Soy **CIEL AI**, tu asistente de aseguramiento de calidad de Ciel Ingeniería S.A.S.\n\n¿En qué te puedo colaborar hoy? Puedes consultarme sobre tus requerimientos, pedirme ayuda para generar casos de prueba EOPA o pedirme que te guíe en el uso de la plataforma.";
  }

  // 3. Qué es PRQA
  if (q.includes("que es prqa") || q.includes("para que sirve prqa")) {
    return "**PRQA** es la plataforma local y privada de Calidad de Software para **Ciel Ingeniería S.A.S.** Te permite procesar documentos técnicos, generar matrices de prueba automáticas en formato estándar **EOPA DTR029C**, cronometrar tiempos y registrar ejecuciones con total soberanía y confidencialidad de datos.";
  }

  // 4. Módulo 1: Base de conocimiento
  if (q.includes("base de conocimiento") || q.includes("cargar documento") || q.includes("subir documento") || q.includes("como indexar") || q.includes("subir archivo")) {
    return "En el módulo **Base de Conocimiento** (Paso 1) puedes arrastrar o seleccionar archivos en formato PDF, Word o Excel (MTR, BRD o Plantillas).\nEl sistema fragmenta e indexa el contenido en la base de datos vectorial ChromaDB para alimentar a la IA al generar casos o responder preguntas.";
  }

  // 5. Módulo 2: Generador de casos
  if (q.includes("como genero casos") || q.includes("generar casos") || q.includes("crear casos") || q.includes("matriz de prueba") || q.includes("eopa") || q.includes("dtr029c")) {
    return "Para generar casos de prueba:\n1. Ve a **Generar Casos** (Paso 2).\n2. Selecciona los tipos de prueba deseados (Funcionales, Negativos, Seguridad, Integración, UI/UX o Carga).\n3. Escribe o pega el requerimiento funcional.\n4. Define la cantidad de casos y presiona **Generar Casos de Prueba** para descargar tu matriz Excel DTR029C.";
  }

  // 6. Módulo 3: Ejecución de pruebas
  if (q.includes("ejecutar pruebas") || q.includes("cumple") || q.includes("no cumple") || q.includes("registrar prueba") || q.includes("marcar prueba")) {
    return "En **Ejecutar Pruebas** (Paso 3) puedes ver la lista de casos de prueba del proyecto activo.\nPara cada uno puedes marcar **CUMPLE** o **NO CUMPLE**.\nSi marcas *NO CUMPLE*, puedes clasificar la severidad (Crítica, Alta, Media, Baja) y detallar el incidente para el Dashboard.";
  }

  // 7. Módulo 4: Tiempos / Cronómetro
  if (q.includes("tiempo") || q.includes("cronometro") || q.includes("productividad") || q.includes("temporizador") || q.includes("medir tiempo")) {
    return "En **Tiempos de Ejecución** (Paso 4) cuentas con un cronómetro digital interactivo para medir el tiempo real que tardas en probar cada caso, registrando estadísticas de productividad y promedios por módulo.";
  }

  // 8. Módulo 5: Dashboard
  if (q.includes("dashboard") || q.includes("metricas") || q.includes("indicadores") || q.includes("kpi") || q.includes("reporte")) {
    return "El **Dashboard** resume los indicadores del ciclo QA en tiempo real: Total de Casos, Tasa de Éxito (% de cumplimiento), distribución por tipo de prueba y reporte de defectos por severidad.";
  }

  return null;
}

async function queryCielAI(text) {
  if (!text || !text.trim()) return;
  const query = text.trim();

  // 1. Bloqueo estricto de concurrencia: 1 consulta a la vez
  if (_isAIProcessing) {
    if (typeof showToast === 'function') {
      showToast('⚠️ CIEL AI está ocupada. Presiona DETENER para interrumpir.', 'warning');
    }
    return;
  }

  _isAIProcessing = true;
  _activeAbortController = new AbortController();

  // Activar botón DETENER en la barra
  _setStopBtnActive(true);

  // 2. Registrar consulta del usuario
  appendJarvisLog('user', query);

  function _finishAI() {
    _isAIProcessing = false;
    _activeAbortController = null;
    _setStopBtnActive(false);
    if (window.PRQAVoice) PRQAVoice.setOrbState('idle');
  }

  // 3. Respuesta instantánea para navegación y preguntas comunes
  const instantAnswer = _getInstantResponse(query);
  if (instantAnswer) {
    _lastAIResponse = instantAnswer;
    window._lastAIResponse = instantAnswer;
    appendJarvisLog('ai', instantAnswer);

    if (window.PRQAVoice && PRQAVoice.isTTSEnabled()) {
      PRQAVoice.setOrbState('speaking');
      PRQAVoice.speak(instantAnswer, {
        onEnd: _finishAI
      });
    } else {
      _finishAI();
    }
    return;
  }

  // 4. Consulta profunda con motor local
  if (window.PRQAVoice) PRQAVoice.setOrbState('processing');

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      signal: _activeAbortController.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: query,
        use_knowledge_base: true,
        project_name: typeof currentProject !== 'undefined' ? currentProject : 'Proyectos'
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const errMsg = err.detail || 'No se pudo procesar la solicitud.';
      appendJarvisLog('error', errMsg);
      if (window.PRQAVoice && PRQAVoice.isTTSEnabled()) {
        PRQAVoice.setOrbState('speaking');
        PRQAVoice.speak('Error: ' + errMsg, {
          onEnd: _finishAI
        });
      } else {
        _finishAI();
      }
      return;
    }

    const data = await res.json();
    if (data && data.response) {
      _lastAIResponse = data.response;
      window._lastAIResponse = data.response;
      appendJarvisLog('ai', data.response);

      if (window.PRQAVoice && PRQAVoice.isTTSEnabled()) {
        PRQAVoice.setOrbState('speaking');
        PRQAVoice.speak(data.response, {
          onEnd: _finishAI
        });
      } else {
        _finishAI();
      }
    } else {
      _finishAI();
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      console.log('[CIEL AI] Consulta detenida por el usuario');
      _finishAI();
    } else {
      console.error('[PRQA AI Error]', e);
      appendJarvisLog('error', 'Error de conexión con el motor de IA local.');
      if (window.PRQAVoice && PRQAVoice.isTTSEnabled()) {
        PRQAVoice.setOrbState('speaking');
        PRQAVoice.speak('No pude conectar con el servidor de inteligencia artificial.', {
          onEnd: _finishAI
        });
      } else {
        _finishAI();
      }
    }
  }
}

async function sendTextToAI() {
  const input = document.getElementById('tibInput');
  if (!input || !input.value.trim()) return;
  const text = input.value.trim();
  input.value = '';
  toggleTextInput();
  await queryCielAI(text);
}
