# AI 溫室氣體盤查系統｜整體系統架構與邊源算報查資料契約規格書（v1.0）

**文件定位**：新系統單一真實來源（SSOT）架構與資料契約規格  
**搭配文件**：《AI_GHG_計算引擎第一波開發規格書_v1.md》  
**核心設計鐵律**：系統內**只有「活動數據」與「被盤查對象基本事實／佐證」來自被盤查對象**；其餘一切法規條文、代碼、係數、熱值、單位換算、GWP、公式、不確定性參數與查驗門檻，**100% 必須綁定可追溯的權威引用來源（`SourceCitation`）**，嚴禁任何無出處的寫死數值。

## 1. 整體分層架構（Core-Shell Separation）

系統採四層解耦架構，確保計算與法規核心不綁死特定資料庫或桌面／網頁外殼：

1. **權威參數與引用庫（Citation & Factor Registry）**
   以唯讀、版本化 JSON/SQLite 表存放環境部公告代碼、排放係數、熱值、GWP 與查驗規範；每一筆數值都必須指向至少一筆 `SourceCitation`。
2. **確定性領域核心（Deterministic Domain Core）**
   純函式模組，依序執行 **邊（Boundary）→ 源（Source）→ 算（Calculation）→ 報（Reporting）→ 查（Verification）** 的驗證、換算、分氣體計算與三軌 GWP 投影。
3. **不可變稽核與儲存層（SSOT & Audit Snapshot Store）**
   儲存被盤查對象輸入之基本事實、活動數據與佐證雜湊；每次鎖版或產出報告時，凍結當下使用的 `citation_id` 與計算參數快照，確保多年後仍可重現完全一致的數字。
4. **外殼與交換介面層（UI / Excel / ODS Adapter）**
   對業主呈現白話表單（僅填活動數據與基本事實）；對顧問呈現代碼對照、覆核與三軌 GWP 差異；支援匯出環境部「製造業完整版（表一～表十一）」與「服務業／擴大盤查版（表 1～表 7）」。

## 2. 資料來源分流與強制引用規格（Provenance-First Invariant）

### 2.1 資料來源責任邊界

| 資料類別 | 唯一合法來源 | 強制追溯要求 |
|---|---|---|
| **被盤查對象基本事實** | 被盤查對象提供 | 證書字號、地址、電號、營運期間、設備台帳（須附登記／帳單／銘牌等佐證索引） |
| **活動數據（Activity Data）** | 被盤查對象提供 | 數量、原始單位、期間、數據來源說明（帳單／磅秤／流量計）、保存單位與佐證檔名／雜湊 |
| **自廠檢測熱值／含碳量** | 第三方或認可實驗室檢測報告 | 強制對應《表十一／表 7》：`lab_name`、`CNS 17025 / ISO 17025`、`NIEA/CNS/ASTM` 方法編號與檢測起訖日 |
| **代碼、係數、熱值、GWP、公式、門檻** | **權威引用來源（`SourceCitation`）** | 必須綁定 `citation_id`（含發布機關、文號／章節、版次日期與官方 URL），無引用者禁止進入計算 |

### 2.2 標準引用結構（`SourceCitation`）

```json
{
  "citation_id": "CIT-EF-MOENV-1130205",
  "category": "emission_factor | codebook | gwp | heating_value | regulation | guideline",
  "issuer": "環境部氣候變遷署",
  "document_title": "溫室氣體排放係數",
  "doc_no_or_section": "環部授氣字第1139101231號 / 附表一～附表四",
  "version_or_date": "2024-02-05 (ODS 2026-02-24)",
  "url": "https://ghgregistry.moenv.gov.tw/upload/Tools/DI/113%E5%B9%B42%E6%9C%885%E6%97%A5%E5%85%AC%E5%91%8A%E6%BA%AB%E5%AE%A3%E6%B0%A3%E9%AB%94%E6%8E%92%E6%94%BE%E4%BF%82%E6%95%B8.ods"
}
```

## 3. 「邊 → 源 → 算 → 報 → 查」統一資料契約

### 3.1 邊（Boundary）— `BoundaryVersion` / `Site` / `UtilityAccount`

支援**單廠查驗模式**與**多據點擴大盤查模式（服務業 V3）**，關鍵欄位如下：

