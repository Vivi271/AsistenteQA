/**
 * PRQA — app.js
 * Asistente QA con IA Local — Ciel Ingeniería S.A.S
 * Lógica completa de la interfaz
 */

// ══════════════════════════════════════════════════════════════
// Configuración
// ══════════════════════════════════════════════════════════════
const API_BASE = '';  // nginx hace proxy de /api/ → backend:8000
let currentModule = 'documents';
let selectedResult = null;
let currentExecutionCaseId = null;
let allTestCases = [];
let activeIndexingFile = null;
let _dashAllCases = [];
let _timerInterval = null;
let _timerSeconds = 0;
let _timerSessionId = null;
let _timerRunning = false;
let _isAIProcessing = false;
let _activeAbortController = null;
let _transcriptOpen = false;
let _textInputOpen = false;
let _lastAIResponse = '';
let _isMuted = false;
let _generatorDocsCache = [];
let chatDrawerOpen = false;
let _lastProjectList = [];
let _lastLogEntry = { type: null, text: null, time: 0 };
let _currentInterimLine = null;

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
  } catch (e) { /* sin conexión */ }

  const custom = _getCustomProjects();
  const all = [...new Set(['Proyectos', 'General', ...serverProjects, ...custom])].sort();

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
document.addEventListener('click', function (e) {
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
  // Reset AI processing state on fresh load
  _isAIProcessing = false;
  _activeAbortController = null;
  window._isAIProcessing = false;
  window._lastAIResponse = '';

  // Exponer todas las funciones globales
  window.queryCielAI = queryCielAI;
  window.stopAI = stopAI;
  window.appendJarvisLog = appendJarvisLog;
  window.appendOrUpdateUserInterim = appendOrUpdateUserInterim;
  window.toggleTranscriptDrawer = toggleTranscriptDrawer;
  window.toggleTranscriptPopup = toggleTranscriptPopup;
  window.showToast = showToast;
  window.toggleListening = toggleListening;
  window.toggleTTS = toggleTTS;
  window.toggleTextInput = toggleTextInput;
  window.sendTextToAI = sendTextToAI;

  // Registrar mensaje inicial dinámico en la consola de transcripción
  appendJarvisLog('system', 'CIEL AI online · Sistema inicializado');

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

  // Reloj HUD en tiempo real
  updateHudClock();
  setInterval(updateHudClock, 1000);

  // Ocultar boot screen con transición suave
  setTimeout(() => {
    const bs = document.getElementById('bootScreen');
    if (bs) bs.classList.add('hidden');
  }, 1200);

  // Show onboarding on first visit
  if (!localStorage.getItem('prqa-onboarding-done')) {
    showOnboarding();
  }
});

function updateHudClock() {
  const clock = document.getElementById('hudClock');
  if (!clock) return;
  const now = new Date();
  clock.textContent = now.toLocaleTimeString('es-CO', { hour12: false });
}

// ══════════════════════════════════════════════════════════════
// Health Check
// ══════════════════════════════════════════════════════════════
async function checkHealth() {
  const dot = document.getElementById('statusDot') || document.querySelector('.hud-system-dot');
  const label = document.getElementById('statusLabel') || document.querySelector('.hud-system-badge');
  const model = document.getElementById('statusModel') || document.getElementById('hudModelChip');

  try {
    const res = await fetch(`${API_BASE}/api/health`);
    const data = await res.json();

    if (data.status === 'ok' && data.rag_ready) {
      if (dot) {
        dot.className = 'hud-system-dot online';
        dot.style.background = 'var(--accent-success, #10b981)';
      }
      if (model) model.textContent = data.model || 'llama3.2';
    } else {
      if (dot) {
        dot.className = 'hud-system-dot';
        dot.style.background = '#f59e0b';
      }
      if (model) model.textContent = data.model || 'llama3.2';
    }
  } catch (e) {
    if (dot) {
      dot.className = 'hud-system-dot offline';
      dot.style.background = '#ef4444';
    }
    if (model) model.textContent = 'OFFLINE';
  }
}

// ══════════════════════════════════════════════════════════════
// Control del Panel Lateral (Sidebar Colapsable & Resizable)
// ══════════════════════════════════════════════════════════════
function toggleSidebar() {
  const layout = document.getElementById('appLayout');
  const btn = document.getElementById('sidebarCollapseBtn');
  if (!layout) return;
  const isCollapsed = layout.classList.toggle('sidebar-collapsed');
  if (btn) {
    btn.classList.toggle('collapsed', isCollapsed);
    btn.title = isCollapsed ? 'Mostrar panel lateral' : 'Ocultar panel lateral';
    if (!isCollapsed) {
      const currentW = getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width') || '260px';
      btn.style.left = currentW.trim();
    } else {
      btn.style.left = '0px';
    }
  }
}

