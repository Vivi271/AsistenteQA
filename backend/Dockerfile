FROM python:3.11-slim

WORKDIR /app

# Dependencias del sistema
RUN apt-get update && apt-get install -y \
    build-essential \
    libmagic1 \
    poppler-utils \
    tesseract-ocr \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Instalar dependencias Python (contexto de build = raíz del proyecto)
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar código del backend
COPY backend/app/ .

# Copiar frontend como archivos estáticos (servidos por FastAPI)
COPY frontend/ ./static/

# Crear directorios de datos (sobrescritos por volúmenes Docker)
RUN mkdir -p /app/db /app/chroma_db /app/knowledge_base/mtr \
    /app/knowledge_base/requirements /app/knowledge_base/templates

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
