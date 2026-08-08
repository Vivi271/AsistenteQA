"""
PRQA — test_generator.py
Motor de generación de casos de prueba QA profesionales (estándar EOPA DTR029C).
Genera casos de prueba de alta calidad usando el LLM local de Ollama con lotes
secuenciales confiables. Incluye motor de análisis semántico de dominio como respaldo.
"""
import os
import json
import re
import asyncio
from typing import List, Optional
import ollama

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://ollama:11434")
LLM_MODEL = os.getenv("LLM_MODEL", "llama3.2:3b")

from rag_pipeline import RAGPipeline

TEST_TYPES = [
    "FUNCIONALES",
    "NO FUNCIONALES",
    "INTEGRACION",
    "CASOS NEGATIVOS",
    "SEGURIDAD",
    "CARGA",
    "ESTRESS",
    "COMPATIBILIDAD",
    "RESILIENCIA"
]
TIPOS = ["CORE", "PROV", "VAL", "RNEG"]

SEVERIDADES = ["Bloqueante", "Crítico", "Tolerable", "Interfaz de usuario"]

# ─── Prompt profesional EOPA DTR029C ──────────────────────────────────────────
GENERATOR_PROMPT = """Eres un QA Engineer senior de Ciel Ingeniería S.A.S. Debes generar casos de prueba EOPA profesionales y detallados para el siguiente requerimiento.

REQUERIMIENTO:
{requirement}

CONTEXTO ADICIONAL:
{context}

INSTRUCCIONES ESTRICTAS:
- Genera exactamente {num_cases} casos de prueba de tipo(s): {test_types}
- El campo "title" es la DESCRIPCIÓN DE LA ACCIÓN: una oración completa y específica que describe exactamente qué acción ejecuta el tester (incluye datos concretos, campos específicos, pasos de navegación).
  Ejemplos correctos:
  • "Ingresar un código de pedido con formato inválido (ej: 'PED#999') en el campo 'Buscar pedido' y presionar el botón Confirmar"
  • "Enviar una consulta sobre política de devolución con el texto 'Quiero devolver mi producto comprado hace 40 días' y verificar la respuesta del sistema"
  • "Configurar el parámetro de resolución con valor vacío y guardar el formulario de configuración del módulo {module}"
  NUNCA uses títulos vagos como "Verificar respuesta" o "Prueba de integración" sin contexto específico.
- El campo "expected_result" describe el RESULTADO ESPERADO observable: qué muestra exactamente el sistema (mensajes de error/éxito entre comillas, estados, valores concretos).
  Ejemplos correctos:
  • "El sistema muestra el mensaje 'Código de pedido inválido, verifique el formato (ej: PED-001)' en rojo debajo del campo."
  • "El chatbot responde con el estado del pedido: 'Su pedido está En proceso de envío' y proporciona el número de seguimiento."
  • "El sistema bloquea el guardado y muestra 'El campo Resolución es obligatorio' resaltado en naranja."

Devuelve ÚNICAMENTE el array JSON sin texto adicional ni bloques de código:
[
  {{
    "title": "[Descripción completa y específica de la acción del tester con datos concretos]",
    "test_type": "{first_type}",
    "expected_result": "[Resultado observable específico con mensajes exactos entre comillas y estados del sistema]"
  }}
]"""



