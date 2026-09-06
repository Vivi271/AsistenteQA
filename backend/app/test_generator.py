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

# ─── Prompt profesional EOPA DTR029C + Estándar ISTQB ────────────────────────
GENERATOR_PROMPT = """Eres un QA Engineer Senior y especialista ISTQB de Ciel Ingeniería S.A.S.
Debes generar casos de prueba de alta calidad técnica para la plataforma PRQA (estándar corporativo EOPA DTR029C).

REQUERIMIENTO A PROBAR:
{requirement}

DOCUMENTOS TÉCNICOS Y REGLAS DE NEGOCIO (CONTEXTO RAG):
{context}

INSTRUCCIONES DE DISEÑO DE PRUEBAS:
- Genera exactamente {num_cases} caso(s) de prueba de tipo(s): {test_types} para el módulo "{module}".
- Extrae y aplica fielmente las entidades, campos, reglas de negocio y flujos presentes en el requerimiento y documentos.
- Para cada caso define obligatoriamente:
  1. "title": DESCRIPCIÓN DE LA ACCIÓN que ejecuta el tester, redactada como una oración completa que incluye contexto y datos concretos de entrada entre comillas (ej: 'PED#999', 'admin@ciel.com', '12345').
  2. "test_type": Uno de: {test_types}.
  3. "technique": Técnica ISTQB aplicada ("Partición de Equivalencia (EP)", "Análisis de Valores Límite (BVA)", "Tabla de Decisión", "Prueba de Flujo de Negocio", "Inyección y Casos de Abuso", "Prueba de Carga/Rendimiento", "Prueba de Compatibilidad").
  4. "preconditions": Estado previo indispensable del sistema o usuario antes de ejecutar la prueba.
  5. "steps": Array con 2 a 4 pasos secuenciales numerados (ej: ["1. Ingresar a...", "2. Digitar...", "3. Presionar..."]).
  6. "expected_result": Resultado observable preciso con mensajes exactos del sistema entre comillas, códigos de estado o cambios visuales esperados.
  7. "severity": "Bloqueante" | "Crítico" | "Tolerable" | "Interfaz de usuario".
  8. "category": "CORE" (funcionalidad principal) | "PROV" (proveedores/servicios) | "VAL" (validaciones) | "RNEG" (reglas de negocio/seguridad).

Devuelve ÚNICAMENTE el array JSON sin texto adicional ni bloques explicativos:
[
  {{
    "title": "[Acción detallada del tester con datos sintéticos concretos para el módulo {module}]",
    "test_type": "{first_type}",
    "technique": "Partición de Equivalencia (EP)",
    "preconditions": "[Estado previo del sistema o usuario]",
    "steps": [
      "1. Acceder al módulo {module}.",
      "2. Ingresar los datos de prueba requeridos.",
      "3. Ejecutar la acción y validar la respuesta del sistema."
    ],
    "expected_result": "[Resultado observable con mensajes exactos del sistema entre comillas]",
    "severity": "Crítico",
    "category": "CORE"
  }}
]"""



