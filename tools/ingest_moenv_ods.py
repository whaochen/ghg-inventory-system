#!/usr/bin/env python3
"""
確定性官方 ODS 解析腳本 (Phase 0.3)
將環境部官方 ODS 檔案解析為版本化 JSON，並強制每筆條目綁定合法 citation_id。
"""

import json
import os
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REFS_DIR = ROOT / "refs" / "moenv"
OUT_DIR = ROOT / "src" / "registry" / "data"

NS = {
    "table": "urn:oasis:names:tc:opendocument:xmlns:table:1.0",
    "text": "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
    "office": "urn:oasis:names:tc:opendocument:xmlns:office:1.0",
}

ATTR_NAME = "{urn:oasis:names:tc:opendocument:xmlns:table:1.0}name"
ATTR_COL_REP = "{urn:oasis:names:tc:opendocument:xmlns:table:1.0}number-columns-repeated"
ATTR_ROW_REP = "{urn:oasis:names:tc:opendocument:xmlns:table:1.0}number-rows-repeated"
ATTR_VALUE = "{urn:oasis:names:tc:opendocument:xmlns:office:1.0}value"
ATTR_VALUE_TYPE = "{urn:oasis:names:tc:opendocument:xmlns:office:1.0}value-type"


def cell_text(cell: ET.Element) -> str:
    parts: list[str] = []
    for p in cell.findall(".//text:p", NS):
        parts.append("".join(p.itertext()))
    txt = "\n".join(parts).strip()
    if not txt and ATTR_VALUE in cell.attrib:
        txt = cell.attrib[ATTR_VALUE].strip()
    return txt


def read_ods_sheets(ods_path: Path) -> dict[str, list[list[str]]]:
    sheets: dict[str, list[list[str]]] = {}
    with zipfile.ZipFile(ods_path, "r") as z:
        root = ET.fromstring(z.read("content.xml"))
        for tbl in root.findall(".//table:table", NS):
            name = tbl.attrib.get(ATTR_NAME, "")
            rows_data: list[list[str]] = []
            for row in tbl.findall("table:table-row", NS):
                row_rep = int(row.attrib.get(ATTR_ROW_REP, "1"))
                if row_rep > 100:
                    # 跳過大量空白列
                    continue
                vals: list[str] = []
                for cell in row.findall("table:table-cell", NS):
                    col_rep = int(cell.attrib.get(ATTR_COL_REP, "1"))
                    txt = cell_text(cell)
                    if col_rep > 100 and txt == "":
                        continue
                    for _ in range(min(col_rep, 100)):
                        vals.append(txt)
                # 去除尾端空白
                while vals and vals[-1] == "":
                    vals.pop()
                for _ in range(row_rep):
                    rows_data.append(list(vals))
            sheets[name] = rows_data
    return sheets


def parse_number(s: str) -> float | None:
    if not s:
        return None
    cleaned = s.replace(",", "").replace(" ", "").strip()
    if cleaned in ("", "NULL", "-", "—", "N/A"):
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def safe_col(row: list[str], idx: int) -> str:
    return row[idx].strip() if idx < len(row) else ""


