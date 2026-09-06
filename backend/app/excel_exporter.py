"""
PRQA — excel_exporter.py
Exporta casos de prueba cargando la plantilla original EOPA (.xlsx)
de Ciel Ingeniería S.A.S para garantizar paridad del 100% en formato.
"""
import os
import json
from datetime import datetime
from pathlib import Path
from typing import List, Optional

import openpyxl
from openpyxl.styles import PatternFill, Font, Alignment, Border, Side
from openpyxl.cell.cell import MergedCell

# ── Colores corporativos para el resultado (EOPA)
VERDE_CUMPLE  = "D4EDDA"
ROJO_NOCUMPLE = "F8D7DA"
AMARILLO_PEND = "FFF3CD"
BORDE_COLOR   = "DEE2E6"


def _border():
    s = Side(style="thin", color=BORDE_COLOR)
    return Border(left=s, right=s, top=s, bottom=s)

def _fill(hex_color):
    return PatternFill("solid", fgColor=hex_color)

def _font(bold=False, size=9, name="Calibri"):
    return Font(bold=bold, size=size, name=name)

def _align(h="left", v="center", wrap=True):
    return Alignment(horizontal=h, vertical=v, wrap_text=wrap)


def write_cell(ws, row, col, value):
    """
    Escribe un valor en la celda correspondiente.
    Si la celda es secundaria en una combinación, escribe en la celda principal
    para evitar errores de sólo lectura.
    """
    cell = ws.cell(row=row, column=col)
    if isinstance(cell, MergedCell):
        for crange in ws.merged_cells.ranges:
            if crange.min_row <= row <= crange.max_row and crange.min_col <= col <= crange.max_col:
                main_cell = ws.cell(row=crange.min_row, column=crange.min_col)
                main_cell.value = value
                return main_cell
    else:
        cell.value = value
    return cell


def export_to_eopa_excel(test_cases, output_path: str, project_name: str = "PRQA"):
    """
    Carga la plantilla oficial DTR029C-EOPA.xlsx, actualiza los encabezados del proyecto
    e inserta los casos de prueba a partir de la fila 23 respetando las columnas originales.
    Limita la exportación a 42 casos para no romper los bloques combinados nativos inferiores.
    Rellena automáticamente las columnas de incidencias (Q-V) cuando el resultado es NO CUMPLE.
    """
    template_path = Path("/app/DTR029C-EOPA.xlsx")
    if not template_path.exists():
        template_path = Path("DTR029C-EOPA.xlsx")
        if not template_path.exists():
            template_path = Path(__file__).parent / "DTR029C-EOPA.xlsx"

    wb = openpyxl.load_workbook(template_path)
    ws = wb.active

    now = datetime.now()
    date_str = now.strftime("%Y/%m/%d")

    # ── Actualizar cabeceras del proyecto (Filas 8-12)
    write_cell(ws, 8, 4, date_str)
    write_cell(ws, 9, 4, project_name)
    write_cell(ws, 10, 4, "Ciel Ingeniería S.A.S")
    write_cell(ws, 12, 4, "PRQA IA")

    # ── Inyectar logo de Ciel programáticamente en A1
    logo_path = Path("/app/ciel_logo.png")
    if not logo_path.exists():
        logo_path = Path("ciel_logo.png")
        if not logo_path.exists():
            logo_path = Path(__file__).parent / "ciel_logo.png"

    if logo_path.exists():
        from openpyxl.drawing.image import Image
        try:
            img = Image(str(logo_path))
            img.width = 100
            img.height = 50
            ws.add_image(img, "A1")
        except Exception as img_err:
            print(f"Aviso al insertar logo: {img_err}")

    # Truncar casos al límite máximo soportado nativamente por la plantilla (42 casos)
    test_cases = test_cases[:42]

    # ── Rellenar la tabla de datos a partir de la fila 23
    for idx, tc in enumerate(test_cases):
        row = 23 + idx

        if tc.status == "Ejecutado":
            if tc.result == "CUMPLE":
                result_val, result_bg = "CUMPLE", VERDE_CUMPLE
            else:
                result_val, result_bg = "NO CUMPLE", ROJO_NOCUMPLE
        else:
            result_val, result_bg = "PENDIENTE", AMARILLO_PEND

        # ── Columnas del caso de prueba (plantilla EOPA)
        col_values = {
            1: date_str,                        # A: Fecha
            2: tc.case_id,                      # B: ID
            3: tc.test_type,                    # C: Tipo
            4: tc.title,                        # D: Descripción de la Acción (Combinada D-H)
            9: tc.expected_result,              # I: Resultado esperado (Combinada I-L)
            13: result_val,                     # M: Resultado (Combinada M-N)
            15: tc.notes or (f"Técnica: {tc.technique} | Precondición: {tc.preconditions}" if (getattr(tc, "technique", None) or getattr(tc, "preconditions", None)) else ""), # O: Observaciones (Combinada O-P)
        }

        # ── Columnas de incidencias (Q-V): se rellenan cuando el resultado es NO CUMPLE
        # La severidad, tipo y estado del defecto quedan registrados en la EOPA automáticamente
        if tc.result == "NO CUMPLE":
            sev = getattr(tc, "severity", None) or "Tolerable"
            inc_type = getattr(tc, "incident_type", None) or "Error"
            inc_state = getattr(tc, "incident_state", None) or "Abierto"

            col_values.update({
                17: "X",                        # Q: Incidencia registrada (marca)
                18: sev,                        # R: Severidad del defecto
                19: inc_type,                   # S: Tipo de incidencia
                20: inc_state,                  # T: Estado de la incidencia
                21: tc.notes or "",             # U: Descripción del defecto
            })

        for col_i, val in col_values.items():
            try:
                cell = write_cell(ws, row, col_i, val)
                cell.font = _font(size=9)
                cell.alignment = _align("left", "center", True)
                cell.border = _border()

                if col_i == 13:
                    cell.fill = _fill(result_bg)
                    cell.alignment = _align("center", "center", True)
                elif col_i == 17 and tc.result == "NO CUMPLE":
                    cell.fill = _fill(ROJO_NOCUMPLE)
                    cell.alignment = _align("center", "center", True)
            except Exception as e:
                print(f"Error escribiendo celda Fila {row} Col {col_i}: {e}")

        # Alto de fila adaptado para descripciones detalladas de varias líneas (estándar EOPA)
        ws.row_dimensions[row].height = 48

    wb.save(output_path)