class TestCaseGenerator:
    """Genera casos de prueba EOPA profesionales usando LLM local."""

    def __init__(self, rag: RAGPipeline):
        self.rag = rag
        self.ollama_client = ollama.Client(host=OLLAMA_HOST, timeout=40.0)
        self._case_counter: dict = {}

    # ─────────────────────────────────────────────────────────────────────────
    # ID Generator
    # ─────────────────────────────────────────────────────────────────────────
    def _next_id(self, test_type: str, category: str, project_name: str, module: str = "General") -> str:
        """Genera ID EOPA profesional: [PROJ]-[TIPO]-[MOD]-[NN]."""
        clean_proj = re.sub(r'[^A-Za-z0-9]', '', project_name).upper()
        words = [w for w in project_name.split() if w.isalnum()]
        if len(words) >= 2:
            proj_prefix = "".join(w[0] for w in words).upper()[:4]
        else:
            proj_prefix = clean_proj[:4] if clean_proj else "PRQA"

        tt = test_type.upper()
        if "NEG" in tt or category == "RNEG":
            tipo = "NEG"
        elif "SEG" in tt or "SEC" in tt:
            tipo = "SEC"
        elif "INT" in tt:
            tipo = "INT"
        elif "NOF" in tt or "NO F" in tt or "COMPAT" in tt:
            tipo = "NOF"
        elif "CARGA" in tt or "ESTRESS" in tt or "REND" in tt:
            tipo = "PER"
        elif "RESIL" in tt:
            tipo = "RES"
        else:
            tipo = "FUN"

        clean_mod = re.sub(r'[^A-Za-z0-9]', '', module).upper()
        mod_words = [w for w in module.split() if w.isalnum()]
        if len(mod_words) >= 2:
            mod = "".join(w[0] for w in mod_words).upper()[:3]
        else:
            mod = clean_mod[:3] if clean_mod else "GEN"

        key = f"{proj_prefix}_{tipo}_{mod}"
        self._case_counter[key] = self._case_counter.get(key, 0) + 1
        return f"{proj_prefix}-{tipo}-{mod}-{self._case_counter[key]:02d}"

    # ─────────────────────────────────────────────────────────────────────────
    # JSON Extraction & Repair
    # ─────────────────────────────────────────────────────────────────────────
    def _fix_truncated_json(self, text: str) -> str:
        text = text.strip()
        text = re.sub(r',\s*$', '', text)
        in_string = escape = False
        for ch in text:
            if escape: escape = False; continue
            if ch == '\\': escape = True; continue
            if ch == '"': in_string = not in_string
        if in_string:
            text += '"'
        opened = []
        in_string = escape = False
        for ch in text:
            if escape: escape = False; continue
            if ch == '\\': escape = True; continue
            if ch == '"': in_string = not in_string; continue
            if in_string: continue
            if ch in ('{', '['): opened.append(ch)
            elif ch == '}' and opened and opened[-1] == '{': opened.pop()
            elif ch == ']' and opened and opened[-1] == '[': opened.pop()
        for s in reversed(opened):
            text += '}' if s == '{' else ']'
        return text

    def _extract_json_array(self, text: str) -> list:
        text = text.strip()
        for pattern in [
            r'```json\s*(\[[\s\S]*?\])\s*```',
            r'```\s*(\[[\s\S]*?\])\s*```',
        ]:
            m = re.search(pattern, text)
            if m:
                try: return json.loads(m.group(1))
                except: pass
        for start in range(len(text)):
            if text[start] == '[':
                try: return json.loads(text[start:])
                except:
                    try: return json.loads(self._fix_truncated_json(text[start:]))
                    except: pass
        for start in range(len(text)):
            if text[start] == '{':
                try:
                    obj = json.loads(self._fix_truncated_json(text[start:]))
                    return [obj] if isinstance(obj, dict) else obj
                except: pass
        raise ValueError("JSON no extraíble de la respuesta del LLM.")

    # ─────────────────────────────────────────────────────────────────────────
    # Validate case fields
    # ─────────────────────────────────────────────────────────────────────────
    def _validate_case(self, case: dict, idx: int) -> dict:
        tt = case.get("test_type", "")
        return {
            "title": case.get("title") or f"Caso de prueba {idx+1}",
            "test_type": tt if tt in TEST_TYPES else "FUNCIONALES",
            "category": case.get("category") if case.get("category") in TIPOS else "CORE",
            "severity": case.get("severity") or "Tolerable",
            "preconditions": case.get("preconditions") or "",
            "steps": "[]",
            "expected_result": case.get("expected_result") or "El sistema responde correctamente.",
            "acceptance_criteria": case.get("acceptance_criteria") or "",
            "technique": "",
        }

    # ─────────────────────────────────────────────────────────────────────────
    # Domain-aware smart fallback (NO generic boilerplate)
    # ─────────────────────────────────────────────────────────────────────────
    def _smart_fallback(
        self,
        req_text: str,
        project_name: str,
        module: str,
        test_types: List[str],
        count: int,
    ) -> List[dict]:
        """
        Motor de respaldo semántico: extrae contexto real del requerimiento
        y genera casos de prueba EOPA profesionales con descripciones detalladas.
        """
        # ── 1. Extraer oraciones del requerimiento ─────────────────────────────
        sents = [s.strip() for s in re.split(r'[.\n;]', req_text) if len(s.strip()) > 30]
        if not sents:
            sents = [req_text[:300]]

        # ── 2. Extraer entidades clave del dominio ─────────────────────────────
        nouns = re.findall(
            r'\b([A-ZÁÉÍÓÚ][a-záéíóúñ]{3,}|PDF|DOCX|API|URL|token|contraseña|'
            r'usuario|documento|contrato|formulario|reporte|factura|registro|'
            r'sesión|módulo|sistema|servicio|base de datos|código|campo|botón|'
            r'archivo|parámetro|configuración|cliente|pedido|solicitud)\b',
            req_text
        )
        nouns = list(dict.fromkeys(nouns))[:6] or [module, "sistema"]

        verbs_found = re.findall(
            r'\b(cargar|subir|descargar|registrar|consultar|buscar|actualizar|'
            r'eliminar|validar|autenticar|generar|enviar|notificar|exportar|'
            r'importar|procesar|calcular|firmar|aprobar|rechazar|listar|crear|'
            r'ingresar|configurar|guardar|verificar|ejecutar)\b',
            req_text.lower()
        )
        verbs_found = list(dict.fromkeys(verbs_found))[:5] or ["procesar"]

        # Datos de prueba concretos según el dominio detectado
        sample_data = {
            "código": "'PED#999'", "usuario": "'usuario_test@ciel.com'",
            "contraseña": "'Pass#1234'", "documento": "'Contrato_prueba.pdf'",
            "fecha": "'2025-02-30'", "formulario": "con todos los campos en blanco",
            "registro": "ID: 00000 (inexistente)", "token": "'TOKEN-INVALIDO-XYZ'",
        }

        cases = []
        for i in range(count):
            t_type = test_types[i % len(test_types)]
            sent   = sents[i % len(sents)]
            noun   = nouns[i % len(nouns)]
            verb   = verbs_found[i % len(verbs_found)]
            noun_l = noun.lower()
            sample = sample_data.get(noun_l, f"datos de prueba para {noun_l}")

            # ── Construcción de descripción detallada según tipo ───────────────
            if t_type == "FUNCIONALES":
                title = (
                    f"{verb.capitalize()} el/la {noun_l} en el módulo '{module}' "
                    f"con datos válidos y verificar que el sistema procesa correctamente "
                    f"la operación según el requerimiento: «{sent[:80].rstrip('.')}»"
                )
                expected = (
                    f"El sistema confirma la operación con el mensaje "
                    f"'Operación completada exitosamente' y el registro de {noun_l} "
                    f"queda guardado y visible en la lista principal. "
                    f"No se presentan errores. Tiempo de respuesta ≤ 3 s."
                )
                cat, sev = "CORE", "Crítico"

            elif t_type == "CASOS NEGATIVOS":
                title = (
                    f"Intentar {verb} el/la {noun_l} con el valor inválido {sample} "
                    f"en el campo correspondiente del módulo '{module}' y confirmar la acción"
                )
                expected = (
                    f"El sistema bloquea la operación y muestra el mensaje de validación "
                    f"'El formato de {noun_l} no es válido. Verifique los datos ingresados.' "
                    f"resaltado en rojo. No se persiste ningún dato incorrecto en la base de datos."
                )
                cat, sev = "RNEG", "Crítico"

            elif t_type == "SEGURIDAD":
                title = (
                    f"Intentar {verb} el/la {noun_l} inyectando código malicioso "
                    f"(ej: <script>alert('XSS')</script> y ' OR '1'='1) en el campo de {noun_l} "
                    f"del módulo '{module}' y observar la respuesta del sistema"
                )
                expected = (
                    f"El sistema sanitiza la entrada y muestra el mensaje "
                    f"'Entrada no válida detectada. La operación ha sido bloqueada.' "
                    f"Devuelve HTTP 403. El intento queda registrado en el log de auditoría "
                    f"con timestamp, usuario y dirección IP."
                )
                cat, sev = "RNEG", "Bloqueante"

            elif t_type == "INTEGRACION":
                title = (
                    f"Ejecutar la integración del endpoint de {noun_l} en '{module}' "
                    f"enviando una petición HTTP con payload válido "
                    f"({verb}: {sent[:60].rstrip('.')}) y verificar la respuesta del servicio"
                )
                expected = (
                    f"El endpoint responde HTTP 200 OK en menos de 1.5 s. "
                    f"El JSON de respuesta contiene los campos requeridos: 'status: success', "
                    f"'data', 'message'. No se presentan errores 4xx ni 5xx en el log del servidor."
                )
                cat, sev = "PROV", "Crítico"

            elif t_type == "NO FUNCIONALES":
                title = (
                    f"Abrir el módulo '{module}' en Chrome, Firefox y Edge y ejecutar "
                    f"la función de {verb} {noun_l} en resolución 1366x768 y en dispositivo "
                    f"móvil (iOS/Android) verificando usabilidad y accesibilidad"
                )
                expected = (
                    f"La interfaz de '{module}' se renderiza sin desalineación en los 3 navegadores. "
                    f"Los botones y campos son accesibles (WCAG 2.1 AA). "
                    f"Los mensajes de la función {verb} son legibles y con contraste adecuado. "
                    f"La pantalla es responsiva en móvil."
                )
                cat, sev = "CORE", "Tolerable"

            elif t_type in ("CARGA", "ESTRESS"):
                usuarios = "500" if t_type == "ESTRESS" else "100"
                title = (
                    f"Simular {usuarios} usuarios concurrentes ejecutando la acción de "
                    f"{verb} {noun_l} en el módulo '{module}' durante 5 minutos continuos "
                    f"usando JMeter y registrar métricas de rendimiento"
                )
                expected = (
                    f"Tiempo de respuesta promedio ≤ 2 s (P95 ≤ 3 s). Tasa de error < 1%. "
                    f"La CPU del servidor no supera el 85%. "
                    f"{'El sistema se degrada de forma controlada y se recupera en menos de 60 s al reducir la carga.' if t_type == 'ESTRESS' else 'El sistema mantiene estabilidad sin errores HTTP 500 durante toda la prueba.'}"
                )
                cat, sev = "CORE", "Bloqueante" if t_type == "ESTRESS" else "Crítico"

            elif t_type == "COMPATIBILIDAD":
                title = (
                    f"Acceder al módulo '{module}' desde iOS 16+, Android 13+ y Windows 11 "
                    f"y ejecutar el flujo completo de {verb} {noun_l} en cada plataforma, "
                    f"verificando consistencia visual y funcional"
                )
                expected = (
                    f"El módulo '{module}' ejecuta la acción de {verb} {noun_l} correctamente "
                    f"en todas las plataformas. La interfaz es responsiva, los formularios "
                    f"funcionan en pantalla táctil y los resultados son idénticos en cada dispositivo."
                )
                cat, sev = "CORE", "Tolerable"

            elif t_type == "RESILIENCIA":
                title = (
                    f"Simular una caída del servicio de base de datos mientras se ejecuta "
                    f"la acción de {verb} {noun_l} en el módulo '{module}', luego restaurar "
                    f"la conexión y reintentar la operación"
                )
                expected = (
                    f"Durante la caída: el sistema muestra 'Servicio no disponible temporalmente. "
                    f"Intente de nuevo en unos momentos.' sin perder los datos ingresados. "
                    f"Al restaurar: la operación de {verb} {noun_l} se completa exitosamente "
                    f"sin necesidad de reingresar información."
                )
                cat, sev = "PROV", "Crítico"

            else:
                title = (
                    f"{verb.capitalize()} {noun_l} en el módulo '{module}': "
                    f"{sent[:100].rstrip('.')}"
                )
                expected = (
                    f"El sistema procesa correctamente la operación de {verb} {noun_l} "
                    f"mostrando confirmación visual y actualizando el estado en la interfaz."
                )
                cat, sev = "CORE", "Tolerable"

            cases.append({
                "title": title,
                "test_type": t_type,
                "category": cat,
                "severity": sev,
                "expected_result": expected,
            })

        return cases


    # ─────────────────────────────────────────────────────────────────────────
    # Main generator (LLM + smart fallback)
    # ─────────────────────────────────────────────────────────────────────────
    async def generate(
        self,
        requirement_text: str,
        project_name: str = "Proyecto",
        module: str = "General",
        test_types: List[str] = None,
        num_cases: int = 10,
    ) -> List[dict]:
        """
        Genera casos de prueba EOPA a partir del requerimiento.
        Estrategia:
          1. Llamada al LLM local en lotes pequeños (3 casos c/u).
          2. Si el LLM falla o agota el tiempo, completa con motor semántico de dominio.
        """
        if not test_types:
            test_types = ["FUNCIONALES", "CASOS NEGATIVOS", "SEGURIDAD"]

        # Recuperar contexto del RAG (limitado para no saturar el prompt)
        context = ""
        try:
            context, _ = await asyncio.wait_for(self.rag.retrieve(requirement_text[:400], n_results=2), timeout=8.0)
            context = context[:400] if context else ""
        except Exception:
            context = ""

        req_clean = requirement_text[:800].strip()
        all_raw: List[dict] = []
        remaining = num_cases
        type_idx = 0
        BATCH = 5  # Procesar en lotes de 5 para reducir llamadas

        while remaining > 0 and len(all_raw) < num_cases:
            batch_count = min(remaining, BATCH)
            # Distribuir tipos de prueba uniformemente entre lotes
            batch_types = list(dict.fromkeys(
                test_types[(type_idx + j) % len(test_types)] for j in range(batch_count)
            ))
            type_idx += batch_count

            prompt = GENERATOR_PROMPT.format(
                requirement=req_clean,
                context=context or "Sin contexto adicional.",
                num_cases=batch_count,
                test_types=", ".join(batch_types),
                first_type=batch_types[0],
                module=module,
            )

            try:
                resp = await asyncio.wait_for(
                    asyncio.get_event_loop().run_in_executor(
                        None,
                        lambda p=prompt: self.ollama_client.chat(
                            model=LLM_MODEL,
                            messages=[{"role": "user", "content": p}],
                            options={"temperature": 0.2, "num_predict": 450, "stop": ["```\n\n", "\n\n\n"]},
                        )
                    ),
                    timeout=35.0
                )
                raw_text = resp["message"]["content"]
                parsed = self._extract_json_array(raw_text)
                batch = parsed if isinstance(parsed, list) else [parsed]
                # Filtrar elementos que no sean dicts
                batch = [c for c in batch if isinstance(c, dict)]
                if batch:
                    all_raw.extend(batch)
                    remaining -= len(batch)
                else:
                    # LLM respondió pero JSON vacío: complementar con smart fallback
                    fb = self._smart_fallback(requirement_text, project_name, module, batch_types, batch_count)
                    all_raw.extend(fb)
                    remaining -= batch_count
            except Exception as ex:
                print(f"⚠️ LLM batch failed (types={batch_types}): {ex} — usando motor semántico de dominio.")
                fb = self._smart_fallback(requirement_text, project_name, module, batch_types, batch_count)
                all_raw.extend(fb)
                remaining -= batch_count

        # Construir casos finales con IDs profesionales
        fixed: List[dict] = []
        for i, raw in enumerate(all_raw[:num_cases]):
            if not isinstance(raw, dict):
                continue
            case = self._validate_case(raw, i)
            case["case_id"] = self._next_id(
                test_type=case["test_type"],
                category=case["category"],
                project_name=project_name,
                module=module,
            )
            fixed.append(case)

        return fixed