def parse_codebook_v2() -> dict:
    ods_path = REFS_DIR / "溫室氣體盤查作業相關代碼檔V2.ods"
    if not ods_path.exists():
        raise FileNotFoundError(f"缺少必要官方檔案: {ods_path}")

    sheets = read_ods_sheets(ods_path)
    rows = sheets["代碼表"]
    cit = "CIT-CODE-V2"

    # 11 張附表在「代碼表」中的欄位配置
    t1_regulated_industries = []  # cols 1..4
    t2_verification_bodies = []   # cols 7..8
    t3_competent_authorities = [] # cols 11..12
    t4_industry_codes = []        # cols 15..16
    t5_zip3_codes = []            # cols 19..21
    t6_process_codes = []         # cols 24..26
    t7_equipment_codes = []       # cols 29..31
    t8_material_codes = []        # cols 34..36
    t9_test_methods = []          # col 39
    t10_gwp_values = []           # cols 42..45
    t11_station_purposes = []     # cols 48..49

    for r in rows[1:]:
        # 附表一
        c1, c2, c3, c4 = safe_col(r, 1), safe_col(r, 2), safe_col(r, 3), safe_col(r, 4)
        if c1 or c3:
            t1_regulated_industries.append({
                "regulated_industry_code": c1,
                "regulated_industry_name": c2,
                "regulated_condition_code": c3,
                "regulated_condition": c4,
                "citation_id": cit,
            })

        # 附表二
        c7, c8 = safe_col(r, 7), safe_col(r, 8)
        if c7:
            t2_verification_bodies.append({
                "code": c7,
                "name": c8,
                "citation_id": cit,
            })

        # 附表三
        c11, c12 = safe_col(r, 11), safe_col(r, 12)
        if c11:
            t3_competent_authorities.append({
                "code": c11,
                "name": c12,
                "citation_id": cit,
            })

        # 附表四
        c15, c16 = safe_col(r, 15), safe_col(r, 16)
        if c15:
            t4_industry_codes.append({
                "code": c15,
                "name": c16,
                "citation_id": cit,
            })

        # 附表五
        c19, c20, c21 = safe_col(r, 19), safe_col(r, 20), safe_col(r, 21)
        if c21:
            t5_zip3_codes.append({
                "city": c19,
                "district": c20,
                "zip3": c21,
                "citation_id": cit,
            })

        # 附表六
        c24, c25, c26 = safe_col(r, 24), safe_col(r, 25), safe_col(r, 26)
        if c25:
            t6_process_codes.append({
                "seq": c24,
                "code": c25,
                "name": c26,
                "citation_id": cit,
            })

        # 附表七
        c29, c30, c31 = safe_col(r, 29), safe_col(r, 30), safe_col(r, 31)
        if c30:
            t7_equipment_codes.append({
                "seq": c29,
                "code": c30,
                "name": c31,
                "citation_id": cit,
            })

        # 附表八
        c34, c35, c36 = safe_col(r, 34), safe_col(r, 35), safe_col(r, 36)
        if c35:
            t8_material_codes.append({
                "seq": c34,
                "code": c35,
                "name": c36,
                "citation_id": cit,
            })

        # 附表九
        c39 = safe_col(r, 39)
        if c39:
            t9_test_methods.append({
                "method": c39,
                "citation_id": cit,
            })

        # 附表十
        c42, c43, c44, c45 = safe_col(r, 42), safe_col(r, 43), safe_col(r, 44), safe_col(r, 45)
        if c42 or c43:
            t10_gwp_values.append({
                "code": c42,
                "name": c43,
                "gwp_ar5": parse_number(c44),
                "note": c45,
                "citation_id": cit,
            })

        # 附表十一
        c48, c49 = safe_col(r, 48), safe_col(r, 49)
        if c48 or c49:
            t11_station_purposes.append({
                "code": c48,
                "name": c49,
                "citation_id": cit,
            })

    return {
        "metadata": {
            "source_file": ods_path.name,
            "citation_id": cit,
            "counts": {
                "table1_regulated_industries": len(t1_regulated_industries),
                "table2_verification_bodies": len(t2_verification_bodies),
                "table3_competent_authorities": len(t3_competent_authorities),
                "table4_industry_codes": len(t4_industry_codes),
                "table5_zip3_codes": len(t5_zip3_codes),
                "table6_process_codes": len(t6_process_codes),
                "table7_equipment_codes": len(t7_equipment_codes),
                "table8_material_codes": len(t8_material_codes),
                "table9_test_methods": len(t9_test_methods),
                "table10_gwp_values": len(t10_gwp_values),
                "table11_station_purposes": len(t11_station_purposes),
            },
        },
        "table1_regulated_industries": t1_regulated_industries,
        "table2_verification_bodies": t2_verification_bodies,
        "table3_competent_authorities": t3_competent_authorities,
        "table4_industry_codes": t4_industry_codes,
        "table5_zip3_codes": t5_zip3_codes,
        "table6_process_codes": t6_process_codes,
        "table7_equipment_codes": t7_equipment_codes,
        "table8_material_codes": t8_material_codes,
        "table9_test_methods": t9_test_methods,
        "table10_gwp_values": t10_gwp_values,
        "table11_station_purposes": t11_station_purposes,
    }


