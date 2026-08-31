/**
 * PRQA — voice.js
 * Módulo de voz CIEL AI: Text-to-Speech (TTS) + Speech-to-Text (STT)
 * Ciel Ingeniería S.A.S | Asistente QA con IA Local
 */

// ══════════════════════════════════════════════════════════════
// Configuración de voz
// ══════════════════════════════════════════════════════════════
const VoiceConfig = {
  enabled: true,          // TTS activado por defecto
  rate: 0.95,             // Velocidad de habla (0.1 - 10)
  pitch: 0.85,            // Tono (0 - 2), < 1 es más grave/robótico
  volume: 0.9,            // Volumen (0 - 1)
  lang: 'es-ES',          // Idioma preferido
  maxChars: 1200,         // Máximo de caracteres a leer (trunca respuestas largas)
};

// Estado del módulo
let _ttsVoice = null;
let _sttRecognition = null;
let _isListening = false;
let _ttsEnabled = true;   // Toggle en caliente
let _currentUtterance = null;

// ══════════════════════════════════════════════════════════════
// Inicialización
// ══════════════════════════════════════════════════════════════
function initVoice() {
  _loadVoices();
  if (window.speechSynthesis && window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = _loadVoices;
  }

  // Inicializar reconocimiento si está disponible
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    _sttRecognition = new SpeechRecognition();
    _sttRecognition.lang = VoiceConfig.lang;
    _sttRecognition.interimResults = true;
    _sttRecognition.maxAlternatives = 1;
    _sttRecognition.continuous = false;

    _sttRecognition.onresult = _onSpeechResult;
    _sttRecognition.onerror = _onSpeechError;
    _sttRecognition.onend   = _onSpeechEnd;
    _sttRecognition.onstart = _onSpeechStart;
  }

  console.log('[PRQA Voice] Módulo de voz inicializado.');
}

function _loadVoices() {
  if (!window.speechSynthesis) return;
  const voices = window.speechSynthesis.getVoices();

  // Prioridad: voz en español, preferiblemente masculina o neural
  const preferred = ['Google español', 'Microsoft Pablo', 'Microsoft Raúl', 'es-ES', 'es-MX', 'es-CO', 'es-419'];
  _ttsVoice = null;

  for (const pref of preferred) {
    const found = voices.find(v => v.name === pref || v.lang.startsWith(pref) || v.name.includes(pref));
    if (found) { _ttsVoice = found; break; }
  }

  // Fallback: cualquier voz en español
  if (!_ttsVoice) {
    _ttsVoice = voices.find(v => v.lang.startsWith('es')) || null;
  }
}

// ══════════════════════════════════════════════════════════════
// Text-to-Speech (CIEL AI habla)
// ══════════════════════════════════════════════════════════════

/**
 * Lee un texto en voz alta (CIEL AI).
 * @param {string} text - Texto a leer
 * @param {object} opts - Opciones opcionales { rate, pitch, volume }
 */
function speak(text, opts = {}) {
  if (!_ttsEnabled || !window.speechSynthesis) {
    if (typeof opts.onEnd === 'function') opts.onEnd();
    return;
  }

  // Detener cualquier habla previa
  stopSpeaking();

  // Limpiar texto: quitar markdown, emojis y truncar
  const clean = _cleanTextForSpeech(text);
  if (!clean.trim()) {
    if (typeof opts.onEnd === 'function') opts.onEnd();
    return;
  }

  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.rate   = opts.rate   ?? VoiceConfig.rate;
  utterance.pitch  = opts.pitch  ?? VoiceConfig.pitch;
  utterance.volume = opts.volume ?? VoiceConfig.volume;
  if (_ttsVoice) utterance.voice = _ttsVoice;
  utterance.lang = VoiceConfig.lang;

  let finished = false;
  const onDone = () => {
    if (finished) return;
    finished = true;
    _currentUtterance = null;
    _updateVoiceIndicator(false);
    if (typeof opts.onEnd === 'function') opts.onEnd();
  };

  utterance.onstart = () => {
    _currentUtterance = utterance;
    _updateVoiceIndicator(true);
    if (typeof opts.onStart === 'function') opts.onStart();
  };

  utterance.onend = onDone;

  utterance.onerror = (e) => {
    onDone();
    if (e.error !== 'interrupted' && e.error !== 'canceled') {
      console.warn('[PRQA Voice] TTS Error:', e.error);
    }
  };

  window.speechSynthesis.speak(utterance);
}

