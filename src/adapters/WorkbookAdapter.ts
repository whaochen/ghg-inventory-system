import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import type { InventoryReportPackage } from '../core/reporting/types.js';
import type { ActivityUnit } from '../core/unitConverter.js';

export interface SheetMatrix {
  name: string;
  rows: Array<Array<string | number | boolean>>;
}

export interface ImportedActivityRow {
  site_id: string;
  source_id: string;
  activity_id: string;
  activity_qty: number;
  activity_unit: ActivityUnit;
  alloc_ratio: number;
  data_source_desc: string;
  evidence_filename: string;
}

function escapeXml(val: string): string {
  return val
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescapeXml(val: string): string {
  return val
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

/**
 * 將 InventoryReportPackage 轉換為環境部官方表單結構化工作表矩陣
 */
export function buildReportSheets(pkg: InventoryReportPackage): SheetMatrix[] {
  const sheets: SheetMatrix[] = [];

  if (pkg.manufacturing_tables) {
    const m = pkg.manufacturing_tables;
    sheets.push({
      name: '表一_基本資料',
      rows: [
        ['邊界版本ID', '盤查年度(民國)', '制度別', '邊界設定方法', '統一編號', '管制編號', '行業代碼', '已鎖定'],
        [
          m.table1_basic_info.boundary_version_id,
          m.table1_basic_info.inventory_year_roc,
          m.table1_basic_info.regime_mode,
          m.table1_basic_info.boundary_method,
          m.table1_basic_info.tax_id,
          m.table1_basic_info.control_no ?? '',
          m.table1_basic_info.industry_code,
          m.table1_basic_info.locked,
        ],
      ],
    });
    sheets.push({
      name: '表二_邊界與排除',
      rows: [
        ['據點代碼', '據點名稱', '納入狀態', '郵遞區號', '地址'],
        ...m.table2_boundary_and_exclusions.sites.map((s) => [
          s.site_id,
          s.site_name,
          s.inclusion_status,
          s.zip3,
          s.address,
        ]),
        [],
        ['排除對象', '排除依據', '佐證索引', '引用ID'],
        ...m.table2_boundary_and_exclusions.exclusions.map((e) => [
          e.excluded_entity_name,
          e.statutory_basis,
          e.evidence_ref,
          e.citation_id,
        ]),
      ],
    });
    sheets.push({
      name: '表三_排放源清冊',
      rows: [
        ['排放源ID', '據點代碼', '業主白話標籤', '製程代碼', '設備代碼', '原燃物料代碼', '範疇', '排放型式', '是否生質'],
        ...m.table3_emission_sources.map((s) => [
          s.source_id,
          s.site_id,
          s.owner_label,
          s.process_code,
          s.equipment_code,
          s.material_code,
          s.scope,
          s.emission_type,
          s.is_biomass,
        ]),
      ],
    });
    sheets.push({
      name: '表四_活動數據',
      rows: [
        ['活動ID', '排放源ID', '本年度使用', '活動數據', '單位', '分配比例', '數據來源說明', '數據等級', '佐證檔名'],
        ...m.table4_activity_records.map((a) => [
          a.activity_id,
          a.source_id,
          a.in_use_this_year,
          a.activity_qty,
          a.activity_unit,
          a.alloc_ratio,
          a.data_source_desc,
          a.data_source_tier,
          a.evidence_files.map((f) => f.filename).join('; '),
        ]),
      ],
    });
    sheets.push({
      name: '表五_排放量明細',
      rows: [
        ['排放源ID', '原燃物料代碼', '氣體', '原始公噸數(4位)', '是否生質CO2', 'AR5_CO2e', 'AR6_2021_CO2e', 'AR6_Errata_CO2e'],
        ...m.table5_calculation_details.flatMap((item) =>
          item.calculation.gas_details.map((g) => [
            item.source.source_id,
            item.source.material_code,
            g.gas_code,
            g.raw_gas_tonnes,
            g.is_biogenic_co2,
            g.projections.MOENV_AR5.co2e_tonnes,
            g.projections.IPCC_AR6_2021.co2e_tonnes,
            g.projections.IPCC_AR6_ERRATA_2025.co2e_tonnes,
          ])
        ),
      ],
    });
    sheets.push({
      name: '表六_數據品質',
      rows: [
        ['排放源ID', '活動誤差等級', '校正等級', '係數等級', '綜合評分', '品質等級'],
        ...m.table6_data_quality.map((dq) => [
          dq.source_id,
          dq.activity_error_grade,
          dq.calibration_grade,
          dq.factor_grade,
          dq.composite_score,
          dq.quality_level,
        ]),
      ],
    });
    sheets.push({
      name: '表七_不確定性',
      rows: m.table7_uncertainty
        ? [
            ['總排放量(tCO2e)', '95%下限(%)', '95%上限(%)', '下限排放量', '上限排放量', '納入項目數'],
            [
              m.table7_uncertainty.total_co2e_tonnes,
              m.table7_uncertainty.combined_lower_pct,
              m.table7_uncertainty.combined_upper_pct,
              m.table7_uncertainty.lower_bound_tonnes,
              m.table7_uncertainty.upper_bound_tonnes,
              m.table7_uncertainty.item_count,
            ],
          ]
        : [['尚未執行不確定性評估']],
    });
    sheets.push({
      name: '表八_三軌彙總(3位)',
      rows: [
        ['GWP軌跡', '總排放當量(tCO2e)', '範疇一', '範疇二', '生質CO2(獨立列示)'],
        ...Object.values(m.table8_summary_by_track).map((t) => [
          t.gwp_profile,
          t.total_co2e_tonnes,
          t.scope_1_co2e_tonnes,
          t.scope_2_co2e_tonnes,
          pkg.biogenic_co2_tonnes,
        ]),
      ],
    });
    sheets.push({
      name: '表十_GWP對照',
      rows: [
        ['氣體', '原始公噸數', 'MOENV_AR5', 'IPCC_AR6_2021', 'IPCC_AR6_ERRATA_2025'],
        ...m.table10_gwp_comparison.map((row) => [
          row.gas_code,
          row.raw_gas_tonnes,
          row.MOENV_AR5,
          row.IPCC_AR6_2021,
          row.IPCC_AR6_ERRATA_2025,
        ]),
      ],
    });
    sheets.push({
      name: '表十一_自廠檢測',
      rows: [
        ['檢測ID', '排放源ID', '參數類型', '實驗室名稱', '認證資格', '檢測方法', '檢測起日', '檢測迄日', '實測值', '單位'],
        ...m.table11_lab_tests.map((t) => [
          t.lab_test_id,
          t.source_id,
          t.parameter_type,
          t.lab_name,
          t.accreditation,
          t.test_method,
          t.test_start_date,
          t.test_end_date,
          t.measured_value,
          t.unit,
        ]),
      ],
    });
  } else if (pkg.service_v3_tables) {
    const s = pkg.service_v3_tables;
    sheets.push({
      name: '表1_基本資料',
      rows: [
        ['邊界版本ID', '盤查年度(民國)', '制度別', '統一編號', '行業代碼', '納管行業代碼', '納管條件代碼', '已鎖定'],
        [
          s.table1_basic_info.boundary_version_id,
          s.table1_basic_info.inventory_year_roc,
          s.table1_basic_info.regime_mode,
          s.table1_basic_info.tax_id,
          s.table1_basic_info.industry_code,
          s.table1_basic_info.regulated_industry_code ?? '',
          s.table1_basic_info.regulated_condition_code ?? '',
          s.table1_basic_info.locked,
        ],
      ],
    });
    sheets.push({
      name: '表2_分據點清冊',
      rows: [
        ['據點代碼', '據點名稱', '型態', '郵遞區號', '地址', '納入狀態'],
        ...s.table2_sites.map((site) => [
          site.site_id,
          site.site_name,
          site.site_type,
          site.zip3,
          site.address,
          site.inclusion_status,
        ]),
      ],
    });
    sheets.push({
      name: '表3_電號分攤',
      rows: [
        ['電號ID', '據點代碼', '有電表', '電號', '是否共用', '分攤比例', '起始日', '結束日'],
        ...s.table3_utility_accounts.map((u) => [
          u.utility_id,
          u.site_id,
          u.meter_available,
          u.meter_no ?? '',
          u.is_shared,
          u.share_ratio,
          u.period_start,
          u.period_end,
        ]),
      ],
    });
    sheets.push({
      name: '表4_活動數據清冊',
      rows: [
        ['據點代碼', '排放源ID', '活動ID', '業主白話標籤', '活動數據', '單位', '分配比例', '佐證檔名'],
        ...s.table4_sources_and_activities.map((item) => [
          item.source.site_id,
          item.source.source_id,
          item.activity.activity_id,
          item.source.owner_label,
          item.activity.activity_qty,
          item.activity.activity_unit,
          item.activity.alloc_ratio,
          item.activity.evidence_files.map((f) => f.filename).join('; '),
        ]),
      ],
    });
    sheets.push({
      name: '表5_計算明細',
      rows: [
        ['排放源ID', '原燃物料代碼', '氣體', '原始公噸數(4位)', 'AR5_CO2e', 'AR6_2021_CO2e', 'AR6_Errata_CO2e'],
        ...s.table5_calculation_details.flatMap((item) =>
          item.calculation.gas_details.map((g) => [
            item.source.source_id,
            item.source.material_code,
            g.gas_code,
            g.raw_gas_tonnes,
            g.projections.MOENV_AR5.co2e_tonnes,
            g.projections.IPCC_AR6_2021.co2e_tonnes,
            g.projections.IPCC_AR6_ERRATA_2025.co2e_tonnes,
          ])
        ),
      ],
    });
    sheets.push({
      name: '表6_三軌總量彙總',
      rows: [
        ['GWP軌跡', '總排放當量(tCO2e)', '範疇一', '範疇二', '生質CO2(獨立列示)'],
        ...Object.values(s.table6_summary_by_track).map((t) => [
          t.gwp_profile,
          t.total_co2e_tonnes,
          t.scope_1_co2e_tonnes,
          t.scope_2_co2e_tonnes,
          pkg.biogenic_co2_tonnes,
        ]),
      ],
    });
    sheets.push({
      name: '表7_自廠檢測',
      rows: [
        ['檢測ID', '排放源ID', '實驗室名稱', '認證資格', '檢測方法', '起日', '迄日'],
        ...s.table7_lab_tests.map((t) => [
          t.lab_test_id,
          t.source_id,
          t.lab_name,
          t.accreditation,
          t.test_method,
          t.test_start_date,
          t.test_end_date,
        ]),
      ],
    });
  }

  sheets.push({
    name: '權威引用來源_Citations',
    rows: [
      ['citation_id', '類別', '發行機關', '文件名稱', '文號/章節', '版次/日期', '官方網址'],
      ...pkg.source_citations.map((c) => [
        c.citation_id,
        c.category,
        c.issuer,
        c.document_title,
        c.doc_no_or_section,
        c.version_or_date,
        c.url,
      ]),
    ],
  });

  return sheets;
}

/**
 * 匯出標準 .xlsx Buffer
 */
export async function exportReportToXlsxBuffer(pkg: InventoryReportPackage): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'AI GHG Inventory System';
  workbook.created = new Date();

  const sheets = buildReportSheets(pkg);
  for (const sheet of sheets) {
    const ws = workbook.addWorksheet(sheet.name.slice(0, 31));
    for (let rIdx = 0; rIdx < sheet.rows.length; rIdx++) {
      const rowValues = sheet.rows[rIdx]!;
      const row = ws.addRow(rowValues);
      if (rIdx === 0) {
        row.font = { bold: true };
      }
    }
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * 匯出標準 OpenDocument Spreadsheet (.ods) Buffer
 */
export async function exportReportToOdsBuffer(pkg: InventoryReportPackage): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/vnd.oasis.opendocument.spreadsheet', {
    compression: 'STORE',
  });

  const manifestXml = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
  <manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`;
  zip.file('META-INF/manifest.xml', manifestXml);

  const sheets = buildReportSheets(pkg);
  const tablesXml = sheets
    .map((sheet) => {
      const rowsXml = sheet.rows
        .map((row) => {
          const cellsXml = row
            .map((cell) => {
              if (typeof cell === 'number') {
                return `<table:table-cell office:value-type="float" office:value="${cell}"><text:p>${cell}</text:p></table:table-cell>`;
              }
              if (typeof cell === 'boolean') {
                return `<table:table-cell office:value-type="boolean" office:boolean-value="${cell}"><text:p>${cell}</text:p></table:table-cell>`;
              }
              const s = escapeXml(String(cell));
              return `<table:table-cell office:value-type="string"><text:p>${s}</text:p></table:table-cell>`;
            })
            .join('');
          return `<table:table-row>${cellsXml}</table:table-row>`;
        })
        .join('');
      return `<table:table table:name="${escapeXml(sheet.name)}">${rowsXml}</table:table>`;
    })
    .join('');

  const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  office:version="1.2">
  <office:body>
    <office:spreadsheet>${tablesXml}</office:spreadsheet>
  </office:body>
</office:document-content>`;
  zip.file('content.xml', contentXml);

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/**
 * 從 .xlsx Buffer 匯入活動數據列（僅讀取活動數據與佐證，嚴禁覆寫係數）
 */
export async function importActivitiesFromXlsxBuffer(
  buffer: Buffer
): Promise<ImportedActivityRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<ExcelJS.Workbook['xlsx']['load']>[0]);

  const ws =
    workbook.getWorksheet('活動數據匯入') ??
    workbook.getWorksheet('表4_活動數據清冊') ??
    workbook.worksheets[0];
  if (!ws) {
    throw new Error('XLSX 檔案中找不到可匯入的工作表');
  }

  const rows: ImportedActivityRow[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // 跳過表頭
    const vals = row.values as Array<string | number | undefined>;
    // ExcelJS row.values 為 1-indexed
    const siteId = String(vals[1] ?? '').trim();
    const sourceId = String(vals[2] ?? '').trim();
    const activityId = String(vals[3] ?? '').trim();
    const qty = Number(vals[5] ?? 0);
    const unit = String(vals[6] ?? '').trim() as ActivityUnit;
    const alloc = Number(vals[7] ?? 1);
    const evidence = String(vals[8] ?? '').trim();
    if (siteId && sourceId && activityId) {
      rows.push({
        site_id: siteId,
        source_id: sourceId,
        activity_id: activityId,
        activity_qty: qty,
        activity_unit: unit,
        alloc_ratio: alloc,
        data_source_desc: 'XLSX 匯入',
        evidence_filename: evidence,
      });
    }
  });
  return rows;
}