function initSidebarResizer() {
  const resizer = document.getElementById('sidebarResizer');
  const sidebar = document.getElementById('sidebar');
  const layout = document.getElementById('appLayout');
  const btn = document.getElementById('sidebarCollapseBtn');
  if (!resizer || !sidebar || !layout) return;

  let isResizing = false;

  resizer.addEventListener('mousedown', (e) => {
    if (layout.classList.contains('sidebar-collapsed')) return;
    isResizing = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const newWidth = Math.max(180, Math.min(e.clientX, 500));
    document.documentElement.style.setProperty('--sidebar-width', `${newWidth}px`);
    sidebar.style.width = `${newWidth}px`;
    sidebar.style.minWidth = `${newWidth}px`;
    sidebar.style.maxWidth = `${newWidth}px`;
    if (btn && !layout.classList.contains('sidebar-collapsed')) {
      btn.style.left = `${newWidth}px`;
    }
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
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
  if (name === 'timer') loadTimerModule();
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
// ══════════════════════════════════════════════════════════════
// MÓDULO 2 — GENERADOR (MULTI-SELECCIÓN DE DOCUMENTOS DE REFERENCIA)
// ══════════════════════════════════════════════════════════════
let generatorAvailableDocs = [];
let generatorSelectedDocIds = [];

async function loadDocumentsForGenerator() {
  const listEl = document.getElementById('docCheckboxList');
  if (!listEl) return;

  try {
    const res = await fetch(`${API_BASE}/api/documents?project=${encodeURIComponent(currentProject)}`);
    generatorAvailableDocs = (await res.json()) || [];

    // Filtrar IDs seleccionados que ya no existan en el proyecto
    generatorSelectedDocIds = generatorSelectedDocIds.filter(id => generatorAvailableDocs.some(d => d.id === id));

    renderDocMultiSelectOptions();
    renderDocSelectedChips();
  } catch (e) {
    console.error('Error cargando documentos para el generador:', e);
  }
}

function toggleDocMultiSelectDropdown(e) {
  if (e) e.stopPropagation();
  const dropdown = document.getElementById('docMultiSelectDropdown');
  if (dropdown) dropdown.classList.toggle('hidden');
}

// Cerrar dropdown al hacer click fuera
document.addEventListener('click', (e) => {
  const wrap = document.getElementById('docMultiSelectWrap');
  const dropdown = document.getElementById('docMultiSelectDropdown');
  if (dropdown && !dropdown.classList.contains('hidden') && wrap && !wrap.contains(e.target)) {
    dropdown.classList.add('hidden');
  }
});

function renderDocMultiSelectOptions() {
  const listEl = document.getElementById('docCheckboxList');
  if (!listEl) return;

  if (generatorAvailableDocs.length === 0) {
    listEl.innerHTML = '<div style="font-size:0.72rem;color:var(--text-muted);padding:0.4rem;">No hay documentos indexados en la Base de Conocimiento de este proyecto.</div>';
    updateDocMultiSelectLabel();
    return;
  }

  const categoryIcons = { mtr: '📋', requirements: '📄', templates: '📁' };

  listEl.innerHTML = generatorAvailableDocs.map(doc => {
    const isChecked = generatorSelectedDocIds.includes(doc.id);
    const icon = categoryIcons[doc.category] || '📄';
    return `
      <label class="doc-checkbox-item">
        <input type="checkbox" value="${doc.id}" ${isChecked ? 'checked' : ''} onchange="toggleSingleDocSelection('${doc.id}', this.checked)" />
        <span style="font-size:0.85rem;">${icon}</span>
        <span style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">${doc.filename}</span>
        <span style="font-size:0.65rem;color:var(--text-muted);">(${doc.chunks || 0} frags)</span>
      </label>
    `;
  }).join('');

  const selectAllCb = document.getElementById('selectAllDocsCheckbox');
  if (selectAllCb) {
    selectAllCb.checked = generatorAvailableDocs.length > 0 && generatorSelectedDocIds.length === generatorAvailableDocs.length;
  }

  updateDocMultiSelectLabel();
}

function updateDocMultiSelectLabel() {
  const labelEl = document.getElementById('docMultiSelectLabel');
  if (!labelEl) return;
  if (generatorSelectedDocIds.length === 0) {
    labelEl.textContent = '-- Seleccionar documentos indexados (0 seleccionados) --';
  } else {
    labelEl.textContent = `✅ ${generatorSelectedDocIds.length} documento(s) seleccionado(s) como contexto`;
  }
}

async function toggleSingleDocSelection(docId, isChecked) {
  if (isChecked) {
    if (!generatorSelectedDocIds.includes(docId)) generatorSelectedDocIds.push(docId);
  } else {
    generatorSelectedDocIds = generatorSelectedDocIds.filter(id => id !== docId);
  }

  const selectAllCb = document.getElementById('selectAllDocsCheckbox');
  if (selectAllCb) {
    selectAllCb.checked = generatorAvailableDocs.length > 0 && generatorSelectedDocIds.length === generatorAvailableDocs.length;
  }

  updateDocMultiSelectLabel();
  renderDocSelectedChips();
  await syncSelectedDocsToTextarea();
}

async function toggleSelectAllDocs(isChecked) {
  if (isChecked) {
    generatorSelectedDocIds = generatorAvailableDocs.map(d => d.id);
  } else {
    generatorSelectedDocIds = [];
  }

  renderDocMultiSelectOptions();
  renderDocSelectedChips();
  await syncSelectedDocsToTextarea();
}

function removeSelectedDocChip(docId) {
  toggleSingleDocSelection(docId, false);
  renderDocMultiSelectOptions();
}

function renderDocSelectedChips() {
  const container = document.getElementById('docSelectedChips');
  if (!container) return;

  if (generatorSelectedDocIds.length === 0) {
    container.innerHTML = '';
    return;
  }

  const categoryIcons = { mtr: '📋', requirements: '📄', templates: '📁' };

  container.innerHTML = generatorSelectedDocIds.map(id => {
    const doc = generatorAvailableDocs.find(d => d.id === id);
    if (!doc) return '';
    const icon = categoryIcons[doc.category] || '📄';
    return `
      <div class="doc-chip" title="${doc.filename}">
        <span>${icon} ${doc.filename}</span>
        <span class="doc-chip-remove" onclick="removeSelectedDocChip('${doc.id}')" title="Quitar">&times;</span>
      </div>
    `;
  }).join('');
}

async function syncSelectedDocsToTextarea() {
  const textarea = document.getElementById('promptInput') || document.getElementById('requirementText');
  if (!textarea) return;

  if (generatorSelectedDocIds.length === 0) {
    textarea.value = '';
    textarea.placeholder = "Describe la funcionalidad a probar, flujos alternos o pega criterios de aceptación...";
    return;
  }

  textarea.placeholder = "Cargando contenido de los documentos seleccionados...";
  
  try {
    const contents = await Promise.all(generatorSelectedDocIds.map(async id => {
      const doc = generatorAvailableDocs.find(d => d.id === id);
      try {
        const res = await fetch(`${API_BASE}/api/documents/${id}/content`);
        if (!res.ok) return null;
        const data = await res.json();
        return {
          filename: doc ? doc.filename : 'Documento',
          category: doc ? doc.category : '',
          content: data.content || ''
        };
      } catch (err) {
        return null;
      }
    }));

    const validContents = contents.filter(c => c && c.content && c.content.trim());
    if (validContents.length > 0) {
      textarea.value = validContents.map(c => `=== DOCUMENTO DE REFERENCIA: ${c.filename} (${(c.category || 'Requerimientos').toUpperCase()}) ===\n${c.content.trim()}`).join('\n\n');
    } else {
      textarea.value = '';
    }
  } catch (e) {
    console.error('Error sincronizando texto de documentos:', e);
  } finally {
    textarea.placeholder = "Describe la funcionalidad a probar, flujos alternos o pega criterios de aceptación...";
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

document.addEventListener('click', function (e) {
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

  const reqInput = document.getElementById('promptInput') || document.getElementById('requirementText');
  const requirementText = reqInput ? reqInput.value.trim() : '';
  if (!requirementText) {
    showToast('Por favor ingresa el requerimiento o selecciona documentos de referencia.', 'error');
    return;
  }

  const testTypes = Array.from(
    document.querySelectorAll('#testTypesContainer input:checked, #testTypesDropdown input:checked')
  ).map(cb => cb.value);

  if (testTypes.length === 0) {
    showToast('Selecciona al menos un tipo de prueba.', 'error');
    return;
  }

  const numCasesEl = document.getElementById('numCases');
  const numCases = numCasesEl ? parseInt(numCasesEl.value, 10) : 5;

  btn.disabled = true;
  loading.classList.remove('hidden');

  try {
    const response = await fetch(`${API_BASE}/api/test-cases/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requirement_text: requirementText,
        project_name: document.getElementById('projectName').value || currentProject || 'Proyecto',
        module: document.getElementById('moduleName').value || 'General',
        test_types: testTypes,
        num_cases: numCases,
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
    a.download = `CasosPrueba_${project || 'PRQA'}_${new Date().toISOString().slice(0, 10)}.xlsx`;
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
// Estado del módulo de ejecución
let _execCurrentGroup = null; // { module, created_at, cases, sessionKey }

async function loadTestCasesForExecution() {
  const matrixGrid = document.getElementById('execMatrixGrid');
  if (!matrixGrid) return;

  // Asegurar que la vista de lista es visible
  showExecMatrixListView();

  let url = `${API_BASE}/api/test-cases?project_name=${encodeURIComponent(currentProject)}`;

  try {
    const res = await fetch(url);
    const cases = await res.json();

    // Actualizar KPIs globales
    updateExecGlobalKpis(cases || []);

    if (!cases || cases.length === 0) {
      matrixGrid.innerHTML = `
        <div class="empty-state" style="padding:3rem 2rem;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" width="48" height="48" style="opacity:0.4">
            <polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
          </svg>
          <p style="margin-top:0.75rem;font-weight:700;color:var(--text-secondary);">No hay casos de prueba disponibles</p>
          <span style="font-size:0.82rem;color:var(--text-muted);max-width:320px;text-align:center;display:block;">
            Los casos de prueba se generan desde <strong>Generar Casos</strong>. Una vez generados aparecerán aquí automáticamente.
          </span>
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

    matrixGrid.innerHTML = renderExecMatrixCards(cases);

  } catch (e) {
    if (matrixGrid) matrixGrid.innerHTML = `<div class="empty-state"><p>Error al cargar matrices: ${e.message}</p></div>`;
  }
}

function updateExecGlobalKpis(cases) {
  const total = cases.length;
  const cumple = cases.filter(c => c.result === 'CUMPLE').length;
  const noCumple = cases.filter(c => c.result === 'NO CUMPLE').length;
  const pct = total > 0 ? Math.round((cumple / total) * 100) : 0;

  const t = document.getElementById('execGlobalKpiTotal');
  const p = document.getElementById('execGlobalKpiPass');
  const f = document.getElementById('execGlobalKpiFail');
  const r = document.getElementById('execGlobalKpiRate');

  if (t) t.innerHTML = `${total} <em>Total Casos</em>`;
  if (p) p.innerHTML = `${cumple} <em>Cumple</em>`;
  if (f) f.innerHTML = `${noCumple} <em>No Cumple</em>`;
  if (r) r.innerHTML = `${pct}% <em>Avance</em>`;
}

// ── Agrupar y renderizar tarjetas de matrices ──
function renderExecMatrixCards(cases) {
  const groups = {};
  cases.forEach(tc => {
    const sessionKey = `${tc.module}|||${(tc.created_at || '').slice(0, 16)}`;
    if (!groups[sessionKey]) groups[sessionKey] = { module: tc.module, created_at: tc.created_at, cases: [], sessionKey };
    groups[sessionKey].cases.push(tc);
  });

  const sorted = Object.values(groups).sort((a, b) =>
    (b.created_at || '').localeCompare(a.created_at || '')
  );

  return sorted.map((group) => {
    const total = group.cases.length;
    const cumple = group.cases.filter(c => c.result === 'CUMPLE').length;
    const noCumple = group.cases.filter(c => c.result === 'NO CUMPLE').length;
    const pendientes = group.cases.filter(c => c.status === 'Pendiente' || !c.result).length;
    const pct = total > 0 ? Math.round((cumple / total) * 100) : 0;

    let cleanDate = group.created_at || '';
    try {
      const iso = (typeof cleanDate === 'string' && !cleanDate.endsWith('Z') && !cleanDate.includes('+')) ? cleanDate + 'Z' : cleanDate;
      const d = new Date(iso);
      cleanDate = d.toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
    } catch (_) {}

    const encodedKey = encodeURIComponent(group.sessionKey);

    return `
      <div class="exec-matrix-card" onclick="openExecMatrixDetail('${encodedKey}')">
        <!-- Icono Excel -->
        <div class="exec-matrix-card-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="22" height="22">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
            <line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/>
          </svg>
        </div>

        <!-- Info principal -->
        <div class="exec-matrix-card-body">
          <div class="exec-matrix-card-title">📋 ${group.module}</div>
          <div class="exec-matrix-card-meta">📅 ${cleanDate}</div>

          <!-- Barra de progreso -->
          <div class="exec-matrix-progress-wrap">
            <div class="exec-matrix-progress-bar">
              <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#009ca6,#00e5ff);border-radius:9999px;transition:width 0.4s ease;"></div>
            </div>
            <span class="exec-matrix-pct">${pct}%</span>
          </div>

          <!-- Badges de estado -->
          <div class="exec-matrix-badges">
            <span class="exec-matrix-badge total">${total} casos</span>
            ${pendientes > 0 ? `<span class="exec-matrix-badge pending">⏳ ${pendientes} pend.</span>` : ''}
            ${cumple > 0 ? `<span class="exec-matrix-badge cumple">✓ ${cumple}</span>` : ''}
            ${noCumple > 0 ? `<span class="exec-matrix-badge fail">✗ ${noCumple}</span>` : ''}
          </div>
        </div>

        <!-- Flecha indicadora -->
        <div class="exec-matrix-card-arrow">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </div>
      </div>
    `;
  }).join('');
}

// ── Abrir detalle de una matriz específica ──
let _execAllCasesCache = [];

async function openExecMatrixDetail(encodedKey) {
  const sessionKey = decodeURIComponent(encodedKey);

  // Cargar todos los casos si no están en cache
  if (_execAllCasesCache.length === 0) {
    try {
      const res = await fetch(`${API_BASE}/api/test-cases?project_name=${encodeURIComponent(currentProject)}`);
      _execAllCasesCache = (await res.json()) || [];
    } catch (e) {
      showToast('Error cargando casos de la matriz', 'error');
      return;
    }
  }

  // Filtrar casos del grupo
  const [module, datePrefix] = sessionKey.split('|||');
  const groupCases = _execAllCasesCache.filter(tc =>
    tc.module === module && (tc.created_at || '').slice(0, 16) === datePrefix
  );

  _execCurrentGroup = { module, created_at: datePrefix, cases: groupCases, sessionKey };

  // Actualizar título y meta
  const titleEl = document.getElementById('execDetailTitle');
  const metaEl = document.getElementById('execDetailMeta');
  if (titleEl) titleEl.textContent = `📋 ${module}`;
  if (metaEl) {
    let cleanDate = datePrefix;
    try {
      const iso = (typeof datePrefix === 'string' && !datePrefix.endsWith('Z') && !datePrefix.includes('+')) ? datePrefix + 'Z' : datePrefix;
      cleanDate = new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
    } catch (_) {}
    metaEl.textContent = `📅 ${cleanDate} · ${groupCases.length} casos`;
  }

  // Botón de descargar resultados
  const exportBtn = document.getElementById('execDetailExportBtn');
  if (exportBtn) {
    exportBtn.onclick = () => exportGroupResults(module, datePrefix);
  }

  // Renderizar casos
  renderExecDetailCases(groupCases);
  updateExecDetailKpis(groupCases);

  // Mostrar la vista de detalle
  showExecDetailView();
}

function renderExecDetailCases(cases) {
  const container = document.getElementById('execDetailCasesList');
  if (!container) return;

  if (!cases || cases.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No hay casos en esta matriz.</p></div>';
    return;
  }

  const rows = cases.map(tc => {
    const isPending = !tc.result || tc.status === 'Pendiente';
    const isCumple = tc.result === 'CUMPLE';
    const badgeCls = isPending ? 'status-pending' : isCumple ? 'status-cumple' : 'status-nocumple';
    const badgeLbl = isPending ? 'Pendiente' : tc.result;
    return `
      <tr class="exec-table-row" id="exec-row-${tc.db_id}">
        <td class="exec-td exec-td-id"><span class="exec-case-id">${tc.case_id}</span></td>
        <td class="exec-td exec-td-title"><div class="exec-title-cell">${tc.title}</div></td>
        <td class="exec-td"><span class="tc-tag tag-type">${tc.test_type}</span></td>
        <td class="exec-td exec-td-status"><span class="exec-status ${badgeCls}">${badgeLbl}</span></td>
        <td class="exec-td exec-td-actions">
          <button class="exec-btn-sm exec-btn-cumple" onclick="openExecutionModal('${tc.db_id}', '${tc.case_id}', '${escapeStr(tc.title)}')">&#10003; CUMPLE</button>
          <button class="exec-btn-sm exec-btn-nocumple" onclick="openExecutionModal('${tc.db_id}', '${tc.case_id}', '${escapeStr(tc.title)}')">&#10007; NO CUMPLE</button>
        </td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <table class="exec-table">
      <thead>
        <tr>
          <th class="exec-th">ID</th>
          <th class="exec-th">Nombre del Caso</th>
          <th class="exec-th">Tipo</th>
          <th class="exec-th">Estado</th>
          <th class="exec-th">Registrar Resultado</th>
        </tr>
      </thead>
      <tbody id="execDetailTableBody">${rows}</tbody>
    </table>
  `;
}

function updateExecDetailKpis(cases) {
  const total = cases.length;
  const cumple = cases.filter(c => c.result === 'CUMPLE').length;
  const noCumple = cases.filter(c => c.result === 'NO CUMPLE').length;
  const pending = cases.filter(c => !c.result || c.status === 'Pendiente').length;
  const pct = total > 0 ? Math.round((cumple / total) * 100) : 0;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('execDKpiTotal', total);
  set('execDKpiCumple', cumple);
  set('execDKpiFail', noCumple);
  set('execDKpiPending', pending);
  set('execDKpiPct', `${pct}%`);
  const bar = document.getElementById('execDetailProgressBar');
  if (bar) bar.style.width = `${pct}%`;
}

function filterExecDetailCases() {
  if (!_execCurrentGroup) return;
  const search = (document.getElementById('execDetailSearch')?.value || '').toLowerCase().trim();
  const status = document.getElementById('execDetailStatusFilter')?.value || '';
  const rows = document.querySelectorAll('#execDetailTableBody tr');

  rows.forEach(r => {
    const text = r.textContent.toLowerCase();
    const matchesSearch = !search || text.includes(search);
    const matchesStatus = !status || text.includes(status.toLowerCase());
    r.style.display = (matchesSearch && matchesStatus) ? '' : 'none';
  });
}

function refreshExecDetail() {
  if (!_execCurrentGroup) return;
  _execAllCasesCache = [];
  openExecMatrixDetail(encodeURIComponent(_execCurrentGroup.sessionKey));
}

function showExecMatrixListView() {
  const list = document.getElementById('execMatrixListView');
  const detail = document.getElementById('execDetailView');
  if (list) list.classList.remove('hidden');
  if (detail) detail.classList.add('hidden');
}

function showExecDetailView() {
  const list = document.getElementById('execMatrixListView');
  const detail = document.getElementById('execDetailView');
  if (list) list.classList.add('hidden');
  if (detail) detail.classList.remove('hidden');
}

function backToExecMatrices() {
  _execCurrentGroup = null;
  _execAllCasesCache = [];
  showExecMatrixListView();
  loadTestCasesForExecution();
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
  } catch (e) { /* continuar aunque falle la sincronización */ }
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
  } catch (e) {
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
      a.download = `Resultados_${module}_${new Date().toLocaleDateString('es-CO').replace(/\//g, '-')}.xlsx`;
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

  const headerEl = document.getElementById('modalTestCaseHeader');
  const badgeEl = document.getElementById('modalCaseId');
  const descEl = document.getElementById('modalTestCaseTitle');

  if (dbId) {
    if (headerEl) headerEl.textContent = 'Registrar Resultado de Prueba';
    if (badgeEl) badgeEl.textContent = caseId || 'CASO DE PRUEBA';
    if (descEl) descEl.textContent = title || 'Sin descripción detallada';
  } else {
    if (headerEl) headerEl.textContent = 'Resultado del Cronómetro';
    if (badgeEl) badgeEl.textContent = caseId || '⏱ 00:00.0';
    if (descEl) descEl.textContent = title || 'Caso de prueba cronometrado';
  }

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

  // Si se cancela el modal y había un cronómetro activo pausado, reanudarlo
  if (_timerSessionId) {
    _timerRunning = true;
    const indicator = document.getElementById('timerStateIndicator');
    const stateText = document.getElementById('timerStateText');
    if (indicator) indicator.classList.add('running');
    if (stateText) stateText.textContent = 'CORRIENDO';

    clearInterval(_timerInterval);
    _timerInterval = setInterval(() => {
      _timerSeconds++;
      const mins = String(Math.floor(_timerSeconds / 60)).padStart(2, '0');
      const secs = String(_timerSeconds % 60).padStart(2, '0');
      const display = document.getElementById('timerDisplay');
      if (display) display.textContent = `${mins}:${secs}.0`;
    }, 1000);

    fetch(`${API_BASE}/api/timer/resume?session_id=${encodeURIComponent(_timerSessionId)}`, { method: 'POST' }).catch(() => {});
  }
}

function selectResult(result) {
  selectedResult = result;
  document.getElementById('btnCumple').classList.toggle('selected', result === 'CUMPLE');
  document.getElementById('btnNoCumple').classList.toggle('selected', result === 'NO CUMPLE');
  document.getElementById('noCumpleFields').style.display = result === 'NO CUMPLE' ? 'block' : 'none';
  document.getElementById('saveExecutionBtn').disabled = false;
}

async function saveExecution() {
  if (!selectedResult) return;

  const saveBtn = document.getElementById('saveExecutionBtn');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Guardando...';
  }

  const notes = document.getElementById('execNotes')?.value.trim() || null;
  const severity = document.getElementById('execSeverity')?.value || 'Media';
  const incidentType = document.getElementById('execIncidentType')?.value || 'Funcional';
  const incidentState = document.getElementById('execIncidentState')?.value || 'Abierto';

  // Si proviene del cronómetro activo
  if (_timerSessionId) {
    try {
      const res = await fetch(`${API_BASE}/api/timer/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: _timerSessionId,
          result: selectedResult,
          notes: notes || 'Registrado desde el cronómetro',
          severity: selectedResult === 'NO CUMPLE' ? severity : null,
          incident_type: selectedResult === 'NO CUMPLE' ? incidentType : null,
          incident_state: selectedResult === 'NO CUMPLE' ? incidentState : null,
        })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Error al registrar fin del cronómetro');
      }

      clearInterval(_timerInterval);
      _timerRunning = false;
      _timerSessionId = null;

      const startBtn = document.getElementById('btnTimerStart');
      const stopBtn = document.getElementById('btnTimerStop');
      const indicator = document.getElementById('timerStateIndicator');
      const stateText = document.getElementById('timerStateText');
      const display = document.getElementById('timerDisplay');

      if (startBtn) startBtn.disabled = false;
      if (stopBtn) stopBtn.disabled = true;
      if (indicator) indicator.classList.remove('running');
      if (stateText) stateText.textContent = 'LISTO';
      if (display) display.textContent = '00:00.0';

      showToast(`✓ Tiempo registrado: ${selectedResult}`, 'success');
      closeExecutionModal();
      await loadTimerStats();
      loadDashboard();
      if (_execCurrentGroup) refreshExecDetail();
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Guardar Resultado';
      }
    }
    return;
  }

  // Registro de ejecución normal desde la tabla
  if (!currentExecutionCaseId) return;

  const payload = {
    test_case_id: currentExecutionCaseId,
    result: selectedResult,
    notes: notes,
    tester_name: null,
  };

  if (selectedResult === 'NO CUMPLE') {
    payload.severity = severity;
    payload.incident_type = incidentType;
    payload.incident_state = incidentState;
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
    if (_execCurrentGroup) {
      refreshExecDetail();
    } else {
      loadTestCasesForExecution();
    }
    loadDashboard();

  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Guardar Resultado';
    }
  }
}

// Cerrar modal al hacer clic fuera
const _execModal = document.getElementById('executionModal');
if (_execModal) {
  _execModal.addEventListener('click', function (e) {
    if (e.target === this) closeExecutionModal();
  });
}

// ══════════════════════════════════════════════════════════════
// MÓDULO 4 — BASE DE CONOCIMIENTO
// ══════════════════════════════════════════════════════════════
function setDocCategory(categoryVal) {
  const pills = document.querySelectorAll('.kb-cat-pill');
  pills.forEach(p => p.classList.remove('active'));
  const targetRadio = document.querySelector(`input[name="category"][value="${categoryVal}"]`);
  if (targetRadio) {
    targetRadio.checked = true;
    targetRadio.closest('.kb-cat-pill')?.classList.add('active');
  }
}

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

    const categoryLabels = { mtr: 'MTR', requirements: 'Requerimientos', templates: 'Plantillas' };
    const catBadgeClass = { mtr: 'doc-badge-mtr', requirements: 'doc-badge-req', templates: 'doc-badge-templates' };

    let indexingRowHtml = '';
    if (activeIndexingFile) {
      indexingRowHtml = `
        <tr id="activeIndexingRow" style="background: rgba(0, 156, 166, 0.08); border-left: 3px solid var(--accent-primary);">
          <td colspan="7" style="padding: 1rem 1.25rem;">
            <div style="display: flex; align-items: center; gap: 1rem;">
              <div style="
                width: 28px; height: 28px;
                border: 3px solid rgba(0, 156, 166, 0.2);
                border-top-color: var(--accent-primary);
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
                flex-shrink: 0;
              "></div>
              <div style="flex: 1;">
                <div style="font-weight: 700; font-size: 0.85rem; color: var(--text-primary);">
                  ⚡ Indexando en la IA: <strong style="color: var(--accent-primary);">${activeIndexingFile}</strong>
                </div>
                <div style="font-size: 0.72rem; color: var(--text-secondary); margin-top: 0.2rem;">
                  Extrayendo texto, fragmentando y generando embeddings vectoriales en ChromaDB...
                </div>
              </div>
            </div>
          </td>
        </tr>
      `;
    }

    const projTitle = document.getElementById('kbActiveProjectTitle');
    if (projTitle) projTitle.textContent = currentProject || 'Proyectos';

    const docsCountEl = document.getElementById('kbStatDocsCount');
    const chunksCountEl = document.getElementById('kbStatChunksCount');
    if (docsCountEl) docsCountEl.textContent = (docs && docs.length) ? docs.length : 0;
    if (chunksCountEl) {
      const totalChunks = (docs || []).reduce((acc, d) => acc + (parseInt(d.chunks, 10) || 0), 0);
      chunksCountEl.textContent = totalChunks;
    }

    if (!docs || docs.length === 0) {
      if (activeIndexingFile) {
        grid.innerHTML = indexingRowHtml;
      } else {
        grid.innerHTML = `
          <tr>
            <td colspan="7">
              <div class="kb-empty-state">
                <div class="kb-empty-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="28" height="28">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                  </svg>
                </div>
                <p class="kb-empty-title">No hay documentos indexados</p>
                <span class="kb-empty-sub">Sube tus archivos MTR, requerimientos o plantillas para comenzar</span>
              </div>
            </td>
          </tr>
        `;
      }
      return;
    }

    grid.innerHTML = indexingRowHtml + docs.map(doc => {
      const ext = (doc.filename.split('.').pop() || 'DOC').toUpperCase();
      let fileTypeStyle = 'background:rgba(0,156,166,0.12);color:var(--accent-primary);';
      if (ext === 'PDF') {
        fileTypeStyle = 'background:rgba(239,68,68,0.15);color:#ef4444;border:1px solid rgba(239,68,68,0.25);';
      } else if (ext === 'DOC' || ext === 'DOCX') {
        fileTypeStyle = 'background:rgba(37,99,235,0.15);color:#2563eb;border:1px solid rgba(37,99,235,0.25);';
      } else if (ext === 'XLS' || ext === 'XLSX') {
        fileTypeStyle = 'background:rgba(16,185,129,0.15);color:#10b981;border:1px solid rgba(16,185,129,0.25);';
      }

      const catClass = catBadgeClass[doc.category] || 'doc-badge-req';
      const catLabel = categoryLabels[doc.category] || doc.category;
      const uploadDate = doc.uploaded_at
        ? new Date(doc.uploaded_at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
        : 'Reciente';

      return `
        <tr data-category="${doc.category || ''}">
          <td style="width:40px;">
            <span class="kb-file-type" style="${fileTypeStyle}">${ext.slice(0, 4)}</span>
          </td>
          <td>
            <span class="doc-filename" title="${doc.filename}">${doc.filename}</span>
          </td>
          <td>
            <span class="doc-badge ${catClass}">${catLabel}</span>
          </td>
          <td style="color:var(--text-muted);font-size:0.75rem;">
            ${doc.size_kb || 0} KB
          </td>
          <td>
            <span class="doc-chunks-pill">+ ${doc.chunks || 0}</span>
          </td>
          <td style="color:var(--text-muted);font-size:0.72rem;white-space:nowrap;">
            ${uploadDate}
          </td>
          <td style="width:70px;">
            <div class="doc-actions">
              <button class="doc-action-btn" onclick="openEditDocModal('${doc.id}', '${escapeStr(doc.filename)}', '${doc.category}')" title="Editar categoría">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4z"/>
                </svg>
              </button>
              <button class="doc-action-btn delete-btn" onclick="deleteDocument('${doc.id}', '${escapeStr(doc.filename)}')" title="Eliminar de la base de conocimiento">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                </svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

  } catch (e) {
    grid.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--accent-danger);">Error al cargar documentos: ${e.message}</td></tr>`;
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
// MÓDULO 5 — DASHBOARD PRO ANALYTICS
// ══════════════════════════════════════════════════════════════
async function loadDashboard() {
  const projNameEl = document.getElementById('dashProjectName');
  if (projNameEl) projNameEl.textContent = currentProject || 'Proyectos';

  const metricsGrid = document.getElementById('metricsGrid');
  const typeDiv = document.getElementById('typeDistribution');
  const sevDiv = document.getElementById('severityDistribution');
  const chartContainer = document.getElementById('dashMainChartContainer');

  // 1. Skeleton loader en KPIs (5 tarjetas)
  if (metricsGrid) {
    metricsGrid.innerHTML = [
      { label: 'Total Casos', color: 'rgba(0,156,166,0.12)', border: 'rgba(0,156,166,0.3)', icon: '📋' },
      { label: 'CUMPLE', color: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)', icon: '✅' },
      { label: 'NO CUMPLE', color: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)', icon: '❌' },
      { label: 'PENDIENTES', color: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)', icon: '⏳' },
      { label: 'Tasa de Éxito', color: 'rgba(139,92,246,0.12)', border: 'rgba(139,92,246,0.3)', icon: '🎯' },
    ].map(k => `
      <div style="background:${k.color};border:1px solid ${k.border};border-radius:var(--radius-md);padding:1.1rem;display:flex;flex-direction:column;gap:0.4rem;">
        <div style="font-size:1.2rem;">${k.icon}</div>
        <div style="font-size:1.8rem;font-weight:800;color:var(--text-primary);line-height:1;">—</div>
        <div style="font-size:0.7rem;color:var(--text-muted);font-weight:600;text-transform:uppercase;">${k.label}</div>
      </div>
    `).join('');
  }

  try {
    // 2. Cargar métricas y casos del proyecto
    const [metricsRes, casesRes, docsRes] = await Promise.all([
      fetch(`${API_BASE}/api/execution/metrics?project_name=${encodeURIComponent(currentProject)}`).then(r => r.json()).catch(() => ({})),
      fetch(`${API_BASE}/api/test-cases?project_name=${encodeURIComponent(currentProject)}`).then(r => r.json()).catch(() => []),
      fetch(`${API_BASE}/api/documents?project=${encodeURIComponent(currentProject)}`).then(r => r.json()).catch(() => [])
    ]);

    _dashAllCases = Array.isArray(casesRes) ? casesRes : [];

    // Poblar selector de documentos en filtros del dashboard
    const docSelect = document.getElementById('dashFilterDoc');
    if (docSelect && Array.isArray(docsRes)) {
      const currentVal = docSelect.value;
      docSelect.innerHTML = '<option value="">Todos los documentos</option>' +
        docsRes.map(d => `<option value="${escapeStr(d.filename)}" ${d.filename === currentVal ? 'selected' : ''}>${d.filename}</option>`).join('');
    }

    renderDashboardWithData(metricsRes, _dashAllCases);

  } catch (e) {
    console.warn('Error cargando dashboard:', e.message);
    if (metricsGrid) metricsGrid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:2rem;">Error al cargar métricas: ${e.message}</div>`;
  }
}

function renderDashboardWithData(metrics, cases) {
  const metricsGrid = document.getElementById('metricsGrid');
  const typeDiv = document.getElementById('typeDistribution');
  const sevDiv = document.getElementById('severityDistribution');
  const chartContainer = document.getElementById('dashMainChartContainer');

  const total = cases.length || metrics.total_cases || 0;
  const cumple = cases.filter(c => c.result === 'CUMPLE').length || metrics.cumple || 0;
  const noCumple = cases.filter(c => c.result === 'NO CUMPLE').length || metrics.no_cumple || 0;
  const ejecutados = cumple + noCumple;
  const pendiente = total - ejecutados;
  const passRate = ejecutados > 0 ? Math.round((cumple / ejecutados) * 100) : (metrics.pass_rate || 0);
  const execRate = total > 0 ? Math.round((ejecutados / total) * 100) : (metrics.execution_rate || 0);

  // ── 1. 5 KPI Cards ──────────────────────────────────────────
  const kpis = [
    {
      value: total, label: 'Total Casos', sub: 'Catalogados en el proyecto',
      color: 'rgba(0,156,166,0.12)', border: 'rgba(0,156,166,0.3)',
      textColor: 'var(--accent-primary)',
      badge: '100%', badgeColor: 'rgba(0,156,166,0.2)', badgeText: 'var(--accent-primary)',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`
    },
    {
      value: cumple, label: 'CUMPLE (PASS)', sub: `${total > 0 ? Math.round(cumple / total * 100) : 0}% del total general`,
      color: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)',
      textColor: '#10b981',
      badge: `+${cumple}`, badgeColor: 'rgba(16,185,129,0.15)', badgeText: '#10b981',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="20" height="20"><polyline points="20 6 9 17 4 12"/></svg>`
    },
    {
      value: noCumple, label: 'NO CUMPLE (DEFECTOS)', sub: `${total > 0 ? Math.round(noCumple / total * 100) : 0}% de incidencia`,
      color: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)',
      textColor: '#ef4444',
      badge: noCumple > 0 ? `${noCumple} Fallos` : '0 Fallos', badgeColor: 'rgba(239,68,68,0.15)', badgeText: '#ef4444',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="20" height="20"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`
    },
    {
      value: pendiente, label: 'PENDIENTES', sub: 'Por registrar resultado',
      color: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)',
      textColor: '#f59e0b',
      badge: pendiente > 0 ? `${pendiente} Restantes` : 'Completo', badgeColor: 'rgba(245,158,11,0.15)', badgeText: '#f59e0b',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`
    },
    {
      value: `${passRate}%`, label: 'TASA DE ÉXITO', sub: `Ejecución: ${execRate}% de casos`,
      color: 'rgba(139,92,246,0.12)', border: 'rgba(139,92,246,0.3)',
      textColor: '#8b5cf6',
      badge: 'En curso', badgeColor: 'rgba(139,92,246,0.15)', badgeText: '#8b5cf6',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`
    },
  ];

  if (metricsGrid) {
    metricsGrid.innerHTML = kpis.map(k => `
      <div class="dash-spark-card" style="background:${k.color};border:1px solid ${k.border};">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.15rem;">
          <span style="font-size:0.65rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;">${k.label}</span>
          <span style="font-size:0.55rem;font-weight:700;padding:0.1rem 0.4rem;border-radius:4px;background:${k.badgeColor};color:${k.badgeText};">${k.badge}</span>
        </div>
        <div style="font-size:1.9rem;font-weight:800;color:${k.textColor};line-height:1.1;letter-spacing:-0.02em;">${k.value}</div>
        <div style="font-size:0.62rem;color:var(--text-muted);margin-bottom:0.3rem;">${k.sub}</div>
        <svg viewBox="0 0 80 20" width="100%" height="20" style="overflow:visible;opacity:0.75;">
          <polyline points="0,16 14,12 28,14 42,8 56,10 70,5 80,6" fill="none" stroke="${k.textColor}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="80" cy="6" r="2.5" fill="${k.textColor}"/>
        </svg>
      </div>
    `).join('');
  }

  // ── 2. Widget Principal: Avance y Cobertura por Módulo ────
  if (chartContainer) {
    // Agrupar por módulo
    const modMap = {};
    cases.forEach(c => {
      const m = c.module || 'General';
      if (!modMap[m]) modMap[m] = { total: 0, cumple: 0, noCumple: 0, pendientes: 0 };
      modMap[m].total++;
      if (c.result === 'CUMPLE') modMap[m].cumple++;
      else if (c.result === 'NO CUMPLE') modMap[m].noCumple++;
      else modMap[m].pendientes++;
    });

    const modEntries = Object.entries(modMap);

    if (modEntries.length === 0) {
      chartContainer.innerHTML = `
        <div style="text-align:center;padding:2rem;color:var(--text-muted);font-size:0.8rem;">
          No hay casos generados en este proyecto aún.
        </div>
      `;
    } else {
      chartContainer.innerHTML = `
        <div class="dash-coverage-container">
          <!-- Barra Global de Proyecto -->
          <div class="dash-global-bar-wrap">
            <div class="dash-global-bar-labels">
              <span class="dash-global-title">Progreso Global del Plan de Pruebas (${total} Casos Totales)</span>
              <span class="dash-global-stat"><strong>${cumple + noCumple}</strong> de ${total} ejecutados (${total > 0 ? Math.round(((cumple + noCumple) / total) * 100) : 0}%)</span>
            </div>
            <div class="dash-segmented-bar large">
              <div class="dash-seg-cumple" style="width: ${total > 0 ? (cumple / total) * 100 : 0}%;" title="CUMPLE: ${cumple}"></div>
              <div class="dash-seg-nocumple" style="width: ${total > 0 ? (noCumple / total) * 100 : 0}%;" title="NO CUMPLE: ${noCumple}"></div>
              <div class="dash-seg-pend" style="width: ${total > 0 ? (pendiente / total) * 100 : 0}%;" title="Pendientes: ${pendiente}"></div>
            </div>
          </div>

          <!-- Listado de Módulos / Funcionalidades -->
          <div class="dash-modules-breakdown-list">
            ${modEntries.map(([modName, stats]) => {
              const execCount = stats.cumple + stats.noCumple;
              const execPct = stats.total > 0 ? Math.round((execCount / stats.total) * 100) : 0;
              const cumpleW = stats.total > 0 ? (stats.cumple / stats.total) * 100 : 0;
              const noCumpleW = stats.total > 0 ? (stats.noCumple / stats.total) * 100 : 0;
              const pendW = stats.total > 0 ? (stats.pendientes / stats.total) * 100 : 0;

              return `
                <div class="dash-module-coverage-row">
                  <div class="dash-mod-header">
                    <div class="dash-mod-name-group">
                      <span class="dash-mod-icon">📋</span>
                      <strong class="dash-mod-title">${modName}</strong>
                      <span class="dash-mod-total-badge">${stats.total} casos</span>
                    </div>
                    <div class="dash-mod-kpis">
                      <span class="dash-mod-kpi-item cumple">✓ <strong>${stats.cumple}</strong> Pass</span>
                      <span class="dash-mod-kpi-item nocumple">✕ <strong>${stats.noCumple}</strong> Fallas</span>
                      <span class="dash-mod-kpi-item pend">⏳ <strong>${stats.pendientes}</strong> Pend.</span>
                      <span class="dash-mod-rate-badge">${execPct}% Ejecutado</span>
                    </div>
                  </div>
                  <div class="dash-segmented-bar">
                    <div class="dash-seg-cumple" style="width: ${cumpleW}%;" title="CUMPLE: ${stats.cumple}"></div>
                    <div class="dash-seg-nocumple" style="width: ${noCumpleW}%;" title="NO CUMPLE: ${stats.noCumple}"></div>
                    <div class="dash-seg-pend" style="width: ${pendW}%;" title="Pendientes: ${stats.pendientes}"></div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }
  }

  // ── 3. Distribución por Tipo de Prueba (Histograma vertical) ──
  const byType = {};
  cases.forEach(c => {
    const t = c.test_type || 'FUNCIONALES';
    byType[t] = (byType[t] || 0) + 1;
  });
  if (Object.keys(byType).length === 0 && metrics.by_type) Object.assign(byType, metrics.by_type);

  const typeEntries = Object.entries(byType).sort(([, a], [, b]) => b - a);
  const typeBadge = document.getElementById('dashTypeBadge');
  if (typeBadge) typeBadge.textContent = `${typeEntries.length} Tipos`;

  const typeColors = {
    'FUNCIONALES': '#00e5ff', 'CASOS NEGATIVOS': '#10b981', 'SEGURIDAD': '#f59e0b',
    'NO FUNCIONALES': '#3b82f6', 'CARGA': '#6366f1', 'INTEGRACION': '#8b5cf6',
    'ESTRESS': '#ec4899', 'COMPATIBILIDAD': '#14b8a6', 'RESILIENCIA': '#f97316'
  };

  const maxTypeCount = Math.max(...Object.values(byType), 1);

  if (typeDiv) {
    if (typeEntries.length === 0) {
      typeDiv.innerHTML = '<p style="color:var(--text-muted);font-size:0.75rem;text-align:center;padding:1.5rem;">Sin datos de tipos</p>';
    } else {
      typeDiv.innerHTML = `
        <div class="dash-barchart-container">
          ${typeEntries.map(([type, count]) => {
        const color = typeColors[type] || 'var(--accent-primary)';
        const heightPct = Math.max(15, Math.round((count / maxTypeCount) * 100));
        return `
              <div class="dash-vbar-group">
                <span class="dash-vbar-val" style="color:${color};">${count}</span>
                <div class="dash-vbar-track">
                  <div class="dash-vbar-fill" style="height:${heightPct}%;background:${color};"></div>
                </div>
                <span class="dash-vbar-label" title="${type}">${type}</span>
              </div>
            `;
      }).join('')}
        </div>
      `;
    }
  }

  // ── 4. Defectos por Nivel de Severidad (Barras horizontales) ──
  const sevDef = [
    { label: 'Bloqueante', color: '#ef4444', count: 0 },
    { label: 'Crítico', color: '#f59e0b', count: 0 },
    { label: 'Tolerable', color: '#10b981', count: 0 },
    { label: 'Interfaz de usuario', color: '#00e5ff', count: 0 }
  ];

  cases.forEach(c => {
    if (c.result === 'NO CUMPLE') {
      const s = sevDef.find(item => item.label.toLowerCase() === (c.severity || '').toLowerCase());
      if (s) s.count++;
      else if (c.severity) sevDef[0].count++;
    }
  });

  const totalDefects = sevDef.reduce((acc, curr) => acc + curr.count, 0) || metrics.no_cumple || 0;
  const sevBadge = document.getElementById('dashSevBadge');
  if (sevBadge) sevBadge.textContent = `${totalDefects} Defectos`;

  const maxSev = Math.max(...sevDef.map(s => s.count), 1);

  if (sevDiv) {
    sevDiv.innerHTML = `
      <div class="dash-severity-container">
        ${sevDef.map(s => {
      const widthPct = Math.max(s.count > 0 ? 10 : 0, Math.round((s.count / maxSev) * 100));
      return `
            <div class="dash-sev-row">
              <div class="dash-sev-header">
                <div class="dash-sev-name">
                  <div class="dash-sev-dot" style="background:${s.color};"></div>
                  <span>${s.label}</span>
                </div>
                <span class="dash-sev-count" style="color:${s.color};">${s.count}</span>
              </div>
              <div class="dash-sev-track">
                <div class="dash-sev-fill" style="width:${widthPct}%;background:${s.color};"></div>
              </div>
            </div>
          `;
    }).join('')}
      </div>
    `;
  }
}

// ── Filtros en tiempo real del Dashboard ────────────────────────
function applyDashFilters() {
  const search = (document.getElementById('dashFilterSearch')?.value || '').toLowerCase().trim();
  const doc = document.getElementById('dashFilterDoc')?.value || '';
  const type = document.getElementById('dashFilterType')?.value || '';
  const sev = document.getElementById('dashFilterSev')?.value || '';
  const result = document.getElementById('dashFilterResult')?.value || '';
  const dateFrom = document.getElementById('dashFilterDateFrom')?.value || '';
  const dateTo = document.getElementById('dashFilterDateTo')?.value || '';

  const filtered = _dashAllCases.filter(c => {
    if (search && !((c.title || '').toLowerCase().includes(search) || (c.case_id || '').toLowerCase().includes(search) || (c.module || '').toLowerCase().includes(search))) return false;
    if (doc && c.source_document !== doc) return false;
    if (type && c.test_type !== type) return false;
    if (sev && c.severity !== sev) return false;
    if (result && c.result !== result && (result !== 'Pendiente' || c.status === 'Ejecutado')) return false;
    if (dateFrom && (c.created_at || '').slice(0, 10) < dateFrom) return false;
    if (dateTo && (c.created_at || '').slice(0, 10) > dateTo) return false;
    return true;
  });

  const countBadge = document.getElementById('dashFilterCount');
  if (countBadge) {
    countBadge.textContent = `${filtered.length} de ${_dashAllCases.length} casos`;
  }

  renderDashboardWithData({}, filtered);
}

function clearDashFilters() {
  const s = document.getElementById('dashFilterSearch'); if (s) s.value = '';
  const d = document.getElementById('dashFilterDoc'); if (d) d.value = '';
  const t = document.getElementById('dashFilterType'); if (t) t.value = '';
  const sv = document.getElementById('dashFilterSev'); if (sv) sv.value = '';
  const r = document.getElementById('dashFilterResult'); if (r) r.value = '';
  const df = document.getElementById('dashFilterDateFrom'); if (df) df.value = '';
  const dt = document.getElementById('dashFilterDateTo'); if (dt) dt.value = '';
  const count = document.getElementById('dashFilterCount'); if (count) count.textContent = '';
  renderDashboardWithData({}, _dashAllCases);
}

// ══════════════════════════════════════════════════════════════
// MÓDULO 4 — CRONÓMETRO Y TIEMPOS DE EJECUCIÓN
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
// MÓDULO 4 — TIEMPOS DE EJECUCIÓN (CRONÓMETRO Y ANALÍTICAS HUD)
// ══════════════════════════════════════════════════════════════
let _timerAllCases = [];

async function loadTimerModule() {
  await Promise.all([
    loadTimerMatrices(),
    loadTimerStats()
  ]);
}

async function loadTimerMatrices() {
  const select = document.getElementById('timerMatrixSelect');
  if (!select) return;

  try {
    const res = await fetch(`${API_BASE}/api/test-cases/exports?project_name=${encodeURIComponent(currentProject)}`);
    const files = await res.json();

    select.innerHTML = '<option value="">-- Todas las matrices de prueba --</option>';
    if (files && files.length > 0) {
      files.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.filename;
        opt.textContent = `📊 Matriz EOPA — ${f.module} (${f.filename})`;
        select.appendChild(opt);
      });
    }

    await onTimerMatrixSelected();
  } catch (e) {
    console.error('Error cargando matrices para el cronómetro:', e);
  }
}

async function onTimerMatrixSelected() {
  const matrixSelect = document.getElementById('timerMatrixSelect');
  const caseSelect = document.getElementById('timerCaseSelect');
  const countSpan = document.getElementById('timerAvailableCasesCount');
  if (!caseSelect) return;

  const selectedFile = matrixSelect ? matrixSelect.value : '';

  try {
    let url = `${API_BASE}/api/test-cases?project_name=${encodeURIComponent(currentProject)}`;
    if (selectedFile) {
      url += `&filename=${encodeURIComponent(selectedFile)}`;
    }

    const res = await fetch(url);
    _timerAllCases = (await res.json()) || [];

    if (countSpan) {
      countSpan.textContent = `${_timerAllCases.length} casos disponibles`;
    }

    caseSelect.innerHTML = '<option value="">-- Selecciona un caso de prueba --</option>';
    _timerAllCases.forEach(tc => {
      const opt = document.createElement('option');
      opt.value = tc.db_id || tc.id;
      opt.textContent = `[${tc.case_id || 'TC'}] ${tc.title || 'Caso'} (${tc.test_type || 'General'})`;
      caseSelect.appendChild(opt);
    });
  } catch (e) {
    console.error('Error cargando casos para el cronómetro:', e);
  }
}

async function startTimer() {
  const caseSelect = document.getElementById('timerCaseSelect');
  const testerInput = document.getElementById('timerTesterInput');

  if (!caseSelect || !caseSelect.value) {
    showToast('Por favor selecciona un caso de prueba para cronometrar.', 'error');
    return;
  }

  const tcId = caseSelect.value;
  const testerName = testerInput ? testerInput.value.trim() : '';

  try {
    const res = await fetch(`${API_BASE}/api/timer/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        test_case_id: tcId,
        tester_name: testerName,
        project_name: currentProject
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Error al iniciar cronómetro');

    _timerSessionId = data.session_id;
    _timerRunning = true;
    _timerSeconds = 0;

    const startBtn = document.getElementById('btnTimerStart');
    const stopBtn = document.getElementById('btnTimerStop');
    const indicator = document.getElementById('timerStateIndicator');
    const stateText = document.getElementById('timerStateText');

    if (startBtn) startBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = false;
    if (indicator) indicator.classList.add('running');
    if (stateText) stateText.textContent = 'CORRIENDO';

    clearInterval(_timerInterval);
    _timerInterval = setInterval(() => {
      _timerSeconds++;
      const mins = String(Math.floor(_timerSeconds / 60)).padStart(2, '0');
      const secs = String(_timerSeconds % 60).padStart(2, '0');
      const display = document.getElementById('timerDisplay');
      if (display) display.textContent = `${mins}:${secs}.0`;
    }, 1000);

    showToast('⏱ Cronómetro iniciado', 'info');
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

function stopTimer() {
  if (!_timerSessionId) return;

  // 1. Congelar inmediatamente el reloj en pantalla
  clearInterval(_timerInterval);
  _timerRunning = false;

  const indicator = document.getElementById('timerStateIndicator');
  const stateText = document.getElementById('timerStateText');
  if (indicator) indicator.classList.remove('running');
  if (stateText) stateText.textContent = 'EN REVISIÓN';

  // 2. Notificar al backend que pause el cronómetro
  fetch(`${API_BASE}/api/timer/pause?session_id=${encodeURIComponent(_timerSessionId)}`, { method: 'POST' }).catch(() => {});

  // 3. Abrir modal con el tiempo exacto congelado
  const caseSelect = document.getElementById('timerCaseSelect');
  const selectedText = caseSelect && caseSelect.selectedIndex >= 0 ? caseSelect.options[caseSelect.selectedIndex].text : 'Caso de prueba';
  const mins = String(Math.floor(_timerSeconds / 60)).padStart(2, '0');
  const secs = String(_timerSeconds % 60).padStart(2, '0');
  openExecutionModal(null, selectedText, `⏱ Tiempo Registrado: ${mins}:${secs}.0`);
}

async function loadTimerStats() {
  const kpiCount = document.getElementById('timerKpiCount');
  const kpiAvg = document.getElementById('timerKpiAvg');
  const kpiTotal = document.getElementById('timerKpiTotal');
  const kpiMin = document.getElementById('timerKpiMin');
  const kpiMax = document.getElementById('timerKpiMax');
  const barsContainer = document.getElementById('timerModuleBarsList');
  const typeGrid = document.getElementById('timerTypeGrid');
  const tbody = document.getElementById('timerHistoryBody');

  try {
    const res = await fetch(`${API_BASE}/api/timer/stats?project_name=${encodeURIComponent(currentProject)}`);
    const data = await res.json();

    if (!data) return;

    // 1. KPIs
    if (kpiCount) kpiCount.textContent = data.total_executed || 0;
    if (kpiAvg) kpiAvg.textContent = `${Math.round(data.avg_seconds || 0)}s`;
    if (kpiTotal) {
      const tot = Math.round(data.total_seconds || 0);
      kpiTotal.textContent = tot >= 60 ? `${Math.floor(tot / 60)}m ${tot % 60}s` : `${tot}s`;
    }
    if (kpiMin) kpiMin.textContent = `${Math.round(data.min_seconds || 0)}s`;
    if (kpiMax) kpiMax.textContent = `${Math.round(data.max_seconds || 0)}s`;

    // 2. Barras por Módulo
    if (barsContainer) {
      const rfs = data.by_rf || [];
      if (rfs.length === 0) {
        barsContainer.innerHTML = '<div style="font-size:0.75rem;color:var(--text-muted);padding:1rem;text-align:center;">Ejecuta casos cronometrados para visualizar métricas por módulo.</div>';
      } else {
        const maxSecs = Math.max(...rfs.map(r => r.avg_seconds || r.total_seconds || 1), 1);
        barsContainer.innerHTML = rfs.map(r => {
          const avgSec = Math.round(r.avg_seconds || (r.count ? r.total_seconds / r.count : 0));
          const pct = Math.min(Math.max((avgSec / maxSecs) * 100, 10), 100);
          return `
            <div class="timer-module-bar-item">
              <div class="timer-bar-header">
                <span class="timer-bar-module-name">${r.rf || r.module || 'General'}</span>
                <span class="timer-bar-meta"><strong>${avgSec}s</strong> · ${r.count} caso(s)</span>
              </div>
              <div class="timer-bar-track">
                <div class="timer-bar-fill" style="width: ${pct}%;"></div>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // 3. Grid por Tipo de Prueba
    if (typeGrid) {
      const typeList = Array.isArray(data.by_type)
        ? data.by_type
        : Object.entries(data.by_type || {}).map(([k, v]) => ({
            type: k,
            count: v.count,
            avg_seconds: v.avg_seconds || (v.count ? v.total_seconds / v.count : 0)
          }));

      if (typeList.length === 0) {
        typeGrid.innerHTML = '<div style="font-size:0.75rem;color:var(--text-muted);padding:1rem;text-align:center;grid-column:1/-1;">Sin datos registrados aún.</div>';
      } else {
        typeGrid.innerHTML = typeList.map(tData => {
          const avgSec = Math.round(tData.avg_seconds || (tData.count ? tData.total_seconds / tData.count : 0));
          const typeName = tData.type || 'General';
          return `
            <div class="timer-type-box">
              <div class="timer-type-lbl">${typeName}</div>
              <div class="timer-type-val">${avgSec}s</div>
              <div class="timer-type-count">${tData.count} caso(s)</div>
            </div>
          `;
        }).join('');
      }
    }

    // 4. Tabla de Historial
    if (tbody) {
      const history = data.history || [];
      if (history.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:1.5rem;color:var(--text-muted);">Sin sesiones registradas aún.</td></tr>';
      } else {
        tbody.innerHTML = history.map(s => {
          const secs = Math.round(s.execution_time_seconds || 0);
          const formattedTime = secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;
          const badgeCls = s.result === 'CUMPLE' ? 'status-cumple' : s.result === 'NO CUMPLE' ? 'status-nocumple' : 'status-pending';
          const dateVal = s.executed_at || s.stopped_at || s.created_at;
          let dateStr = '—';
          if (dateVal) {
            try {
              const iso = (typeof dateVal === 'string' && !dateVal.endsWith('Z') && !dateVal.includes('+')) ? dateVal + 'Z' : dateVal;
              dateStr = new Date(iso).toLocaleString('es-CO', {
                hour12: true,
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              });
            } catch (_) {}
          }

          return `
            <tr>
              <td><strong style="color:var(--accent-secondary);">${s.case_id || '—'}</strong></td>
              <td style="max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s.title || 'Caso de prueba'}</td>
              <td>${s.module || 'General'}</td>
              <td><strong style="font-family:var(--font-hud);">${formattedTime}</strong></td>
              <td><span class="exec-status ${badgeCls}">${s.result || 'Ejecutado'}</span></td>
              <td style="font-size:0.75rem;color:var(--text-muted);">${dateStr}</td>
              <td style="text-align:center;">
                <button class="btn-icon-danger" title="Eliminar registro" onclick="deleteTimerExecution('${s.execution_id}')" style="background:transparent;border:none;color:var(--danger,#f43f5e);cursor:pointer;padding:4px 8px;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;transition:background 0.2s, color 0.2s;" onmouseover="this.style.background='rgba(244,63,94,0.15)'" onmouseout="this.style.background='transparent'">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                </button>
              </td>
            </tr>
          `;
        }).join('');
      }
    }

  } catch (e) {
    console.error('Error cargando estadísticas del cronómetro:', e);
  }
}

async function deleteTimerExecution(executionId) {
  if (!executionId) return;
  if (!confirm('¿Deseas eliminar este registro del historial de ejecución?')) return;

  try {
    const res = await fetch(`${API_BASE}/api/timer/executions/${executionId}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Error al eliminar el registro');
    }
    showToast('Registro de ejecución eliminado', 'success');
    loadTimerStats();
  } catch (e) {
    console.error('Error al eliminar registro de ejecución:', e);
    showToast(e.message || 'Error al eliminar', 'error');
  }
}

function exportTimedExcel() {
  const url = `${API_BASE}/api/test-cases/export/excel?project_name=${encodeURIComponent(currentProject)}`;
  window.open(url, '_blank');
}

// ══════════════════════════════════════════════════════════════
// FILTROS Y MODALES DE BASE DE CONOCIMIENTO & EJECUCIÓN
// ══════════════════════════════════════════════════════════════
function filterDocuments() {
  const query = (document.getElementById('kbSearchInput')?.value || '').toLowerCase().trim();
  const cat = document.getElementById('kbCatFilter')?.value || '';
  const rows = document.querySelectorAll('#documentsGrid tr');

  rows.forEach(r => {
    const text = r.textContent.toLowerCase();
    const matchesQuery = !query || text.includes(query);
    const matchesCat = !cat || text.includes(cat.toLowerCase());
    r.style.display = (matchesQuery && matchesCat) ? '' : 'none';
  });
}

function filterExecutionCases() {
  const search = (document.getElementById('executionSearch')?.value || '').toLowerCase().trim();
  const status = document.getElementById('execStatusFilter')?.value || '';
  const rows = document.querySelectorAll('#executionCasesList .exec-table-row');

  rows.forEach(r => {
    const text = r.textContent.toLowerCase();
    const matchesSearch = !search || text.includes(search);
    const matchesStatus = !status || text.includes(status.toLowerCase());
    r.style.display = (matchesSearch && matchesStatus) ? '' : 'none';
  });
}

function openEditDocModal(id, filename, category) {
  document.getElementById('editDocId').value = id;
  document.getElementById('editDocName').value = filename;
  document.getElementById('editDocCategory').value = category || 'requirements';
  document.getElementById('editDocModal').classList.remove('hidden');
}

function closeEditDocModal() {
  document.getElementById('editDocModal').classList.add('hidden');
}

async function saveEditDoc() {
  const id = document.getElementById('editDocId').value;
  const name = document.getElementById('editDocName').value.trim();
  const cat = document.getElementById('editDocCategory').value;

  if (!name) { showToast('El nombre no puede estar vacío', 'error'); return; }

  try {
    const res = await fetch(`${API_BASE}/api/documents/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: name, category: cat })
    });
    if (!res.ok) throw new Error('Error al actualizar documento');
    closeEditDocModal();
    showToast('Documento actualizado', 'success');
    loadDocuments();
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

function toggleTranscriptDrawer() {
  const p = document.getElementById('jarvisLogPanel');
  if (p) {
    p.classList.toggle('hidden');
    _transcriptOpen = !p.classList.contains('hidden');
    const btn = document.getElementById('jtbTranscriptToggle');
    if (btn) btn.classList.toggle('active', _transcriptOpen);
  }
}

function toggleTranscriptPopup() {
  toggleTranscriptDrawer();
}

function toggleListening() {
  if (window._isAIProcessing || (window.speechSynthesis && window.speechSynthesis.speaking)) {
    showToast('⚠️ CIEL AI está respondiendo. Espera a que termine o presiona DETENER.', 'warning');
    return;
  }
  if (window.PRQAVoice && typeof PRQAVoice.toggleListening === 'function') {
    PRQAVoice.toggleListening();
  } else if (typeof startListening === 'function') {
    startListening();
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
  return new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
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
    try { _activeAbortController.abort(); } catch (e) { }
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

// _currentInterimLine declarado al inicio del archivo

function appendOrUpdateUserInterim(text) {
  const body = document.getElementById('jarvisLogBody') || document.getElementById('jarvisLogList');
  if (!body || !text || !text.trim()) return;

  if (!_currentInterimLine || !document.getElementById('jlpActiveInterim')) {
    _currentInterimLine = document.createElement('div');
    _currentInterimLine.className = 'jlp-line jlp-user';
    _currentInterimLine.id = 'jlpActiveInterim';
    body.appendChild(_currentInterimLine);
  }

  _currentInterimLine.innerHTML = `
    <span class="jlp-ts">${_jlpTs()}</span>
    <span class="jlp-tag jlp-tag-user">USR</span>
    <span class="jlp-text">${text.replace(/</g, '&lt;')} <em style="font-size:0.65rem;color:#10b981;font-style:normal;">●</em></span>
  `;
  body.scrollTop = body.scrollHeight;
}

function finalizeUserInterim(text) {
  const el = document.getElementById('jlpActiveInterim');
  if (el) el.remove();
  _currentInterimLine = null;
}

// _lastLogEntry declarado al inicio del archivo

function _formatLogText(text) {
  if (!text) return '';
  let str = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Negrita
  str = str.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Viñetas con viñetas o guiones (•, ·, -, *)
  str = str.replace(/^[•·\-\*]\s*(.+)$/gm, '<div class="jlp-bullet-item"><span class="jlp-bullet-dot">▪</span><span>$1</span></div>');

  // Listas numeradas (1., 2., etc)
  str = str.replace(/^(\d+)\.\s*(.+)$/gm, '<div class="jlp-bullet-item"><span class="jlp-bullet-num">$1.</span><span>$2</span></div>');

  // Párrafos y saltos
  str = str.replace(/\n\n+/g, '<div class="jlp-gap"></div>');
  str = str.replace(/\n/g, '<br>');

  return str;
}

function appendJarvisLog(type, text) {
  const body = document.getElementById('jarvisLogBody') || document.getElementById('jarvisLogList');
  if (!body || !text) return;

  const now = Date.now();
  // Evitar duplicar exactamente el mismo mensaje consecutivo en menos de 1.5 segundos
  if (_lastLogEntry.type === type && _lastLogEntry.text === text && (now - _lastLogEntry.time) < 1500) {
    return;
  }
  _lastLogEntry = { type, text, time: now };

  // Si había una línea interim, limpiarla
  if (type === 'user') {
    finalizeUserInterim();
  }

  const tagMap = {
    user: { cls: 'jlp-user', tag: 'USR', tagCls: 'jlp-tag-user' },
    ai: { cls: 'jlp-ai', tag: 'CIEL AI', tagCls: 'jlp-tag-ai' },
    system: { cls: 'jlp-system', tag: 'SYS', tagCls: 'jlp-tag-sys' },
    error: { cls: 'jlp-error', tag: 'ERR', tagCls: 'jlp-tag-err' },
  };

  const m = tagMap[type] || tagMap.system;

  const line = document.createElement('div');
  line.className = `jlp-line ${m.cls}`;
  line.innerHTML = `
    <span class="jlp-ts">${_jlpTs()}</span>
    <span class="jlp-tag ${m.tagCls}">${m.tag}</span>
    <span class="jlp-text">${_formatLogText(text)}</span>
  `;

  body.appendChild(line);
  body.scrollTop = body.scrollHeight;

  // Abrir automáticamente la transcripción cuando hay un mensaje del usuario o de la IA
  if ((type === 'ai' || type === 'user') && !_transcriptOpen) {
    const panel = document.getElementById('jarvisLogPanel');
    if (panel) {
      panel.classList.remove('hidden');
      _transcriptOpen = true;
      const btn = document.getElementById('jtbTranscriptToggle');
      if (btn) btn.classList.add('active');
    }
  }
}

window.appendOrUpdateUserInterim = appendOrUpdateUserInterim;
window.finalizeUserInterim = finalizeUserInterim;
window.appendJarvisLog = appendJarvisLog;

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

  // Si no coincide con las respuestas inmediatas, pasa al modelo RAG en backend
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
  if (window._isAIProcessing || (window.speechSynthesis && window.speechSynthesis.speaking)) {
    showToast('⚠️ CIEL AI está respondiendo. Espera a que termine o presiona DETENER.', 'warning');
    return;
  }
  const input = document.getElementById('tibInput');
  if (!input || !input.value.trim()) return;
  const text = input.value.trim();
  input.value = '';
  toggleTextInput();
  await queryCielAI(text);
}

window.queryCielAI = queryCielAI;
window.stopAI = stopAI;
window.appendJarvisLog = appendJarvisLog;
window.appendOrUpdateUserInterim = appendOrUpdateUserInterim;
window.toggleTranscriptDrawer = toggleTranscriptDrawer;
window.showToast = showToast;
window.toggleListening = toggleListening;
window.toggleTTS = toggleTTS;
window.toggleTextInput = toggleTextInput;
window.openExecMatrixDetail = openExecMatrixDetail;
window.backToExecMatrices = backToExecMatrices;
window.refreshExecDetail = refreshExecDetail;
window.filterExecDetailCases = filterExecDetailCases;
window.openExecutionModal = openExecutionModal;
window.closeExecutionModal = closeExecutionModal;
window.selectResult = selectResult;
window.saveExecution = saveExecution;