/** Detiene inmediatamente cualquier habla activa. */
function stopSpeaking() {
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  _currentUtterance = null;
  _updateVoiceIndicator(false);
}

/** Activa/desactiva el TTS desde el botón de la UI. */
function toggleTTS() {
  _ttsEnabled = !_ttsEnabled;
  _updateTTSButton();

  if (!_ttsEnabled) {
    stopSpeaking();
    if (typeof appendJarvisLog === 'function') appendJarvisLog('system', '🔇 Voz silenciada');
    showToast('🔇 Voz silenciada', 'info');
    if (window._isAIProcessing && typeof _setStopBtnActive === 'function') {
      // Si la IA estaba hablando y se silencia, liberar el estado
      window._isAIProcessing = false;
      _setStopBtnActive(false);
      setOrbState('idle');
    }
  } else {
    if (typeof appendJarvisLog === 'function') appendJarvisLog('system', '🔊 Voz activada');
    showToast('🔊 CIEL AI activada', 'success');
    if (window._lastAIResponse) {
      if (typeof _setStopBtnActive === 'function') _setStopBtnActive(true);
      window._isAIProcessing = true;
      setOrbState('speaking');
      speak(window._lastAIResponse, {
        onEnd: () => {
          window._isAIProcessing = false;
          if (typeof _setStopBtnActive === 'function') _setStopBtnActive(false);
          setOrbState('idle');
        }
      });
    }
  }
}

function isTTSEnabled() { return _ttsEnabled; }

// ══════════════════════════════════════════════════════════════
// Speech-to-Text (Dictado por voz)
// ══════════════════════════════════════════════════════════════

/**
 * Inicia o detiene el reconocimiento de voz.
 * Transcribe al campo de texto del chat (chatInput).
 */
function toggleMic() {
  if (!_sttRecognition) {
    showToast('Tu navegador no soporta reconocimiento de voz. Usa Chrome o Edge.', 'warning');
    return;
  }

  // Bloquear el mic si CIEL AI está procesando o hablando
  if (window._isAIProcessing) {
    showToast('⚠️ CIEL AI está ocupada. Presiona DETENER para interrumpir.', 'warning');
    return;
  }

  // Abrir el drawer si está cerrado
  const drawer = document.getElementById('chatDrawer');
  if (drawer && !drawer.classList.contains('open')) {
    if (typeof toggleChatDrawer === 'function') toggleChatDrawer();
  }

  if (_isListening) {
    _sttRecognition.stop();
  } else {
    try {
      _sttRecognition.start();
    } catch(e) {
      console.warn('[PRQA Voice] STT start error:', e);
    }
  }
}

function _onSpeechStart() {
  _isListening = true;
  _updateMicButton(true);
  setOrbState('listening');
  showToast('🎤 Escuchando...', 'info');
}

function _onSpeechResult(event) {
  let transcript = '';
  for (let i = event.resultIndex; i < event.results.length; i++) {
    transcript += event.results[i][0].transcript;
  }

  const input = document.getElementById('chatInput');
  if (input) {
    input.value = transcript;
    if (typeof autoResizeTextarea === 'function') autoResizeTextarea(input);
  }

  const isFinal = event.results[event.results.length - 1].isFinal;
  if (isFinal && transcript.trim()) {
    // Marcar como NO escuchando INMEDIATAMENTE para bloquear reintentos
    _isListening = false;
    _sttRecognition.stop();
    setOrbState('processing');

    // Bloqueo definitivo: no enviar si la IA ya está procesando
    if (window._isAIProcessing) {
      showToast('⚠️ CIEL AI está ocupada. Espera que termine.', 'warning');
      setOrbState('idle');
      return;
    }

    setTimeout(() => {
      if (typeof queryCielAI === 'function') {
        queryCielAI(transcript.trim());
      } else if (typeof sendMessage === 'function') {
        sendMessage();
      }
    }, 250);
  }
}

