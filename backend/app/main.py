"""
PRQA Backend — main.py
API y frontend del asistente de QA con IA Local
Ciel Ingeniería S.A.S — Prácticas Profesionales 2026

Este servicio expone la API REST en /api/* y sirve
el frontend estático en la raíz (/).
"""

import os
import json
import uuid
import asyncio
from pathlib import Path
from typing import Optional, List
from datetime import datetime, timezone, timedelta

# Zona horaria Colombia (UTC-5)
TZ_COLOMBIA = timezone(timedelta(hours=-5))

def now_co():
    """Retorna la hora actual en Colombia (UTC-5)."""
    return datetime.now(TZ_COLOMBIA)

from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse, StreamingResponse
from pydantic import BaseModel
import aiofiles

from database import engine, Base, SessionLocal
from models import TestCase, TestExecution, Document, TimerSession
from sqlalchemy import String, func
from rag_pipeline import RAGPipeline
from test_generator import TestCaseGenerator

# ── Inicialización ──────────────────────────────────────────────
app = FastAPI(
    title="PRQA — Asistente QA con IA Local",
    description="Asistente de calidad de software potenciado por IA local para Ciel Ingeniería",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Crear tablas en la base de datos
Base.metadata.create_all(bind=engine)

# Pipelines globales (se inicializan al arrancar)
rag: Optional[RAGPipeline] = None
generator: Optional[TestCaseGenerator] = None

KNOWLEDGE_BASE_PATH = Path(os.getenv("KNOWLEDGE_BASE_PATH", "/app/knowledge_base"))
KNOWLEDGE_BASE_PATH.mkdir(parents=True, exist_ok=True)


@app.on_event("startup")
async def startup_event():
    """Inicializa el pipeline RAG y el generador de casos de prueba."""
    global rag, generator
    print("Iniciando PRQA (API + Frontend)...")
    
    # Migración automática SQLite para agregar project_name si no existe y rellenar nulos
    try:
        from sqlalchemy import text
        db = SessionLocal()
        try:
            db.execute(text("ALTER TABLE documents ADD COLUMN project_name VARCHAR DEFAULT 'Proyectos'"))
            db.commit()
        except Exception:
            pass
        db.execute(text("UPDATE documents SET project_name = 'Proyectos' WHERE project_name IS NULL OR project_name = 'General'"))
        db.execute(text("UPDATE test_cases SET project_name = 'Proyectos' WHERE project_name IS NULL OR project_name = 'General'"))
        db.commit()
        print("Migraciones de project_name a 'Proyectos' completadas exitosamente en SQLite.")

        # Migrar columnas de tiempo en test_executions y export_file en test_cases
        for col_def in [
            "ALTER TABLE test_executions ADD COLUMN execution_time_seconds REAL",
            "ALTER TABLE test_executions ADD COLUMN started_at DATETIME",
            "ALTER TABLE test_executions ADD COLUMN paused_seconds REAL DEFAULT 0.0",
            "ALTER TABLE test_cases ADD COLUMN export_file VARCHAR",
        ]:
            try:
                db.execute(text(col_def))
                db.commit()
            except Exception:
                pass

        # Crear tabla timer_sessions si no existe (por si la BD ya existía)
        try:
            db.execute(text("""
                CREATE TABLE IF NOT EXISTS timer_sessions (
                    id VARCHAR PRIMARY KEY,
                    test_case_id VARCHAR REFERENCES test_cases(id),
                    project_name VARCHAR DEFAULT 'Proyectos',
                    started_at DATETIME NOT NULL,
                    stopped_at DATETIME,
                    paused_seconds REAL DEFAULT 0.0,
                    execution_time_seconds REAL,
                    is_running BOOLEAN DEFAULT 1,
                    is_paused BOOLEAN DEFAULT 0,
                    pause_started_at DATETIME,
                    tester_name VARCHAR,
                    created_at DATETIME
                )
            """))
            db.commit()
        except Exception:
            pass
        
        # Migrar archivos físicos al subdirectorio del proyecto "Proyectos"
        for cat in ["requirements", "mtr", "templates"]:
            old_dir = KNOWLEDGE_BASE_PATH / cat
            new_dir = KNOWLEDGE_BASE_PATH / "Proyectos" / cat
            if old_dir.exists() and old_dir.is_dir():
                new_dir.mkdir(parents=True, exist_ok=True)
                for item in old_dir.iterdir():
                    if item.is_file():
                        dest = new_dir / item.name
                        if not dest.exists():
                            import shutil
                            shutil.move(str(item), str(dest))
                            print(f"Movido archivo físico {item.name} a {dest}")
                        
                        # Actualizar en la base de datos el path del archivo físico
                        doc = db.query(Document).filter(Document.filename == item.name, Document.category == cat).first()
                        if doc:
                            doc.file_path = str(dest)
                            db.commit()
                            print(f"Actualizado path de {item.name} en SQLite a {dest}")
        db.close()
    except Exception as e:
        print(f"Error en migración SQLite y archivos: {e}")

    try:
        rag = RAGPipeline()
        generator = TestCaseGenerator(rag)
        print("Pipeline RAG inicializado correctamente.")

        # ── Warmup de Ollama: cargar modelo en memoria al inicio ──────────────
        async def _warmup_ollama():
            import ollama, os
            OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://ollama:11434")
            LLM_MODEL = os.getenv("LLM_MODEL", "llama3.2:3b")
            try:
                print(f"[Warmup] Cargando {LLM_MODEL} en memoria (keep_alive=24h)...")
                client = ollama.Client(host=OLLAMA_HOST, timeout=300.0)
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(None, lambda: client.chat(
                    model=LLM_MODEL,
                    messages=[{"role": "user", "content": "hola"}],
                    keep_alive="24h",
                    options={"num_predict": 5}
                ))
                print(f"[Warmup] Modelo {LLM_MODEL} cargado y listo.")
            except Exception as ex:
                print(f"[Warmup] Aviso (no crítico): {ex}")

        asyncio.create_task(_warmup_ollama())
    except Exception as e:
        print(f"⚠️  Error al inicializar pipeline: {e}")
        print(f"Modo degradado: {e}. Verifica que Ollama este corriendo.")


# ── Servir Frontend estático ─────────────────────────────────
STATIC_PATH = Path(os.getenv("STATIC_PATH", "/app/static"))

if STATIC_PATH.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_PATH)), name="static")
    if (STATIC_PATH / "img").exists():
        app.mount("/img", StaticFiles(directory=str(STATIC_PATH / "img")), name="img")
    if (STATIC_PATH / "css").exists():
        app.mount("/css", StaticFiles(directory=str(STATIC_PATH / "css")), name="css")
    if (STATIC_PATH / "js").exists():
        app.mount("/js", StaticFiles(directory=str(STATIC_PATH / "js")), name="js")