def parse_113_ef() -> dict:
    ods_path = REFS_DIR / "113年2月5日公告溫室氣體排放係數.ods"
    if not ods_path.exists():
        raise FileNotFoundError(f"缺少必要官方檔案: {ods_path}")

    sheets = read_ods_sheets(ods_path)
    cit = "CIT-EF-MOENV-113"

    # 1. 附表一_固定燃燒排放源排放係數
    stationary_fuels = []
    for r in sheets["附表一_固定燃燒排放源排放係數"][8:]:
        if not r or safe_col(r, 0).startswith("註"):
            if safe_col(r, 0).startswith("註"):
                break
            continue
        # 處理合併儲存格造成欄位偏移：正常列 col 0=中文, col 1=英文, col 2=CO2, col 3=CH4, col 4=N2O
        # 若 col 0='汽油' 且 col 1='車用汽油'，則 col 2='Gasoline', col 3='Motor Gasoline', col 4=CO2...
        if len(r) >= 7 and parse_number(r[2]) is None and parse_number(r[4]) is not None:
            fuel_zh = f"{r[0]}（{r[1]}）"
            fuel_en = f"{r[2]} ({r[3]})"
            co2_tj = parse_number(r[4])
            ch4_tj = parse_number(r[5])
            n2o_tj = parse_number(r[6])
        else:
            fuel_zh = safe_col(r, 0)
            fuel_en = safe_col(r, 1)
            co2_tj = parse_number(safe_col(r, 2))
            ch4_tj = parse_number(safe_col(r, 3))
            n2o_tj = parse_number(safe_col(r, 4))

        if fuel_zh and co2_tj is not None:
            stationary_fuels.append({
                "fuel_name": fuel_zh,
                "fuel_name_en": fuel_en,
                "co2_kg_per_tj": co2_tj,
                "ch4_kg_per_tj": ch4_tj,
                "n2o_kg_per_tj": n2o_tj,
                "unit": "kg/TJ",
                "citation_id": cit,
            })

    # 2. 附表一_移動燃燒排放源排放係數
    mobile_fuels = []
    for r in sheets["附表一_移動燃燒排放源排放係數"][8:]:
        if not r or safe_col(r, 0).startswith("註"):
            if safe_col(r, 0).startswith("註"):
                break
            continue
        fuel_zh = safe_col(r, 0)
        fuel_en = safe_col(r, 1)
        co2_tj = parse_number(safe_col(r, 2))
        if fuel_zh and co2_tj is not None:
            mobile_fuels.append({
                "fuel_name": fuel_zh,
                "fuel_name_en": fuel_en,
                "co2_kg_per_tj": co2_tj,
                "ch4_kg_per_tj": None,  # 113 公告僅含 CO2，車型 CH4/N2O 待驗證
                "n2o_kg_per_tj": None,
                "unit": "kg/TJ",
                "citation_id": cit,
                "unverified_note": "113年公告附表一移動燃燒僅列 CO2 係數，CH4/N2O 車型細項係數待驗證",
            })

    # 3. 附表三：生活廢水/化糞池 + 冷凍空調逸散率
    wastewater_mcf = []
    refrigeration_leak_rates = []
    t3_rows = sheets["附表三"]
    in_mcf = False
    in_refrig = False
    for r in t3_rows:
        joined = "".join(r)
        if "表2、甲烷修正係數" in joined:
            in_mcf = True
            in_refrig = False
            continue
        if "三、冷凍及空調" in joined:
            in_mcf = False
            in_refrig = True
            continue
        if "四、事業廢棄物掩埋" in joined:
            in_refrig = False
            break

        if in_mcf:
            sys_name = safe_col(r, 1)
            mcf_val = parse_number(safe_col(r, 2))
            mcf_range = safe_col(r, 3)
            if sys_name and mcf_val is not None:
                wastewater_mcf.append({
                    "treatment_system": sys_name,
                    "mcf": mcf_val,
                    "range": mcf_range,
                    "citation_id": cit,
                })

        if in_refrig:
            equip = safe_col(r, 1)
            install_rate = safe_col(r, 2)
            op_rate = safe_col(r, 3)
            if equip and ("-" in op_rate or parse_number(op_rate) is not None):
                refrigeration_leak_rates.append({
                    "equipment_type": equip,
                    "assembly_leak_rate_pct": install_rate,
                    "operating_leak_rate_pct_per_year": op_rate,
                    "citation_id": cit,
                })

    # 4. 附表四：GWP
    gwp_ar5 = []
    for r in sheets["附表四"][2:]:
        name = safe_col(r, 0)
        formula = safe_col(r, 1)
        val = parse_number(safe_col(r, 2))
        if name and val is not None:
            gwp_ar5.append({
                "name": name,
                "formula": formula,
                "gwp_ar5": val,
                "citation_id": cit,
            })

    # 5. 服務業 V3 參考表中的 95% 信賴區間係數表
    svc3_path = REFS_DIR / "溫室氣體排放量清冊表單(範例)_服務業V3.ods"
    svc3_sheets = read_ods_sheets(svc3_path)
    ef_with_ci = []
    for r in svc3_sheets.get("溫室氣體排放係數(參考)", [])[1:]:
        if len(r) < 10:
            continue
        mat_code = safe_col(r, 3)
        gas = safe_col(r, 2)
        ef_val = parse_number(safe_col(r, 9))
        if mat_code and gas and ef_val is not None:
            ef_with_ci.append({
                "scope_type": safe_col(r, 0),
                "emission_type": safe_col(r, 1),
                "gas": gas,
                "material_code": mat_code,
                "material_name": safe_col(r, 5),
                "fuel_name": safe_col(r, 7),
                "ef_value": ef_val,
                "unit": safe_col(r, 10),
                "ci_95_lower_pct": parse_number(safe_col(r, 11)),
                "ci_95_upper_pct": parse_number(safe_col(r, 12)),
                "citation_id": "CIT-TPL-SVC3",
            })

    return {
        "metadata": {
            "source_file": ods_path.name,
            "citation_id": cit,
            "counts": {
                "stationary_fuels": len(stationary_fuels),
                "mobile_fuels": len(mobile_fuels),
                "wastewater_mcf": len(wastewater_mcf),
                "refrigeration_leak_rates": len(refrigeration_leak_rates),
                "gwp_ar5": len(gwp_ar5),
                "ef_with_ci_svc3": len(ef_with_ci),
            },
        },
        "stationary_fuels": stationary_fuels,
        "mobile_fuels": mobile_fuels,
        "wastewater_mcf": wastewater_mcf,
        "refrigeration_leak_rates": refrigeration_leak_rates,
        "gwp_ar5": gwp_ar5,
        "ef_with_ci_svc3": ef_with_ci,
    }


