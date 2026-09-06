"""
PRQA — models.py
Modelos SQLAlchemy para casos de prueba, ejecuciones, temporizadores y documentos
"""
from datetime import datetime
from sqlalchemy import Column, String, Integer, Float, DateTime, Text, ForeignKey, Boolean
from database import Base


class Document(Base):
    """Documentos indexados en la base de conocimiento."""
    __tablename__ = "documents"

    id = Column(String, primary_key=True)
    filename = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    category = Column(String, default="requirements")  # mtr | requirements | templates
    project_name = Column(String, default="Proyectos")
    size_bytes = Column(Integer, default=0)
    chunks_count = Column(Integer, default=0)
    uploaded_at = Column(DateTime, default=datetime.now)


class TestCase(Base):
    """Casos de prueba generados por la IA."""
    __tablename__ = "test_cases"

    id = Column(String, primary_key=True)
    case_id = Column(String, nullable=False)          # CFG-[TIPO]-[CATEGORIA]-[NN]
    project_name = Column(String, default="Proyectos")
    module = Column(String, default="General")
    title = Column(String, nullable=False)
    test_type = Column(String, nullable=False)         # FUNCIONALES | NO FUNCIONALES | etc.
    technique = Column(String, default="")             # Técnica de prueba
    preconditions = Column(Text, default="")
    steps = Column(Text, default="[]")                 # JSON list of steps
    expected_result = Column(Text, default="")
    severity = Column(String, default="Tolerable")     # Bloqueante | Crítico | Tolerable | UI
    category = Column(String, default="")              # CORE | PROV | VAL | RNEG
    acceptance_criteria = Column(Text, default="")
    status = Column(String, default="Pendiente")       # Pendiente | Ejecutado
    result = Column(String, nullable=True)             # CUMPLE | NO CUMPLE
    notes = Column(Text, nullable=True)
    incident_type = Column(String, nullable=True)      # Error | Mejora (cuando NO CUMPLE)
    incident_state = Column(String, nullable=True)     # Abierto | Re-abierto | Cerrado
    export_file = Column(String, nullable=True)        # Archivo Excel específico asociado
    created_at = Column(DateTime, default=datetime.now)
    executed_at = Column(DateTime, nullable=True)


class TestExecution(Base):
    """Registro histórico de ejecuciones de pruebas."""
    __tablename__ = "test_executions"

    id = Column(String, primary_key=True)
    test_case_id = Column(String, ForeignKey("test_cases.id"), nullable=False)
    result = Column(String, nullable=False)            # CUMPLE | NO CUMPLE
    notes = Column(Text, nullable=True)
    severity = Column(String, nullable=True)
    incident_type = Column(String, nullable=True)      # Mejora | Error
    incident_state = Column(String, nullable=True)     # Abierto | Re-abierto | Cerrado
    tester_name = Column(String, nullable=True)
    executed_at = Column(DateTime, default=datetime.now)
    # ── Campos de tiempo de ejecución ──────────────────────────
    execution_time_seconds = Column(Float, nullable=True)   # Tiempo total en segundos
    started_at = Column(DateTime, nullable=True)             # Cuándo se inició el timer
    paused_seconds = Column(Float, default=0.0)              # Segundos acumulados en pausa


class TimerSession(Base):
    """Sesiones de cronómetro activas o completadas por caso de prueba."""
    __tablename__ = "timer_sessions"

    id = Column(String, primary_key=True)
    test_case_id = Column(String, ForeignKey("test_cases.id"), nullable=False)
    project_name = Column(String, default="Proyectos")
    started_at = Column(DateTime, nullable=False)            # Inicio del cronómetro
    stopped_at = Column(DateTime, nullable=True)             # Fin (None si está corriendo)
    paused_seconds = Column(Float, default=0.0)              # Segundos de pausa acumulados
    execution_time_seconds = Column(Float, nullable=True)    # Tiempo neto calculado
    is_running = Column(Boolean, default=True)               # True = activo
    is_paused = Column(Boolean, default=False)               # True = en pausa
    pause_started_at = Column(DateTime, nullable=True)       # Cuándo empezó la pausa actual
    tester_name = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.now)