@app.get("/", response_class=HTMLResponse, include_in_schema=False)
async def root():
    index_file = STATIC_PATH / "index.html"
    if index_file.exists():
        headers = {
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        }
        return FileResponse(str(index_file), headers=headers)
    return HTMLResponse("<h1>PRQA API corriendo. Coloca el frontend en /app/static/</h1>")

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    icon_file = STATIC_PATH / "favicon.ico"
    if icon_file.exists():
        return FileResponse(str(icon_file), media_type="image/x-icon")
    from fastapi.responses import Response
    return Response(status_code=204)




# ── Health Check ────────────────────────────────────────────────
@app.get("/api/health")
async def health():
    status = {
        "status": "ok",
        "timestamp": datetime.now().isoformat(),
        "rag_ready": rag is not None and rag.is_ready(),
        "ollama_host": os.getenv("OLLAMA_HOST", "http://ollama:11434"),
        "model": os.getenv("LLM_MODEL", "llama3.1:8b"),
    }
    return status


# ══════════════════════════════════════════════════════════════════
# MÓDULO 1 — CHAT / ASISTENTE
# ══════════════════════════════════════════════════════════════════

class ChatRequest(BaseModel):
    message: str
    use_knowledge_base: bool = True
    session_id: Optional[str] = None
    project_name: Optional[str] = None

class ChatResponse(BaseModel):
    response: str
    sources: List[str] = []
    session_id: str