def parse_svc3_reference_tables() -> dict:
    ods_path = REFS_DIR / "溫室氣體排放量清冊表單(範例)_服務業V3.ods"
    if not ods_path.exists():
        raise FileNotFoundError(f"缺少必要官方檔案: {ods_path}")

    sheets = read_ods_sheets(ods_path)
    cit = "CIT-TPL-SVC3"

    unit_conversions = []
    for r in sheets.get("單位轉換係數表(參考)", [])[1:]:
        act_unit = safe_col(r, 0)
        ncv_unit = safe_col(r, 1)
        heat_conv = safe_col(r, 2)
        ef_unit = safe_col(r, 3)
        combo_key = safe_col(r, 4)
        factor = parse_number(safe_col(r, 5))
        if act_unit and ef_unit and factor is not None:
            unit_conversions.append({
                "activity_unit": act_unit,
                "ncv_unit": ncv_unit,
                "heat_conversion_unit": heat_conv,
                "ef_unit": ef_unit,
                "combo_key": combo_key,
                "unit_factor": factor,
                "citation_id": cit,
            })

    fossil_fuels = []
    for r in sheets.get("化石燃料表(參考)", [])[1:]:
        mat_code = safe_col(r, 0)
        mat_name = safe_col(r, 1)
        em_type = safe_col(r, 2)
        gwp = parse_number(safe_col(r, 4))
        if mat_code and em_type and gwp is not None:
            fossil_fuels.append({
                "material_code": mat_code,
                "material_name": mat_name,
                "emission_type": em_type,
                "ch4_gwp_ar5": gwp,
                "citation_id": cit,
            })

    return {
        "metadata": {
            "source_file": ods_path.name,
            "citation_id": cit,
            "counts": {
                "unit_conversions": len(unit_conversions),
                "fossil_fuels": len(fossil_fuels),
            },
        },
        "unit_conversions": unit_conversions,
        "fossil_fuels": fossil_fuels,
    }


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    codebook = parse_codebook_v2()
    ef_113 = parse_113_ef()
    svc3_refs = parse_svc3_reference_tables()

    (OUT_DIR / "codebook_v2.json").write_text(
        json.dumps(codebook, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT_DIR / "ef_moenv_113.json").write_text(
        json.dumps(ef_113, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT_DIR / "svc3_reference_tables.json").write_text(
        json.dumps(svc3_refs, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    summary = {
        "codebook_v2": codebook["metadata"]["counts"],
        "ef_moenv_113": ef_113["metadata"]["counts"],
        "svc3_reference_tables": svc3_refs["metadata"]["counts"],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
