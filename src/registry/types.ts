/**
 * 權威引用來源類別
 */
export type CitationCategory =
  | 'emission_factor'
  | 'codebook'
  | 'gwp'
  | 'heating_value'
  | 'regulation'
  | 'guideline'
  | 'template'
  | 'qa';

/**
 * 標準權威引用結構 (Provenance-First Invariant)
 */
export interface SourceCitation {
  citation_id: string;
  category: CitationCategory;
  issuer: string;
  document_title: string;
  doc_no_or_section: string;
  version_or_date: string;
  url: string;
  local_ref_file?: string;
}

/**
 * 任何進入計算或領域模型之官方參數皆須攜帶合法 citation_id
 */
export interface CitedEntry {
  citation_id: string;
}