| 實體 | 欄位名稱 | 型別／約束 | 來源歸屬 |
|---|---|---|---|
| `BoundaryVersion` | `boundary_version_id`, `inventory_year_roc`, `regime_mode` | `string`, `int`, Enum (`mandatory_verify` \| `mandatory_register` \| `voluntary`) | 系統生成 + 被盤查對象適用身分 |
| `BoundaryVersion` | `boundary_method`, `tax_id`, `control_no`, `industry_code` | Enum (`statutory` \| `operational_control`), `string`, `附表四 4碼` | 法定規範（引用 `CIT-LAW-MGT`）+ 代碼檔 V2 `附表四` |
| `BoundaryVersion` | `regulated_industry_code`, `regulated_condition_code` | `RIC*` / `RIT*`（擴大列管適用） | 引用《代碼檔 V2》`附表一`（`CIT-CODE-V2`） |
| `Site` | `site_id`, `site_name`, `site_type`, `zip3`, `address` | `D00001` 跨年度穩定主鍵, `附表五 3碼` | 據點主鍵不可跨年異動；郵遞區號引 `附表五` |
| `Site` | `inclusion_status`, `operating_periods[]` | Enum (`included` \| `inactive_period` \| `excluded_statutory` \| `data_gap`) | **四態嚴格分離**；僅 `included` 進入計算；支援同據點多段營業起訖日 |
| `BoundaryExclusion` | `site_id`, `excluded_entity_name`, `address_desc`, `statutory_basis`, `evidence_ref` | 僅同址且具獨立登記及列管證明者可排除 | 依《盤查作業問答集》排除規範（`CIT-QA-MOENV`） |
| `UtilityAccount` | `utility_id`, `site_id`, `meter_available`, `meter_no`, `unavailable_reason`, `is_shared`, `share_ratio` | `decimal (0..1]`，同電號合計不得＞100% | 被盤查對象提供帳單／分攤依據；系統檢查重複計算 |

### 3.2 源（Source）— `EmissionSource` / `ActivityRecord`

嚴格切分「被盤查對象白話輸入」與「系統／顧問官方代碼」，並強制綁定 `site_id`：

| 實體 | 欄位名稱 | 型別／約束 | 來源歸屬與檢核 |
|---|---|---|---|
| `EmissionSource` | `source_id`, `site_id`, `process_no`, `equipment_no` | FK → `Site(included)`；前綴 `G`/`GS`/`GM`/`GV`/`GF`/`GP` | 編碼建議引用《113 年版指引》（`CIT-GUIDE-113`） |
| `EmissionSource` | `process_code`, `equipment_code`, `material_code` | `6碼`, `4碼`, `6碼英數`（如 `GG3500` 台電電力） | 100% 查表《代碼檔 V2》`附表六/七/八`（`CIT-CODE-V2`） |
| `EmissionSource` | `scope`, `emission_type`, `sub_category`, `is_biomass`, `is_chp` | Scope 1/2 × 固定/移動/製程/逸散/電力蒸汽 | 對應 ISO 14064-1 類別 1/2 與官方表三格式 |
| `EmissionSource` | `ch4_origin` | Enum (`non_fossil_combustion` \| `biogenic_or_wastewater` \| `fossil_fugitive_or_process`) | 決定 AR5 (`28 vs 30`) 與 AR6 (`27.0 vs 29.8`)／更正版 (`25.3 vs 28.1`) |
| `ActivityRecord` | `activity_id`, `source_id`, `in_use_this_year`, `activity_qty`, `activity_unit`, `alloc_ratio` | `boolean`, `decimal(4位)`, `單位枚舉`, `decimal(0..1]` | **唯一來自被盤查對象之量化數據** |
| `ActivityRecord` | `data_source_desc`, `data_source_tier`, `evidence_files[]` | Enum (`cems` \| `periodic_measure` \| `estimate`), 佐證清單 | 數據優序依《作業問答集》（`CIT-QA-MOENV`） |

### 3.3 算（Calculation）— `CalcExecution` / `GasEmissionResult` / `GwpProjection`

| 實體 | 欄位名稱 | 型別／約束 | 來源歸屬與不變式 |
|---|---|---|---|
| `CalcExecution` | `calc_id`, `activity_id`, `calc_method`, `formula_citation_id` | Enum (`emission_factor` \| `mass_balance` \| `direct_monitoring`) | 公式與方法依《管理辦法》第 4 條（`CIT-LAW-MGT`） |
| `CalcExecution` | `factor_citation_id`, `ncv_citation_id`, `unit_factor_citation_id`, `lab_test_id` | 全部強制引用 `SourceCitation`（自廠檢測改引 `LabTestRecord`） | 無有效 `citation_id` 禁止執行計算 |
| `GasEmissionResult` | `gas_code` (`附表八/十`), `raw_tonnes` | `decimal`（明細四捨五入至小數第 4 位） | **核心不變式：資料庫只存分氣體原始公噸數** |
| `GwpProjection` | `gwp_profile`, `gwp_value`, `gwp_citation_id`, `co2e_tonnes` | `MOENV_AR5` \| `IPCC_AR6_2021` \| `IPCC_AR6_ERRATA_2025` | 同一 `raw_tonnes` 自動產出三軌 CO₂e 與版本差異率 |

### 3.4 報（Reporting）— `InventoryReportPackage`