function _onSpeechError(event) {
  _isListening = false;
  _updateMicButton(false);
  const msg = {
    'network': 'Sin conexión de red para el reconocimiento de voz.',
    'not-allowed': 'Permiso de micrófono denegado. Habilítalo en el navegador.',
    'no-speech': 'No se detectó voz. Intenta de nuevo.',
    'aborted': null,
  }[event.error];
  if (msg) showToast(msg, 'warning');
}

function _onSpeechEnd() {
  _isListening = false;
  _updateMicButton(false);
  // Solo volver a idle si la IA NO está procesando
  // (si está procesando, el orb ya está en 'processing' o 'speaking')
  if (!window._isAIProcessing) {
    setOrbState('idle');
  }
}

// ══════════════════════════════════════════════════════════════
// Helpers de UI
// ══════════════════════════════════════════════════════════════

function _updateMicButton(listening) {
  const btn = document.getElementById('micBtn');
  if (!btn) return;
  btn.classList.toggle('mic-listening', listening);
  btn.title = listening ? 'Detener grabación' : 'Hablar (dictado por voz)';
}

function _updateTTSButton() {
  const btn = document.getElementById('ttsToggleBtn');
  if (!btn) return;
  btn.classList.toggle('tts-off', !_ttsEnabled);
  btn.title = _ttsEnabled ? 'Silenciar voz de CIEL AI' : 'Activar voz de CIEL AI';
  const icon = btn.querySelector('.tts-icon');
  if (icon) icon.textContent = _ttsEnabled ? '🔊' : '🔇';
}

function _updateVoiceIndicator(speaking) {
  // Controlar el orb de voz
  setOrbState(speaking ? 'speaking' : 'idle');

  // Animar la burbuja del chat-fab mientras habla
  const fab = document.getElementById('chatFab');
  if (fab) fab.classList.toggle('jarvis-speaking', speaking);
}

/**
 * Controla el estado visual del orb CIEL AI.
 * @param {'idle'|'listening'|'processing'|'speaking'} state
 */
function setOrbState(state) {
  const orb  = document.getElementById('jarvisOrb');
  const dot  = document.getElementById('orbStatusDot');
  const txt  = document.getElementById('orbStatusText');
  const wave = document.getElementById('orbWaveform');

  if (orb) {
    orb.classList.remove('orb-listening', 'orb-processing', 'orb-speaking');
    if (state !== 'idle') orb.classList.add(`orb-${state}`);
  }

  if (dot) dot.dataset.state = state;

  const labels = {
    idle:       'Toca para hablar',
    listening:  'Escuchando...',
    processing: 'Procesando...',
    speaking:   'Hablando...',
  };
  if (txt) txt.textContent = labels[state] || 'Listo';

  if (wave) wave.classList.toggle('active', state === 'listening' || state === 'speaking');

  // También actualizar la barra HABLAR CON CIEL AI inferior
  _setJtbState(state);
}

/**
 * Actualiza el estado visual de la barra "HABLAR CON CIEL AI" inferior.
 */
