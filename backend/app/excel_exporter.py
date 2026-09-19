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
BORDE_COLOR   = "000000"   # Negro — igual que los bordes nativos del template EOPA


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
    Si la celda es secundaria en una combinacion, escribe en la celda principal
    para evitar errores de solo lectura.
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


def _fmt_seconds(secs):
    """Formatea segundos como MM:SS para mostrar en Excel."""
    if secs is None:
        return ""
    try:
        s = int(round(float(secs)))
        return f"{s // 60:02d}:{s % 60:02d}"
    except Exception:
        return str(secs)


def export_to_eopa_excel(test_cases, output_path: str, project_name: str = "PRQA",
                         executions_map: dict = None):
    """
    Carga la plantilla oficial DTR029C-EOPA.xlsx, actualiza los encabezados del proyecto
    e inserta los casos de prueba a partir de la fila 23 respetando las columnas originales.
    Limita la exportacion a 42 casos para no romper los bloques combinados nativos inferiores.
    Rellena automaticamente las columnas de incidencias (Q-V) cuando el resultado es NO CUMPLE.
    Incluye el tiempo de ejecucion cronometrado en la columna Observaciones si esta disponible.
    executions_map: dict {tc_id: execution_time_seconds}
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
    write_cell(ws, 10, 4, "Ciel Ingenieria S.A.S")
    write_cell(ws, 12, 4, "PRQA IA")

    # ── Inyectar logo de Ciel programaticamente en A1
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

    # Truncar casos al limite maximo soportado nativamente por la plantilla (42 casos)
    test_cases = test_cases[:42]
    executions_map = executions_map or {}

    # ═══════════════════════════════════════════════════════════════════
    # Mapa exacto de columnas del template DTR029C-EOPA.xlsx (fila 22):
    #   A(1)=Fecha  B(2)=ID  C(3)=Tipo  D-H(4-8)=Descripcion
    #   I-L(9-12)=Resultado Esperado  M-N(13-14)=Resultado
    #   O-P(15-16)=Observaciones
    #   Q(17)=FECHA INCIDENCIA  R(18)=DESCRIPCION  S(19)=PASOS  T(20)=SEVERIDAD ...
    # PRQA usa Q(17), R(18), S(19), T(20) con sus propios encabezados.
    # Las columnas U(21) en adelante quedan libres para uso manual del tester.
    # ═══════════════════════════════════════════════════════════════════

    COL_TIEMPO   = 17   # Q — Tiempo de Ejecucion (unica columna gestionada por PRQA)

    # ── Encabezado de la columna PRQA (fila 22) — misma fuente que el template
    hdr_font  = Font(bold=True, size=9, color="FFFFFF", name="Calibri")
    hdr_align = Alignment(horizontal="center", vertical="center", wrap_text=True)
    hdr_brd   = _border()

    tiempo_h = ws.cell(row=22, column=COL_TIEMPO, value="Tiempo de\nEjecucion")
    tiempo_h.font = hdr_font; tiempo_h.fill = PatternFill("solid", fgColor="009CA6")
    tiempo_h.alignment = hdr_align; tiempo_h.border = hdr_brd
    ws.column_dimensions["Q"].width = 13

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

        # Tiempo de ejecucion cronometrado — columna Q (17)
        exec_time_str = _fmt_seconds(executions_map.get(tc.id))

        # Observaciones (O-P): notas reales del tester (sin texto automatico)
        obs_parts = []
        if tc.notes and tc.notes.strip():
            obs_parts.append(tc.notes.strip())
        if not obs_parts and (getattr(tc, "technique", None) or getattr(tc, "preconditions", None)):
            obs_parts.append(f"Tecnica: {tc.technique} | Precondicion: {tc.preconditions}")
        obs_text = " | ".join(obs_parts) if obs_parts else ""

        # ── Columnas base EOPA
        col_values = {
            1:  date_str,
            2:  tc.case_id,
            3:  tc.test_type,
            4:  tc.title,
            9:  tc.expected_result,
            13: result_val,
            15: obs_text,
        }

        data_font = Font(bold=False, size=9, name="Calibri", color="1E293B")

        for col_i, val in col_values.items():
            try:
                cell = write_cell(ws, row, col_i, val)
                cell.font      = data_font
                cell.alignment = _align("left", "center", True)
                if col_i == 13:
                    cell.fill      = _fill(result_bg)
                    cell.alignment = _align("center", "center", True)
            except Exception as e:
                print(f"Error escribiendo celda Fila {row} Col {col_i}: {e}")

        # ── Col Q (17): Tiempo de Ejecucion — siempre presente
        t_cell = ws.cell(row=row, column=COL_TIEMPO,
                         value=exec_time_str if exec_time_str else "")
        t_cell.font      = Font(bold=False, size=9, name="Calibri",
                                color="155724" if exec_time_str else "94A3B8")
        t_cell.fill      = PatternFill("solid",
                                       fgColor="D4EDDA" if exec_time_str else "F8FAFC")
        t_cell.alignment = Alignment(horizontal="center", vertical="center")
        t_cell.border    = _border()

        ws.row_dimensions[row].height = 48

    wb.save(output_path)



def export_timer_report(executions, output_path: str, project_name: str = "PRQA"):
    """
    Genera un reporte Excel independiente de tiempos de ejecucion cronometrados.
    Columnas: Fecha, ID Caso, Nombre del Caso, Tipo, Modulo, Resultado,
              Severidad, Tipo Incidencia, Estado Incidencia,
              Tiempo (MM:SS), Tiempo (seg), Observaciones
    """
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Tiempos de Ejecucion"

    # ── Paleta de colores
    HEADER_BG = "1E293B"    # Azul oscuro corporativo
    HEADER_FG = "FFFFFF"
    ROW_ODD   = "F8FAFC"
    ROW_EVEN  = "FFFFFF"
    ACCENT    = "009CA6"    # Teal corporativo Ciel

    now = datetime.now()

    # ── Titulo del reporte (fila 1)
    ws.merge_cells("A1:L1")
    title_cell = ws["A1"]
    title_cell.value = f"REPORTE DE TIEMPOS DE EJECUCION — {project_name.upper()}"
    title_cell.font = Font(bold=True, size=13, color=HEADER_FG, name="Calibri")
    title_cell.fill = PatternFill("solid", fgColor=HEADER_BG)
    title_cell.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 32

    # Subtitulo (fila 2)
    ws.merge_cells("A2:L2")
    sub_cell = ws["A2"]
    sub_cell.value = f"Generado: {now.strftime('%d/%m/%Y %H:%M')} | PRQA – QA Automatizado con IA"
    sub_cell.font = Font(size=9, italic=True, color="64748B", name="Calibri")
    sub_cell.fill = PatternFill("solid", fgColor="F1F5F9")
    sub_cell.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[2].height = 18

    # Fila 3 vacia como separador
    ws.row_dimensions[3].height = 6

    # ── Encabezados de columnas (fila 4)
    headers = [
        "Fecha Ejecucion", "ID Caso", "Caso de Prueba", "Tipo Prueba",
        "Modulo / RF", "Resultado", "Severidad", "Tipo Incidencia",
        "Estado", "Tiempo (MM:SS)", "Tiempo (seg)", "Observaciones / Notas"
    ]
    col_widths = [16, 14, 40, 14, 18, 12, 11, 16, 12, 13, 12, 40]

    for col_idx, (hdr, w) in enumerate(zip(headers, col_widths), start=1):
        cell = ws.cell(row=4, column=col_idx, value=hdr)
        cell.font = Font(bold=True, size=9, color=HEADER_FG, name="Calibri")
        cell.fill = PatternFill("solid", fgColor=ACCENT)
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = Border(
            left=Side(style="thin", color="FFFFFF"),
            right=Side(style="thin", color="FFFFFF"),
            top=Side(style="thin", color="FFFFFF"),
            bottom=Side(style="thin", color="FFFFFF"),
        )
        col_letter = ws.cell(row=4, column=col_idx).column_letter
        ws.column_dimensions[col_letter].width = w
    ws.row_dimensions[4].height = 24

    # ── Filas de datos
    thin_border = Border(
        left=Side(style="thin", color=BORDE_COLOR),
        right=Side(style="thin", color=BORDE_COLOR),
        top=Side(style="thin", color=BORDE_COLOR),
        bottom=Side(style="thin", color=BORDE_COLOR),
    )

    for row_idx, e in enumerate(executions, start=5):
        bg = ROW_ODD if row_idx % 2 == 0 else ROW_EVEN
        result = e.get("result", "")
        exec_secs = e.get("execution_time_seconds")
        time_fmt = _fmt_seconds(exec_secs)
        executed_at_raw = e.get("executed_at", "")
        executed_at = executed_at_raw
        if executed_at_raw and "T" in str(executed_at_raw):
            try:
                dt = datetime.fromisoformat(str(executed_at_raw).replace("Z", ""))
                executed_at = dt.strftime("%d/%m/%Y %H:%M")
            except Exception:
                pass

        row_data = [
            executed_at,
            e.get("case_id", ""),
            e.get("title", ""),
            e.get("test_type", ""),
            e.get("module", ""),
            result,
            e.get("severity", "") if result == "NO CUMPLE" else "",
            e.get("incident_type", "") if result == "NO CUMPLE" else "",
            e.get("incident_state", "") if result == "NO CUMPLE" else "",
            time_fmt,
            round(float(exec_secs), 1) if exec_secs is not None else "",
            e.get("notes", "") or "",
        ]

        centered_cols = {1, 2, 6, 7, 8, 9, 10, 11}

        for col_idx, val in enumerate(row_data, start=1):
            cell = ws.cell(row=row_idx, column=col_idx, value=val)
            cell.font = Font(size=9, name="Calibri")
            cell.fill = PatternFill("solid", fgColor=bg)
            cell.border = thin_border
            cell.alignment = Alignment(
                horizontal="center" if col_idx in centered_cols else "left",
                vertical="center",
                wrap_text=True,
            )

            # Color del resultado
            if col_idx == 6:
                if result == "CUMPLE":
                    cell.fill = PatternFill("solid", fgColor=VERDE_CUMPLE)
                    cell.font = Font(size=9, bold=True, color="155724", name="Calibri")
                elif result == "NO CUMPLE":
                    cell.fill = PatternFill("solid", fgColor=ROJO_NOCUMPLE)
                    cell.font = Font(size=9, bold=True, color="721C24", name="Calibri")

        ws.row_dimensions[row_idx].height = 20

    # ── Fila de resumen
    total_rows = len(executions)
    if total_rows > 0:
        summary_row = 5 + total_rows + 1
        ws.merge_cells(f"A{summary_row}:L{summary_row}")
        summary_cell = ws[f"A{summary_row}"]
        cumple = sum(1 for e in executions if e.get("result") == "CUMPLE")
        no_cumple = sum(1 for e in executions if e.get("result") == "NO CUMPLE")
        times = [e.get("execution_time_seconds") for e in executions if e.get("execution_time_seconds") is not None]
        avg_str = _fmt_seconds(sum(times) / len(times)) if times else "—"
        total_str = _fmt_seconds(sum(times)) if times else "—"

        summary_cell.value = (
            f"Total: {total_rows} ejecuciones  |  Cumple: {cumple}  |  No Cumple: {no_cumple}  |  "
            f"Promedio: {avg_str}  |  Total acumulado: {total_str}"
        )
        summary_cell.font = Font(bold=True, size=9, color="1E293B", name="Calibri")
        summary_cell.fill = PatternFill("solid", fgColor="E2E8F0")
        summary_cell.alignment = Alignment(horizontal="left", vertical="center")
        ws.row_dimensions[summary_row].height = 22

    # Congelar la fila de encabezados para facilitar la navegacion
    ws.freeze_panes = "A5"

    wb.save(output_path)
