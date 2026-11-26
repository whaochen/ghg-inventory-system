/**
 * 全域確定性精度常數與四捨五入工具
 * 依據：《溫室氣體排放量盤查登錄及查驗管理辦法》第2條第1款 & 第一波計算引擎規格書第1節
 */

export const DETAIL_DECIMALS = 4;
export const INTERMEDIATE_DECIMALS = 10;
export const SUMMARY_DECIMALS = 3;

/** 1 kcal = 4.1868 × 10^-9 TJ (CIT-EF-MOENV-113 附表一註2) */
export const KCAL_TO_TJ = 4.1868e-9;

/**
 * 確定性四捨五入（避免 IEEE 754 浮點誤差如 1.005 -> 1.00）
 */
export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`無效的數值無法執行四捨五入: ${value}`);
  }
  if (value === 0) return 0;
  const factor = 10 ** decimals;
  const sign = value < 0 ? -1 : 1;
  // 先將絕對值正規化至 15 位有效數字，再加微小 epsilon 進行標準四捨五入
  const abs = Math.abs(value);
  const scaled = Number((abs * factor).toPrecision(15));
  return (sign * Math.round(scaled)) / factor;
}

export function roundDetail(value: number): number {
  return roundTo(value, DETAIL_DECIMALS);
}

export function roundIntermediate(value: number): number {
  return roundTo(value, INTERMEDIATE_DECIMALS);
}

export function roundSummary(value: number): number {
  return roundTo(value, SUMMARY_DECIMALS);
}