function _setJtbState(state) {
  const center = document.getElementById('jtbCenter');
  const label  = document.getElementById('jtbLabel');
  const dot    = document.querySelector('.jtb-dot');

  if (!center) return;
  center.classList.remove('jtb-listening', 'jtb-speaking', 'jtb-processing');

  const map = {
    listening:  { cls: 'jtb-listening',  label: 'ESCUCHANDO...',   dot: '#10b981' },
    processing: { cls: 'jtb-processing', label: 'PROCESANDO...',   dot: '#f59e0b' },
    speaking:   { cls: 'jtb-speaking',   label: 'HABLANDO...',     dot: '#00e5ff' },
    idle:       { cls: '',               label: 'HABLAR CON CIEL AI', dot: '#10b981' },
    listening:  { cls: 'jtb-listening',  label: 'ESCUCHANDO...',      dot: '#10b981' },
    processing: { cls: 'jtb-processing', label: 'ANALIZANDO...',      dot: '#f59e0b' },
    speaking:   { cls: 'jtb-speaking',   label: 'RESPONDIENDO...',    dot: '#00e5ff' },
  };

  const s = map[state] || map.idle;
  if (s.cls) center.classList.add(s.cls);
  if (label) label.textContent = s.label;
  if (dot)   { dot.style.background = s.dot; dot.style.boxShadow = `0 0 8px ${s.dot}cc`; }

  // Actualizar sublabel
  const subLabels = {
    idle:       'Toca para comenzar...',
    listening:  'Escuchando...',
    processing: 'Procesando...',
    speaking:   'Respondiendo...',
  };
  const subLabel = document.getElementById('jtbSubLabel');
  if (subLabel) subLabel.textContent = subLabels[state] || 'Toca para comenzar...';

  // Animar el energy cloud orb
  const cloud = document.getElementById('jarvisEnergyCloud');
  if (cloud) {
    cloud.classList.remove('ec-listening', 'ec-speaking', 'ec-processing');
    if (state === 'listening')  cloud.classList.add('ec-listening');
    if (state === 'speaking')   cloud.classList.add('ec-speaking');
    if (state === 'processing') cloud.classList.add('ec-processing');
  }

  // Animar los dots de la barra según el estado
  const bar = document.getElementById('jarvisTalkBar');
  if (bar) {
    bar.classList.remove('jtb-active', 'jtb-listening');
    if (state === 'speaking')  bar.classList.add('jtb-active');
    if (state === 'listening') bar.classList.add('jtb-listening');
  }

  // Log en el terminal de transcripción
  if (typeof appendJarvisLog === 'function') {
    const logMap = {
      listening:  'CIEL AI · Escuchando entrada de voz',
      processing: 'CIEL AI · Consultando IA...',
      idle:       null,
      speaking:   null,
    };
    if (logMap[state]) appendJarvisLog('system', logMap[state]);
  }
}


// ══════════════════════════════════════════════════════════════
// Limpieza de texto para TTS
// ══════════════════════════════════════════════════════════════
function _cleanTextForSpeech(text) {
  let clean = text
    // Quitar bloques de código
    .replace(/```[\s\S]*?```/g, ' [código omitido] ')
    // Quitar markdown bold/italic
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    // Quitar encabezados markdown
    .replace(/^#+\s/gm, '')
    // Quitar bullets
    .replace(/^[-*•]\s/gm, '')
    // Quitar emojis
    .replace(/[\u{1F300}-\u{1FFFF}]/gu, '')
    .replace(/[\u2600-\u27BF]/g, '')
    // Quitar URLs
    .replace(/https?:\/\/\S+/g, '')
    // Normalizar espacios
    .replace(/\s+/g, ' ')
    .trim();

  // Truncar si es muy largo
  if (clean.length > VoiceConfig.maxChars) {
    clean = clean.substring(0, VoiceConfig.maxChars) + '... respuesta truncada.';
  }

  return clean;
}

// ══════════════════════════════════════════════════════════════
// Exposición global
// ══════════════════════════════════════════════════════════════
window.PRQAVoice = {
  init:          initVoice,
  speak:         speak,
  stop:          stopSpeaking,
  toggleTTS:     toggleTTS,
  toggleMic:     toggleMic,
  isTTSEnabled:  isTTSEnabled,
  setOrbState:   setOrbState,
};
