"""
PRQA — models.py
Modelos SQLAlchemy para casos de prueba, ejecuciones y documentos
"""
from datetime import datetime
from sqlalchemy import Column, String, Integer, DateTime, Text, ForeignKey
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
