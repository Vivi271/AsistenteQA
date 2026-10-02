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
  rate: 0.95,             // Velocidad natural y fluida
  pitch: 0.95,            // Tono natural masculino, sobrio y limpio
  volume: 1.0,            // Volumen al 100%
  lang: 'es-ES',          // Idioma preferido
  maxChars: 1800,         // Máximo de caracteres a leer
};

// Estado del módulo
let _ttsVoice = null;
let _sttRecognition = null;
let _isListening = false;
let _ttsEnabled = true;   // Toggle en caliente
let _currentUtterance = null;
let _currentSpeechId = 0;
let _ttsKeepAliveTimer = null;
let _speechStartTime = 0;  // Marca de tiempo cuando el mic realmente inicia
const STT_MIN_DELAY_MS = 450; // ms mínimos antes de mostrar transcripción (evita fantasy results)

// Registro global para evitar que V8 haga Garbage Collection de las utterances en vuelo
window._prqaActiveUtterances = window._prqaActiveUtterances || [];

// ══════════════════════════════════════════════════════════════
// Inicialización y Desbloqueo de Audio (Chrome Autoplay Policy)
// ══════════════════════════════════════════════════════════════
let _audioUnlocked = false;

function unlockAudio() {
  if (!window.speechSynthesis) return;
  _audioUnlocked = true;

  try {
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      if (!window._prqaAudioCtx) window._prqaAudioCtx = new AudioCtx();
      if (window._prqaAudioCtx.state === 'suspended') {
        window._prqaAudioCtx.resume();
      }
    }
  } catch (_) {}
}

function initVoice() {
  _loadVoices();
  if (window.speechSynthesis && window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = _loadVoices;
  }

  // Registrar desbloqueo en interacciones reales del usuario
  const unlockEvents = ['click', 'touchstart', 'keydown', 'pointerdown'];
  unlockEvents.forEach(evt => {
    document.addEventListener(evt, unlockAudio, { passive: true });
  });

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

  console.log('[PRQA Voice] Módulo de voz inicializado con soporte multivoz y anti-bloqueo.');
}

/**
 * Resuelve dinámicamente la mejor voz en español disponible en el sistema.
 * Prioriza voces nativas de alta calidad (neurales) de macOS/Chrome.
 */