| 輸出標的 | 契約規範與引用依據 |
|---|---|
| **官方清冊匯出** | • **單廠查驗模式**：對齊《製造業清冊範例》（2026/06/01 版，`CIT-TPL-MFG`）`表一`～`表十一`<br>• **多據點擴大盤查模式**：對齊《服務業 V3 範例》（`CIT-TPL-SVC3`）`表 1`～`表 7` |
| **法定精度規則** | 彙總表總排放量以「公噸 CO₂e」表示，四捨五入至**小數點後第 3 位**（《管理辦法》第 2 條第 1 款，`CIT-LAW-MGT`） |
| **報告書資料包** | 對應《盤查報告書參考範本》（`CIT-RPT-GEN`）第二～四章，直接帶入鎖定版本之 `boundary_version_id`、`site_id` 與計算結果，報告端禁止手動改數 |
| **雙軌／三軌對照揭露** | 同時輸出 `MOENV_AR5`、`IPCC_AR6_2021`、`IPCC_AR6_ERRATA_2025` 彙總對照表與標註 `GWP-100` 完整出處 |

### 3.5 查（Verification & Audit）— `DataQuality` / `Uncertainty` / `AuditGuard`

| 稽核模組 | 核心欄位與系統阻擋／預警條件 | 引用來源 |
|---|---|---|
| **數據品質管理（製造業表六）** | `activity_error_grade` × `calibration_grade` × `factor_grade` → 綜合誤差等級與評分區間 | `CIT-TPL-MFG` 表六 |
| **不確定性評估（製造業表七）** | 活動數據與係數 95% 信賴區間上下限合成（係數預設信賴區間來自官網係數參考表） | `CIT-TPL-MFG` 表七與附表一 |
| **自廠檢測強制驗證（表十一／表 7）** | 凡選用自廠熱值或碳含量，缺 `CNS 17025 / ISO 17025 / 環境部認可` 機構與檢測日期者**阻擋定案** | `CIT-QA-CHECK`（第 5 條） |
| **5% 實質性差異預警** | 跨年度或 GWP 版本切換（AR5 ↔ AR6）差異達 **5%** 以上時自動亮燈，提示基準年重算評估或實質錯誤風險 | 《管理辦法》第 15 條第 5 款（`CIT-LAW-MGT`） |
| **查驗機構與輪調控管** | 查驗機構代碼引《代碼檔 V2》`附表二`；追蹤同一主導查驗員連續年限，滿 6 年強制警示不得連任 | 《管理辦法》第 8 條（`CIT-LAW-MGT`） |

## 4. 權威引用來源基準清單（Citation Registry Seed）

系統啟動時預設載入以下已驗證官方與國際權威來源（後續新增係數或法規均須比照登錄）：

