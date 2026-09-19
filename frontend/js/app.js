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
  // Solo proteger 'General' (proyecto de sistema). 'Proyectos' y demas son eliminables.
  if (currentProject === 'General') {
    showToast('El proyecto "General" es el predeterminado del sistema y no se puede eliminar.', 'error');
    return;
  }
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
  window.finalizeUserInterim = finalizeUserInterim;
  window.clearJarvisLog = clearJarvisLog;
  window.toggleTranscriptDrawer = toggleTranscriptDrawer;
  window.toggleTranscriptPopup = toggleTranscriptPopup;
  window.initTranscriptResize = initTranscriptResize;
  window.toggleMaximizeTranscript = toggleMaximizeTranscript;
  window.showToast = showToast;
  window.toggleListening = toggleListening;
  window.toggleTTS = toggleTTS;
  window.toggleTextInput = toggleTextInput;
  window.sendTextToAI = sendTextToAI;

  // Inicializar redimensionamiento de ventana de transcripción
  initTranscriptResize();

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
  // Ocultar modulo actual
  document.querySelectorAll('.module').forEach(m => m.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  // Mostrar nuevo modulo
  const moduleEl = document.getElementById(`module${name.charAt(0).toUpperCase() + name.slice(1)}`);
  const navEl = document.getElementById(`nav${name.charAt(0).toUpperCase() + name.slice(1)}`);

  if (moduleEl) moduleEl.classList.add('active');
  if (navEl) navEl.classList.add('active');

  currentModule = name;

  // Recargar datos segun modulo
  if (name === 'generate') {
    _expandedMatrices.clear();
    loadDocumentsForGenerator();
    loadTestCasesForGenerator();
    updateTestTypeChips();
  }
  if (name === 'documents') loadDocuments();
  if (name === 'execution') {
    loadTestCasesForExecution();
    // Tambien cargar datos del cronometro al entrar al modulo
    if (typeof loadTimerModule === 'function') loadTimerModule();
  }
  if (name === 'dashboard') loadDashboard();
}

let _autoExpandedMatrixFile = null;
let _expandedMatrices = new Set();