function _resolveSpanishVoice() {
  if (!window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices() || [];
  if (voices.length === 0) return null;

  // 1. Voces masculinas de alta calidad en español (estilo Jarvis)
  //    macOS: Jorge (muy natural y sobria), Diego, Eddy
  //    Windows/Edge: Microsoft Pablo, Microsoft Raúl, Microsoft Álvaro
  const preferredOrder = [
    'Jorge',
    'Diego',
    'Microsoft Pablo',
    'Microsoft Raúl',
    'Microsoft Álvaro',
    'Eddy',
    'Reed',
    'Rocko',
    'Juan',
    'Carlos',
    'Google español',
    'Mónica',
    'Paulina'
  ];

  for (const name of preferredOrder) {
    const found = voices.find(v => {
      const vName = (v.name || '').toLowerCase();
      const vLang = (v.lang || '').replace('_', '-').toLowerCase();
      return vName.includes(name.toLowerCase()) && (vLang.startsWith('es') || vName.includes('español') || vName.includes('spanish'));
    });
    if (found) return found;
  }

  // Búsqueda más amplia por nombre parcial
  for (const name of preferredOrder) {
    const found = voices.find(v => (v.name || '').toLowerCase().includes(name.toLowerCase()));
    if (found) return found;
  }

  // Fallback: cualquier voz en español disponible
  const anyEs = voices.find(v => {
    const lang = (v.lang || '').replace('_', '-').toLowerCase();
    return lang.startsWith('es') || (v.name && v.name.toLowerCase().includes('spanish'));
  });
  if (anyEs) return anyEs;

  // Último fallback: voz por defecto del sistema
  return voices.find(v => v.default) || voices[0] || null;
}

function _loadVoices() {
  _ttsVoice = _resolveSpanishVoice();
  if (_ttsVoice) {
    console.log('[PRQA Voice] Voz Jarvis seleccionada:', _ttsVoice.name, `(${_ttsVoice.lang})`);
  }
}

/**
 * Divide el texto en oraciones naturales para evitar que Chrome detenga la síntesis
 * después de 15 segundos en textos largos.
 */
/**
 * Agrupa oraciones en bloques sustanciales (~220 chars mín) para que Chrome las reproduzca
 * en pocos utterances grandes → sin micro-pausas → voz fluida y natural.
 */
function _splitTextIntoSentences(text) {
  if (!text) return [];

  // Partir el texto en oraciones individuales
  const rawParts = text.match(/[^.!?]+[.!?]*/g) || [text];
  const chunks = [];
  let current = '';

  for (const part of rawParts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    current += (current ? ' ' : '') + trimmed;
    // Crear un chunk solo cuando acumulemos suficiente texto → elimina micro-pausas
    if (current.length >= 220) {
      chunks.push(current);
      current = '';
    }
  }
  // Agregar lo que sobre al último chunk
  if (current.trim()) {
    if (chunks.length > 0 && current.length < 100) {
      // Si el remanente es muy corto, unirlo al último chunk
      chunks[chunks.length - 1] += ' ' + current;
    } else {
      chunks.push(current);
    }
  }

  // Seguridad: fragmentar cualquier chunk mayor a 450 chars por espacio
  const result = [];
  for (const chunk of chunks) {
    if (chunk.length > 450) {
      const sub = chunk.match(/.{1,420}(\s+|$)/g) || [chunk];
      for (const s of sub) {
        const t = s.trim();
        if (t) result.push(t);
      }
    } else {
      result.push(chunk);
    }
  }

  return result.length > 0 ? result : [text.trim()];
}

// ══════════════════════════════════════════════════════════════
// Text-to-Speech (CIEL AI habla con Voz Neural Edge-TTS)
// ══════════════════════════════════════════════════════════════
let _currentAudio = null;
let _syncAnimFrame = null;

/**
 * Lee un texto en voz alta con síntesis NEURAL de alta calidad (Edge-TTS Jarvis).
 * Sincroniza la revelación del texto en tiempo real con la voz (escribe al tiempo).
 * @param {string} text - Texto a leer
 * @param {object} opts - { rate, pitch, volume, onStart, onProgress, onEnd }
 */
async function speak(text, opts = {}) {
  if (!_ttsEnabled) {
    if (typeof opts.onEnd === 'function') opts.onEnd();
    return;
  }

  const clean = _cleanTextForSpeech(text);
  if (!clean || !clean.trim()) {
    if (typeof opts.onEnd === 'function') opts.onEnd();
    return;
  }

  // Generar ID único para esta secuencia de habla
  const speechId = ++_currentSpeechId;
  stopSpeaking();
  _currentSpeechId = speechId;

  // 1. Intentar con voz Neural en el backend (Edge-TTS Jarvis: Álvaro)
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: clean,
        voice: opts.voice || 'es-ES-AlvaroNeural',
        rate: opts.rate || '-3%',
        pitch: opts.pitch || '-4Hz'
      })
    });

    if (res.ok) {
      if (speechId !== _currentSpeechId) return;
      const blob = await res.blob();
      if (speechId !== _currentSpeechId) return;

      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      _currentAudio = audio;

      audio.onplay = () => {
        if (speechId !== _currentSpeechId) return;
        _updateVoiceIndicator(true);
        if (typeof opts.onStart === 'function') opts.onStart();

        // Sincronización exacta en tiempo real (escribe al tiempo que habla)
        const words = text.split(/(\s+)/);
        const totalTokens = words.length;

        function syncLoop() {
          if (speechId !== _currentSpeechId || !audio || audio.paused || audio.ended) return;
          const duration = audio.duration || 1;
          const progress = Math.min(0.99, audio.currentTime / duration);
          const currentTokenIndex = Math.min(totalTokens, Math.floor(progress * totalTokens) + 1);
          const currentChunk = words.slice(0, currentTokenIndex).join('');

          if (typeof opts.onProgress === 'function') {
            opts.onProgress(currentChunk, progress);
          }
          _syncAnimFrame = requestAnimationFrame(syncLoop);
        }
        syncLoop();
      };

      audio.onended = () => {
        if (_syncAnimFrame) cancelAnimationFrame(_syncAnimFrame);
        _syncAnimFrame = null;
        try { URL.revokeObjectURL(audioUrl); } catch (_) {}
        _currentAudio = null;
        _updateVoiceIndicator(false);
        if (typeof opts.onProgress === 'function') {
          opts.onProgress(text, 1.0);
        }
        if (typeof opts.onEnd === 'function') {
          opts.onEnd();
        }
      };

      audio.onerror = (err) => {
        console.warn('[PRQA Voice] Error de audio neural, usando fallback local:', err);
        if (_syncAnimFrame) cancelAnimationFrame(_syncAnimFrame);
        _currentAudio = null;
        _speakWebSpeechFallback(clean, text, opts, speechId);
      };

      try {
        await audio.play();
        return;
      } catch (playErr) {
        console.warn('[PRQA Voice] audio.play() bloqueado, probando Web Audio API...', playErr);
        try {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          if (!window._prqaAudioCtx && AudioCtx) window._prqaAudioCtx = new AudioCtx();
          if (window._prqaAudioCtx) {
            if (window._prqaAudioCtx.state === 'suspended') await window._prqaAudioCtx.resume();
            const arrayBuf = await blob.arrayBuffer();
            const audioBuf = await window._prqaAudioCtx.decodeAudioData(arrayBuf);
            const source = window._prqaAudioCtx.createBufferSource();
            source.buffer = audioBuf;
            source.connect(window._prqaAudioCtx.destination);

            _updateVoiceIndicator(true);
            if (typeof opts.onStart === 'function') opts.onStart();

            const startTime = window._prqaAudioCtx.currentTime;
            const duration = audioBuf.duration;
            const words = text.split(/(\s+)/);
            const totalTokens = words.length;

            function webAudioSync() {
              if (speechId !== _currentSpeechId) return;
              const elapsed = window._prqaAudioCtx.currentTime - startTime;
              if (elapsed >= duration) return;
              const progress = Math.min(0.99, elapsed / duration);
              const currentTokenIndex = Math.min(totalTokens, Math.floor(progress * totalTokens) + 1);
              if (typeof opts.onProgress === 'function') {
                opts.onProgress(words.slice(0, currentTokenIndex).join(''), progress);
              }
              _syncAnimFrame = requestAnimationFrame(webAudioSync);
            }
            webAudioSync();

            source.onended = () => {
              if (_syncAnimFrame) cancelAnimationFrame(_syncAnimFrame);
              _syncAnimFrame = null;
              _updateVoiceIndicator(false);
              if (typeof opts.onProgress === 'function') opts.onProgress(text, 1.0);
              if (typeof opts.onEnd === 'function') opts.onEnd();
            };

            source.start(0);
            return;
          }
        } catch (webaudioErr) {
          console.warn('[PRQA Voice] Error Web Audio fallback:', webaudioErr);
        }
        _speakWebSpeechFallback(clean, text, opts, speechId);
        return;
      }
    }
  } catch (netErr) {
    console.warn('[PRQA Voice] Endpoint TTS offline, usando fallback local:', netErr);
  }

  // Fallback a Web Speech API del navegador en caso de no haber red
  _speakWebSpeechFallback(clean, text, opts, speechId);
}

