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

  // Limpiar texto: formatear saltos y bullets para que suene continuo y natural
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
    if (typeof opts.onStart === 'function') opts.onStart(clean);
  };

  utterance.onboundary = (e) => {
    if (typeof opts.onBoundary === 'function') {
      opts.onBoundary(e, clean);
    }
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

// Cola de habla secuencial para streaming de oraciones en tiempo real
let _speechQueue = [];
let _isProcessingQueue = false;
let _queueEndCallback = null;
let _isStreamingActive = false;

/**
 * Prepara la cola de voz para recibir oraciones en tiempo real mientras la IA genera texto.
 */
function initStreamSpeech(onAllDone) {
  stopSpeaking();
  _speechQueue = [];
  _isProcessingQueue = false;
  _queueEndCallback = onAllDone;
  _isStreamingActive = true;
}

/**
 * Añade una oración completada a la cola de voz y la reproduce de inmediato si no hay otra sonando.
 */
function queueSentence(sentence) {
  if (!_ttsEnabled || !window.speechSynthesis) return;
  const clean = _cleanTextForSpeech(sentence);
  if (!clean || clean.length < 2) return;
  _speechQueue.push(clean);
  _drainSpeechQueue();
}

/**
 * Avisa que la IA terminó de emitir texto. Si la cola ya se vació, notifica fin.
 */
function finishStreamSpeech() {
  _isStreamingActive = false;
  if (_speechQueue.length === 0 && !_isProcessingQueue) {
    _updateVoiceIndicator(false);
    if (typeof _queueEndCallback === 'function') {
      const cb = _queueEndCallback;
      _queueEndCallback = null;
      cb();
    }
  }
}

function _drainSpeechQueue() {
  if (_isProcessingQueue || _speechQueue.length === 0) return;
  if (!_ttsEnabled || !window.speechSynthesis) return;

  const text = _speechQueue.shift();
  _isProcessingQueue = true;

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate   = VoiceConfig.rate;
  utterance.pitch  = VoiceConfig.pitch;
  utterance.volume = VoiceConfig.volume;
  if (_ttsVoice) utterance.voice = _ttsVoice;
  utterance.lang = VoiceConfig.lang;

  utterance.onstart = () => {
    _currentUtterance = utterance;
    _updateVoiceIndicator(true);
  };

  const onSentenceEnd = () => {
    _currentUtterance = null;
    _isProcessingQueue = false;
    if (_speechQueue.length > 0) {
      _drainSpeechQueue();
    } else {
      if (!_isStreamingActive) {
        _updateVoiceIndicator(false);
        if (typeof _queueEndCallback === 'function') {
          const cb = _queueEndCallback;
          _queueEndCallback = null;
          cb();
        }
      }
    }
  };

  utterance.onend = onSentenceEnd;
  utterance.onerror = (e) => {
    if (e.error !== 'interrupted' && e.error !== 'canceled') {
      console.warn('[PRQA Voice] Chunk TTS error:', e.error);
    }
    onSentenceEnd();
  };

  window.speechSynthesis.speak(utterance);
}

/** Detiene inmediatamente cualquier habla activa y vacía la cola. */
function stopSpeaking() {
  _speechQueue = [];
  _isProcessingQueue = false;
  _isStreamingActive = false;
  _queueEndCallback = null;
  if (window.speechSynthesis) {
    try { window.speechSynthesis.cancel(); } catch (_) {}
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
    showToast('🔇 Voz silenciada', 'info');
    if (window._isAIProcessing && typeof _setStopBtnActive === 'function') {
      // Si la IA estaba hablando y se silencia, liberar el estado
      window._isAIProcessing = false;
      _setStopBtnActive(false);
      setOrbState('idle');
    }
  } else {
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
 */
function toggleMic() {
  if (!_sttRecognition) {
    initVoice();
  }
  if (!_sttRecognition) {
    showToast('Tu navegador no soporta reconocimiento de voz. Usa Google Chrome o Edge.', 'warning');
    return;
  }

  // Bloquear el mic si CIEL AI está procesando o hablando
  if (window._isAIProcessing) {
    showToast('⚠️ CIEL AI está respondiendo. Presiona DETENER para interrumpir.', 'warning');
    return;
  }

  // Abrir panel de transcripción si está cerrado para ver la voz en vivo
  if (typeof toggleTranscriptDrawer === 'function') {
    const panel = document.getElementById('jarvisLogPanel');
    if (panel && panel.classList.contains('hidden')) {
      toggleTranscriptDrawer();
    }
  }

  if (_isListening) {
    _isListening = false;
    try { _sttRecognition.stop(); } catch (_) {}
    setOrbState('idle');
    _updateMicButton(false);
  } else {
    try {
      _sttRecognition.start();
    } catch(e) {
      console.warn('[PRQA Voice] STT start error:', e);
      try {
        _sttRecognition.stop();
        setTimeout(() => { try { _sttRecognition.start(); } catch(_) {} }, 200);
      } catch(_) {}
    }
  }
}

function _onSpeechStart() {
  _isListening = true;
  _updateMicButton(true);
  setOrbState('listening');
  showToast('🎤 Escuchando... habla ahora', 'info');
}

function abortListening() {
  _isListening = false;
  try {
    if (_sttRecognition) _sttRecognition.abort();
  } catch (_) {}
  _updateMicButton(false);
}

function _onSpeechResult(event) {
  if (window._isAIProcessing) {
    // Si la IA ya está procesando o respondiendo, ignorar cualquier audio captado por el mic
    abortListening();
    return;
  }

  let interimTranscript = '';
  let finalTranscript = '';

  for (let i = 0; i < event.results.length; ++i) {
    if (event.results[i].isFinal) {
      finalTranscript += event.results[i][0].transcript;
    } else {
      interimTranscript += event.results[i][0].transcript;
    }
  }

  const currentDisplay = (finalTranscript + ' ' + interimTranscript).trim();

  // Mostrar transcripción en tiempo real en el panel
  if (typeof appendOrUpdateUserInterim === 'function' && currentDisplay) {
    appendOrUpdateUserInterim(currentDisplay);
  }

  const lastResult = event.results[event.results.length - 1];
  if (lastResult && lastResult.isFinal) {
    const fullText = (finalTranscript || currentDisplay).trim();
    if (fullText.length > 0) {
      abortListening();
      setOrbState('processing');

      setTimeout(() => {
        if (typeof queryCielAI === 'function') {
          queryCielAI(fullText);
        }
      }, 150);
    }
  }
}

function _onSpeechError(event) {
  _isListening = false;
  _updateMicButton(false);
  const msg = {
    'network': 'Sin conexión de red para el reconocimiento de voz.',
    'not-allowed': 'Permiso de micrófono denegado. Habilítalo en el navegador.',
    'no-speech': null, // No spamear alerta si solo hubo silencio
    'aborted': null,
  }[event.error];
  if (msg) showToast(msg, 'warning');
}

function _onSpeechEnd() {
  _isListening = false;
  _updateMicButton(false);
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
  const center = document.getElementById('jtbCenter') || document.querySelector('.jtb-center-area');
  const label  = document.getElementById('voiceStatusText') || document.getElementById('jtbSubLabel') || document.getElementById('jtbLabel');
  const cloud  = document.getElementById('energyCloud') || document.getElementById('jarvisEnergyCloud');
  const bar    = document.getElementById('jarvisTalkBar');
  const stopBtn = document.getElementById('tpStopBtn');

  if (center) {
    center.classList.remove('jtb-listening', 'jtb-speaking', 'jtb-processing');
    if (state !== 'idle') center.classList.add(`jtb-${state}`);
  }

  const subLabels = {
    idle:       'Toca para comenzar...',
    listening:  'Escuchando...',
    processing: 'Procesando...',
    speaking:   'Hablando...',
  };
  if (label) label.textContent = subLabels[state] || 'Toca para comenzar...';

  // Animar el energy cloud orb central
  if (cloud) {
    cloud.classList.remove('ec-listening', 'ec-speaking', 'ec-processing');
    if (state === 'listening')  cloud.classList.add('ec-listening');
    if (state === 'speaking')   cloud.classList.add('ec-speaking');
    if (state === 'processing') cloud.classList.add('ec-processing');
  }

  // Animar los dots de la barra según el estado
  if (bar) {
    bar.classList.remove('jtb-active', 'jtb-listening');
    if (state === 'speaking')  bar.classList.add('jtb-active');
    if (state === 'listening') bar.classList.add('jtb-listening');
  }

  // Botón DETENER / EN ESPERA
  if (stopBtn) {
    const span = stopBtn.querySelector('span');
    if (state === 'speaking' || state === 'processing') {
      stopBtn.classList.remove('is-idle');
      stopBtn.classList.add('is-active');
      stopBtn.removeAttribute('disabled');
      stopBtn.title = 'Detener respuesta de CIEL AI';
      if (span) span.textContent = 'DETENER';
    } else {
      stopBtn.classList.add('is-idle');
      stopBtn.classList.remove('is-active');
      stopBtn.setAttribute('disabled', 'true');
      stopBtn.title = 'CIEL AI en espera';
      if (span) span.textContent = 'EN ESPERA';
    }
  }

  // No loguear estados en la transcripción — ya se refleja en el orb visual
}


// ══════════════════════════════════════════════════════════════
// Limpieza de texto para TTS
// ══════════════════════════════════════════════════════════════
function _cleanTextForSpeech(text) {
  let clean = text
    // Quitar bloques de código
    .replace(/```[\s\S]*?```/g, ' [código omitido] ')
    // Convertir bullets y listas a pausas naturales en español
    .replace(/\n\s*[-*•]\s*/g, '. ')
    .replace(/^[-*•]\s*/gm, '')
    // Quitar markdown bold/italic
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    // Quitar encabezados markdown
    .replace(/^#+\s/gm, '')
    // Quitar emojis
    .replace(/[\u{1F300}-\u{1FFFF}]/gu, '')
    .replace(/[\u2600-\u27BF]/g, '')
    // Quitar URLs
    .replace(/https?:\/\/\S+/g, '')
    // Convertir saltos de línea restantes en pausas de punto
    .replace(/\n+/g, '. ')
    .replace(/\s*\.\s*\./g, '.')
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
  init:               initVoice,
  speak:              speak,
  initStreamSpeech:   initStreamSpeech,
  queueSentence:      queueSentence,
  finishStreamSpeech: finishStreamSpeech,
  stop:               stopSpeaking,
  toggleTTS:          toggleTTS,
  toggleMic:          toggleMic,
  toggleListening:    toggleMic,
  startListening:     toggleMic,
  abortListening:     abortListening,
  isTTSEnabled:       isTTSEnabled,
  setOrbState:        setOrbState,
};

// Auto-inicialización
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initVoice);
  } else {
    initVoice();
  }
}
