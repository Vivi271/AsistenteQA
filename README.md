# PRQA — Asistente de QA con IA Local

**Ciel Ingeniería S.A.S | Área de Calidad de Software | Prácticas Profesionales 2026**

Sistema de asistencia para el equipo de testers que genera casos de prueba automáticamente, procesa documentos técnicos de forma privada y registra la ejecución de pruebas. Todo el procesamiento ocurre localmente mediante `llama3.1:8b`, sin exposición a servicios de nube.

---

## Requisitos

- Docker Desktop instalado y en ejecución
- 8 GB de RAM mínimo (recomendado 16 GB para llama3.1:8b)
- Puertos `80`, `8000` y `11434` disponibles

---

## Inicio rápido

```bash
# 1. Copiar variables de entorno
cp .env.example .env

# 2. Construir y levantar los servicios
docker-compose up -d

# 3. Descargar el modelo LLM (primera vez — puede tomar varios minutos)
docker exec prqa_ollama ollama pull llama3.1:8b
docker exec prqa_ollama ollama pull nomic-embed-text

# 4. Abrir la aplicación
open http://localhost:8000
```

---

## Arquitectura

El sistema está compuesto por dos contenedores Docker independientes:

```
docker-compose
├── ollama  → Servidor de inferencia LLM local (llama3.1:8b)
└── app     → API REST + frontend estático (FastAPI)
```

| Servicio | Puerto | Función                                                        |
|----------|--------|----------------------------------------------------------------|
| `ollama` | 11434  | Ejecuta el modelo de lenguaje localmente                       |
| `app`    | 8000   | Expone la API REST (`/api/*`) y sirve la interfaz web (`/`)   |

El frontend se sirve directamente desde FastAPI como archivos estáticos. No se requiere nginx ni un contenedor adicional. Este enfoque es el adecuado para herramientas internas con equipos pequeños.

---

## Estructura del proyecto

```
PRQA/
├── docker-compose.yml
├── .env.example
├── .gitignore
├── README.md
│
├── backend/
│   ├── Dockerfile               Contexto de build: raíz del proyecto
│   ├── requirements.txt
│   └── app/
│       ├── main.py              API + sirve archivos estáticos del frontend
│       ├── rag_pipeline.py      Pipeline RAG con ChromaDB
│       ├── test_generator.py    Generador de casos formato EOPA
│       ├── excel_exporter.py    Exportador a Excel
│       ├── models.py            Modelos SQLAlchemy
│       └── database.py          Configuración de base de datos
│
├── frontend/                    Código fuente del frontend (HTML/CSS/JS)
│   ├── index.html               El Dockerfile lo copia a /app/static/
│   ├── css/style.css
│   └── js/app.js
│
└── knowledge_base/              Documentos privados (montado como volumen)
    ├── mtr/
    ├── requirements/
    └── templates/
        └── DTR029C-EOPA.xls     Plantilla oficial de casos de prueba
```

---

## Módulos de la aplicación

### Asistente de IA
Chat con el modelo local. Puede responder con o sin contexto de la base de conocimiento. Soporta preguntas sobre metodologías de prueba, análisis de requerimientos y estándares internos.

### Generador de Casos de Prueba
Recibe el texto de un requerimiento o MTR y genera automáticamente casos de prueba en el formato EOPA de Ciel Ingeniería. Los resultados pueden exportarse a Excel.

### Registro de Ejecución
Permite marcar cada caso como `CUMPLE` o `NO CUMPLE`, registrar severidad, tipo de incidencia y estado. El historial queda almacenado en SQLite.

### Base de Conocimiento
Gestión de documentos internos (PDF, DOCX, XLSX, TXT). Los archivos se indexan con ChromaDB y son usados como contexto por el LLM. Ningún dato sale de la red local.

### Dashboard de Eficiencia
Métricas en tiempo real: total de casos, tasa de éxito, cobertura de ejecución, distribución por tipo de prueba y defectos por severidad.

---

## Formato de casos de prueba (EOPA)

Los casos generados siguen la plantilla `DTR029C-(EOPA)` de Ciel Ingeniería.

**Estructura del ID:** `CFG-[TIPO]-[CATEGORIA]-[NN]`

| Campo       | Valores posibles                                                                 |
|-------------|---------------------------------------------------------------------------------|
| TIPO        | `CORE` (configuración general), `PROV` (proveedor), `VAL` (validador), `RNEG` (regla de negocio) |
| CATEGORIA   | `ENA`, `URL`, `CRED`, `TOK`, `TIME`, `RET`, `LOG`, `DBL`, `CON`, `RES`, `STA` |
| Técnica     | Partición de equivalencia, Valores límite, Exploratoria, Tabla de decisión, etc. |
| Severidad   | `Bloqueante`, `Crítico`, `Tolerable`, `Interfaz de usuario`                     |
| Resultado   | `CUMPLE`, `NO CUMPLE`                                                           |
| Estado      | `Abierto`, `Re-abierto`, `Cerrado`                                              |

---

## Comandos de administración

```bash
# Ver logs de la aplicación
docker logs prqa_app -f

# Ver logs de Ollama
docker logs prqa_ollama -f

# Reiniciar la aplicación sin perder datos
docker-compose restart app

# Detener todos los servicios
docker-compose down

# Detener y eliminar todos los datos (irreversible)
docker-compose down -v

# Cambiar el modelo LLM
# Editar .env → LLM_MODEL=llama3.2:3b
docker exec prqa_ollama ollama pull llama3.2:3b
docker-compose restart app
```

---

## Fases del proyecto

| Fase   | Descripción                                      | Fechas                  | Entregable                                        |
|--------|--------------------------------------------------|-------------------------|---------------------------------------------------|
| Fase 1 | Infraestructura de inferencia local              | 27/07 – 24/08/2026      | Documento de diseño de arquitectura               |
| Fase 2 | Arquitectura de datos y pipeline RAG             | 25/08 – 21/09/2026      | Imagen Docker con RAG funcional                   |
| Fase 3 | Desarrollo del asistente y WebUI                 | 22/09 – 19/10/2026      | Interfaz web + protocolo operativo                |
| Fase 4 | Validación, registro y optimización              | 20/10 – 27/11/2026      | Reporte de eficiencia y módulo de registro        |

---

## Información del proyecto

**Estudiante:** Viviana Marcela García Valderrama  
**Programa:** Ingeniería de Sistemas — Fundación Universitaria Konrad Lorenz  
**Empresa:** Ciel Ingeniería S.A.S — Área de Calidad de Software  
**Período:** 27 de julio de 2026 – 15 de noviembre de 2026  
**Supervisora empresarial:** Lisceth Valentina Avila Gómez, Líder de QA