function _speakWebSpeechFallback(clean, fullText, opts, speechId) {
  if (!_ttsEnabled || !window.speechSynthesis) {
    if (typeof opts.onEnd === 'function') opts.onEnd();
    return;
  }

  const sentences = _splitTextIntoSentences(clean);
  if (sentences.length === 0) {
    if (typeof opts.onEnd === 'function') opts.onEnd();
    return;
  }

  _updateVoiceIndicator(true);
  if (typeof opts.onStart === 'function') opts.onStart();

  let currentIndex = 0;
  let accumulatedChars = 0;
  const totalChars = clean.length || 1;

  function playNext() {
    if (speechId !== _currentSpeechId) return;
    if (currentIndex >= sentences.length) {
      _updateVoiceIndicator(false);
      if (typeof opts.onProgress === 'function') opts.onProgress(fullText, 1.0);
      if (typeof opts.onEnd === 'function') opts.onEnd();
      return;
    }

    const sText = sentences[currentIndex++];
    const utterance = new SpeechSynthesisUtterance(sText);
    const voice = _resolveSpanishVoice();
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang || 'es-ES';
    utterance.rate = 0.95;   // Velocidad fluida y natural
    utterance.pitch = 0.95;  // Tono natural masculino, no distorsionado

    _currentUtterance = utterance;
    window._prqaActiveUtterances.push(utterance);

    utterance.onboundary = (evt) => {
      if (typeof opts.onProgress === 'function' && evt.charIndex !== undefined) {
        const estProgress = Math.min(0.98, (accumulatedChars + evt.charIndex) / totalChars);
        const charsToShow = Math.floor(estProgress * fullText.length);
        opts.onProgress(fullText.slice(0, charsToShow), estProgress);
      }
    };

    utterance.onend = () => {
      accumulatedChars += sText.length;
      const idx = window._prqaActiveUtterances.indexOf(utterance);
      if (idx !== -1) window._prqaActiveUtterances.splice(idx, 1);
      if (typeof opts.onProgress === 'function') {
        const estProgress = Math.min(1.0, accumulatedChars / totalChars);
        const charsToShow = Math.floor(estProgress * fullText.length);
        opts.onProgress(fullText.slice(0, charsToShow), estProgress);
      }
      playNext();
    };

    utterance.onerror = () => {
      accumulatedChars += sText.length;
      playNext();
    };

    try {
      window.speechSynthesis.speak(utterance);
    } catch (_) {
      playNext();
    }
  }

  playNext();
}

