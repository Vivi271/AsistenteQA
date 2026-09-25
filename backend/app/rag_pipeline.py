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

SYSTEM_PROMPT = """Eres CIEL AI, la asistente oficial de Aseguramiento de Calidad (QA) de Ciel Ingeniería S.A.S. en la plataforma PRQA.
Tu rol es orientar a los ingenieros en el flujo de calidad: Base de Conocimiento, Generación de Casos EOPA DTR029C, Ejecución de Pruebas y Dashboard.

REGLAS DE RESPUESTA:
- Responde siempre en español, de forma cordial, profesional y concisa.
- Sé directa: responde en máximo 2 a 3 puntos breves o un párrafo corto.
- Concluye siempre tus oraciones con punto final. Nunca dejes listas cortadas ni numeraciones vacías.{context_block}"""


def is_conversational_query(text: str) -> bool:
    """Detecta si la consulta es un saludo o pregunta general sobre CIEL AI/PRQA que no requiere buscar en documentos del proyecto."""
    q = text.lower().strip()
    doc_keywords = ["requisito", "requerimiento", "criterio", "historia", "contrato", "prd", "brd", "mtr", "tabla", "modulo", "módulo", "endpoint", "api"]
    if any(k in q for k in doc_keywords):
        return False
    meta_patterns = [
        "hola", "buen", "saludos", "que tal", "qué tal", "que mas", "qué más",
        "que sabes hacer", "qué sabes hacer", "que puedes hacer", "qué puedes hacer",
        "quien eres", "quién eres", "como te llamas", "cómo te llamas",
        "ciel ai", "ciel", "para que sirves", "para qué sirves",
        "que es prqa", "qué es prqa", "como funciona", "cómo funciona",
        "ayuda", "help", "gracias", "muchas gracias", "adios", "adiós", "chao"
    ]
    return any(p in q for p in meta_patterns)



class RAGPipeline:
    """Pipeline RAG que combina ChromaDB para recuperación y Ollama para generación."""

    def __init__(self):
        # Inicializar cliente Ollama síncrono y asíncrono con timeout ampliado para CPU
        self.ollama_client = ollama.Client(host=OLLAMA_HOST, timeout=300.0)
        self.async_ollama = ollama.AsyncClient(host=OLLAMA_HOST, timeout=300.0)

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

    async def retrieve(
        self,
        query: str,
        n_results: int = 3,
        project_name: str = None,
        doc_names: List[str] = None,
        max_distance: float = 0.60
    ) -> Tuple[str, List[str]]:
        """Recupera los fragmentos más relevantes para una consulta, filtrando opcionalmente por proyecto y documentos específicos."""
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

        # Construir filtro 'where' combinando proyecto y/o documentos específicos
        conditions = []
        if project_name:
            conditions.append({"project": project_name})
        if doc_names and len(doc_names) > 0:
            clean_docs = [str(d).strip() for d in doc_names if str(d).strip()]
            if len(clean_docs) == 1:
                conditions.append({"source": clean_docs[0]})
            elif len(clean_docs) > 1:
                conditions.append({"source": {"$in": clean_docs}})

        if len(conditions) == 1:
            query_kwargs["where"] = conditions[0]
        elif len(conditions) > 1:
            query_kwargs["where"] = {"$and": conditions}

        results = self.collection.query(**query_kwargs)

        if not results["documents"] or not results["documents"][0]:
            return "", []

        # Filtrar fragmentos con distancia coseno según umbral
        filtered_docs = []
        filtered_sources = []
        distances = results.get("distances", [[]])[0]

        for doc, meta, dist in zip(
            results["documents"][0],
            results["metadatas"][0],
            distances
        ):
            if dist <= max_distance:
                filtered_docs.append(doc)
                filtered_sources.append(meta["source"])

        # Si el filtro estricto descartó todo pero el usuario seleccionó documentos específicos,
        # devolver los mejores fragmentos disponibles del documento elegido
        if not filtered_docs and doc_names and results["documents"][0]:
            filtered_docs = results["documents"][0][:n_results]
            filtered_sources = [m["source"] for m in results["metadatas"][0][:n_results]]

        if not filtered_docs:
            return "", []

        context = "\n\n---\n\n".join(filtered_docs)
        sources = list(set(filtered_sources))
        return context, sources

    async def query(self, question: str, use_knowledge_base: bool = True, project_name: str = None) -> Tuple[str, List[str]]:
        """Consulta 100% generada por el LLM local (Ollama) con contexto RAG."""
        self._check_ready()
        if not self._ready:
            raise RuntimeError("El servidor de IA local (Ollama) no está disponible.")

        context = ""
        sources = []

        if use_knowledge_base and not is_conversational_query(question):
            try:
                context, sources = await self.retrieve(question, project_name=project_name, n_results=2, max_distance=0.48)
            except Exception as e:
                print(f"Aviso al recuperar contexto RAG para chat: {e}")

        context_block = ""
        if context:
            context_block = f"\n\nDOCUMENTOS DE REFERENCIA DEL PROYECTO:\n{context}\n\nUsa únicamente la información anterior si la pregunta del usuario lo requiere."

        prompt = SYSTEM_PROMPT.format(context_block=context_block)

        response = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: self.ollama_client.chat(
                model=LLM_MODEL,
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": question},
                ],
                keep_alive="24h",
                options={
                    "temperature": 0.3,
                    "num_predict": 280,
                    "num_ctx": 1536,
                    "num_thread": 6,
                    "top_k": 20,
                    "top_p": 0.85,
                    "repeat_penalty": 1.1
                },
            )
        )

        answer = response["message"]["content"]
        return answer, sources

    async def stream_query(self, question: str, use_knowledge_base: bool = True, project_name: str = None) -> AsyncIterator[str]:
        """Streaming del LLM con contexto RAG asíncrono y no bloqueante."""
        self._check_ready()
        if not self._ready:
            yield "Error: Ollama no está disponible."
            return

        context = ""
        if use_knowledge_base and not is_conversational_query(question):
            try:
                context, _ = await self.retrieve(question, project_name=project_name, n_results=2, max_distance=0.48)
            except Exception as e:
                print(f"Aviso en streaming RAG: {e}")

        context_block = ""
        if context:
            context_block = f"\n\nDOCUMENTOS DE REFERENCIA DEL PROYECTO:\n{context}\n\nUsa únicamente la información anterior si la pregunta del usuario lo requiere."

        prompt = SYSTEM_PROMPT.format(context_block=context_block)

        try:
            stream = await self.async_ollama.chat(
                model=LLM_MODEL,
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": question},
                ],
                stream=True,
                keep_alive="24h",
                options={
                    "temperature": 0.2,
                    "num_predict": 150,
                    "num_ctx": 1024,
                    "num_thread": 6,
                    "top_k": 20,
                    "top_p": 0.85
                },
            )

            async for chunk in stream:
                content = chunk.get("message", {}).get("content", "")
                if content:
                    yield content
        except Exception as e:
            print(f"Error en stream_query: {e}")
            yield f"Error al generar respuesta: {str(e)}"

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