@app.post("/api/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    """Envía un mensaje al asistente de IA con contexto de la base de conocimiento."""
    if not rag:
        raise HTTPException(503, "Pipeline RAG no disponible. Verifica que Ollama esté corriendo.")

    session_id = req.session_id or str(uuid.uuid4())

    try:
        response, sources = await rag.query(
            question=req.message,
            use_knowledge_base=req.use_knowledge_base,
            project_name=req.project_name
        )
        return ChatResponse(
            response=response,
            sources=sources,
            session_id=session_id
        )
    except Exception as e:
        raise HTTPException(500, f"Error al procesar la consulta: {str(e)}")


@app.post("/api/chat/stream")
async def chat_stream(req: ChatRequest):
    """Streaming del chat para respuestas en tiempo real."""
    if not rag:
        raise HTTPException(503, "Pipeline RAG no disponible.")

    async def generate():
        try:
            async for chunk in rag.stream_query(req.message, req.use_knowledge_base, project_name=req.project_name):
                yield f"data: {json.dumps({'chunk': chunk})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.get("/api/projects")
async def list_projects():
    """Obtiene la lista única de todos los nombres de proyectos registrados."""
    db = SessionLocal()
    try:
        doc_projects = db.query(Document.project_name).distinct().all()
        tc_projects = db.query(TestCase.project_name).distinct().all()
        
        projects = set()
        projects.add("General")  # Siempre incluir el proyecto por defecto
        
        for (p,) in doc_projects:
            if p:
                projects.add(p)
        for (p,) in tc_projects:
            if p:
                projects.add(p)
                
        return sorted(list(projects))
    finally:
        db.close()


class RenameProjectRequest(BaseModel):
    new_name: str

@app.put("/api/projects/{project_name}")
async def rename_project(project_name: str, req: RenameProjectRequest):
    """Renombra un proyecto: actualiza project_name en documentos y casos de prueba."""
    new_name = req.new_name.strip()
    if not new_name:
        raise HTTPException(400, "El nuevo nombre no puede estar vacío.")
    if project_name == new_name:
        return {"renamed": False, "message": "El nombre es igual."}
    if project_name == "General":
        raise HTTPException(400, "No puedes renombrar el proyecto predeterminado.")

    db = SessionLocal()
    try:
        db.query(Document).filter(Document.project_name == project_name).update(
            {"project_name": new_name}, synchronize_session=False
        )
        db.query(TestCase).filter(TestCase.project_name == project_name).update(
            {"project_name": new_name}, synchronize_session=False
        )
        db.commit()

        # Renombrar carpeta de Excels en disco si existe
        old_dir = KNOWLEDGE_BASE_PATH / "Proyectos" / project_name
        new_dir = KNOWLEDGE_BASE_PATH / "Proyectos" / new_name
        if old_dir.exists() and not new_dir.exists():
            old_dir.rename(new_dir)

        return {"renamed": True, "old_name": project_name, "new_name": new_name}
    except Exception as ex:
        db.rollback()
        raise HTTPException(500, f"Error al renombrar: {ex}")
    finally:
        db.close()


@app.delete("/api/projects/{project_name}")
async def delete_project(project_name: str):
    """Elimina un proyecto completo: test cases, documentos (ChromaDB + archivos) y Excels generados."""
    if project_name in ('General',):
        raise HTTPException(400, "No puedes eliminar el proyecto predeterminado.")

    db = SessionLocal()
    deleted_summary = {"test_cases": 0, "documents": 0, "excels": 0}
    try:
        # 1. Borrar todos los casos de prueba del proyecto
        tc_deleted = db.query(TestCase).filter(TestCase.project_name == project_name).delete(synchronize_session=False)
        deleted_summary["test_cases"] = tc_deleted

        # 2. Borrar todos los documentos del proyecto (ChromaDB + archivo físico)
        docs = db.query(Document).filter(Document.project_name == project_name).all()
        for doc in docs:
            try:
                if rag:
                    await rag.remove_document(doc.file_path)
            except Exception:
                pass
            try:
                fp = Path(doc.file_path)
                if fp.exists():
                    fp.unlink()
            except Exception:
                pass
            db.delete(doc)
            deleted_summary["documents"] += 1

        # 3. Borrar Excels generados en disco
        export_dir = KNOWLEDGE_BASE_PATH / "Proyectos" / project_name / "generados"
        if export_dir.exists():
            for f in export_dir.glob("*.xlsx"):
                try:
                    f.unlink()
                    deleted_summary["excels"] += 1
                except Exception:
                    pass

        db.commit()
        return {"deleted": True, "project": project_name, **deleted_summary}
    except HTTPException:
        raise
    except Exception as ex:
        db.rollback()
        raise HTTPException(500, f"Error eliminando proyecto: {ex}")
    finally:
        db.close()


# ══════════════════════════════════════════════════════════════════
# MÓDULO 2 — GESTIÓN DE DOCUMENTOS (Knowledge Base)
# ══════════════════════════════════════════════════════════════════

@app.get("/api/documents")
async def list_documents(project: Optional[str] = None):
    """Lista todos los documentos indexados en la base de conocimiento."""
    db = SessionLocal()
    try:
        query = db.query(Document)
        if project:
            query = query.filter(Document.project_name == project)
        docs = query.order_by(Document.uploaded_at.desc()).all()
        return [
            {
                "id": d.id,
                "filename": d.filename,
                "category": d.category,
                "project_name": d.project_name,
                "size_kb": round(d.size_bytes / 1024, 1),
                "chunks": d.chunks_count,
                "uploaded_at": d.uploaded_at.isoformat(),
            }
            for d in docs
        ]
    finally:
        db.close()


@app.get("/api/documents/{doc_id}/content")
async def get_document_content(doc_id: str):
    """Obtiene el texto completo indexado para un documento específico."""
    if not rag:
        raise HTTPException(503, "Pipeline RAG no disponible.")
    db = SessionLocal()
    try:
        doc = db.query(Document).filter(Document.id == doc_id).first()
        if not doc:
            raise HTTPException(404, "Documento no encontrado.")
        
        text = rag.get_document_text(doc.filename)
        return {"filename": doc.filename, "content": text}
    finally:
        db.close()


@app.post("/api/documents/upload")
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    category: str = "requirements",
    project: str = "Proyectos"
):
    """Sube e indexa un documento en la base de conocimiento."""
    if not rag:
        raise HTTPException(503, "Pipeline RAG no disponible.")

    allowed_types = {".pdf", ".docx", ".txt", ".xlsx", ".xls", ".md"}
    suffix = Path(file.filename).suffix.lower()
    if suffix not in allowed_types:
        raise HTTPException(400, f"Tipo de archivo no soportado: {suffix}. Usa: {allowed_types}")

    # Sanitizar nombre del proyecto para su uso como nombre de carpeta física
    safe_project = "".join([c for c in project if c.isalnum() or c in (" ", "_", "-")]).strip()
    if not safe_project:
        safe_project = "Proyectos"

    # Guardar archivo bajo el directorio del proyecto
    project_path = KNOWLEDGE_BASE_PATH / safe_project / category
    project_path.mkdir(parents=True, exist_ok=True)
    file_path = project_path / file.filename

    content = await file.read()
    async with aiofiles.open(file_path, "wb") as f:
        await f.write(content)

    # Indexar en background
    doc_id = str(uuid.uuid4())
    background_tasks.add_task(
        index_document_task,
        doc_id=doc_id,
        file_path=file_path,
        filename=file.filename,
        category=category,
        project_name=project,
        size_bytes=len(content)
    )

    return {
        "message": f"Documento '{file.filename}' recibido. Indexando en segundo plano...",
        "doc_id": doc_id,
        "status": "processing"
    }


async def index_document_task(doc_id: str, file_path: Path, filename: str, category: str, project_name: str, size_bytes: int):
    """Tarea de background: indexa el documento en ChromaDB y registra en SQLite."""
    db = SessionLocal()
    try:
        # Buscar y eliminar duplicados previos de este mismo archivo en este proyecto
        existing_doc = db.query(Document).filter(
            Document.filename == filename,
            Document.project_name == project_name
        ).first()
        if existing_doc:
            try:
                if rag:
                    await rag.remove_document(existing_doc.file_path)
            except Exception as ex:
                print(f"Aviso: No se pudo limpiar Chroma para duplicado {filename}: {ex}")
            db.delete(existing_doc)
            db.commit()

        chunks_count = await rag.index_document(str(file_path), project_name=project_name)

        doc = Document(
            id=doc_id,
            filename=filename,
            file_path=str(file_path),
            category=category,
            project_name=project_name,
            size_bytes=size_bytes,
            chunks_count=chunks_count,
        )
        db.add(doc)
        db.commit()
        print(f"✅ Documento indexado: {filename} ({chunks_count} fragmentos)")
    except Exception as e:
        print(f"❌ Error indexando {filename}: {e}")
    finally:
        db.close()



@app.delete("/api/documents/{doc_id}")
async def delete_document(doc_id: str):
    """Elimina un documento de la base de conocimiento."""
    db = SessionLocal()
    try:
        doc = db.query(Document).filter(Document.id == doc_id).first()
        if not doc:
            raise HTTPException(404, "Documento no encontrado.")

        # Eliminar de ChromaDB
        if rag:
            await rag.remove_document(doc.file_path)

        # Eliminar archivo físico
        file_path = Path(doc.file_path)
        if file_path.exists():
            file_path.unlink()

        db.delete(doc)
        db.commit()
        return {"message": f"Documento '{doc.filename}' eliminado."}
    finally:
        db.close()


class EditDocumentRequest(BaseModel):
    filename: str
    category: str


@app.put("/api/documents/{doc_id}")
async def edit_document(doc_id: str, req: EditDocumentRequest):
    """Edita el nombre o categoría de un documento indexado."""
    db = SessionLocal()
    try:
        doc = db.query(Document).filter(Document.id == doc_id).first()
        if not doc:
            raise HTTPException(404, "Documento no encontrado.")

        old_filename = doc.filename
        doc.filename = req.filename
        doc.category = req.category
        db.commit()

        # Actualizar metadatas en ChromaDB si está disponible
        if rag and old_filename != req.filename:
            try:
                existing = rag.collection.get(where={"source": old_filename})
                if existing["ids"]:
                    new_metadatas = []
                    for m in existing["metadatas"]:
                        m["source"] = req.filename
                        new_metadatas.append(m)
                    rag.collection.update(ids=existing["ids"], metadatas=new_metadatas)
            except Exception as e:
                print(f"Error actualizando ChromaDB: {e}")

        return {"status": "ok", "message": "Documento actualizado correctamente."}
    finally:
        db.close()


# ══════════════════════════════════════════════════════════════════
# MÓDULO 3 — GENERACIÓN DE CASOS DE PRUEBA
# ══════════════════════════════════════════════════════════════════

class GenerateTestCasesRequest(BaseModel):
    requirement_text: str
    project_name: str = "Proyecto"
    module: str = "General"
    test_types: List[str] = ["FUNCIONALES", "NO FUNCIONALES"]
    num_cases: int = 10
    selected_doc_ids: Optional[List[str]] = None
    doc_names: Optional[List[str]] = None


@app.post("/api/test-cases/generate")
async def generate_test_cases(req: GenerateTestCasesRequest):
    """Genera casos de prueba automáticamente a partir de un requerimiento y contexto documental."""
    if not generator:
        raise HTTPException(503, "Generador no disponible.")

    try:
        # Resolver nombres de documentos seleccionados para alimentar el contexto RAG
        target_doc_names = list(req.doc_names or [])
        if req.selected_doc_ids and len(req.selected_doc_ids) > 0:
            db_docs = SessionLocal()
            try:
                matched_docs = db_docs.query(Document.filename).filter(Document.id.in_(req.selected_doc_ids)).all()
                for doc_row in matched_docs:
                    if doc_row[0] and doc_row[0] not in target_doc_names:
                        target_doc_names.append(doc_row[0])
            except Exception as e:
                print(f"Aviso al consultar documentos seleccionados: {e}")
            finally:
                db_docs.close()

        test_cases = await generator.generate(
            requirement_text=req.requirement_text,
            project_name=req.project_name,
            module=req.module,
            test_types=req.test_types,
            num_cases=req.num_cases,
            doc_names=target_doc_names if target_doc_names else None,
        )

        if not test_cases or len(test_cases) == 0:
            raise HTTPException(500, "El modelo local de IA no retornó casos de prueba válidos. Por favor presiona 'Generar' nuevamente.")

        # Guardar en base de datos
        db = SessionLocal()
        saved_db_cases = []
        try:
            saved_cases = []
            for i, tc in enumerate(test_cases):
                steps_data = tc.get("steps", [])
                steps_json = json.dumps(steps_data, ensure_ascii=False) if isinstance(steps_data, list) else str(steps_data)

                db_case = TestCase(
                    id=str(uuid.uuid4()),
                    case_id=tc.get("case_id") or tc.get("id", f"PRQA-{i+1:03d}"),
                    project_name=req.project_name,
                    module=req.module,
                    title=tc["title"],
                    test_type=tc["test_type"],
                    technique=tc.get("technique", ""),
                    preconditions=tc.get("preconditions", ""),
                    steps=steps_json,
                    expected_result=tc.get("expected_result", ""),
                    severity=tc.get("severity", "Tolerable"),
                    category=tc.get("category", ""),
                    acceptance_criteria=tc.get("acceptance_criteria", ""),
                    status="Pendiente",
                )
                db.add(db_case)
                saved_db_cases.append(db_case)
                saved_cases.append({
                    **tc,
                    "db_id": db_case.id,
                    "case_id": db_case.case_id,
                    "project_name": req.project_name,
                    "module": req.module,
                })

            # Generar y guardar el Excel permanente correspondiente a esta generación
            from excel_exporter import export_to_eopa_excel
            export_dir = KNOWLEDGE_BASE_PATH / "Proyectos" / req.project_name / "generados"
            export_dir.mkdir(parents=True, exist_ok=True)
            
            timestamp = now_co().strftime("%Y-%m-%d_%H-%M-%S")
            filename = f"Casos_{req.module.replace(' ', '_')}_{timestamp}.xlsx"
            filepath = export_dir / filename

            # Vincular cada caso guardado con este archivo Excel específico
            for db_case in saved_db_cases:
                db_case.export_file = filename
            db.commit()

            for sc in saved_cases:
                sc["export_file"] = filename
            
            export_to_eopa_excel(saved_db_cases, str(filepath), req.project_name)

            return {
                "test_cases": saved_cases,
                "total": len(saved_cases),
                "excel_filename": filename,
                "excel_path": f"/api/test-cases/exports/download?project_name={req.project_name}&filename={filename}"
            }
        finally:
            db.close()

    except Exception as e:
        raise HTTPException(500, f"Error generando casos de prueba: {str(e)}")


@app.get("/api/test-cases/exports")
async def list_generated_excels(project_name: str):
    """Lista todos los archivos Excel EOPA generados para el proyecto."""
    export_dir = KNOWLEDGE_BASE_PATH / "Proyectos" / project_name / "generados"
    if not export_dir.exists():
        return []
    
    files = []
    for f in export_dir.glob("*.xlsx"):
        if f.is_file():
            stat = f.stat()
            # Módulo extraído del nombre: Casos_ModuleName_YYYY-MM-DD_HH-MM-SS.xlsx
            parts = f.stem.split("_")
            module_str = "General"
            if len(parts) >= 2 and parts[1]:
                module_str = parts[1].replace("-", " ")

            # Fecha limpia y profesional en formato colombiano (DD/MM/YYYY - hh:mm AM/PM)
            mtime_dt = datetime.fromtimestamp(stat.st_mtime, tz=TZ_COLOMBIA)
            clean_date = mtime_dt.strftime("%d/%m/%Y - %I:%M %p")

            files.append({
                "filename": f.name,
                "module": module_str,
                "created_at": clean_date,
                "mtime": stat.st_mtime,
                "size_kb": round(stat.st_size / 1024, 1),
                "download_url": f"/api/test-cases/exports/download?project_name={project_name}&filename={f.name}"
            })
    # Ordenar por fecha de modificación más reciente primero
    files.sort(key=lambda x: x["mtime"], reverse=True)
    return files



@app.get("/api/test-cases/exports/download")
async def download_generated_excel(project_name: str, filename: str):
    """Descarga un archivo Excel EOPA generado del proyecto, regenerándolo al vuelo para corregir corrupciones previas."""
    export_dir = KNOWLEDGE_BASE_PATH / "Proyectos" / project_name / "generados"
    file_path = export_dir / filename
    
    # ── Regeneración dinámica al vuelo ────────────────────────────
    # Intentar obtener el nombre del módulo a partir del nombre del archivo:
    # Ejemplo: Casos_ModuleName_YYYY-MM-DD_HH-MM-SS.xlsx
    module_name = "General"
    parts = filename.replace(".xlsx", "").split("_")
    if len(parts) >= 2:
        module_name = parts[1].replace("-", " ")
        
    db = SessionLocal()
    try:
        query = db.query(TestCase).filter(
            TestCase.project_name == project_name,
            TestCase.module == module_name
        )
        cases = query.all()
        
        if cases:
            # Si hay casos guardados para este módulo, reconstruimos el Excel con la nueva plantilla limpia
            from excel_exporter import export_to_eopa_excel
            export_dir.mkdir(parents=True, exist_ok=True)
            export_to_eopa_excel(cases, str(file_path), project_name)
    except Exception as ex:
        print(f"Aviso al regenerar Excel en descarga: {ex}")
    finally:
        db.close()
        
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(404, "El archivo Excel solicitado no existe y no pudo ser regenerado.")
    
    return FileResponse(
        str(file_path),
        filename=filename,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        }
    )

@app.delete("/api/test-cases/exports/delete")
async def delete_generated_excel(project_name: str, filename: str):
    """Elimina un archivo Excel generado del historial del proyecto
    y borra en cascada ÚNICAMENTE los casos de prueba asociados a este archivo específico."""
    safe_name = Path(filename).name
    export_dir = KNOWLEDGE_BASE_PATH / "Proyectos" / project_name / "generados"
    file_path = export_dir / safe_name
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(404, "Archivo no encontrado.")

    try:
        # 1. Borrar el archivo físico
        file_path.unlink()

        # 2. Borrar casos en la base de datos EXCLUSIVAMENTE vinculados a este archivo
        deleted_db = 0
        db = SessionLocal()
        try:
            # Primero intentar por la columna export_file exacta
            target_cases = db.query(TestCase).filter(
                TestCase.project_name == project_name,
                TestCase.export_file == safe_name
            ).all()

            # Si son casos legados sin export_file, filtrar por minuto exacto para NO afectar otras matrices del mismo día
            if not target_cases:
                stem = safe_name.replace(".xlsx", "")
                parts = stem.split("_")
                if len(parts) >= 4 and parts[0] == "Casos":
                    module_parts = parts[1:-2]
                    module_name = " ".join(module_parts)
                    date_part = parts[-2]                  # YYYY-MM-DD
                    time_part = parts[-1].replace("-", ":") # HH:MM:SS
                    
                    from sqlalchemy import func
                    minute_prefix = f"{date_part} {time_part[:5]}" # Filtra hasta el minuto exacto
                    target_cases = db.query(TestCase).filter(
                        TestCase.project_name == project_name,
                        (TestCase.module == module_name) | (TestCase.module == "_".join(module_parts)),
                        func.cast(TestCase.created_at, String).like(f"{minute_prefix}%")
                    ).all()

            tc_ids = [c.id for c in target_cases]
            if tc_ids:
                # Borrado en cascada estricto
                db.query(TestExecution).filter(TestExecution.test_case_id.in_(tc_ids)).delete(synchronize_session=False)
                db.query(TimerSession).filter(TimerSession.test_case_id.in_(tc_ids)).delete(synchronize_session=False)
                deleted_db = db.query(TestCase).filter(TestCase.id.in_(tc_ids)).delete(synchronize_session=False)
                db.commit()
        finally:
            db.close()

        return {
            "deleted": True,
            "filename": safe_name,
            "db_cases_deleted": deleted_db
        }
    except Exception as ex:
        raise HTTPException(500, f"No se pudo eliminar el archivo: {ex}")


@app.delete("/api/test-cases/matrix/delete")
async def delete_matrix_group(project_name: str, module: str, date_prefix: Optional[str] = None, created_at: Optional[str] = None):
    """Elimina una matriz de casos de prueba completa desde la vista de ejecución,
    borrando en cascada ejecuciones, sesiones de cronómetro, casos y el archivo Excel asociado."""
    db = SessionLocal()
    try:
        from sqlalchemy import func
        query = db.query(TestCase).filter(
            TestCase.project_name == project_name,
            TestCase.module == module
        )
        time_ref = created_at or date_prefix
        if time_ref and len(time_ref.strip()) >= 16:
            # Filtrar por timestamp hasta el minuto exacto (YYYY-MM-DD HH:MM)
            clean_time = time_ref.strip().replace("T", " ")[:16]
            query = query.filter(func.cast(TestCase.created_at, String).like(f"{clean_time}%"))
        elif time_ref and len(time_ref.strip()) >= 10:
            clean_date = time_ref.strip().replace("T", " ")[:10]
            query = query.filter(func.substr(func.cast(TestCase.created_at, String), 1, 10) == clean_date)

        target_cases = query.all()
        tc_ids = [c.id for c in target_cases]
        export_files_to_delete = set([c.export_file for c in target_cases if getattr(c, "export_file", None)])
        deleted_count = 0

        if tc_ids:
            # 1. Borrar resultados de ejecución
            db.query(TestExecution).filter(TestExecution.test_case_id.in_(tc_ids)).delete(synchronize_session=False)
            # 2. Borrar sesiones de temporizador
            db.query(TimerSession).filter(TimerSession.test_case_id.in_(tc_ids)).delete(synchronize_session=False)
            # 3. Borrar los casos de prueba
            deleted_count = db.query(TestCase).filter(TestCase.id.in_(tc_ids)).delete(synchronize_session=False)
            db.commit()

        # 4. Eliminar exclusivamente el archivo Excel asociado
        export_dir = KNOWLEDGE_BASE_PATH / "Proyectos" / project_name / "generados"
        if export_dir.exists():
            for ef in export_files_to_delete:
                p = export_dir / ef
                if p.exists() and p.is_file():
                    try:
                        p.unlink()
                    except Exception:
                        pass

        return {
            "deleted": True,
            "project_name": project_name,
            "module": module,
            "db_cases_deleted": deleted_count
        }
    except Exception as ex:
        db.rollback()
        raise HTTPException(500, f"Error al eliminar matriz de pruebas: {ex}")
    finally:
        db.close()


@app.get("/api/test-cases")
async def list_test_cases(project_name: Optional[str] = None, status: Optional[str] = None):
    """Lista todos los casos de prueba almacenados."""
    db = SessionLocal()
    try:
        query = db.query(TestCase)
        if project_name:
            query = query.filter(TestCase.project_name == project_name)
        if status:
            query = query.filter(TestCase.status == status)

        cases = query.order_by(TestCase.created_at.desc()).all()
        return [
            {
                "id": c.id,
                "db_id": c.id,
                "case_id": c.case_id,
                "project_name": c.project_name,
                "module": c.module,
                "title": c.title,
                "test_type": c.test_type,
                "technique": c.technique,
                "preconditions": c.preconditions,
                "steps": json.loads(c.steps) if c.steps else [],
                "expected_result": c.expected_result,
                "severity": c.severity,
                "category": c.category,
                "acceptance_criteria": c.acceptance_criteria,
                "status": c.status,
                "result": c.result,
                "notes": c.notes,
                "export_file": getattr(c, "export_file", None),
                "created_at": c.created_at.isoformat() + "Z",
                "executed_at": (c.executed_at.isoformat() + "Z") if c.executed_at else None,
            }
            for c in cases
        ]
    finally:
        db.close()


@app.delete("/api/test-cases/all")
async def delete_all_test_cases(project_name: str):
    """Elimina en cascada todos los casos de prueba de un proyecto."""
    db = SessionLocal()
    try:
        cases = db.query(TestCase.id).filter(TestCase.project_name == project_name).all()
        tc_ids = [c[0] for c in cases]
        deleted = 0
        if tc_ids:
            db.query(TestExecution).filter(TestExecution.test_case_id.in_(tc_ids)).delete(synchronize_session=False)
            db.query(TimerSession).filter(TimerSession.test_case_id.in_(tc_ids)).delete(synchronize_session=False)
            deleted = db.query(TestCase).filter(TestCase.id.in_(tc_ids)).delete(synchronize_session=False)
            db.commit()
        return {"deleted": deleted, "project_name": project_name}
    finally:
        db.close()


@app.get("/api/test-cases/export/excel")
async def export_test_cases_excel(project_name: Optional[str] = None):
    """Exporta los casos de prueba en formato Excel (plantilla EOPA)."""

    from excel_exporter import export_to_eopa_excel
    import tempfile

    db = SessionLocal()
    try:
        query = db.query(TestCase)
        if project_name:
            query = query.filter(TestCase.project_name == project_name)
        cases = query.all()

        if not cases:
            raise HTTPException(404, "No hay casos de prueba para exportar.")

        # Generar Excel temporal
        with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
            tmp_path = tmp.name

        export_to_eopa_excel(cases, tmp_path, project_name or "PRQA")

        return FileResponse(
            tmp_path,
            filename=f"CasosPrueba_{project_name or 'PRQA'}_{datetime.now().strftime('%Y%m%d')}.xlsx",
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
    finally:
        db.close()


# ══════════════════════════════════════════════════════════════════
# MÓDULO 4 — REGISTRO DE EJECUCIÓN DE PRUEBAS
# ══════════════════════════════════════════════════════════════════

class ExecutionRequest(BaseModel):
    test_case_id: str
    result: str  # "CUMPLE" | "NO CUMPLE"
    notes: Optional[str] = None
    severity: Optional[str] = None
    incident_type: Optional[str] = None
    incident_state: Optional[str] = "Abierto"
    tester_name: Optional[str] = None


@app.post("/api/execution/register")
async def register_execution(req: ExecutionRequest):
    """Registra el resultado de ejecución de un caso de prueba."""
    if req.result not in ["CUMPLE", "NO CUMPLE"]:
        raise HTTPException(400, "El resultado debe ser 'CUMPLE' o 'NO CUMPLE'.")

    db = SessionLocal()
    try:
        test_case = db.query(TestCase).filter(TestCase.id == req.test_case_id).first()
        if not test_case:
            raise HTTPException(404, "Caso de prueba no encontrado.")

        # Actualizar caso de prueba con resultado e info de incidencia
        test_case.result = req.result
        test_case.status = "Ejecutado"
        test_case.notes = req.notes
        test_case.executed_at = datetime.now()
        if req.result == "NO CUMPLE":
            test_case.incident_type = req.incident_type
            test_case.incident_state = req.incident_state or "Abierto"

        # Crear registro histórico de ejecución
        execution = TestExecution(
            id=str(uuid.uuid4()),
            test_case_id=req.test_case_id,
            result=req.result,
            notes=req.notes,
            severity=req.severity,
            incident_type=req.incident_type,
            incident_state=req.incident_state if req.result == "NO CUMPLE" else None,
            tester_name=req.tester_name,
        )
        db.add(execution)
        db.commit()

        return {
            "message": f"Ejecución registrada: {req.result}",
            "execution_id": execution.id,
            "test_case_id": req.test_case_id,
        }
    finally:
        db.close()


@app.get("/api/execution/metrics")
async def get_metrics(project_name: Optional[str] = None):
    """Obtiene métricas de eficiencia del área de QA."""
    db = SessionLocal()
    try:
        query = db.query(TestCase)
        if project_name:
            query = query.filter(TestCase.project_name == project_name)
        all_cases = query.all()

        total = len(all_cases)
        executed = sum(1 for c in all_cases if c.status == "Ejecutado")
        cumple = sum(1 for c in all_cases if c.result == "CUMPLE")
        no_cumple = sum(1 for c in all_cases if c.result == "NO CUMPLE")
        pending = total - executed

        # Distribución por tipo de prueba
        by_type = {}
        for c in all_cases:
            by_type[c.test_type] = by_type.get(c.test_type, 0) + 1

        # Distribución por severidad (solo los que no cumplen)
        by_severity = {}
        for c in all_cases:
            if c.result == "NO CUMPLE" and c.severity:
                by_severity[c.severity] = by_severity.get(c.severity, 0) + 1

        return {
            "total_cases": total,
            "executed": executed,
            "pending": pending,
            "cumple": cumple,
            "no_cumple": no_cumple,
            "pass_rate": round((cumple / executed * 100) if executed > 0 else 0, 1),
            "execution_rate": round((executed / total * 100) if total > 0 else 0, 1),
            "by_type": by_type,
            "by_severity": by_severity,
        }
    finally:
        db.close()


@app.get("/api/execution/history")
async def get_execution_history():
    """Historial completo de ejecuciones."""
    db = SessionLocal()
    try:
        executions = db.query(TestExecution).order_by(TestExecution.executed_at.desc()).limit(100).all()
        return [
            {
                "id": e.id,
                "test_case_id": e.test_case_id,
                "result": e.result,
                "notes": e.notes,
                "severity": e.severity,
                "incident_type": e.incident_type,
                "incident_state": e.incident_state,
                "tester_name": e.tester_name,
                "executed_at": (e.executed_at.isoformat() + "Z") if e.executed_at else None,
            }
            for e in executions
        ]
    finally:
        db.close()


# ════════════════════════════════════════════════════════════════
# MÓDULO 5 — TEMPORIZADOR DE EJECUCIÓN DE PRUEBAS
# ════════════════════════════════════════════════════════════════

class TimerStartRequest(BaseModel):
    test_case_id: str
    tester_name: Optional[str] = None
    project_name: Optional[str] = "Proyectos"

class TimerStopRequest(BaseModel):
    session_id: str
    result: str                          # "CUMPLE" | "NO CUMPLE"
    notes: Optional[str] = None
    severity: Optional[str] = None
    incident_type: Optional[str] = None
    incident_state: Optional[str] = "Abierto"


def _calc_net_seconds(session: TimerSession, reference: datetime) -> float:
    """Calcula segundos netos de ejecución descontando pausas."""
    total = (reference - session.started_at.replace(tzinfo=None)).total_seconds()
    paused = session.paused_seconds or 0.0
    if session.is_paused and session.pause_started_at:
        paused += (reference - session.pause_started_at.replace(tzinfo=None)).total_seconds()
    return max(0.0, total - paused)


@app.post("/api/timer/start")
async def timer_start(req: TimerStartRequest):
    """Inicia un cronómetro para un caso de prueba."""
    db = SessionLocal()
    try:
        tc = db.query(TestCase).filter(TestCase.id == req.test_case_id).first()
        if not tc:
            raise HTTPException(404, "Caso de prueba no encontrado.")

        # Cancelar cualquier sesión activa previa del mismo caso
        prev = db.query(TimerSession).filter(
            TimerSession.test_case_id == req.test_case_id,
            TimerSession.is_running == True
        ).first()
        if prev:
            prev.is_running = False
            prev.stopped_at = datetime.now()
            db.commit()

        session = TimerSession(
            id=str(uuid.uuid4()),
            test_case_id=req.test_case_id,
            project_name=req.project_name or tc.project_name,
            started_at=datetime.now(),
            is_running=True,
            is_paused=False,
            paused_seconds=0.0,
            tester_name=req.tester_name,
            created_at=datetime.now(),
        )
        db.add(session)
        db.commit()
        db.refresh(session)
        return {
            "session_id": session.id,
            "test_case_id": req.test_case_id,
            "started_at": session.started_at.isoformat(),
            "status": "running"
        }
    finally:
        db.close()


@app.post("/api/timer/pause")
async def timer_pause(session_id: str):
    """Pausa el cronómetro activo."""
    db = SessionLocal()
    try:
        session = db.query(TimerSession).filter(TimerSession.id == session_id).first()
        if not session or not session.is_running:
            raise HTTPException(404, "Sesión no encontrada o ya detenida.")
        if session.is_paused:
            raise HTTPException(400, "El cronómetro ya está en pausa.")
        session.is_paused = True
        session.pause_started_at = datetime.now()
        db.commit()
        net = _calc_net_seconds(session, datetime.now())
        return {"status": "paused", "elapsed_seconds": net}
    finally:
        db.close()


@app.post("/api/timer/resume")
async def timer_resume(session_id: str):
    """Reanuda un cronómetro en pausa."""
    db = SessionLocal()
    try:
        session = db.query(TimerSession).filter(TimerSession.id == session_id).first()
        if not session or not session.is_running:
            raise HTTPException(404, "Sesión no encontrada o ya detenida.")
        if not session.is_paused:
            raise HTTPException(400, "El cronómetro no está en pausa.")
        if session.pause_started_at:
            paused_now = (datetime.now() - session.pause_started_at.replace(tzinfo=None)).total_seconds()
            session.paused_seconds = (session.paused_seconds or 0.0) + paused_now
        session.is_paused = False
        session.pause_started_at = None
        db.commit()
        net = _calc_net_seconds(session, datetime.now())
        return {"status": "running", "elapsed_seconds": net}
    finally:
        db.close()


@app.post("/api/timer/stop")
async def timer_stop(req: TimerStopRequest):
    """Detiene el cronómetro y registra el resultado de ejecución."""
    if req.result not in ["CUMPLE", "NO CUMPLE"]:
        raise HTTPException(400, "El resultado debe ser 'CUMPLE' o 'NO CUMPLE'.")

    db = SessionLocal()
    try:
        session = db.query(TimerSession).filter(TimerSession.id == req.session_id).first()
        if not session:
            raise HTTPException(404, "Sesión de cronómetro no encontrada.")

        now = datetime.now()
        net_seconds = _calc_net_seconds(session, now)

        session.stopped_at = now
        session.is_running = False
        session.is_paused = False
        session.execution_time_seconds = net_seconds

        # Actualizar el caso de prueba
        tc = db.query(TestCase).filter(TestCase.id == session.test_case_id).first()
        if tc:
            tc.result = req.result
            tc.status = "Ejecutado"
            tc.notes = req.notes
            tc.executed_at = now
            if req.result == "NO CUMPLE":
                tc.incident_type = req.incident_type
                tc.incident_state = req.incident_state or "Abierto"

        # Crear registro de ejecución con tiempo
        execution = TestExecution(
            id=str(uuid.uuid4()),
            test_case_id=session.test_case_id,
            result=req.result,
            notes=req.notes,
            severity=req.severity,
            incident_type=req.incident_type,
            incident_state=req.incident_state if req.result == "NO CUMPLE" else None,
            tester_name=session.tester_name,
            executed_at=now,
            execution_time_seconds=net_seconds,
            started_at=session.started_at,
            paused_seconds=session.paused_seconds or 0.0,
        )
        db.add(execution)
        db.commit()

        return {
            "session_id": req.session_id,
            "test_case_id": session.test_case_id,
            "result": req.result,
            "execution_time_seconds": net_seconds,
            "execution_id": execution.id,
            "status": "completed"
        }
    finally:
        db.close()


@app.get("/api/timer/active")
async def timer_get_active(test_case_id: str):
    """Devuelve la sesión activa de un caso, si existe."""
    db = SessionLocal()
    try:
        session = db.query(TimerSession).filter(
            TimerSession.test_case_id == test_case_id,
            TimerSession.is_running == True
        ).first()
        if not session:
            return {"active": False}
        net = _calc_net_seconds(session, datetime.now())
        return {
            "active": True,
            "session_id": session.id,
            "started_at": session.started_at.isoformat(),
            "elapsed_seconds": net,
            "is_paused": session.is_paused,
            "paused_seconds": session.paused_seconds or 0.0,
        }
    finally:
        db.close()


@app.get("/api/timer/stats")
async def timer_stats(project_name: Optional[str] = None):
    """Análiticas de tiempo de ejecución por proyecto."""
    db = SessionLocal()
    try:
        query = db.query(TestExecution).filter(TestExecution.execution_time_seconds.isnot(None))

        # Filtrar por proyecto uniendo con TestCase
        if project_name:
            tc_ids = [tc.id for tc in db.query(TestCase).filter(TestCase.project_name == project_name).all()]
            query = query.filter(TestExecution.test_case_id.in_(tc_ids))

        executions = query.all()
        if not executions:
            return {
                "total_executed": 0, "avg_seconds": 0, "total_seconds": 0,
                "min_seconds": 0, "max_seconds": 0,
                "by_type": {}, "by_rf": [], "history": []
            }

        times = [e.execution_time_seconds for e in executions]
        avg   = sum(times) / len(times)
        total = sum(times)
        mn    = min(times)
        mx    = max(times)

        # Por tipo de prueba (join con TestCase)
        by_type = {}
        by_rf   = {}
        history = []
        for e in executions:
            tc = db.query(TestCase).filter(TestCase.id == e.test_case_id).first()
            if tc:
                t = tc.test_type or "DESCONOCIDO"
                if t not in by_type:
                    by_type[t] = {"count": 0, "total_seconds": 0.0}
                by_type[t]["count"] += 1
                by_type[t]["total_seconds"] += e.execution_time_seconds

                # Agrupar por RF (módulo)
                rf = tc.module or "General"
                if rf not in by_rf:
                    by_rf[rf] = {"count": 0, "total_seconds": 0.0, "avg_seconds": 0.0}
                by_rf[rf]["count"] += 1
                by_rf[rf]["total_seconds"] += e.execution_time_seconds

            history.append({
                "execution_id": e.id,
                "test_case_id": e.test_case_id,
                "case_id": tc.case_id if tc else "",
                "title": tc.title if tc else "(eliminado)",
                "module": tc.module if tc else "",
                "test_type": tc.test_type if tc else "",
                "result": e.result,
                "execution_time_seconds": e.execution_time_seconds,
                "tester_name": e.tester_name,
                "executed_at": (e.executed_at.isoformat() + "Z") if e.executed_at else None,
            })

        # Calcular promedios por RF
        for rf in by_rf:
            by_rf[rf]["avg_seconds"] = by_rf[rf]["total_seconds"] / by_rf[rf]["count"]

        # Ordenar historial por fecha descendente
        history.sort(key=lambda x: x["executed_at"] or "", reverse=True)

        # Calcular promedios por tipo
        for t in by_type:
            by_type[t]["avg_seconds"] = by_type[t]["total_seconds"] / by_type[t]["count"]

        return {
            "total_executed": len(executions),
            "avg_seconds": round(avg, 2),
            "total_seconds": round(total, 2),
            "min_seconds": round(mn, 2),
            "max_seconds": round(mx, 2),
            "by_type": [
                {"type": k, "count": v["count"], "avg_seconds": round(v["avg_seconds"], 2)}
                for k, v in sorted(by_type.items(), key=lambda x: -x[1]["total_seconds"])
            ],
            "by_rf": [
                {"rf": k, "count": v["count"],
                 "total_seconds": round(v["total_seconds"], 2),
                 "avg_seconds": round(v["avg_seconds"], 2)}
                for k, v in sorted(by_rf.items(), key=lambda x: -x[1]["total_seconds"])
            ],
            "history": history[:50],
        }
    finally:
        db.close()


@app.get("/api/timer/sessions")
async def timer_sessions_list(project_name: Optional[str] = None):
    """Lista todas las sesiones completadas con sus tiempos."""
    db = SessionLocal()
    try:
        query = db.query(TimerSession).filter(TimerSession.is_running == False)
        if project_name:
            query = query.filter(TimerSession.project_name == project_name)
        sessions = query.order_by(TimerSession.stopped_at.desc()).limit(100).all()
        result = []
        for s in sessions:
            tc = db.query(TestCase).filter(TestCase.id == s.test_case_id).first()
            result.append({
                "session_id": s.id,
                "test_case_id": s.test_case_id,
                "case_id": tc.case_id if tc else "",
                "title": tc.title if tc else "(eliminado)",
                "module": tc.module if tc else "",
                "result": tc.result if tc else None,
                "execution_time_seconds": s.execution_time_seconds,
                "tester_name": s.tester_name,
                "started_at": (s.started_at.isoformat() + "Z") if s.started_at else None,
                "stopped_at": (s.stopped_at.isoformat() + "Z") if s.stopped_at else None,
            })
        return result
    finally:
        db.close()


@app.delete("/api/timer/executions/{execution_id}")
async def delete_timer_execution(execution_id: str):
    """Elimina un registro específico del historial de ejecuciones cronometradas."""
    db = SessionLocal()
    try:
        execution = db.query(TestExecution).filter(TestExecution.id == execution_id).first()
        if not execution:
            raise HTTPException(404, "Registro de ejecución no encontrado.")
        db.delete(execution)
        db.commit()
        return {"deleted": True, "execution_id": execution_id}
    finally:
        db.close()