| `citation_id` | 文件／規範名稱 | 發行機關與版次／日期 | 驗證來源網址 |
|---|---|---|---|
| `CIT-LAW-ACT` | 《氣候變遷因應法》及施行細則 | 環境部（2025/06/29 更新） | [製造業法規專區](https://ghgregistry.moenv.gov.tw/epa_ghg/Downloads/FileDownloads.aspx?Type_ID=1&Category=law) |
| `CIT-LAW-MGT` | 《溫室氣體排放量盤查登錄及查驗管理辦法》 | 環境部（2025/12/26 更新） | [製造業法規專區](https://ghgregistry.moenv.gov.tw/epa_ghg/Downloads/FileDownloads.aspx?Type_ID=1&Category=law) |
| `CIT-CODE-V2` | 《溫室氣體盤查作業相關代碼檔 V2》 | 環境部（2026/02/24 更新） | [盤查登錄下載專區](https://ghgregistry.moenv.gov.tw/epa_ghg/Downloads/FileDownloads.aspx?Type_ID=6) |
| `CIT-EF-MOENV-113` | 《113 年 2 月 5 日公告溫室氣體排放係數》 | 環境部環部授氣字第 1139101231 號（ODS 2026/02/24） | [113 年係數 ODS](https://www.google.com/search?q=https%3A%2F%2Fwww.google.com%2Furl%3Fsa%3DE%26source%3Dgmail%26q%3Dhttps%3A%2F%2Fghgregistry.moenv.gov.tw%2Fupload%2FTools%2FDI%2F113%25E5%25B9%25B42%25E6%259C%25885%25E6%2597%25A5%25E5%2585%25AC%25E5%2591%258A%25E6%25BA%25AB%25E5%25AE%25A3%25E6%25B0%25A3%25E9%25AB%2594%25E6%258E%2592%25E6%2594%25BE%25E4%25BF%2582%25E6%2595%25B8.ods) |
| `CIT-NCV-114` | 《114 年度車用汽油、柴油、液化石油氣及天然氣之熱值》 | 環境部（2026/02/10 發布） | [114 年度熱值公告](https://ghgregistry.moenv.gov.tw/epa_ghg/News/NewsCont.aspx?Type_ID=1&Record_ID=3268) |
| `CIT-GUIDE-113` | 《溫室氣體排放量盤查作業指引 113 年版》 | 環境部（2024/03/07） | [113 年版盤查作業指引](https://www.google.com/search?q=https://ghgregistry.moenv.gov.tw/epa_ghg/GhgDownload/%25E6%25BA%25AB%25E5%25AE%25A3%25E6%25B0%25A3%25E9%25AB%2594%25E6%258E%2592%25E6%2594%25BE%25E9%2587%258F%25E7%259B%25A4%25E6%259F%25A5%25E4%25BD%259C%25E6%25A5%25AD%25E6%258C%2587%25E5%25BC%2595113%25E5%25B9%25B4%25E7%2589%2588.pdf) |
| `CIT-TPL-MFG` | 《溫室氣體排放量清冊表單(範例)》 | 環境部（2026/06/04，含 2026/06/01 修正） | [盤查登錄下載專區](https://ghgregistry.moenv.gov.tw/epa_ghg/Downloads/FileDownloads.aspx?Type_ID=6) |
| `CIT-TPL-SVC3` | 《溫室氣體排放量清冊表單(範例)_服務業 V3》 | 環境部（2026/02/24） | [服務業下載專區](https://ghgregistry.moenv.gov.tw/epa_ghg/Downloads/FileDownloads.aspx?Type_ID=2) |
| `CIT-RPT-GEN` | 《盤查報告書參考範本_各行業通用》 | 環境部（2024/03/05） | [通用報告書範本](https://ghgregistry.moenv.gov.tw/upload/Tools/AI/%E7%9B%A4%E6%9F%A5%E5%A0%B1%E5%91%8A%E6%9B%B8%E5%8F%83%E8%80%83%E7%AF%84%E6%9C%AC_%E5%90%84%E8%A1%8C%E6%A5%AD%E9%80%9A%E7%94%A8.pdf) |
| `CIT-QA-MOENV` | 《溫室氣體排放量盤查登錄作業問答集》與《查驗指引》 | 環境部（2026/07/20 更新） | [應查驗作業問答集](https://ghgregistry.moenv.gov.tw/upload/Tools/AI/%E6%BA%AB%E5%AE%A4%E6%B0%A3%E9%AB%94%E6%8E%92%E6%94%BE%E9%87%8F%E7%9B%A4%E6%9F%A5%E7%99%BB%E9%8C%84%E4%BD%9C%E6%A5%AD%E5%95%8F%E7%AD%94%E9%9B%86_%E6%87%89%E7%9B%A4%E6%9F%A5%E7%99%BB%E9%8C%84%E5%8F%8A%E6%9F%A5%E9%A9%97%E4%B9%8B%E6%8E%92%E6%94%BE%E6%BA%90.pdf) |
| `CIT-GWP-AR6-2021` | IPCC AR6 WGI Table 7.15 & 7.SM.7 / GHG Protocol GWP v2.0 | IPCC (2021) / GHG Protocol (2024/08) | [GHG Protocol GWP 表](https://ghgprotocol.org/sites/default/files/2024-08/Global-Warming-Potential-Values%20%28August%202024%29.pdf) |
| `CIT-GWP-AR6-ERR25` | IPCC AR6 WGI Errata (Table 7.15 & 7.SM.7 修正) | IPCC (2025/10/07) | [IPCC AR6 WGI Errata](https://www.ipcc.ch/report/ar6/wg1/downloads/report/IPCC_AR6_WGI_Errata.pdf) |

## 5. 建議開發落地順序（交給 Antigravity 執行）

1. **Phase 0（參數與引用底座）**：寫一支確定性匯入腳本，將《代碼檔 V2.ods》與《113 年係數.ods》轉成版本化 JSON，並強制每筆參數掛上 `citation_id`；寫單元測試驗證「無引用來源不得入庫」。
2. **Phase 1（計算引擎 + 黃金案例）**：依《第一波開發規格書》實作五大排放源純函式與 `GwpProjection`，跑通全部官方黃金案例並鎖定 4 位／3 位精度。
3. **Phase 2（邊＋源資料管理）**：實作 `BoundaryVersion`、`Site`、`UtilityAccount`、`EmissionSource` 與 `ActivityRecord` 的驗證規則（含排除檢核與電號重複計算防護）。
4. **Phase 3（報＋查輸出與檢核）**：實作製造業／服務業雙模式清冊匯出、5% 差異預警、自廠檢測阻擋與不可變 `AuditSnapshot`。
5. **Phase 4（外殼包裝與 AI 輔助）**：視交付需求套上網頁或 Windows 桌面外殼（含本機加密與備份），最後才接入 AI 輔助抽取單據與異常提示（嚴守「AI 不得核准計算與判定」邊界）。