/**
 * 從 .ods Buffer 匯入活動數據列（僅讀取活動數據與佐證）
 */
export async function importActivitiesFromOdsBuffer(
  buffer: Buffer
): Promise<ImportedActivityRow[]> {
  const zip = await JSZip.loadAsync(buffer);
  const contentFile = zip.file('content.xml');
  if (!contentFile) {
    throw new Error('ODS 檔案格式無效：缺少 content.xml');
  }
  const xml = await contentFile.async('string');

  const tableMatches = Array.from(
    xml.matchAll(/<table:table\b[^>]*table:name="([^"]*)"[^>]*>([\s\S]*?)<\/table:table>/g)
  );
  const targetTable =
    tableMatches.find((m) => m[1] === '表4_活動數據清冊' || m[1] === '活動數據匯入') ??
    tableMatches[0];
  if (!targetTable) {
    throw new Error('ODS 檔案中找不到可匯入的工作表');
  }

  const rowMatches = Array.from(
    targetTable[2]!.matchAll(/<table:table-row\b[^>]*>([\s\S]*?)<\/table:table-row>/g)
  );
  const imported: ImportedActivityRow[] = [];

  for (let i = 1; i < rowMatches.length; i++) {
    const rowXml = rowMatches[i]![1]!;
    const cellMatches = Array.from(
      rowXml.matchAll(/<table:table-cell\b[^>]*>([\s\S]*?)<\/table:table-cell>/g)
    );
    const cells = cellMatches.map((cm) => {
      const textMatch = cm[1]!.match(/<text:p[^>]*>([\s\S]*?)<\/text:p>/);
      return textMatch ? unescapeXml(textMatch[1]!.trim()) : '';
    });
    if (cells.length >= 7 && cells[0] && cells[1] && cells[2]) {
      imported.push({
        site_id: cells[0]!,
        source_id: cells[1]!,
        activity_id: cells[2]!,
        activity_qty: Number(cells[4] ?? 0),
        activity_unit: (cells[5] ?? '') as ActivityUnit,
        alloc_ratio: Number(cells[6] ?? 1),
        data_source_desc: 'ODS 匯入',
        evidence_filename: cells[7] ?? '',
      });
    }
  }

  return imported;
}
