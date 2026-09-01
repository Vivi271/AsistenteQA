"""
PRQA — rag_pipeline.py
Pipeline RAG con ChromaDB + Ollama para la base de conocimiento privada
"""
import os
import asyncio
from pathlib import Path
from typing import List, Tuple, AsyncIterator, Optional

import chromadb
from chromadb.config import Settings
import ollama

from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_community.document_loaders import (
    PyPDFLoader,
    Docx2txtLoader,
    TextLoader,
    UnstructuredExcelLoader,
)


OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://ollama:11434")
LLM_MODEL = os.getenv("LLM_MODEL", "llama3.2:3b")
EMBED_MODEL = "nomic-embed-text"
CHROMA_PATH = os.getenv("CHROMA_PATH", "/app/chroma_db")
COLLECTION_NAME = "prqa_knowledge"

SYSTEM_PROMPT = """Eres CIEL AI, la asistente oficial de Inteligencia Artificial para Aseguramiento de Calidad (QA) de Ciel Ingeniería S.A.S., integrada en la plataforma PRQA.

TU ROL Y MISIÓN:
Ayudar a los testers e ingenieros de calidad a comprender la plataforma PRQA, analizar requerimientos de software y generar o validar casos de prueba de forma profesional, clara y pedagógica.

ESTRUCTURA DE LA PLATAFORMA PRQA (FLUJO DE 4 PASOS):
1. 📂 Base de Conocimiento (Paso 1): Carga e indexación semántica de documentos técnicos (PDF, Word, Excel como MTR o BRD) en ChromaDB para usarlos como contexto inteligente.
2. ⚡ Generar Casos (Paso 2): Creación automática de matrices de prueba en Excel estándar EOPA DTR029C según los tipos seleccionados (Funcionales, Negativos, Seguridad, Integración, UI/UX, Carga).
3. 📋 Ejecutar Pruebas (Paso 3): Registro de resultados reales (CUMPLE / NO CUMPLE), asignación de severidad a defectos (Crítica, Alta, Media, Baja) e incidencias.
4. ⏱️ Tiempos de Ejecución (Paso 4): Cronómetro digital HUD integrado para medir la duración de las pruebas y la productividad del tester.
5. 📊 Dashboard: Panel de analíticas que consolida en tiempo real los KPIs del ciclo: Total de casos, Tasa de Éxito y defectos por severidad.

PAUTAS DE RESPUESTA:
- Responde SIEMPRE en español, con tono profesional, claro, estructurado y muy cordial.
- Si el usuario dice que "no entiende", pide ayuda o pregunta cómo funciona la plataforma, explícale de forma amigable y paso a paso el flujo de PRQA. NUNCA confundas la aplicación PRQA con los documentos del proyecto.
- Si la pregunta es sobre el proyecto activo o requerimientos específicos, responde utilizando el contexto de documentos indexados y cita el nombre del documento fuente.
- Si el contexto proporcionado no contiene la respuesta a una pregunta sobre el proyecto, dilo amablemente y orienta al usuario sobre qué documento subir o consultar.
- Mantén tus explicaciones concretas, directas y fáciles de entender.

CONTEXTO DE DOCUMENTOS DEL PROYECTO (USAR SOLO SI APLICA):
{context}
"""


