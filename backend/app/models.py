"""
PRQA - models.py
Modelos SQLAlchemy para casos de prueba, ejecuciones, temporizadores y documentos.
Compatible con MySQL 8 y SQLite.
"""
from datetime import datetime
from sqlalchemy import Column, String, Integer, Float, DateTime, Text, ForeignKey, Boolean
from database import Base


class Document(Base):
    """Documentos indexados en la base de conocimiento."""
    __tablename__ = "documents"

    id           = Column(String(36),  primary_key=True)       # UUID
    filename     = Column(String(255), nullable=False)
    file_path    = Column(String(512), nullable=False)
    category     = Column(String(50),  default="requirements")  # mtr | requirements | templates
    project_name = Column(String(150), default="Proyectos")
    size_bytes   = Column(Integer,     default=0)
    chunks_count = Column(Integer,     default=0)
    uploaded_at  = Column(DateTime,    default=datetime.now)


class TestCase(Base):
    """Casos de prueba generados por la IA o creados manualmente."""
    __tablename__ = "test_cases"

    id                 = Column(String(36),  primary_key=True)       # UUID
    case_id            = Column(String(50),  nullable=False)          # CFG-[TIPO]-[CAT]-[NN]
    project_name       = Column(String(150), default="Proyectos")
    module             = Column(String(150), default="General")
    title              = Column(String(500), nullable=False)
    test_type          = Column(String(100), nullable=False)          # FUNCIONALES | NO FUNCIONALES | etc.
    technique          = Column(String(150), default="")              # Tecnica de prueba
    preconditions      = Column(Text,        default="")
    steps              = Column(Text,        default="[]")            # JSON list of steps
    expected_result    = Column(Text,        default="")
    severity           = Column(String(50),  default="Tolerable")     # Bloqueante | Critico | Tolerable | UI
    category           = Column(String(50),  default="")              # CORE | PROV | VAL | RNEG
    acceptance_criteria= Column(Text,        default="")
    status             = Column(String(30),  default="Pendiente")     # Pendiente | Ejecutado
    result             = Column(String(20),  nullable=True)           # CUMPLE | NO CUMPLE
    notes              = Column(Text,        nullable=True)
    incident_type      = Column(String(100), nullable=True)           # Error | Mejora (cuando NO CUMPLE)
    incident_state     = Column(String(50),  nullable=True)           # Abierto | Re-abierto | Cerrado
    export_file        = Column(String(255), nullable=True)           # Archivo Excel especifico asociado
    created_at         = Column(DateTime,    default=datetime.now)
    executed_at        = Column(DateTime,    nullable=True)


class TestExecution(Base):
    """Registro historico de ejecuciones de pruebas."""
    __tablename__ = "test_executions"

    id             = Column(String(36),  primary_key=True)            # UUID
    test_case_id   = Column(String(36),  ForeignKey("test_cases.id"), nullable=False)
    result         = Column(String(20),  nullable=False)              # CUMPLE | NO CUMPLE
    notes          = Column(Text,        nullable=True)
    severity       = Column(String(50),  nullable=True)
    incident_type  = Column(String(100), nullable=True)               # Mejora | Error
    incident_state = Column(String(50),  nullable=True)               # Abierto | Re-abierto | Cerrado
    tester_name    = Column(String(150), nullable=True)
    executed_at    = Column(DateTime,    default=datetime.now)
    # Campos de tiempo de ejecucion
    execution_time_seconds = Column(Float,    nullable=True)          # Tiempo total en segundos
    started_at             = Column(DateTime, nullable=True)          # Cuando se inicio el timer
    paused_seconds         = Column(Float,    default=0.0)            # Segundos acumulados en pausa


class TimerSession(Base):
    """Sesiones de cronometro activas o completadas por caso de prueba."""
    __tablename__ = "timer_sessions"

    id                     = Column(String(36),  primary_key=True)   # UUID
    test_case_id           = Column(String(36),  ForeignKey("test_cases.id"), nullable=False)
    project_name           = Column(String(150), default="Proyectos")
    started_at             = Column(DateTime,    nullable=False)       # Inicio del cronometro
    stopped_at             = Column(DateTime,    nullable=True)        # Fin (None si esta corriendo)
    paused_seconds         = Column(Float,       default=0.0)         # Segundos de pausa acumulados
    execution_time_seconds = Column(Float,       nullable=True)       # Tiempo neto calculado
    is_running             = Column(Boolean,     default=True)        # True = activo
    is_paused              = Column(Boolean,     default=False)       # True = en pausa
    pause_started_at       = Column(DateTime,    nullable=True)       # Cuando empezo la pausa actual
    tester_name            = Column(String(150), nullable=True)
    created_at             = Column(DateTime,    default=datetime.now)