function toggleMatrixCases(matrixKey) {
  if (_expandedMatrices.has(matrixKey)) {
    _expandedMatrices.delete(matrixKey);
  } else {
    _expandedMatrices.add(matrixKey);
  }
  const el = document.getElementById(`matrixCases_${matrixKey}`);
  const btn = document.getElementById(`btnToggleCases_${matrixKey}`);
  if (el) {
    const isNowExpanded = _expandedMatrices.has(matrixKey);
    el.style.display = isNowExpanded ? 'flex' : 'none';
    if (isNowExpanded) {
      el.scrollTop = 0;
    }
    if (btn) {
      btn.innerHTML = isNowExpanded
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M18 15l-6-6-6 6"/></svg> Ocultar Casos`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M6 9l6 6 6-6"/></svg> Ver Casos`;
    }
  }
}

async function loadTestCasesForGenerator() {
  const container = document.getElementById('testCasesContainer');
  if (!container) return;

  try {
    const [resFiles, resCases] = await Promise.all([
      fetch(`${API_BASE}/api/test-cases/exports?project_name=${encodeURIComponent(currentProject)}`),
      fetch(`${API_BASE}/api/test-cases?project_name=${encodeURIComponent(currentProject)}`)
    ]);

    const files = await resFiles.json();
    const allCases = (await resCases.json()) || [];

    if (!files || files.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" width="48" height="48">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <p>Sin matrices generadas</p>
          <span>Genera casos de prueba a la izquierda para crear tu primera matriz Excel EOPA</span>
        </div>
      `;
      const badge = document.getElementById('caseCountBadge');
      if (badge) badge.textContent = '0';
      const tabBadge = document.getElementById('genTabBadge');
      if (tabBadge) tabBadge.textContent = '0';
      return;
    }

    const badge = document.getElementById('caseCountBadge');
    if (badge) badge.textContent = files.length;
    const tabBadge = document.getElementById('genTabBadge');
    if (tabBadge) tabBadge.textContent = files.length;

    const severityColors = {
      "Bloqueante": { bg: "rgba(239,68,68,0.12)", color: "#ef4444", border: "rgba(239,68,68,0.3)" },
      "Crítico": { bg: "rgba(249,115,22,0.12)", color: "#f97316", border: "rgba(249,115,22,0.3)" },
      "Tolerable": { bg: "rgba(59,130,246,0.12)", color: "#3b82f6", border: "rgba(59,130,246,0.3)" },
      "Interfaz de usuario": { bg: "rgba(168,85,247,0.12)", color: "#a855f7", border: "rgba(168,85,247,0.3)" }
    };

    container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:0.85rem;width:100%;">
        ${files.map((f, idx) => {
          const displayTitle = `Matriz EOPA — ${f.module}`;
          const isExpanded = _expandedMatrices.has(f.filename);

          // Filtrar casos de la base de datos pertenecientes a este archivo específico o módulo
          const matchedCases = allCases.filter(c => c.export_file ? c.export_file === f.filename : c.module === f.module);
          const casesCount = matchedCases.length;

          return `
          <div class="excel-file-card" style="
            display:flex;flex-direction:column;gap:0.75rem;
            background:var(--bg-card);border:1px solid var(--border-subtle);
            border-radius:var(--radius-md);padding:0.9rem 1rem;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            transition:var(--transition);
          ">
            <!-- Fila Principal de la Matriz -->
            <div style="display:flex;align-items:center;gap:0.85rem;width:100%;">
              <!-- Icono Excel (Estilo Ciel Teal corporativo) -->
              <div style="width:40px;height:40px;border-radius:8px;
                background:rgba(0,156,166,0.12);color:var(--accent-primary);
                display:flex;align-items:center;justify-content:center;flex-shrink:0;
                border:1px solid rgba(0,156,166,0.3);">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                </svg>
              </div>

              <!-- Metadatos de la Matriz -->
              <div style="flex:1;min-width:0;">
                <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
                  <strong style="font-size:0.92rem;color:var(--text-primary);">${displayTitle}</strong>
                  <span style="font-size:0.7rem;padding:0.15rem 0.5rem;background:rgba(0,156,166,0.12);color:var(--accent-primary);border-radius:9999px;font-weight:700;">
                    ${casesCount > 0 ? `${casesCount} Casos` : 'EOPA'}
                  </span>
                </div>
                <div style="font-size:0.74rem;color:var(--text-muted);margin-top:0.25rem;display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
                  <span>📅 <strong>${f.created_at}</strong></span>
                  <span>·</span>
                  <span>📦 ${f.size_kb} KB</span>
                  <span>·</span>
                  <span style="font-family:var(--font-mono, monospace);font-size:0.7rem;color:var(--text-secondary);" title="${f.filename}">${f.filename}</span>
                </div>
              </div>

              <!-- Acciones Principales -->
              <div style="display:flex;gap:0.45rem;flex-shrink:0;align-items:center;">
                <button class="btn-ghost" id="btnToggleCases_${f.filename}" style="padding:0.42rem 0.65rem;font-size:0.75rem;border-radius:var(--radius-sm);display:inline-flex;align-items:center;gap:0.3rem;"
                  onclick="toggleMatrixCases('${f.filename}')" title="Ver / Ocultar casos de prueba técnicos">
                  ${isExpanded
                    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M18 15l-6-6-6 6"/></svg> Ocultar Casos`
                    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M6 9l6 6 6-6"/></svg> Ver Casos`
                  }
                </button>

                <button class="btn-ghost" style="padding:0.42rem 0.75rem;font-size:0.75rem;border-radius:var(--radius-sm);display:inline-flex;align-items:center;gap:0.3rem;"
                  onclick="goToExecution('${f.module}')" title="Ir a ejecutar las pruebas de esta matriz">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                  </svg>
                  Ejecutar
                </button>

                <button class="btn-primary" style="padding:0.42rem 0.95rem;font-size:0.75rem;font-weight:700;border-radius:var(--radius-sm);display:inline-flex;align-items:center;gap:0.35rem;"
                  onclick="downloadSpecificExcel('${f.filename}')" title="Descargar archivo Excel oficial EOPA DTR029C">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  Descargar Excel
                </button>

                <button onclick="deleteExcel('${f.filename}')" title="Eliminar archivo y sus casos de prueba en cascada"
                  style="padding:0.42rem 0.55rem;font-size:0.75rem;background:rgba(239,68,68,0.08);color:var(--accent-danger);
                    border:1px solid rgba(239,68,68,0.25);border-radius:var(--radius-sm);cursor:pointer;transition:var(--transition);"
                  onmouseenter="this.style.background='rgba(239,68,68,0.2)'" onmouseleave="this.style.background='rgba(239,68,68,0.08)'">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
                  </svg>
                </button>
              </div>
            </div>

            <!-- Desglose de Casos de Prueba con Scroll Independiente por Matriz -->
            <div id="matrixCases_${f.filename}" class="matrix-cases-scroll-wrap" style="
              display: ${isExpanded ? 'flex' : 'none'};
              flex-direction: column;
              gap: 0.65rem;
              margin-top: 0.45rem;
              padding: 0.5rem 0.6rem 0.5rem 0.2rem;
              border-top: 1px dashed var(--border-subtle);
              max-height: 480px;
              overflow-y: auto;
              overflow-x: hidden;
            ">
              ${matchedCases.length > 0 ? `
                <!-- Barra superior fija con contador y guía de scroll -->
                <div style="
                  display:flex;align-items:center;justify-content:space-between;
                  padding:0.4rem 0.7rem;
                  background:var(--bg-card);
                  border:1px solid rgba(0,156,166,0.25);
                  border-radius:var(--radius-sm);
                  font-size:0.73rem;
                  color:var(--text-secondary);
                  position:sticky;top:0;z-index:4;
                  box-shadow:0 2px 6px rgba(0,0,0,0.18);
                ">
                  <span style="display:flex;align-items:center;gap:0.4rem;">
                    <strong style="color:var(--accent-primary);">${matchedCases.length} Casos Técnicos</strong>
                    <span>en esta matriz</span>
                  </span>
                  <span style="font-size:0.69rem;color:var(--text-muted);display:flex;align-items:center;gap:0.25rem;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
                    Scroll interno en la matriz
                  </span>
                </div>
              ` : ''}
              ${matchedCases.length > 0 ? matchedCases.map((tc, cIdx) => {
                const sevStyle = severityColors[tc.severity] || severityColors["Tolerable"];
                let steps = [];
                try {
                  steps = Array.isArray(tc.steps) ? tc.steps : (typeof tc.steps === 'string' && tc.steps.startsWith('[') ? JSON.parse(tc.steps) : [tc.steps]);
                } catch (_) {
                  steps = [tc.steps];
                }

                return `
                  <div class="test-preview-card" style="
                    background:var(--bg-input);border:1px solid var(--border-subtle);
                    border-radius:var(--radius-sm);padding:0.75rem 0.85rem;
                    display:flex;flex-direction:column;gap:0.45rem;
                  ">
                    <!-- Encabezado del caso: ID, tipo, técnica y severidad -->
                    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.4rem;">
                      <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
                        <span style="font-family:var(--font-mono, monospace);font-weight:700;font-size:0.76rem;color:var(--accent-primary);background:rgba(0,156,166,0.12);padding:0.18rem 0.45rem;border-radius:var(--radius-sm);border:1px solid rgba(0,156,166,0.25);">
                          ${tc.case_id || `TC-${cIdx+1}`}
                        </span>
                        <span class="tc-tag tag-type" style="font-size:0.66rem;padding:0.16rem 0.45rem;">
                          ${tc.test_type}
                        </span>
                        ${tc.technique ? `
                          <span style="font-size:0.66rem;padding:0.16rem 0.5rem;border-radius:9999px;background:rgba(14,165,233,0.1);color:#0ea5e9;border:1px solid rgba(14,165,233,0.25);font-weight:600;">
                            🎯 ${tc.technique}
                          </span>
                        ` : ''}
                        <span style="font-size:0.66rem;padding:0.16rem 0.45rem;border-radius:var(--radius-sm);font-weight:700;background:${sevStyle.bg};color:${sevStyle.color};border:1px solid ${sevStyle.border};">
                          ${tc.severity || 'Tolerable'}
                        </span>
                      </div>

                      <button type="button" class="btn-ghost" onclick="copyIndividualCaseGherkin('${encodeURIComponent(JSON.stringify(tc))}')" title="Copiar como escenario BDD (Gherkin)"
                        style="padding:0.2rem 0.5rem;font-size:0.7rem;display:inline-flex;align-items:center;gap:0.25rem;">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                        Gherkin
                      </button>
                    </div>

                    <!-- Título -->
                    <div style="font-weight:600;font-size:0.82rem;color:var(--text-primary);line-height:1.35;">
                      ${tc.title}
                    </div>

                    <!-- Precondición -->
                    ${tc.preconditions ? `
                      <div style="font-size:0.72rem;color:var(--text-secondary);background:var(--bg-panel);padding:0.35rem 0.55rem;border-radius:var(--radius-sm);border-left:3px solid var(--accent-primary);">
                        <strong style="color:var(--accent-primary);">🔑 Precondición:</strong> ${tc.preconditions}
                      </div>
                    ` : ''}

                    <!-- Pasos -->
                    ${steps && steps.length > 0 ? `
                      <div style="font-size:0.72rem;color:var(--text-secondary);background:var(--bg-panel);padding:0.35rem 0.55rem;border-radius:var(--radius-sm);">
                        <strong style="color:var(--text-primary);display:block;margin-bottom:0.15rem;">📋 Pasos de Ejecución:</strong>
                        <ol style="margin:0;padding-left:1.1rem;display:flex;flex-direction:column;gap:0.12rem;">
                          ${steps.map(s => `<li>${String(s).replace(/^\d+\.\s*/, '')}</li>`).join('')}
                        </ol>
                      </div>
                    ` : ''}

                    <!-- Resultado Esperado -->
                    <div style="font-size:0.72rem;color:var(--text-primary);background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.25);border-radius:var(--radius-sm);padding:0.4rem 0.6rem;">
                      <strong style="color:#10b981;">✓ Resultado Esperado:</strong> ${tc.expected_result}
                    </div>
                  </div>
                `;
              }).join('') : `
                <div style="font-size:0.75rem;color:var(--text-muted);padding:0.5rem;text-align:center;">
                  Descarga el archivo Excel para inspeccionar los casos completos de esta matriz histórica.
                </div>
              `}
            </div>
          </div>
        `}).join('')}
      </div>
    `;

    _autoExpandedMatrixFile = null;

  } catch (e) {
    console.error('Error cargando historial de archivos Excel:', e);
    container.innerHTML = `<div class="empty-state"><p>Error al cargar historial: ${e.message}</p></div>`;
  }
}

function copyIndividualCaseGherkin(rawJson) {
  try {
    const tc = JSON.parse(decodeURIComponent(rawJson));
    let steps = [];
    try {
      steps = Array.isArray(tc.steps) ? tc.steps : (typeof tc.steps === 'string' && tc.steps.startsWith('[') ? JSON.parse(tc.steps) : [tc.steps]);
    } catch (_) {
      steps = [tc.steps];
    }
    const stepsGherkin = steps.length > 0
      ? steps.map(s => `    And ${String(s).replace(/^\d+\.\s*/, '')}`).join('\n')
      : `    When el usuario ejecuta la acción "${tc.title}"`;

    const gherkin = [
      `@test-${(tc.case_id || 'tc').toLowerCase()} @severity-${(tc.severity || 'tolerable').toLowerCase()}`,
      `Scenario: ${tc.case_id} - ${tc.title.slice(0, 70)}`,
      `  Given ${tc.preconditions || 'el sistema se encuentra en estado operativo'}`,
      `  When el tester procede con la prueba:`,
      stepsGherkin,
      `  Then ${tc.expected_result}`
    ].join('\n');

    navigator.clipboard.writeText(gherkin).then(() => {
      showToast(`📋 Escenario Gherkin copiado al portapapeles (${tc.case_id})`, 'success');
    }).catch(() => {
      showToast('Error al copiar al portapapeles', 'error');
    });
  } catch (e) {
    showToast('Error al procesar caso de prueba', 'error');
  }
}

async function deleteExcel(filename) {
  if (!confirm(`¿Eliminar "${filename}"?\n\nEsto también eliminará los casos de prueba generados en esa sesión y sus registros de ejecución. Esta acción no se puede deshacer.`)) return;
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
    showToast(`Matriz eliminada exitosamente${casesMsg}`, 'success');
    _execAllCasesCache = [];
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
  const btn = document.getElementById('testTypesBtn');
  if (!dropdown || !btn) return;

  const isHidden = dropdown.classList.contains('hidden');

  if (isHidden) {
    // Posicionar el dropdown con posicion fija para que no sea cortado por overflow
    const rect = btn.getBoundingClientRect();
    dropdown.style.position = 'fixed';
    dropdown.style.top = (rect.bottom + 4) + 'px';
    dropdown.style.left = rect.left + 'px';
    dropdown.style.width = rect.width + 'px';
    dropdown.style.zIndex = '9999';
    dropdown.classList.remove('hidden');
  } else {
    dropdown.classList.add('hidden');
  }
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
  const chipsContainer = document.getElementById('selectedTestTypeChips');
  if (dropdown && !dropdown.classList.contains('hidden')) {
    const clickedInsideBtn = select && select.contains(e.target);
    const clickedInsideDropdown = dropdown.contains(e.target);
    const clickedInsideChips = chipsContainer && chipsContainer.contains(e.target);
    if (!clickedInsideBtn && !clickedInsideDropdown && !clickedInsideChips) {
      dropdown.classList.add('hidden');
    }
  }
});

// Actualizar posicion del dropdown al hacer scroll o resize
window.addEventListener('scroll', function() {
  const dropdown = document.getElementById('testTypesDropdown');
  if (dropdown && !dropdown.classList.contains('hidden')) {
    const btn = document.getElementById('testTypesBtn');
    if (btn) {
      const rect = btn.getBoundingClientRect();
      dropdown.style.top = (rect.bottom + 4) + 'px';
      dropdown.style.left = rect.left + 'px';
    }
  }
}, true);

window.addEventListener('resize', function() {
  const dropdown = document.getElementById('testTypesDropdown');
  if (dropdown && !dropdown.classList.contains('hidden')) {
    dropdown.classList.add('hidden');
  }
});

// ══════════════════════════════════════════════════════════════
// MÓDULO 2 — GENERADOR DE CASOS DE PRUEBA (ISTQB & EOPA)
// ══════════════════════════════════════════════════════════════
let _lastGeneratedTestCases = [];

function switchGenTab(tabName) {
  const btnConfig = document.getElementById('genTabBtnConfig');
  const btnResults = document.getElementById('genTabBtnResults');
  const viewConfig = document.getElementById('genTabContentConfig');
  const viewResults = document.getElementById('genTabContentResults');

  if (tabName === 'config') {
    if (btnConfig) btnConfig.classList.add('active');
    if (btnResults) btnResults.classList.remove('active');
    if (viewConfig) viewConfig.style.display = 'block';
    if (viewResults) viewResults.style.display = 'none';
  } else {
    if (btnResults) btnResults.classList.add('active');
    if (btnConfig) btnConfig.classList.remove('active');
    if (viewConfig) viewConfig.style.display = 'none';
    if (viewResults) viewResults.style.display = 'block';
  }
}
window.switchGenTab = switchGenTab;

function renderGeneratedTestCasesPreview(cases) {
  const container = document.getElementById('genPreviewContainer');
  const badge = document.getElementById('previewCountBadge');
  if (!container) return;

  _lastGeneratedTestCases = cases || [];
  if (badge) badge.textContent = _lastGeneratedTestCases.length;

  if (!_lastGeneratedTestCases || _lastGeneratedTestCases.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" width="48" height="48">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
        </svg>
        <p>Sin casos generados</p>
        <span>Genera casos de prueba para visualizar el desglose técnico en esta pestaña</span>
      </div>
    `;
    return;
  }

  const severityColors = {
    "Bloqueante": { bg: "rgba(239,68,68,0.12)", color: "#ef4444", border: "rgba(239,68,68,0.3)" },
    "Crítico": { bg: "rgba(249,115,22,0.12)", color: "#f97316", border: "rgba(249,115,22,0.3)" },
    "Tolerable": { bg: "rgba(59,130,246,0.12)", color: "#3b82f6", border: "rgba(59,130,246,0.3)" },
    "Interfaz de usuario": { bg: "rgba(168,85,247,0.12)", color: "#a855f7", border: "rgba(168,85,247,0.3)" }
  };

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:0.75rem;width:100%;">
      ${_lastGeneratedTestCases.map((tc, idx) => {
        const sevStyle = severityColors[tc.severity] || severityColors["Tolerable"];
        const steps = Array.isArray(tc.steps) ? tc.steps : (typeof tc.steps === 'string' && tc.steps.startsWith('[') ? JSON.parse(tc.steps) : []);
        
        return `
          <div class="test-preview-card" style="
            background:var(--bg-card);border:1px solid var(--border-subtle);
            border-radius:var(--radius-md);padding:0.9rem 1rem;
            display:flex;flex-direction:column;gap:0.55rem;
            transition:var(--transition);
          " onmouseenter="this.style.borderColor='var(--border-accent)'" onmouseleave="this.style.borderColor='var(--border-subtle)'">
            
            <!-- Encabezado del caso: ID, tipo, técnica y severidad -->
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.4rem;">
              <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
                <span style="font-family:var(--font-mono, monospace);font-weight:700;font-size:0.78rem;color:var(--accent-primary);background:rgba(0,156,166,0.1);padding:0.2rem 0.5rem;border-radius:var(--radius-sm);border:1px solid rgba(0,156,166,0.25);">
                  ${tc.case_id || `TC-${idx+1}`}
                </span>
                <span class="tc-tag tag-type" style="font-size:0.68rem;padding:0.18rem 0.45rem;">
                  ${tc.test_type}
                </span>
                ${tc.technique ? `
                  <span style="font-size:0.68rem;padding:0.18rem 0.5rem;border-radius:9999px;background:rgba(14,165,233,0.1);color:#0ea5e9;border:1px solid rgba(14,165,233,0.25);font-weight:600;">
                    🎯 ${tc.technique}
                  </span>
                ` : ''}
                <span style="font-size:0.68rem;padding:0.18rem 0.45rem;border-radius:var(--radius-sm);font-weight:700;background:${sevStyle.bg};color:${sevStyle.color};border:1px solid ${sevStyle.border};">
                  ${tc.severity || 'Tolerable'}
                </span>
              </div>

              <!-- Acciones: Copiar Gherkin -->
              <div style="display:flex;gap:0.35rem;">
                <button type="button" class="btn-ghost" onclick="copyTestCaseGherkin('${tc.case_id}')" title="Copiar como escenario BDD (Gherkin)"
                  style="padding:0.25rem 0.55rem;font-size:0.72rem;display:inline-flex;align-items:center;gap:0.3rem;">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                  Gherkin
                </button>
              </div>
            </div>

            <!-- Título / Acción -->
            <div style="font-weight:600;font-size:0.84rem;color:var(--text-primary);line-height:1.4;">
              ${tc.title}
            </div>

            <!-- Precondiciones si existen -->
            ${tc.preconditions ? `
              <div style="font-size:0.74rem;color:var(--text-secondary);background:var(--bg-input);padding:0.4rem 0.6rem;border-radius:var(--radius-sm);border-left:3px solid var(--accent-primary);">
                <strong style="color:var(--accent-primary);">🔑 Precondición:</strong> ${tc.preconditions}
              </div>
            ` : ''}

            <!-- Pasos numerados si existen -->
            ${steps && steps.length > 0 ? `
              <div style="font-size:0.73rem;color:var(--text-secondary);background:var(--bg-input);padding:0.4rem 0.6rem;border-radius:var(--radius-sm);">
                <strong style="color:var(--text-primary);display:block;margin-bottom:0.2rem;">📋 Pasos de Ejecución:</strong>
                <ol style="margin:0;padding-left:1.1rem;display:flex;flex-direction:column;gap:0.15rem;">
                  ${steps.map(s => `<li>${s.replace(/^\d+\.\s*/, '')}</li>`).join('')}
                </ol>
              </div>
            ` : ''}

            <!-- Resultado esperado -->
            <div style="font-size:0.74rem;color:var(--text-primary);background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.25);border-radius:var(--radius-sm);padding:0.45rem 0.65rem;">
              <strong style="color:#10b981;">✓ Resultado Esperado:</strong> ${tc.expected_result}
            </div>

          </div>
        `;
      }).join('')}
    </div>
  `;
}

function copyTestCaseGherkin(caseId) {
  const tc = _lastGeneratedTestCases.find(c => c.case_id === caseId);
  if (!tc) return;

  const steps = Array.isArray(tc.steps) ? tc.steps : (typeof tc.steps === 'string' && tc.steps.startsWith('[') ? JSON.parse(tc.steps) : []);
  const stepsGherkin = steps.length > 0
    ? steps.map(s => `    And ${s.replace(/^\d+\.\s*/, '')}`).join('\n')
    : `    When el usuario ejecuta la acción "${tc.title}"`;

  const gherkin = [
    `@test-${tc.case_id.toLowerCase()} @severity-${(tc.severity || 'tolerable').toLowerCase()}`,
    `Scenario: ${tc.case_id} - ${tc.title.slice(0, 70)}`,
    `  Given ${tc.preconditions || 'el sistema se encuentra en estado operativo'}`,
    `  When el tester procede con la prueba:`,
    stepsGherkin,
    `  Then ${tc.expected_result}`
  ].join('\n');

  navigator.clipboard.writeText(gherkin).then(() => {
    showToast(`📋 Escenario Gherkin copiado al portapapeles (${tc.case_id})`, 'success');
  }).catch(() => {
    showToast('Error al copiar al portapapeles', 'error');
  });
}

// AbortController para cancelar generacion en curso
let _generateAbortController = null;

async function generateTestCases() {
  const btn = document.getElementById('generateBtn');
  const loading = document.getElementById('generatorLoading');

  const reqInput = document.getElementById('promptInput') || document.getElementById('requirementText');
  const requirementText = reqInput ? reqInput.value.trim() : '';
  if (!requirementText && generatorSelectedDocIds.length === 0) {
    showToast('Por favor ingresa el requerimiento o selecciona al menos un documento de referencia.', 'error');
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

  // Mostrar boton Cancelar
  const cancelBtn = document.getElementById('generateCancelBtn');
  if (cancelBtn) cancelBtn.classList.remove('hidden');

  // Crear AbortController para poder cancelar el fetch en cualquier momento
  _generateAbortController = new AbortController();
  const { signal } = _generateAbortController;

  // ── Contador de tiempo en vivo + mensajes de estado ──────────────
  const _genStartTime = Date.now();
  const _genStatuses = [
    'Consultando base de conocimiento...',
    'Analizando requerimiento con IA...',
    'Generando casos de prueba EOPA...',
    'Estructurando la matriz de resultados...',
    'Finalizando y exportando a Excel...'
  ];
  let _genStatusIdx = 0;
  const _genStatusEl = loading.querySelector('p');
  const _genTimeEl = loading.querySelector('span');
  const _genTimerInterval = setInterval(() => {
    const elapsedSec = Math.round((Date.now() - _genStartTime) / 1000);
    if (_genTimeEl) _genTimeEl.textContent = `⏱ ${elapsedSec}s transcurridos...`;
    if (_genStatusEl && _genStatusIdx < _genStatuses.length - 1 && elapsedSec % 8 === 0 && elapsedSec > 0) {
      _genStatusIdx++;
      _genStatusEl.textContent = _genStatuses[_genStatusIdx];
    }
  }, 1000);

  try {
    // Asegurar que el input de proyecto y currentProject coincidan
    const effectiveProject = currentProject || 'General';
    const projInput = document.getElementById('projectName');
    if (projInput) projInput.value = effectiveProject;

    const response = await fetch(`${API_BASE}/api/test-cases/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        requirement_text: requirementText,
        project_name: effectiveProject,
        module: (document.getElementById('moduleName')?.value || '').trim() || 'General',
        test_types: testTypes,
        num_cases: numCases,
        selected_doc_ids: generatorSelectedDocIds,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || 'Error generando casos de prueba');
    }

    // Refrescar el listado de matrices generadas (que incluye los casos técnicos detallados)
    await loadTestCasesForGenerator();

    // Cambiar automáticamente a la pestaña de matrices y casos generados
    switchGenTab('results');

    const totalSec = Math.round((Date.now() - _genStartTime) / 1000);
    showToast(`✅ ${data.total || numCases} casos generados en ${totalSec}s — ${data.excel_filename || 'Excel listo'}`, 'success');

    // Descarga automática del Excel recién generado
    if (data.excel_filename) {
      downloadSpecificExcel(data.excel_filename);
    }

  } catch (e) {
    if (e.name === 'AbortError') {
      showToast('Generación cancelada.', 'warning');
    } else {
      showToast(e.message, 'error');
      const container = document.getElementById('genPreviewContainer');
      if (container) {
        container.innerHTML = `
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40" style="color:var(--accent-danger)">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <p>Error al generar</p>
            <span>${e.message}</span>
          </div>
        `;
      }
    }
  } finally {
    clearInterval(_genTimerInterval);
    loading.classList.add('hidden');
    btn.disabled = false;
    _generateAbortController = null;
    const cancelBtn = document.getElementById('generateCancelBtn');
    if (cancelBtn) cancelBtn.classList.add('hidden');
    if (_genStatusEl) _genStatusEl.textContent = 'Consultando base de conocimiento y generando casos de prueba...';
    if (_genTimeEl) _genTimeEl.textContent = 'Esto puede tardar entre 20 y 45 segundos según el modelo';
  }
}

function cancelGeneration() {
  if (_generateAbortController) {
    _generateAbortController.abort();
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
  const kpiRow = document.getElementById('execKpiRow');
  const subtitle = document.getElementById('execSubtitle');
  if (!matrixGrid) return;

  // Asegurar que la vista de lista es visible
  showExecMatrixListView();

  let url = `${API_BASE}/api/test-cases?project_name=${encodeURIComponent(currentProject)}`;

  try {
    const res = await fetch(url);
    const cases = await res.json();

    if (!cases || cases.length === 0) {
      if (kpiRow) kpiRow.style.display = 'none';
      if (subtitle) subtitle.style.display = 'none';
      matrixGrid.style.display = 'block';

      matrixGrid.innerHTML = `
        <div class="exec-empty-card" style="
          max-width: 580px;
          margin: 2.5rem auto 3rem;
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          padding: 2.6rem 2.2rem;
          text-align: center;
          box-shadow: 0 12px 36px rgba(0,0,0,0.35);
          display: flex;
          flex-direction: column;
          align-items: center;
          position: relative;
          overflow: hidden;
        ">
          <!-- Brillo superior ambiental -->
          <div style="position:absolute;top:0;left:50%;transform:translateX(-50%);width:260px;height:2px;background:linear-gradient(90deg, transparent, var(--accent-primary), transparent);"></div>

          <div style="
            width: 66px; height: 66px; border-radius: 18px;
            background: rgba(0, 156, 166, 0.12);
            color: var(--accent-primary);
            border: 1px solid rgba(0, 156, 166, 0.35);
            display: flex; align-items: center; justify-content: center;
            margin-bottom: 1.25rem;
            box-shadow: 0 0 24px rgba(0, 156, 166, 0.16);
          ">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="30" height="30">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="9" y1="15" x2="15" y2="15"/>
            </svg>
          </div>

          <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--text-primary); margin: 0 0 0.45rem;">
            No hay matrices de prueba disponibles para ejecutar
          </h3>

          <p style="font-size: 0.83rem; color: var(--text-secondary); max-width: 440px; line-height: 1.55; margin: 0 0 1.6rem;">
            Para registrar resultados técnicos (<span style="color:#10b981;font-weight:600;">CUMPLE</span> / <span style="color:#ef4444;font-weight:600;">NO CUMPLE</span>) y cronometrar las pruebas, genera primero tu matriz en el módulo de casos.
          </p>

          <!-- Flujo guiado en 3 pasos -->
          <div style="
            display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.75rem;
            width: 100%; max-width: 510px; margin-bottom: 1.8rem; text-align: left;
          ">
            <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 0.75rem 0.8rem;">
              <div style="font-size: 0.68rem; font-weight: 700; color: var(--accent-primary); margin-bottom: 0.2rem;">PASO 1</div>
              <div style="font-size: 0.76rem; font-weight: 600; color: var(--text-primary);">Documentos</div>
              <div style="font-size: 0.68rem; color: var(--text-muted); margin-top: 0.2rem;">Carga requerimientos en Base de Conocimiento.</div>
            </div>
            <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 0.75rem 0.8rem;">
              <div style="font-size: 0.68rem; font-weight: 700; color: var(--accent-primary); margin-bottom: 0.2rem;">PASO 2</div>
              <div style="font-size: 0.76rem; font-weight: 600; color: var(--text-primary);">Generar Casos</div>
              <div style="font-size: 0.68rem; color: var(--text-muted); margin-top: 0.2rem;">La IA crea la matriz técnica en formato EOPA.</div>
            </div>
            <div style="background: rgba(0,156,166,0.06); border: 1px solid rgba(0,156,166,0.3); border-radius: var(--radius-sm); padding: 0.75rem 0.8rem;">
              <div style="font-size: 0.68rem; font-weight: 700; color: var(--accent-primary); margin-bottom: 0.2rem;">PASO 3</div>
              <div style="font-size: 0.76rem; font-weight: 600; color: var(--text-primary);">Ejecutar Aquí</div>
              <div style="font-size: 0.68rem; color: var(--text-muted); margin-top: 0.2rem;">Registra CUMPLE, defectos y métricas.</div>
            </div>
          </div>

          <div style="display: flex; gap: 0.85rem; justify-content: center; align-items: center; flex-wrap: wrap;">
            <button class="btn-primary" onclick="switchModule('generate')" style="padding: 0.62rem 1.35rem; font-size: 0.82rem; font-weight: 700; display: inline-flex; align-items: center; gap: 0.45rem; box-shadow: 0 4px 14px rgba(0,156,166,0.25);">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
              Ir a Generar Casos con IA
            </button>
            <button class="btn-ghost" onclick="loadTestCasesForExecution()" style="padding: 0.62rem 1.05rem; font-size: 0.80rem; display: inline-flex; align-items: center; gap: 0.4rem;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
              Actualizar
            </button>
          </div>
        </div>
      `;
      return;
    }

    // Cuando sí existen casos:
    if (kpiRow) kpiRow.style.display = 'flex';
    if (subtitle) subtitle.style.display = 'block';
    matrixGrid.style.display = 'grid';

    // Actualizar KPIs globales
    updateExecGlobalKpis(cases || []);

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
    const sessionKey = tc.export_file
      ? `${tc.module}|||${tc.export_file}`
      : `${tc.module}|||${(tc.created_at || '').slice(0, 16)}`;
    if (!groups[sessionKey]) groups[sessionKey] = { module: tc.module, created_at: tc.created_at, export_file: tc.export_file, cases: [], sessionKey };
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

        <!-- Acciones: Eliminar matriz y Flecha indicadora -->
        <div style="display:flex;align-items:center;gap:0.4rem;flex-shrink:0;">
          <button class="btn-icon" style="color:var(--accent-danger);padding:0.38rem 0.55rem;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);border-radius:6px;cursor:pointer;transition:var(--transition);"
            onclick="event.stopPropagation(); deleteExecMatrix('${encodeURIComponent(group.module)}', '${encodeURIComponent(group.created_at || '')}')"
            title="Eliminar esta matriz y todas sus ejecuciones">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
            </svg>
          </button>
          <div class="exec-matrix-card-arrow">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function deleteExecMatrix(encodedModule, encodedCreatedAt) {
  const mod = decodeURIComponent(encodedModule);
  const cr = decodeURIComponent(encodedCreatedAt || '');
  if (!confirm(`¿Eliminar la matriz "${mod}" y todas sus pruebas ejecutadas?\n\nEsta acción eliminará los casos de prueba de la base de datos, el historial de ejecuciones y su archivo Excel asociado. Esta acción no se puede deshacer.`)) return;

  try {
    const res = await fetch(`${API_BASE}/api/test-cases/matrix/delete?project_name=${encodeURIComponent(currentProject)}&module=${encodeURIComponent(mod)}&created_at=${encodeURIComponent(cr)}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const err = await res.json();
      showToast(err.detail || 'Error al eliminar matriz', 'error');
      return;
    }
    const result = await res.json();
    showToast(`Matriz eliminada exitosamente (${result.db_cases_deleted} casos)`, 'success');
    _execAllCasesCache = [];
    loadTestCasesForExecution();
    loadTestCasesForGenerator();
  } catch (e) {
    showToast('Error al eliminar matriz: ' + e.message, 'error');
  }
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
  const [module, fileOrDate] = sessionKey.split('|||');
  const groupCases = _execAllCasesCache.filter(tc =>
    tc.module === module && (
      (tc.export_file && tc.export_file === fileOrDate) ||
      (tc.created_at || '').slice(0, 16) === fileOrDate
    )
  );

  _execCurrentGroup = { module, created_at: fileOrDate, cases: groupCases, sessionKey };

  // Actualizar título y meta
  const titleEl = document.getElementById('execDetailTitle');
  const metaEl = document.getElementById('execDetailMeta');
  if (titleEl) titleEl.textContent = `📋 ${module}`;
  if (metaEl) {
    let cleanDate = fileOrDate;
    try {
      const iso = (typeof fileOrDate === 'string' && !fileOrDate.endsWith('Z') && !fileOrDate.includes('+')) ? fileOrDate + 'Z' : fileOrDate;
      cleanDate = new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
    } catch (_) {}
    metaEl.textContent = `📅 ${cleanDate} · ${groupCases.length} casos`;
  }

  // Botón de descargar resultados
  const exportBtn = document.getElementById('execDetailExportBtn');
  if (exportBtn) {
    exportBtn.onclick = () => exportGroupResults(module, fileOrDate);
  }

  // Renderizar casos
  renderExecDetailCases(groupCases);
  updateExecDetailKpis(groupCases);

  // Restablecer la selección del cronómetro al cambiar de matriz
  _timerSelectedCaseId = null;
  const displayEl = document.getElementById('timerSelectedCaseDisplay');
  const textEl = document.getElementById('timerSelectedCaseText');
  if (displayEl) displayEl.style.borderColor = 'rgba(0,156,166,0.25)';
  if (textEl) { textEl.style.color = 'var(--text-muted)'; textEl.innerHTML = '<span style="color:var(--text-muted);font-size:0.72rem;">Haz clic en una fila o en el botón ⏱ para seleccionarlo</span>'; }

  // Cargar estadísticas del cronómetro para el mini panel
  if (typeof loadTimerStats === 'function') loadTimerStats();

  // Mostrar la vista de detalle
  showExecDetailView();
}

function handleExecRowClick(event, tcId) {
  // Si el clic fue en un botón, enlace o input, no ejecutar la selección por fila
  if (event.target.closest('button') || event.target.closest('a') || event.target.closest('input') || event.target.closest('select')) {
    return;
  }
  selectCaseForTimer(tcId);
}
window.handleExecRowClick = handleExecRowClick;

function renderExecDetailCases(cases) {
  const container = document.getElementById('execDetailCasesList');
  if (!container) return;

  if (!cases || cases.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No hay casos en esta matriz.</p></div>';
    return;
  }

  // Almacenar los casos en un mapa global por db_id para acceso seguro sin pasar JSON por atributos
  window._execCasesMap = window._execCasesMap || {};
  cases.forEach(tc => { window._execCasesMap[tc.db_id] = tc; });

  const rows = cases.map(tc => {
    const isPending = !tc.result || tc.status === 'Pendiente';
    const isCumple = tc.result === 'CUMPLE';
    const badgeCls = isPending ? 'status-pending' : isCumple ? 'status-cumple' : 'status-nocumple';
    const badgeLbl = isPending ? 'Pendiente' : tc.result;
    const isTimerSelected = tc.db_id === _timerSelectedCaseId;

    return `
      <tr class="exec-table-row ${isTimerSelected ? 'timer-row-selected' : ''}" id="exec-row-${tc.db_id}" data-tc-id="${tc.db_id}"
          onclick="handleExecRowClick(event, '${tc.db_id}')" style="cursor:pointer;">
        <td class="exec-td exec-td-id">
          <span class="exec-case-id" onclick="openCaseDetailFromId('${tc.db_id}')" title="Ver detalles y precondiciones">${tc.case_id}</span>
        </td>
        <td class="exec-td exec-td-title">
          <div class="exec-title-cell" onclick="openCaseDetailFromId('${tc.db_id}')" title="Haz clic para previsualizar detalles completos de este caso">${tc.title}</div>
        </td>
        <td class="exec-td">
          <span class="tc-tag tag-type">${tc.test_type}</span>
        </td>
        <td class="exec-td exec-td-status">
          <span class="exec-status ${badgeCls}">${badgeLbl}</span>
        </td>
        <td class="exec-td exec-td-actions" style="text-align:right;">
          <div class="exec-actions-bar">
            <button type="button" class="exec-action-icon-btn btn-preview" onclick="openCaseDetailFromId('${tc.db_id}')" title="👁 Ver detalles completos del caso">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
            </button>
            <button type="button" class="exec-action-icon-btn btn-edit" onclick="openEditFromId('${tc.db_id}')" title="✏️ Editar caso de prueba">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button type="button" class="exec-btn-timer-pill ${isTimerSelected ? 'active' : ''}" id="timer-btn-${tc.db_id}" onclick="selectCaseForTimer('${tc.db_id}')" title="Seleccionar para cronómetro y ejecución">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              <span id="timer-btn-text-${tc.db_id}">${isTimerSelected ? 'En Cronómetro' : 'Cronometrar'}</span>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <table class="exec-table">
      <thead>
        <tr>
          <th class="exec-th" style="width:110px;">ID</th>
          <th class="exec-th">Caso de Prueba</th>
          <th class="exec-th" style="width:110px;">Tipo</th>
          <th class="exec-th" style="width:100px;">Estado</th>
          <th class="exec-th" style="width:170px;text-align:right;">Acciones</th>
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

  // Si proviene del cronómetro activo
  if (_timerSessionId) {
    try {
      const res = await fetch(`${API_BASE}/api/timer/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: _timerSessionId,
          result: selectedResult,
          notes: notes || '',
        })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Error al registrar fin del cronómetro');
      }

      _resetTimerUI();

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
  const progressBox = document.getElementById('docUploadProgressContainer');

  zone.style.borderColor = 'var(--accent-primary)';
  activeIndexingFile = file.name;

  showToast(`🚀 Subiendo "${file.name}"...`, 'info');

  // Mostrar el indicador de carga en el contenedor dedicado superior SIN tocar la tabla de documentos existentes
  if (progressBox) {
    progressBox.classList.remove('hidden');
    progressBox.style.display = 'block';
    progressBox.innerHTML = `
      <div style="
        background: rgba(0, 156, 166, 0.08);
        border: 1.5px dashed var(--accent-primary);
        border-radius: var(--radius-md);
        padding: 1.1rem 1.3rem;
        display: flex;
        align-items: center;
        gap: 1.1rem;
        box-shadow: 0 4px 12px rgba(0,0,0,0.12);
        animation: pulseBorder 2s infinite ease-in-out;
      ">
        <div style="
          width: 32px; height: 32px;
          border: 3px solid rgba(0, 156, 166, 0.2);
          border-top-color: var(--accent-primary);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
          flex-shrink: 0;
        "></div>
        <div style="flex:1;">
          <div style="font-weight: 700; font-size: 0.92rem; color: var(--text-primary); display: flex; align-items: center; gap: 0.5rem;">
            <span>⚡ Indexando documento en la IA:</span>
            <strong style="color: var(--accent-primary);">${file.name}</strong>
          </div>
          <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.25rem;">
            Extrayendo contenido, fragmentando en bloques y generando embeddings vectoriales en ChromaDB... Por favor espera un momento.
          </div>
        </div>
      </div>
    `;
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
    if (progressBox) {
      progressBox.classList.add('hidden');
      progressBox.style.display = 'none';
      progressBox.innerHTML = '';
    }
    loadDocuments();
  } finally {
    zone.style.borderColor = '';
    document.getElementById('fileInput').value = '';
  }
}

async function pollIndexingCompletion(filename) {
  let attempts = 0;
  const maxAttempts = 25;

  const interval = setInterval(async () => {
    attempts++;
    try {
      const res = await fetch(`${API_BASE}/api/documents?project=${encodeURIComponent(currentProject)}`);
      const docs = await res.json();

      const doc = docs.find(d => d.filename === filename && d.chunks > 0);
      if (doc) {
        clearInterval(interval);
        activeIndexingFile = null;
        const progressBox = document.getElementById('docUploadProgressContainer');
        if (progressBox) {
          progressBox.classList.add('hidden');
          progressBox.style.display = 'none';
          progressBox.innerHTML = '';
        }
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
      const progressBox = document.getElementById('docUploadProgressContainer');
      if (progressBox) {
        progressBox.classList.add('hidden');
        progressBox.style.display = 'none';
        progressBox.innerHTML = '';
      }
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
      return;
    }

    grid.innerHTML = docs.map(doc => {
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
  // Obtener el caso: primero el seleccionado desde la tabla integrada, luego el dropdown (pestaña Historial)
  let tcId = _timerSelectedCaseId;

  // Si no hay caso seleccionado desde la tabla, intentar con el dropdown (vista Historial)
  if (!tcId) {
    const caseSelect = document.getElementById('timerCaseSelect');
    tcId = caseSelect ? caseSelect.value : '';
  }

  if (!tcId) {
    showToast('Selecciona un caso de prueba usando el botón ⏱ de la tabla para cronometrarlo.', 'error');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/timer/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        test_case_id: tcId,
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
    const cancelBtn = document.getElementById('btnTimerCancel');
    const indicator = document.getElementById('timerStateIndicator');
    const stateText = document.getElementById('timerStateText');

    if (startBtn) startBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = false;
    if (indicator) indicator.classList.add('running');
    if (stateText) stateText.textContent = 'CORRIENDO';

    // Actualizar botón del caso actual y bloquear los de las otras filas
    document.querySelectorAll('.exec-btn-timer-pill').forEach(btn => {
      const isCurrent = btn.id === ('timer-btn-' + tcId);
      const span = btn.querySelector('span');
      if (isCurrent) {
        btn.disabled = false;
        btn.classList.add('active');
        if (span) span.textContent = '⏱ Corriendo...';
      } else {
        btn.disabled = true;
        btn.classList.remove('active');
        btn.title = '⚠ Detén o cancela el cronómetro antes de cambiar de caso';
        if (span) span.textContent = 'Cronometrar';
      }
    });

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

function _resetTimerUI() {
  clearInterval(_timerInterval);
  _timerRunning = false;
  _timerSessionId = null;
  _timerSeconds = 0;

  const startBtn = document.getElementById('btnTimerStart');
  const stopBtn = document.getElementById('btnTimerStop');
  const cancelBtn = document.getElementById('btnTimerCancel');
  const indicator = document.getElementById('timerStateIndicator');
  const stateText = document.getElementById('timerStateText');
  const display = document.getElementById('timerDisplay');

  if (startBtn) startBtn.disabled = false;
  if (stopBtn) stopBtn.disabled = true;
  if (cancelBtn) cancelBtn.disabled = true;
  if (indicator) indicator.classList.remove('running');
  if (stateText) stateText.textContent = 'LISTO';
  if (display) display.textContent = '00:00.0';

  // Desbloquear todos los botones de la tabla y restaurar etiquetas
  document.querySelectorAll('.exec-btn-timer-pill').forEach(btn => {
    btn.disabled = false;
    btn.title = 'Seleccionar para cronómetro y ejecución';
    const isCurrent = btn.id === ('timer-btn-' + _timerSelectedCaseId);
    const span = btn.querySelector('span');
    if (span) {
      span.textContent = isCurrent ? 'En Cronómetro' : 'Cronometrar';
    }
  });
}

async function cancelTimer() {
  if (!_timerSessionId) return;
  if (!confirm('¿Cancelar el cronómetro? El tiempo transcurrido NO se guardará y el caso seguirá como Pendiente.')) return;

  const sessionId = _timerSessionId;
  _resetTimerUI();

  try {
    await fetch(`${API_BASE}/api/timer/cancel?session_id=${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
    showToast('🗑 Cronómetro cancelado — sin cambios guardados', 'info');
  } catch (e) {
    // ignorar error de red, ya se reseteó UI
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

  // 3. Abrir modal con el caso seleccionado y el tiempo exacto congelado
  const mins = String(Math.floor(_timerSeconds / 60)).padStart(2, '0');
  const secs = String(_timerSeconds % 60).padStart(2, '0');
  const timeNote = `⏱ Tiempo Registrado: ${mins}:${secs}.0`;

  let tc = _timerSelectedCaseId && window._execCasesMap ? window._execCasesMap[_timerSelectedCaseId] : null;
  const caseSelect = document.getElementById('timerCaseSelect');
  const selectedText = tc ? tc.title : (caseSelect && caseSelect.selectedIndex >= 0 ? caseSelect.options[caseSelect.selectedIndex].text : 'Caso de prueba');
  const caseBadge = tc ? tc.case_id : `⏱ ${mins}:${secs}.0`;

  openExecutionModal(tc ? tc.db_id : null, caseBadge, selectedText || timeNote);
}

async function loadTimerStats() {
  // IDs en el panel mini (sidebar integrado) y en la pestaña completa de Historial
  const kpiCount = document.getElementById('timerKpiCount');
  const kpiAvg = document.getElementById('timerKpiAvg');
  const kpiTotal = document.getElementById('timerKpiTotal');
  const kpiCountFull = document.getElementById('timerKpiCountFull');
  const kpiAvgFull = document.getElementById('timerKpiAvgFull');
  const kpiTotalFull = document.getElementById('timerKpiTotalFull');
  const kpiMin = document.getElementById('timerKpiMin');
  const kpiMax = document.getElementById('timerKpiMax');
  const barsContainer = document.getElementById('timerModuleBarsList');
  const typeGrid = document.getElementById('timerTypeGrid');
  const tbody = document.getElementById('timerHistoryBody');
  const miniHistory = document.getElementById('timerMiniHistory');

  try {
    const res = await fetch(`${API_BASE}/api/timer/stats?project_name=${encodeURIComponent(currentProject)}`);
    const data = await res.json();

    if (!data) return;

    // 1. KPIs — sidebar mini + pestaña historial completa
    const totalExec = data.total_executed || 0;
    const avgSec = Math.round(data.avg_seconds || 0);
    const totSec = Math.round(data.total_seconds || 0);
    const totStr = totSec >= 60 ? `${Math.floor(totSec / 60)}m ${totSec % 60}s` : `${totSec}s`;

    if (kpiCount) kpiCount.textContent = totalExec;
    if (kpiAvg) kpiAvg.textContent = `${avgSec}s`;
    if (kpiTotal) kpiTotal.textContent = totStr;
    if (kpiCountFull) kpiCountFull.textContent = totalExec;
    if (kpiAvgFull) kpiAvgFull.textContent = `${avgSec}s`;
    if (kpiTotalFull) kpiTotalFull.textContent = totStr;
    if (kpiMin) kpiMin.textContent = `${Math.round(data.min_seconds || 0)}s`;
    if (kpiMax) kpiMax.textContent = `${Math.round(data.max_seconds || 0)}s`;

    // 2. Barras por Módulo
    if (barsContainer) {
      const rfs = data.by_rf || [];
      if (rfs.length === 0) {
        barsContainer.innerHTML = `
          <div class="timer-empty-inline">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" width="22" height="22" style="opacity:0.35;margin-bottom:0.4rem;">
              <rect x="3" y="12" width="4" height="8" rx="1"/><rect x="10" y="8" width="4" height="12" rx="1"/><rect x="17" y="4" width="4" height="16" rx="1"/>
            </svg>
            <span>Sin métricas por módulo aún</span>
          </div>`;
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
        typeGrid.innerHTML = `
          <div class="timer-empty-inline" style="grid-column:1/-1;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" width="22" height="22" style="opacity:0.35;margin-bottom:0.4rem;">
              <circle cx="12" cy="12" r="9"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            <span>Sin registros por tipo aún</span>
          </div>`;
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

    // 5. Mini historial en el panel lateral integrado (últimas 5 sesiones)
    //    Filtrar al grupo activo si hay uno seleccionado
    if (miniHistory) {
      const allHistory = data.history || [];

      // Si hay un grupo (matriz) activo, mostrar solo sus casos
      let history = allHistory;
      if (_execCurrentGroup && _execCurrentGroup.cases && _execCurrentGroup.cases.length > 0) {
        // Filtrar por UUID (db_id) para no mezclar con matrices antiguas que comparten el mismo case_id textual
        const activeCaseUUIDs = new Set(_execCurrentGroup.cases.map(c => c.db_id || c.id));
        history = allHistory.filter(s => activeCaseUUIDs.has(s.test_case_id));

        // Recalcular KPIs del panel solo con los casos del grupo activo
        const groupExecs = history;
        const groupTotal = groupExecs.length;
        const groupSumSec = groupExecs.reduce((a, s) => a + (s.execution_time_seconds || 0), 0);
        const groupAvg = groupTotal > 0 ? Math.round(groupSumSec / groupTotal) : 0;
        const groupTotStr = groupSumSec >= 60
          ? `${Math.floor(groupSumSec / 60)}m ${Math.round(groupSumSec % 60)}s`
          : `${Math.round(groupSumSec)}s`;

        if (kpiCount) kpiCount.textContent = groupTotal;
        if (kpiAvg)   kpiAvg.textContent   = `${groupAvg}s`;
        if (kpiTotal) kpiTotal.textContent  = groupTotStr;
      }

      const last5 = history.slice(0, 5);
      if (last5.length === 0) {
        miniHistory.innerHTML = '<div style="font-size:0.72rem;color:var(--text-muted);text-align:center;padding:0.75rem 0;">Sin registros aún</div>';
      } else {
        miniHistory.innerHTML = last5.map(s => {
          const secs = Math.round(s.execution_time_seconds || 0);
          const t = secs >= 60 ? `${Math.floor(secs / 60)}m${secs % 60}s` : `${secs}s`;
          const badgeCls = s.result === 'CUMPLE' ? 'status-cumple' : s.result === 'NO CUMPLE' ? 'status-nocumple' : 'status-pending';
          const isCritical = s.result === 'NO CUMPLE';
          return `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:0.3rem 0.5rem;background:var(--bg-panel);border-radius:6px;gap:0.4rem;">
              <span style="font-size:0.68rem;color:var(--accent-secondary);font-weight:600;flex-shrink:0;">${s.case_id || '?'}</span>
              <span style="font-size:0.68rem;color:var(--text-muted);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${s.title || '—'}</span>
              <span style="font-size:0.7rem;font-weight:700;color:var(--text-primary);flex-shrink:0;">${t}</span>
              <span class="exec-status ${badgeCls}" style="font-size:0.62rem;padding:0.1rem 0.35rem;flex-shrink:0;">${s.result || '—'}</span>
              <span style="font-size:0.6rem;font-weight:700;flex-shrink:0;padding:0.1rem 0.3rem;border-radius:4px;${isCritical ? 'background:rgba(239,68,68,0.15);color:#ef4444;' : 'background:rgba(16,185,129,0.1);color:#10b981;'}">${isCritical ? '🔴 Crítico' : '✓ OK'}</span>
            </div>
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

async function exportTimedExcel() {
  // Exporta la plantilla EOPA filtrada por el modulo Y archivo exacto de la matriz activa
  try {
    const activeModule   = (_execCurrentGroup && _execCurrentGroup.module)      ? _execCurrentGroup.module      : null;
    const activeFile     = (_execCurrentGroup && _execCurrentGroup.created_at)   ? _execCurrentGroup.created_at  : null;
    // created_at puede ser el export_file (nombre .xlsx) o una fecha ISO
    const isExportFile   = activeFile && activeFile.endsWith('.xlsx');

    let url = `${API_BASE}/api/test-cases/export/excel?project_name=${encodeURIComponent(currentProject)}`;
    if (activeModule)              url += `&module=${encodeURIComponent(activeModule)}`;
    if (isExportFile && activeFile) url += `&export_file=${encodeURIComponent(activeFile)}`;

    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.detail || 'No hay casos para exportar aún.', 'error');
      return;
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const fecha = new Date().toLocaleDateString('es-CO').replace(/\//g, '-');
    const label = activeModule || currentProject;
    a.download = `Casos_${label}_${fecha}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('✅ Plantilla EOPA exportada con tiempos de ejecución', 'success');
  } catch (e) {
    showToast('Error al exportar: ' + e.message, 'error');
  }
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

function toggleMaximizeTranscript() {
  const panel = document.getElementById('jarvisLogPanel');
  if (!panel) return;
  panel.classList.toggle('jlp-maximized');
  const isMax = panel.classList.contains('jlp-maximized');
  const btn = document.getElementById('jlpMaxBtn');
  if (btn) {
    btn.title = isMax ? 'Restaurar tamaño' : 'Maximizar ventana';
    btn.innerHTML = isMax
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;
  }
}

function initTranscriptResize() {
  const panel = document.getElementById('jarvisLogPanel');
  const handle = document.getElementById('jlpResizeCorner');
  if (!panel || !handle) return;

  // Restaurar tamaño previo si existe
  try {
    const saved = localStorage.getItem('prqa-transcript-size');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.width && parsed.height) {
        panel.style.width = parsed.width + 'px';
        panel.style.height = parsed.height + 'px';
      }
    }
  } catch (_) {}

  let isResizing = false;
  let startX = 0;
  let startY = 0;
  let startW = 0;
  let startH = 0;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    isResizing = true;
    startX = e.clientX;
    startY = e.clientY;
    startW = panel.offsetWidth;
    startH = panel.offsetHeight;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'nwse-resize';

    panel.classList.remove('jlp-maximized');

    function onMouseMove(moveEvent) {
      if (!isResizing) return;
      // Arrastrar hacia la izquierda expande ancho (anclado a la derecha)
      const dx = startX - moveEvent.clientX;
      // Arrastrar hacia arriba expande alto (anclado abajo)
      const dy = startY - moveEvent.clientY;

      const newW = Math.max(360, Math.min(window.innerWidth - 40, startW + dx));
      const newH = Math.max(240, Math.min(window.innerHeight - 100, startH + dy));

      panel.style.width = newW + 'px';
      panel.style.height = newH + 'px';
    }

    function onMouseUp() {
      if (!isResizing) return;
      isResizing = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);

      try {
        localStorage.setItem('prqa-transcript-size', JSON.stringify({
          width: panel.offsetWidth,
          height: panel.offsetHeight
        }));
      } catch (_) {}
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });
}

function toggleListening() {
  if (window._isAIProcessing || (window.speechSynthesis && window.speechSynthesis.speaking)) {
    showToast('⚠️ CIEL AI está respondiendo. Espera a que termine o presiona DETENER.', 'warning');
    return;
  }
  if (window.PRQAVoice && typeof PRQAVoice.toggleListening === 'function') {
    PRQAVoice.toggleListening();
  } else if (window.PRQAVoice && typeof PRQAVoice.toggleMic === 'function') {
    PRQAVoice.toggleMic();
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

// Activa/desactiva visualmente el botón DETENER (en espera cuando la IA está inactiva, rojo cuando habla/procesa)
function _setStopBtnActive(active) {
  const btn = document.getElementById('tpStopBtn');
  if (!btn) return;
  const span = btn.querySelector('span');
  if (active) {
    btn.disabled = false;
    btn.classList.add('is-active');
    btn.classList.remove('is-idle');
    if (span) span.textContent = 'DETENER';
    btn.title = 'Detener respuesta de IA';
  } else {
    btn.disabled = false;
    btn.classList.remove('is-active');
    btn.classList.add('is-idle');
    if (span) span.textContent = 'EN ESPERA';
    btn.title = 'CIEL AI en espera (toca el orbe para hablar o escribe)';
  }
}

// Botón para detener la respuesta en curso y silenciar la voz
function stopAI() {
  if (!_isAIProcessing && !(window.speechSynthesis && window.speechSynthesis.speaking)) {
    if (typeof showToast === 'function') {
      showToast('ℹ️ CIEL AI está en espera. Toca el orbe central para hablar.', 'info');
    }
    return;
  }

  if (_activeAbortController) {
    try { _activeAbortController.abort(); } catch (e) { }
    _activeAbortController = null;
  }
  if (window.PRQAVoice && typeof PRQAVoice.stop === 'function') {
    PRQAVoice.stop();
  }
  if (window.speechSynthesis) {
    try { window.speechSynthesis.cancel(); } catch (_) { }
  }
  if (window._activeTypewriterTimer) {
    clearInterval(window._activeTypewriterTimer);
    window._activeTypewriterTimer = null;
  }
  const typingEl = document.querySelector('.stream-typing');
  if (typingEl) typingEl.classList.remove('stream-typing');

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

function _jlpTs() {
  const d = new Date();
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function _formatLogText(text) {
  if (!text) return '';
  let escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Formato markdown bold
  escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // Formato bullets
  const lines = escaped.split('\n');
  let inList = false;
  let html = '';

  for (let line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('• ')) {
      if (!inList) {
        html += '<ul style="margin:0.25rem 0; padding-left:1.2rem;">';
        inList = true;
      }
      const itemText = trimmed.replace(/^[-*•]\s+/, '');
      html += `<li style="margin-bottom:0.2rem;">${itemText}</li>`;
    } else {
      if (inList) {
        html += '</ul>';
        inList = false;
      }
      if (trimmed) {
        html += `<p style="margin:0.2rem 0;">${trimmed}</p>`;
      }
    }
  }
  if (inList) html += '</ul>';

  return html || escaped;
}

let _userInterimEl = null;

function appendOrUpdateUserInterim(transcript) {
  const body = document.getElementById('jarvisLogList') || document.getElementById('jarvisLogBody');
  if (!body) return;

  const emptyState = document.getElementById('jlpEmptyState');
  if (emptyState) emptyState.style.display = 'none';

  if (!_userInterimEl) {
    _userInterimEl = document.createElement('div');
    _userInterimEl.className = 'jlp-line jlp-user jlp-interim';
    _userInterimEl.id = 'jlpInterimLine';
    _userInterimEl.innerHTML = `
      <div class="jlp-line-meta">
        <span class="jlp-tag jlp-tag-user">USR · DICTANDO</span>
        <span class="jlp-ts">${_jlpTs()}</span>
      </div>
      <div class="jlp-text jlp-interim-text"></div>
    `;
    body.appendChild(_userInterimEl);
  }

  const textEl = _userInterimEl.querySelector('.jlp-interim-text');
  if (textEl) {
    textEl.textContent = transcript + '...';
  }
  body.scrollTop = body.scrollHeight;

  // Abrir automáticamente la transcripción si está oculta
  const panel = document.getElementById('jarvisLogPanel');
  if (panel && panel.classList.contains('hidden')) {
    panel.classList.remove('hidden');
    _transcriptOpen = true;
    const btn = document.getElementById('jtbTranscriptToggle');
    if (btn) btn.classList.add('active');
  }
}

function finalizeUserInterim() {
  if (_userInterimEl) {
    _userInterimEl.remove();
    _userInterimEl = null;
  }
}

function clearJarvisLog() {
  const body = document.getElementById('jarvisLogList') || document.getElementById('jarvisLogBody');
  if (!body) return;
  body.innerHTML = '';
  // Restaurar tarjeta de bienvenida / empty state
  const emptyState = document.getElementById('jlpEmptyState');
  if (emptyState) {
    body.appendChild(emptyState);
    emptyState.style.display = 'flex';
  }
  appendJarvisLog('system', 'Historial de transcripción limpiado.');
}

function appendJarvisLog(type, text) {
  const body = document.getElementById('jarvisLogList') || document.getElementById('jarvisLogBody');
  if (!body || !text) return;

  // Ocultar empty state
  const emptyState = document.getElementById('jlpEmptyState');
  if (emptyState) emptyState.style.display = 'none';

  const now = Date.now();
  if (_lastLogEntry.type === type && _lastLogEntry.text === text && (now - _lastLogEntry.time) < 1500) {
    return;
  }
  _lastLogEntry = { type, text, time: now };

  if (type === 'user') {
    finalizeUserInterim();
  }

  const tagMap = {
    user:   { cls: 'jlp-user',   tag: 'USR',     tagCls: 'jlp-tag-user' },
    ai:     { cls: 'jlp-ai',     tag: 'CIEL AI', tagCls: 'jlp-tag-ai' },
    system: { cls: 'jlp-system', tag: 'SYS',     tagCls: 'jlp-tag-sys' },
    error:  { cls: 'jlp-error',  tag: 'ERR',     tagCls: 'jlp-tag-err' },
  };

  const m = tagMap[type] || tagMap.system;

  const line = document.createElement('div');
  line.className = `jlp-line ${m.cls}`;
  line.innerHTML = `
    <div class="jlp-line-meta">
      <span class="jlp-tag ${m.tagCls}">${m.tag}</span>
      <span class="jlp-ts">${_jlpTs()}</span>
    </div>
    <div class="jlp-text">${_formatLogText(text)}</div>
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
window.clearJarvisLog = clearJarvisLog;
window.initTranscriptResize = initTranscriptResize;
window.toggleMaximizeTranscript = toggleMaximizeTranscript;
window.appendJarvisLog = appendJarvisLog;

async function queryCielAI(text) {
  if (!text || !text.trim()) return;
  const query = text.trim();

  // 1. Bloqueo estricto de concurrencia: 1 consulta a la vez
  if (_isAIProcessing) {
    if (typeof showToast === 'function') {
      showToast('⚠️ CIEL AI está procesando una consulta. Espera un momento o presiona DETENER.', 'warning');
    }
    return;
  }

  _isAIProcessing = true;
  _activeAbortController = new AbortController();

  if (window.PRQAVoice && typeof PRQAVoice.abortListening === 'function') {
    PRQAVoice.abortListening();
  }
  finalizeUserInterim();

  // Activar botón DETENER en la barra
  _setStopBtnActive(true);

  // 2. Registrar consulta del usuario en el log
  appendJarvisLog('user', query);

  function _finishAI() {
    _isAIProcessing = false;
    _activeAbortController = null;
    _setStopBtnActive(false);
    if (window.PRQAVoice) PRQAVoice.setOrbState('idle');
  }

  let fullResponse = '';
  let streamLine = null;
  let streamTextSpan = null;
  let hasReceivedFirstChunk = false;

  if (window.PRQAVoice) PRQAVoice.setOrbState('processing');

  try {
    const res = await fetch('/api/chat/stream', {
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
      const errMsg = err.detail || 'Error en la respuesta del motor de IA local.';
      appendJarvisLog('error', errMsg);
      _finishAI();
      return;
    }

    // Abrir panel de transcripción si está cerrado
    if (!_transcriptOpen) {
      const panel = document.getElementById('jarvisLogPanel');
      if (panel) {
        panel.classList.remove('hidden');
        _transcriptOpen = true;
        const btn = document.getElementById('jtbTranscriptToggle');
        if (btn) btn.classList.add('active');
      }
    }

    // Crear línea de respuesta estructurada en el panel
    const body = document.getElementById('jarvisLogList') || document.getElementById('jarvisLogBody');
    if (body) {
      streamLine = document.createElement('div');
      streamLine.className = 'jlp-line jlp-ai';
      streamLine.innerHTML = `
        <div class="jlp-line-meta">
          <span class="jlp-tag jlp-tag-ai">CIEL AI</span>
          <span class="jlp-ts">${_jlpTs()}</span>
        </div>
        <div class="jlp-text stream-typing"><span style="opacity:0.6; font-style:italic;">Pensando respuesta...</span></div>
      `;
      body.appendChild(streamLine);
      body.scrollTop = body.scrollHeight;
      streamTextSpan = streamLine.querySelector('.jlp-text');
    }

    // Leer el stream SSE de Ollama
    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const textChunk = decoder.decode(value, { stream: true });
      const lines = textChunk.split('\n');

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') break;
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            appendJarvisLog('error', parsed.error);
            if (streamLine) streamLine.remove();
            _finishAI();
            return;
          }
          if (parsed.chunk) {
            if (!hasReceivedFirstChunk) {
              hasReceivedFirstChunk = true;
              if (streamTextSpan) streamTextSpan.textContent = '';
            }
            fullResponse += parsed.chunk;
          }
        } catch (_) {}
      }
    }

    _lastAIResponse = fullResponse;
    window._lastAIResponse = fullResponse;

    const ttsActive = window.PRQAVoice && PRQAVoice.isTTSEnabled();

    if (ttsActive && fullResponse.trim().length > 0) {
      // Sincronización perfecta: habla de forma consecutiva y el texto se escribe conforme habla
      if (window.PRQAVoice) PRQAVoice.setOrbState('speaking');

      let currentTypedIndex = 0;
      const totalLen = fullResponse.length;
      if (window._activeTypewriterTimer) clearInterval(window._activeTypewriterTimer);

      PRQAVoice.speak(fullResponse, {
        onStart: (cleanText) => {
          if (streamTextSpan) {
            streamTextSpan.classList.add('stream-typing');
            streamTextSpan.textContent = '';
          }

          // Estimamos tiempo total de habla para sincronizar el tipeo con el audio
          // ~13 caracteres por segundo a ritmo normal en español
          const estimatedDurationMs = Math.max(1500, (cleanText.length / 13) * 1000);
          const intervalMs = 45;
          const charsPerTick = Math.max(1, (totalLen / (estimatedDurationMs / intervalMs)));

          window._activeTypewriterTimer = setInterval(() => {
            if (currentTypedIndex < totalLen) {
              currentTypedIndex = Math.min(totalLen, currentTypedIndex + charsPerTick);
              if (streamTextSpan) {
                streamTextSpan.textContent = fullResponse.substring(0, Math.floor(currentTypedIndex));
                if (body) body.scrollTop = body.scrollHeight;
              }
            }
          }, intervalMs);
        },
        onBoundary: (e, cleanText) => {
          // Si el navegador emite eventos de límite de palabra, sincronizar de forma exacta
          if (e.charIndex !== undefined && cleanText && cleanText.length > 0) {
            const progressRatio = Math.min(1, (e.charIndex + (e.charLength || 4)) / cleanText.length);
            const targetChar = Math.floor(progressRatio * totalLen);
            if (targetChar > currentTypedIndex) {
              currentTypedIndex = targetChar;
              if (streamTextSpan) {
                streamTextSpan.textContent = fullResponse.substring(0, currentTypedIndex);
                if (body) body.scrollTop = body.scrollHeight;
              }
            }
          }
        },
        onEnd: () => {
          if (window._activeTypewriterTimer) {
            clearInterval(window._activeTypewriterTimer);
            window._activeTypewriterTimer = null;
          }
          if (streamTextSpan) {
            streamTextSpan.classList.remove('stream-typing');
            streamTextSpan.innerHTML = _formatLogText(fullResponse);
            if (body) body.scrollTop = body.scrollHeight;
          }
          _finishAI();
        }
      });
    } else {
      // Si la voz está desactivada, mostrar el resultado completo formateado de inmediato
      if (streamTextSpan) {
        streamTextSpan.classList.remove('stream-typing');
        if (fullResponse) {
          streamTextSpan.innerHTML = _formatLogText(fullResponse);
        } else {
          streamTextSpan.textContent = '(Sin respuesta de la IA)';
        }
      }
      if (body) body.scrollTop = body.scrollHeight;
      _finishAI();
    }

  } catch (e) {
    if (e.name === 'AbortError') {
      console.log('[CIEL AI] Consulta cancelada por el usuario');
      _finishAI();
    } else {
      console.error('[PRQA AI Error]', e);
      appendJarvisLog('error', 'Error de conexión con el motor de IA local.');
      _finishAI();
    }
  }
}

function toggleTextInput() {
  const bar = document.getElementById('textInputBar');
  const btn = document.getElementById('tibToggleBtn');
  if (!bar) return;

  const isHidden = bar.classList.contains('hidden');
  if (isHidden) {
    // Posicionar dinámicamente según el estado del panel de transcripción
    const panel = document.getElementById('jarvisLogPanel');
    if (panel && !panel.classList.contains('hidden')) {
      const panelWidth = panel.offsetWidth || 540;
      bar.style.right = (panelWidth + 35) + 'px';
    } else {
      bar.style.right = '25px';
    }
    bar.classList.remove('hidden');
    if (btn) btn.classList.add('active');
    const input = document.getElementById('tibInput');
    if (input) {
      setTimeout(() => {
        input.focus();
        input.select();
      }, 50);
    }
  } else {
    bar.classList.add('hidden');
    if (btn) btn.classList.remove('active');
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

// ======================================================
// PESTANAS: Ejecutar Pruebas / Cronometro
// ======================================================
function switchExecTab(tab) {
  const execContent  = document.getElementById('execTabContentExecute');
  const timerContent = document.getElementById('execTabContentTimer');
  const execTabBtn   = document.getElementById('execTabExecute');
  const timerTabBtn  = document.getElementById('execTabTimer');

  if (tab === 'execute') {
    if (execContent)  execContent.classList.remove('hidden');
    if (timerContent) timerContent.classList.add('hidden');
    if (execTabBtn)   execTabBtn.classList.add('active');
    if (timerTabBtn)  timerTabBtn.classList.remove('active');
  } else {
    if (execContent)  execContent.classList.add('hidden');
    if (timerContent) timerContent.classList.remove('hidden');
    if (execTabBtn)   execTabBtn.classList.remove('active');
    if (timerTabBtn)  timerTabBtn.classList.add('active');
    if (typeof loadTimerModule === 'function') loadTimerModule();
  }
}
window.switchExecTab = switchExecTab;

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
window._setStopBtnActive = _setStopBtnActive;

// ══════════════════════════════════════════════════════════════
// Helpers seguros: Abrir detalle / editar desde el mapa de casos
// ══════════════════════════════════════════════════════════════

function openCaseDetailFromId(tcId) {
  const tc = (window._execCasesMap || {})[tcId];
  if (tc) {
    openCaseDetailModal(tc);
  } else {
    showToast('No se encontró el caso de prueba.', 'error');
  }
}

function openEditFromId(tcId) {
  const tc = (window._execCasesMap || {})[tcId];
  if (tc) {
    openEditTestCaseModal(tcId, tc);
  } else {
    showToast('No se encontró el caso para editar.', 'error');
  }
}

// ID del caso actualmente seleccionado para el cronómetro
let _timerSelectedCaseId = null;

function selectCaseForTimer(tcId) {
  // Evitar cambiar de caso si hay una medición activa en curso
  if (_timerRunning) {
    showToast('⚠️ El cronómetro está corriendo. Detén, finaliza o cancela la sesión actual antes de cambiar de caso.', 'warning');
    return;
  }

  const tc = (window._execCasesMap || {})[tcId];
  if (!tc) return;

  _timerSelectedCaseId = tcId;

  // Highlight visual: quitar selección previa, aplicar a la nueva fila
  document.querySelectorAll('.exec-table-row').forEach(r => r.classList.remove('timer-row-selected'));
  const row = document.getElementById('exec-row-' + tcId);
  if (row) row.classList.add('timer-row-selected');

  // Actualizar estado activo y texto en botones de la tabla
  document.querySelectorAll('.exec-btn-timer-pill').forEach(btn => {
    btn.classList.remove('active');
    const span = btn.querySelector('span');
    if (span) span.textContent = 'Cronometrar';
  });
  const activeBtn = document.getElementById('timer-btn-' + tcId);
  if (activeBtn) {
    activeBtn.classList.add('active');
    const span = activeBtn.querySelector('span');
    if (span) span.textContent = 'En Cronómetro';
  }

  // Actualizar el display en el panel del cronómetro
  const display = document.getElementById('timerSelectedCaseDisplay');
  const textEl = document.getElementById('timerSelectedCaseText');
  if (display) {
    display.style.borderColor = 'rgba(0,156,166,0.45)';
    display.style.background = 'rgba(0,156,166,0.06)';
  }
  if (textEl) {
    textEl.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:0.3rem;width:100%;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:0.4rem;">
          <span style="font-weight:700;color:var(--accent-primary);font-size:0.75rem;">${tc.case_id}</span>
          <button type="button" onclick="openCaseDetailFromId('${tc.db_id}')" class="btn-ghost" style="font-size:0.68rem;padding:0.15rem 0.5rem;height:auto;gap:0.25rem;border:1px solid rgba(0,156,166,0.3);background:rgba(0,156,166,0.06);border-radius:4px;cursor:pointer;" title="Ver pasos y detalles completos">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
            Ver caso
          </button>
        </div>
        <div style="color:var(--text-primary);font-size:0.72rem;line-height:1.3;white-space:normal;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${tc.title}</div>
      </div>
    `;
  }

  showToast(`⏱ Caso vinculado al cronómetro: ${tc.case_id}`, 'info');
}

function recordManualResultForSelectedCase() {
  if (_timerRunning) {
    showToast('⚠️ Hay un cronómetro activo en curso. Detén o cancela la sesión primero.', 'warning');
    return;
  }
  let tc = _timerSelectedCaseId && window._execCasesMap ? window._execCasesMap[_timerSelectedCaseId] : null;
  if (!tc) {
    showToast('Por favor selecciona un caso de la lista primero.', 'info');
    return;
  }
  openExecutionModal(tc.db_id, tc.case_id, tc.title);
}

window.openCaseDetailFromId = openCaseDetailFromId;
window.openEditFromId = openEditFromId;
window.selectCaseForTimer = selectCaseForTimer;
window.recordManualResultForSelectedCase = recordManualResultForSelectedCase;

// ══════════════════════════════════════════════════════════════
// MÓDULO: VER DETALLES COMPLETOS DEL CASO DE PRUEBA
// ══════════════════════════════════════════════════════════════

let _currentDetailCase = null; // Cache del caso actualmente en el modal de detalle


function openCaseDetailModal(tcRawOrJson) {
  let tc;
  try {
    tc = typeof tcRawOrJson === 'string' ? JSON.parse(tcRawOrJson) : tcRawOrJson;
  } catch (e) {
    showToast('Error al cargar detalles del caso.', 'error');
    return;
  }
  _currentDetailCase = tc;

  // Llenar header
  const idEl = document.getElementById('caseDetailModalId');
  const titleEl = document.getElementById('caseDetailModalTitle');
  if (idEl) idEl.textContent = tc.case_id || '—';
  if (titleEl) titleEl.textContent = tc.title || 'Caso de Prueba';

  // Meta chips (tipo, severidad, módulo, técnica)
  const chipsEl = document.getElementById('caseDetailMetaChips');
  if (chipsEl) {
    const chipStyle = 'display:inline-flex;align-items:center;gap:0.3rem;padding:0.25rem 0.6rem;border-radius:9999px;font-size:0.7rem;font-weight:600;';
    const sevColors = {
      'Bloqueante': 'background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.4);color:#ef4444;',
      'Crítico': 'background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.4);color:#f59e0b;',
      'Tolerable': 'background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.3);color:#10b981;',
      'Interfaz de usuario': 'background:rgba(139,92,246,0.12);border:1px solid rgba(139,92,246,0.3);color:#8b5cf6;',
    };
    const sevColor = sevColors[tc.severity] || 'background:rgba(148,163,184,0.1);border:1px solid rgba(148,163,184,0.25);color:var(--text-secondary);';
    chipsEl.innerHTML = `
      <span style="${chipStyle}background:rgba(0,156,166,0.12);border:1px solid rgba(0,156,166,0.3);color:var(--accent-primary);">📋 ${tc.test_type || '—'}</span>
      <span style="${chipStyle}${sevColor}">⚠ ${tc.severity || 'Tolerable'}</span>
      ${tc.module ? `<span style="${chipStyle}background:rgba(148,163,184,0.08);border:1px solid rgba(148,163,184,0.2);color:var(--text-secondary);">📦 ${tc.module}</span>` : ''}
      ${tc.technique ? `<span style="${chipStyle}background:rgba(139,92,246,0.08);border:1px solid rgba(139,92,246,0.2);color:#a78bfa;">🔬 ${tc.technique}</span>` : ''}
      <span style="${chipStyle}${tc.status === 'Ejecutado' ? 'background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.3);color:#10b981;' : 'background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);color:#f59e0b;'}">
        ${tc.status === 'Ejecutado' ? '✅ Ejecutado' : '⏳ Pendiente'}
      </span>
    `;
  }

  // Precondiciones
  const preEl = document.getElementById('caseDetailPreconditions');
  if (preEl) preEl.textContent = tc.preconditions || '—';

  // Pasos
  const stepsList = document.getElementById('caseDetailStepsList');
  if (stepsList) {
    let steps = tc.steps || [];
    if (typeof steps === 'string') {
      try { steps = JSON.parse(steps); } catch (_) { steps = [steps]; }
    }
    if (!Array.isArray(steps) || steps.length === 0) {
      stepsList.innerHTML = '<li style="color:var(--text-muted);font-style:italic;">Sin pasos definidos.</li>';
    } else {
      stepsList.innerHTML = steps.map((step, idx) => {
        const text = typeof step === 'string' ? step : (step.action || step.step || JSON.stringify(step));
        return `<li style="margin-bottom:0.4rem;line-height:1.5;"><strong style="color:var(--accent-primary);">Paso ${idx + 1}:</strong> ${text}</li>`;
      }).join('');
    }
  }

  // Resultado esperado
  const expEl = document.getElementById('caseDetailExpected');
  if (expEl) expEl.textContent = tc.expected_result || '—';

  // Criterios de aceptación
  const accEl = document.getElementById('caseDetailAcc');
  if (accEl) accEl.textContent = tc.acceptance_criteria || '—';

  // Resultado registrado (si ya fue ejecutado)
  const resultSection = document.getElementById('caseDetailResultSection');
  const resultEl = document.getElementById('caseDetailResult');
  const notesEl = document.getElementById('caseDetailNotes');
  if (resultSection && tc.result) {
    resultSection.style.display = '';
    const isPass = tc.result === 'CUMPLE';
    if (resultEl) resultEl.innerHTML = `<span style="color:${isPass ? '#10b981' : '#ef4444'};">${tc.result}</span>`;
    if (notesEl) notesEl.textContent = tc.notes ? `📝 ${tc.notes}` : '';
  } else if (resultSection) {
    resultSection.style.display = 'none';
  }

  // Actualizar botón de ejecutar
  const execBtn = document.getElementById('caseDetailExecuteBtn');
  if (execBtn) {
    if (tc.status === 'Ejecutado') {
      execBtn.textContent = 'Re-ejecutar';
    } else {
      execBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polygon points="5 3 19 12 5 21 5 3"/></svg> Registrar Resultado`;
    }
  }

  document.getElementById('caseDetailModal').classList.remove('hidden');
}

function closeCaseDetailModal() {
  document.getElementById('caseDetailModal').classList.add('hidden');
  _currentDetailCase = null;
}

function editFromDetailModal() {
  if (!_currentDetailCase) return;
  closeCaseDetailModal();
  openEditTestCaseModal(_currentDetailCase.db_id || _currentDetailCase.id, _currentDetailCase);
}

function executeFromDetailModal() {
  if (!_currentDetailCase) return;
  const tc = _currentDetailCase;
  closeCaseDetailModal();
  openExecutionModal(tc.db_id || tc.id, tc.case_id, tc.title);
}

window.openCaseDetailModal = openCaseDetailModal;
window.closeCaseDetailModal = closeCaseDetailModal;
window.editFromDetailModal = editFromDetailModal;
window.executeFromDetailModal = executeFromDetailModal;


// ══════════════════════════════════════════════════════════════
// MÓDULO: CREAR / EDITAR CASO DE PRUEBA MANUAL
// ══════════════════════════════════════════════════════════════

let _editTcStepCount = 0;

function openEditTestCaseModal(tcId, tcDataRawOrObj) {
  let tc;
  try {
    tc = typeof tcDataRawOrObj === 'string' ? JSON.parse(tcDataRawOrObj) : tcDataRawOrObj;
  } catch (_) {
    tc = null;
  }

  document.getElementById('editTcMode').value = tcId ? 'edit' : 'create';
  document.getElementById('editTcId').value = tcId || '';
  document.getElementById('editTestCaseModalTitle').textContent = tcId ? 'Editar Caso de Prueba' : 'Nuevo Caso de Prueba Manual';

  // Pre-cargar campos si es edición
  if (tc) {
    document.getElementById('editTcTitle').value = tc.title || '';
    const typeEl = document.getElementById('editTcType');
    if (typeEl) typeEl.value = tc.test_type || 'FUNCIONALES';
    const sevEl = document.getElementById('editTcSeverity');
    if (sevEl) sevEl.value = tc.severity || 'Tolerable';
    document.getElementById('editTcModule').value = tc.module || '';
    document.getElementById('editTcTechnique').value = tc.technique || '';
    document.getElementById('editTcPreconditions').value = tc.preconditions || '';
    document.getElementById('editTcExpected').value = tc.expected_result || '';
    document.getElementById('editTcAcceptance').value = tc.acceptance_criteria || '';

    // Cargar pasos
    let steps = tc.steps || [];
    if (typeof steps === 'string') {
      try { steps = JSON.parse(steps); } catch (_) { steps = steps ? [steps] : []; }
    }
    _editTcStepCount = 0;
    const stepsContainer = document.getElementById('editTcStepsList');
    if (stepsContainer) stepsContainer.innerHTML = '';
    (Array.isArray(steps) ? steps : []).forEach(step => {
      const text = typeof step === 'string' ? step : (step.action || step.step || '');
      addTcStep(text);
    });
    if (steps.length === 0) addTcStep(); // Al menos 1 paso vacío
  } else {
    // Nuevo caso: limpiar todos los campos
    ['editTcTitle', 'editTcModule', 'editTcTechnique', 'editTcPreconditions', 'editTcExpected', 'editTcAcceptance'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('editTcType').value = 'FUNCIONALES';
    document.getElementById('editTcSeverity').value = 'Tolerable';
    _editTcStepCount = 0;
    const stepsContainer = document.getElementById('editTcStepsList');
    if (stepsContainer) stepsContainer.innerHTML = '';
    addTcStep(); // Agregar primer paso vacío
  }

  document.getElementById('editTestCaseModal').classList.remove('hidden');
}

function openCreateManualCaseModal() {
  openEditTestCaseModal(null, null);
}

function closeEditTestCaseModal() {
  document.getElementById('editTestCaseModal').classList.add('hidden');
}

function addTcStep(defaultText = '') {
  _editTcStepCount++;
  const container = document.getElementById('editTcStepsList');
  if (!container) return;
  const idx = _editTcStepCount;
  const row = document.createElement('div');
  row.className = 'tc-step-row';
  row.id = `tcStepRow${idx}`;
  row.style.cssText = 'display:flex;align-items:center;gap:0.4rem;';
  row.innerHTML = `
    <span style="min-width:22px;font-size:0.72rem;font-weight:700;color:var(--accent-primary);text-align:right;">${idx}.</span>
    <input type="text" class="form-input" style="flex:1;padding:0.4rem 0.65rem;font-size:0.78rem;" 
           placeholder="Descripción del paso ${idx}..." value="${defaultText.replace(/"/g, '&quot;')}" />
    <button type="button" style="padding:0.3rem;background:transparent;border:none;cursor:pointer;color:var(--text-muted);opacity:0.7;" 
            onclick="document.getElementById('tcStepRow${idx}').remove();" title="Eliminar paso">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  `;
  container.appendChild(row);
}

async function saveTestCaseEdits() {
  const mode = document.getElementById('editTcMode').value;
  const tcId = document.getElementById('editTcId').value;
  const title = document.getElementById('editTcTitle').value.trim();

  if (!title) {
    showToast('El título del caso es obligatorio.', 'error');
    document.getElementById('editTcTitle').focus();
    return;
  }

  // Recolectar pasos del DOM
  const stepsRows = document.querySelectorAll('#editTcStepsList .tc-step-row input[type="text"]');
  const steps = Array.from(stepsRows).map(inp => inp.value.trim()).filter(s => s);

  const payload = {
    title,
    test_type: document.getElementById('editTcType').value,
    severity: document.getElementById('editTcSeverity').value,
    module: document.getElementById('editTcModule').value.trim(),
    technique: document.getElementById('editTcTechnique').value.trim(),
    preconditions: document.getElementById('editTcPreconditions').value.trim(),
    steps,
    expected_result: document.getElementById('editTcExpected').value.trim(),
    acceptance_criteria: document.getElementById('editTcAcceptance').value.trim(),
  };

  const saveBtn = document.getElementById('saveEditTestCaseBtn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Guardando...'; }

  try {
    let res, data;

    if (mode === 'edit' && tcId) {
      // PUT /api/test-cases/{id}
      res = await fetch(`${API_BASE}/api/test-cases/${tcId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      // POST /api/test-cases/manual
      const project = currentProject || 'Proyectos';
      res = await fetch(`${API_BASE}/api/test-cases/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, project_name: project }),
      });
    }

    data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Error al guardar.');

    closeEditTestCaseModal();
    showToast(mode === 'edit' ? '✅ Caso actualizado correctamente.' : '✅ Caso manual creado correctamente.', 'success');

    // Refrescar la vista de ejecución actual si está activa
    if (typeof refreshExecDetail === 'function') refreshExecDetail();

  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Guardar Caso`;
    }
  }
}

window.openEditTestCaseModal = openEditTestCaseModal;
window.openCreateManualCaseModal = openCreateManualCaseModal;
window.closeEditTestCaseModal = closeEditTestCaseModal;
window.addTcStep = addTcStep;
window.saveTestCaseEdits = saveTestCaseEdits;

// Inicializar botón DETENER en estado inactivo / en espera
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => _setStopBtnActive(false));
} else {
  _setStopBtnActive(false);
}