class TestCaseGenerator:
    """Genera casos de prueba EOPA profesionales usando LLM local."""

    def __init__(self, rag: RAGPipeline):
        self.rag = rag
        self.ollama_client = ollama.Client(host=OLLAMA_HOST, timeout=300.0)
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
        if tt not in TEST_TYPES:
            tt = "FUNCIONALES"

        steps_raw = case.get("steps")
        if isinstance(steps_raw, list):
            steps = [str(s).strip() for s in steps_raw if str(s).strip()]
        elif isinstance(steps_raw, str) and steps_raw.strip():
            steps = [s.strip() for s in re.split(r'[\n\r]+', steps_raw) if s.strip()]
        else:
            steps = []

        cat = case.get("category", "")
        if cat not in TIPOS:
            cat = "RNEG" if ("NEG" in tt or "SEG" in tt) else ("PROV" if ("INT" in tt or "RES" in tt) else "CORE")

        sev = case.get("severity", "")
        if sev not in SEVERIDADES:
            sev = "Bloqueante" if ("SEG" in tt or "ESTRESS" in tt) else ("Crítico" if ("NEG" in tt or "INT" in tt or "CARGA" in tt) else "Tolerable")

        # Asignar técnica ISTQB adecuada si viene vacía
        tech = case.get("technique") or ""
        if not tech:
            if "NEG" in tt:
                tech = "Análisis de Valores Límite (BVA)"
            elif "SEG" in tt:
                tech = "Inyección y Casos de Abuso"
            elif "INT" in tt:
                tech = "Prueba de Integración de Endpoints"
            elif "NOF" in tt or "COMPAT" in tt:
                tech = "Prueba de Usabilidad y Matriz Multiplataforma"
            elif "CARGA" in tt or "ESTRESS" in tt:
                tech = "Prueba de Sobrecarga y Rendimiento"
            elif "RESIL" in tt:
                tech = "Prueba de Tolerancia a Fallos"
            else:
                tech = "Partición de Equivalencia (EP)"

        pre = case.get("preconditions") or "El sistema se encuentra operativo y el usuario cuenta con los permisos requeridos."
        if not steps:
            steps = [
                f"1. Acceder al módulo correspondiente y verificar el estado inicial.",
                f"2. Ejecutar la acción de prueba con los datos especificados.",
                f"3. Confirmar la operación y verificar la respuesta esperada en pantalla."
            ]

        exp = case.get("expected_result") or "El sistema procesa la operación según la especificación sin generar errores."

        return {
            "title": case.get("title") or f"Caso de prueba {idx+1}",
            "test_type": tt,
            "category": cat,
            "severity": sev,
            "technique": tech,
            "preconditions": pre,
            "steps": steps,
            "expected_result": exp,
            "acceptance_criteria": case.get("acceptance_criteria") or "",
        }

    # ─────────────────────────────────────────────────────────────────────────
    # ─────────────────────────────────────────────────────────────────────────
    # Motor Semántico de Respaldo EOPA (Garantía de Continuidad y Resiliencia)
    # ─────────────────────────────────────────────────────────────────────────
    def _generate_fallback_cases(
        self,
        req_clean: str,
        project_name: str,
        module: str,
        batch_types: List[str],
        needed: int,
        context: str = ""
    ) -> List[dict]:
        """Genera casos de prueba EOPA técnicos ISTQB cuando el LLM está sobrecargado o agota tiempo."""
        cases = []
        mod = module if module and module.lower() != 'general' else 'Módulo'
        terms = re.findall(r'\b[A-Za-záéíóúÁÉÍÓÚñÑ]{4,}\b', req_clean)
        domain_entity = terms[0].capitalize() if terms else 'Operación'

        for i in range(needed):
            tt = batch_types[i % len(batch_types)].upper()
            if 'NEG' in tt:
                cases.append({
                    'title': f'Verificar rechazo y control de excepciones con entradas inválidas o fuera de límite en {mod}',
                    'test_type': 'CASOS NEGATIVOS',
                    'technique': 'Análisis de Valores Límite (BVA)',
                    'preconditions': f'El usuario tiene sesión activa y se encuentra en el formulario o servicio {mod}.',
                    'steps': [
                        f'1. Acceder a la interfaz de {mod}.',
                        f'2. Ingresar datos vacíos, nulos o con caracteres especiales no permitidos en los campos de entrada.',
                        f'3. Confirmar la operación presionando el botón de envío o confirmación.',
                        f'4. Verificar el bloqueo y la notificación desplegada en pantalla.'
                    ],
                    'expected_result': 'El sistema no procesa la transacción, previene la persistencia errónea y muestra el mensaje de error: "Datos requeridos incompletos o en formato inválido".',
                    'severity': 'Crítico',
                    'category': 'RNEG'
                })
            elif 'SEG' in tt or 'SEC' in tt:
                cases.append({
                    'title': f'Validar mitigación de inyecciones y control estricto de acceso no autenticado en {mod}',
                    'test_type': 'SEGURIDAD',
                    'technique': 'Inyección y Casos de Abuso',
                    'preconditions': f'Servicio de {mod} activo y políticas de seguridad configuradas en el entorno.',
                    'steps': [
                        f'1. Acceder al punto de entrada del módulo {mod}.',
                        f'2. Enviar parámetros con payloads de prueba de inyección (ej: "<script>alert(1)</script>" o inyección SQL).',
                        f'3. Intentar acceder a operaciones restringidas sin las cabeceras de autorización requeridas.',
                        f'4. Evaluar la respuesta del backend y la renderización en el cliente.'
                    ],
                    'expected_result': 'El sistema sanitiza las entradas, deniega el acceso no autorizado con código HTTP 401/403 o alerta: "Acceso denegado", sin filtrar datos confidenciales en trazas.',
                    'severity': 'Bloqueante',
                    'category': 'RNEG'
                })
            elif 'INT' in tt:
                cases.append({
                    'title': f'Validar la integración y sincronización de datos de {mod} con servicios y base de datos',
                    'test_type': 'INTEGRACION',
                    'technique': 'Prueba de Integración de Endpoints',
                    'preconditions': f'Los microservicios y fuentes de datos de {project_name} están operativos.',
                    'steps': [
                        f'1. Iniciar un flujo transaccional completo en {mod}.',
                        f'2. Transmitir el payload al endpoint correspondiente.',
                        f'3. Validar la respuesta JSON y el esquema de datos retornado.',
                        f'4. Simular un retardo de red o desconexión temporal y validar la gestión del reintento.'
                    ],
                    'expected_result': 'Los datos se sincronizan bajo el contrato de integración esperado en menos de 1.5s; ante fallos temporales se activa el circuito de reintento controlado.',
                    'severity': 'Crítico',
                    'category': 'PROV'
                })
            elif 'CARGA' in tt or 'ESTRESS' in tt or 'REND' in tt:
                cases.append({
                    'title': f'Evaluar la estabilidad y tiempos de respuesta de {mod} bajo concurrencia',
                    'test_type': 'CARGA' if 'CARGA' in tt else 'ESTRESS',
                    'technique': 'Prueba de Sobrecarga y Rendimiento',
                    'preconditions': 'Entorno de pruebas con monitoreo de métricas de CPU y memoria activo.',
                    'steps': [
                        f'1. Ejecutar peticiones concurrentes simultáneas sobre las operaciones clave de {mod}.',
                        f'2. Monitorear los tiempos de latencia y porcentaje de errores en la respuesta.',
                        f'3. Verificar la liberación adecuada de memoria al finalizar el lote de solicitudes.'
                    ],
                    'expected_result': 'El sistema mantiene un tiempo de respuesta promedio inferior a 2.0s y una tasa de éxito superior al 99.5% sin pérdida de estabilidad.',
                    'severity': 'Crítico',
                    'category': 'CORE'
                })
            else:
                cases.append({
                    'title': f'Validar el flujo principal y persistencia exitosa en {mod} para {domain_entity}',
                    'test_type': 'FUNCIONALES',
                    'technique': 'Partición de Equivalencia (EP)',
                    'preconditions': f'Usuario habilitado con permisos en el proyecto {project_name}.',
                    'steps': [
                        f'1. Navegar al módulo {mod}.',
                        f'2. Ingresar la información requerida con valores válidos y acordes a la especificación.',
                        f'3. Presionar el botón de confirmación para procesar la acción.',
                        f'4. Verificar el registro persistido y la confirmación en pantalla.'
                    ],
                    'expected_result': 'La operación concluye exitosamente, los datos se almacenan en el sistema y se muestra: "Operación completada con éxito".',
                    'severity': 'Crítico',
                    'category': 'CORE'
                })
        return cases

    # ─────────────────────────────────────────────────────────────────────────
    # Generador Principal de Casos con LLM Local (Ollama)
    # ─────────────────────────────────────────────────────────────────────────
    async def generate(
        self,
        requirement_text: str,
        project_name: str = "Proyecto",
        module: str = "General",
        test_types: List[str] = None,
        num_cases: int = 10,
        doc_names: List[str] = None,
    ) -> List[dict]:
        """
        Genera casos de prueba EOPA a partir del requerimiento y contexto documental.
        Estrategia resiliente:
          1. Llamada al LLM local con timeout optimizado y formato JSON estricto.
          2. Si el LLM demora o agota tiempo, completa instantáneamente con motor semántico EOPA.
        """
        if not test_types:
            test_types = ["FUNCIONALES", "CASOS NEGATIVOS", "SEGURIDAD"]

        # Recuperar contexto del RAG filtrando por proyecto y documentos específicos
        context = ""
        try:
            context, _ = await asyncio.wait_for(
                self.rag.retrieve(
                    query=(requirement_text[:500] if requirement_text else module),
                    n_results=3,
                    project_name=(project_name if project_name != "Proyecto" else None),
                    doc_names=doc_names,
                    max_distance=0.65
                ),
                timeout=8.0
            )
            context = context[:1200] if context else ""
        except Exception as ex:
            print(f"Aviso al recuperar contexto RAG para generador: {ex}")
            context = ""

        req_clean = requirement_text[:1000].strip()
        all_raw: List[dict] = []
        remaining = num_cases
        type_idx = 0
        BATCH = 3

        while remaining > 0 and len(all_raw) < num_cases:
            batch_count = min(remaining, BATCH)
            batch_types = list(dict.fromkeys(
                test_types[(type_idx + j) % len(test_types)] for j in range(batch_count)
            ))
            type_idx += batch_count

            prompt = GENERATOR_PROMPT.format(
                requirement=req_clean or f"Operaciones y lógica general del módulo {module}.",
                context=context or "Sin contexto adicional de documentos.",
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
                            format="json",
                            keep_alive="24h",
                            options={"temperature": 0.2, "num_predict": 600, "stop": ["```\n\n", "\n\n\n"]},
                        )
                    ),
                    timeout=90.0
                )
                raw_text = resp["message"]["content"]
                parsed = self._extract_json_array(raw_text)
                batch = parsed if isinstance(parsed, list) else [parsed]
                batch = [c for c in batch if isinstance(c, dict)]
                if batch:
                    all_raw.extend(batch)
                    remaining -= len(batch)
                else:
                    raise ValueError("Estructura JSON vacía o no válida")
            except Exception as ex:
                print(f"Aviso en inferencia LLM ({ex}). Utilizando motor semántico de respaldo EOPA...")
                fallback = self._generate_fallback_cases(
                    req_clean=req_clean,
                    project_name=project_name,
                    module=module,
                    batch_types=batch_types,
                    needed=batch_count,
                    context=context
                )
                all_raw.extend(fallback)
                remaining -= len(fallback)

        # Garantizar cuota solicitada
        if len(all_raw) < num_cases:
            diff = num_cases - len(all_raw)
            all_raw.extend(self._generate_fallback_cases(
                req_clean=req_clean,
                project_name=project_name,
                module=module,
                batch_types=test_types,
                needed=diff,
                context=context
            ))

        # Construir casos finales con IDs profesionales EOPA
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
