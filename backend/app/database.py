"""
PRQA — database.py
Configuracion de SQLAlchemy con MySQL (PyMySQL driver)
Migrado desde SQLite — Ciel Ingenieria S.A.S 2026
"""
import os
from sqlalchemy import create_engine, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# ── URL de conexion ────────────────────────────────────────────────────────
# Se usa la variable de entorno DB_URL (MySQL) definida en .env / docker-compose.
# Fallback a SQLite local para desarrollo sin Docker.
DB_URL = os.getenv(
    "DB_URL",
    "sqlite:///./prqa_local.db"   # Solo para desarrollo local sin MySQL
)

# Configuracion del engine segun el motor de base de datos
if DB_URL.startswith("sqlite"):
    # SQLite: necesita check_same_thread=False para FastAPI (modo dev unicamente)
    import pathlib
    sqlite_path = DB_URL.replace("sqlite:///", "")
    if sqlite_path.startswith("./") or not sqlite_path.startswith("/"):
        pathlib.Path(sqlite_path).parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(
        DB_URL,
        connect_args={"check_same_thread": False},
    )
else:
    # MySQL / otros:
    # pool_pre_ping verifica la conexion antes de usarla (evita errores de conexion caida)
    # pool_recycle recicla conexiones cada hora
    # La conexion real se establece de forma lazy (cuando se ejecuta la primera query)
    engine = create_engine(
        DB_URL,
        pool_pre_ping=True,
        pool_recycle=3600,          # Reciclar conexiones cada hora
        pool_size=5,                # Conexiones simultaneas
        max_overflow=10,            # Conexiones adicionales en picos
        echo=False,                 # Poner True para depurar queries SQL
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()