// Cola de habla secuencial para streaming
let _speechQueue = [];
let _isProcessingQueue = false;
let _queueEndCallback = null;
let _isStreamingActive = false;

function initStreamSpeech(onAllDone) {
  stopSpeaking();
  _speechQueue = [];
  _isProcessingQueue = false;
  _queueEndCallback = onAllDone;
  _isStreamingActive = true;
}

function queueSentence(sentence) {
  if (!_ttsEnabled || !window.speechSynthesis) return;
  const clean = _cleanTextForSpeech(sentence);
  if (!clean || clean.length < 2) return;
  _speechQueue.push(clean);
  _drainSpeechQueue();
}

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
  const voice = _resolveSpanishVoice();
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang || 'es-ES';
  } else {
    utterance.lang = VoiceConfig.lang || 'es-ES';
  }

  utterance.rate   = VoiceConfig.rate;
  utterance.pitch  = 1.0;
  utterance.volume = VoiceConfig.volume;

  _currentUtterance = utterance;
  window._prqaActiveUtterances.push(utterance);
  _updateVoiceIndicator(true);

  const onSentenceEnd = () => {
    const idx = window._prqaActiveUtterances.indexOf(utterance);
    if (idx !== -1) window._prqaActiveUtterances.splice(idx, 1);
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
      console.warn('[PRQA Voice] Error de fragmento:', e.error);
    }
    onSentenceEnd();
  };

  try {
    window.speechSynthesis.speak(utterance);
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
  } catch (_) {
    onSentenceEnd();
  }
}

/** Detiene inmediatamente cualquier habla activa y cancela animaciones. */
function stopSpeaking() {
  _currentSpeechId++;
  if (_syncAnimFrame) {
    cancelAnimationFrame(_syncAnimFrame);
    _syncAnimFrame = null;
  }
  if (_currentAudio) {
    try {
      _currentAudio.pause();
      _currentAudio.currentTime = 0;
    } catch (_) {}
    _currentAudio = null;
  }
  _speechQueue = [];
  _isProcessingQueue = false;
  _isStreamingActive = false;
  _queueEndCallback = null;
  window._prqaActiveUtterances = [];
  _currentUtterance = null;

  if (window.speechSynthesis) {
    try {
      if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
        window.speechSynthesis.cancel();
      }
    } catch (_) {}
  }
  if (_ttsKeepAliveTimer) {
    clearInterval(_ttsKeepAliveTimer);
    _ttsKeepAliveTimer = null;
  }
  _updateVoiceIndicator(false);
}

/** Activa/desactiva el TTS desde el botón de la UI. */
function toggleTTS() {
  _ttsEnabled = !_ttsEnabled;
  _updateTTSButton();

  if (!_ttsEnabled) {
    stopSpeaking();
    showToast('🔇 Voz silenciada', 'info');
    // Si la IA estaba respondiendo, delegar limpieza al callback registrado por app.js
    // Esto garantiza que _isAIProcessing se libere correctamente a través de _finishAI()
    if (typeof window._onTTSMutedDuringSpeech === 'function') {
      try { window._onTTSMutedDuringSpeech(); } catch (_) {}
    }
    // Si no hay callback activo (silenciando cuando IA está idle), solo resetear orb visual
    if (!window._isAIProcessing) {
      setOrbState('idle');
    }
  } else {
    showToast('🔊 CIEL AI activada (Voz Jarvis Neural)', 'success');
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
    stopSpeaking();
    _speechStartTime = Date.now();
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
  _speechStartTime = Date.now();  // ← Registrar el momento exacto en que el mic arranca
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

  // ── GUARDIA ANTI-FANTASMA ────────────────────────────────────────
  // Ignorar cualquier resultado (interim o final) que llegue antes de
  // STT_MIN_DELAY_MS ms desde que el mic se activó.
  // Esto evita que el browser Web Speech API transcriba ruido de fondo
  // o sonidos del sistema que detecta al inicializar el micrófono.
  const elapsed = Date.now() - _speechStartTime;
  if (elapsed < STT_MIN_DELAY_MS) {
    return;  // Demasiado pronto — descartar silenciosamente
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

  // Mostrar transcripción en tiempo real en el panel (solo tras el delay)
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
  unlockAudio:        unlockAudio,
};

// Auto-inicialización
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initVoice);
  } else {
    initVoice();
  }
}