class RAGPipeline:
    """Pipeline RAG que combina ChromaDB para recuperación y Ollama para generación."""

    def __init__(self):
        # Inicializar cliente Ollama con timeout ampliado para CPU
        self.ollama_client = ollama.Client(host=OLLAMA_HOST, timeout=180.0)

        # Inicializar ChromaDB persistente
        Path(CHROMA_PATH).mkdir(parents=True, exist_ok=True)
        self.chroma_client = chromadb.PersistentClient(
            path=CHROMA_PATH,
            settings=Settings(anonymized_telemetry=False)
        )

        # Obtener o crear colección
        self.collection = self.chroma_client.get_or_create_collection(
            name=COLLECTION_NAME,
            metadata={"hnsw:space": "cosine"}
        )

        # Splitter para fragmentar documentos
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=600,
            chunk_overlap=80,
            separators=["\n\n", "\n", ". ", " ", ""]
        )

        self._ready = False
        self._check_ready()

    def _check_ready(self):
        """Verifica que Ollama esté disponible."""
        try:
            self.ollama_client.list()
            self._ready = True
        except Exception as e:
            print(f"⚠️  Ollama no disponible: {e}")
            self._ready = False

    def is_ready(self) -> bool:
        return self._ready

    def _embed(self, texts: List[str]) -> List[List[float]]:
        """Genera embeddings usando el modelo de Ollama."""
        embeddings = []
        for text in texts:
            response = self.ollama_client.embeddings(
                model=EMBED_MODEL,
                prompt=text
            )
            embeddings.append(response["embedding"])
        return embeddings

    async def index_document(self, file_path: str, project_name: str = "General") -> int:
        """Indexa un documento en ChromaDB. Retorna el número de fragmentos."""
        path = Path(file_path)
        suffix = path.suffix.lower()

        # Cargar documento según tipo
        try:
            if suffix == ".pdf":
                loader = PyPDFLoader(file_path)
                docs = loader.load()
            elif suffix == ".docx":
                import docx
                from langchain_core.documents import Document as LangchainDocument
                
                doc_obj = docx.Document(file_path)
                paragraphs = [p.text.strip() for p in doc_obj.paragraphs if p.text.strip()]
                
                # Extraer también texto de tablas dentro del docx
                table_lines = []
                for table in doc_obj.tables:
                    for row in table.rows:
                        row_cells = [cell.text.strip() for cell in row.cells if cell.text.strip()]
                        if row_cells:
                            table_lines.append(" | ".join(row_cells))
                
                full_text = "\n".join(paragraphs)
                if table_lines:
                    full_text += "\n\n--- TABLAS DEL REQUERIMIENTO ---\n" + "\n".join(table_lines)
                    
                docs = [LangchainDocument(page_content=full_text, metadata={"source": path.name})]
            elif suffix in [".xlsx", ".xls"]:
                # Cargador local offline personalizado usando openpyxl para evitar 403 HTTP Errors
                import openpyxl
                from langchain_core.documents import Document as LangchainDocument
                
                wb = openpyxl.load_workbook(file_path, read_only=True, data_only=True)
                text_content = []
                for sheet_name in wb.sheetnames:
                    sheet = wb[sheet_name]
                    sheet_text = [f"--- Hoja: {sheet_name} ---"]
                    for row in sheet.iter_rows(values_only=True):
                        row_str = " | ".join([str(val).strip() for val in row if val is not None])
                        if row_str.strip():
                            sheet_text.append(row_str)
                    text_content.append("\n".join(sheet_text))
                
                full_text = "\n\n".join(text_content)
                docs = [LangchainDocument(page_content=full_text, metadata={"source": path.name})]
            elif suffix in [".txt", ".md"]:
                loader = TextLoader(file_path, encoding="utf-8")
                docs = loader.load()
            else:
                raise ValueError(f"Tipo no soportado: {suffix}")
        except Exception as e:
            raise RuntimeError(f"Error cargando documento {path.name}: {e}")

        # Fragmentar
        chunks = self.splitter.split_documents(docs)
        if not chunks:
            return 0

        # Generar embeddings
        texts = [c.page_content for c in chunks]
        embeddings = await asyncio.get_event_loop().run_in_executor(
            None, self._embed, texts
        )

        # Guardar en ChromaDB
        ids = [f"{path.stem}_{i}" for i in range(len(chunks))]
        metadatas = [
            {
                "source": path.name,
                "file_path": file_path,
                "chunk_index": i,
                "page": c.metadata.get("page", 0),
                "project": project_name,
            }
            for i, c in enumerate(chunks)
        ]

        # Eliminar versión anterior si existe
        try:
            existing = self.collection.get(where={"file_path": file_path})
            if existing["ids"]:
                self.collection.delete(ids=existing["ids"])
        except Exception:
            pass

        self.collection.add(
            ids=ids,
            documents=texts,
            embeddings=embeddings,
            metadatas=metadatas,
        )

        return len(chunks)

    async def retrieve(self, query: str, n_results: int = 3, project_name: str = None) -> Tuple[str, List[str]]:
        """Recupera los fragmentos más relevantes para una consulta, filtrando por relevancia semántica."""
        if self.collection.count() == 0:
            return "", []

        # Embed de la consulta
        query_embedding = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: self.ollama_client.embeddings(model=EMBED_MODEL, prompt=query)["embedding"]
        )

        query_kwargs = {
            "query_embeddings": [query_embedding],
            "n_results": min(n_results, self.collection.count()),
            "include": ["documents", "metadatas", "distances"],
        }
        if project_name:
            query_kwargs["where"] = {"project": project_name}

        results = self.collection.query(**query_kwargs)

        if not results["documents"] or not results["documents"][0]:
            return "", []

        # Filtrar fragmentos con distancia coseno alta (> 0.55 = baja relevancia semántica)
        # Distancia coseno: 0 = idéntico, 1 = opuesto. < 0.55 = relevante.
        MAX_DISTANCE = 0.55
        filtered_docs = []
        filtered_sources = []
        distances = results.get("distances", [[]])[0]

        for doc, meta, dist in zip(
            results["documents"][0],
            results["metadatas"][0],
            distances
        ):
            if dist <= MAX_DISTANCE:
                filtered_docs.append(doc)
                filtered_sources.append(meta["source"])

        if not filtered_docs:
            # Ningún fragmento es lo suficientemente relevante
            return "", []

        context = "\n\n---\n\n".join(filtered_docs)
        sources = list(set(filtered_sources))
        return context, sources

    async def query(self, question: str, use_knowledge_base: bool = True, project_name: str = None) -> Tuple[str, List[str]]:
        """Consulta al LLM con contexto RAG y parámetros optimizados para CPU."""
        self._check_ready()
        if not self._ready:
            raise RuntimeError("Ollama no está disponible.")

        context = ""
        sources = []

        if use_knowledge_base:
            context, sources = await self.retrieve(question, project_name=project_name)

        prompt = SYSTEM_PROMPT.format(
            context=context if context else "No hay documentos indexados en este proyecto."
        )

        response = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: self.ollama_client.chat(
                model=LLM_MODEL,
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": question},
                ],
                options={
                    "temperature": 0.35,
                    "num_predict": 350,
                    "num_ctx": 2048,
                    "num_thread": 6,
                    "top_k": 30,
                    "top_p": 0.90
                },
            )
        )

        answer = response["message"]["content"]
        return answer, sources

    async def stream_query(self, question: str, use_knowledge_base: bool = True, project_name: str = None) -> AsyncIterator[str]:
        """Streaming del LLM con contexto RAG."""
        self._check_ready()
        if not self._ready:
            yield "Error: Ollama no está disponible."
            return

        context = ""
        if use_knowledge_base:
            context, _ = await self.retrieve(question, project_name=project_name)

        prompt = SYSTEM_PROMPT.format(
            context=context if context else "No hay documentos indexados en este proyecto."
        )

        stream = self.ollama_client.chat(
            model=LLM_MODEL,
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": question},
            ],
            stream=True,
            options={
                "temperature": 0.35,
                "num_predict": 350,
                "num_ctx": 2048,
                "num_thread": 6
            },
        )

        for chunk in stream:
            if chunk.get("message", {}).get("content"):
                yield chunk["message"]["content"]

    async def remove_document(self, file_path: str):
        """Elimina los fragmentos de un documento de ChromaDB."""
        try:
            existing = self.collection.get(where={"file_path": file_path})
            if existing["ids"]:
                self.collection.delete(ids=existing["ids"])
        except Exception as e:
            print(f"Error eliminando documento de ChromaDB: {e}")

    def get_document_text(self, filename: str) -> str:
        """Obtiene todo el texto indexado de un archivo desde ChromaDB."""
        if not self._ready or self.collection.count() == 0:
            return ""
        try:
            results = self.collection.get(where={"source": filename})
            if results and results["documents"]:
                return "\n\n".join(results["documents"])
        except Exception as e:
            print(f"Error obteniendo texto de Chroma: {e}")
        return ""
