import qimenPackage from "qimen-engine/lib/qimen.js";

const qimen = qimenPackage?.default || qimenPackage;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/u;
const PALACE_META = {
  1: ["坎", "正北", "水"], 2: ["坤", "西南", "土"], 3: ["震", "正东", "木"],
  4: ["巽", "东南", "木"], 5: ["中", "中宫", "土"], 6: ["乾", "西北", "金"],
  7: ["兑", "正西", "金"], 8: ["艮", "东北", "土"], 9: ["离", "正南", "火"],
};

export const QIMEN_ENGINE_VERSION = "qfdk-qimen-8a9734a-structure-mvp-0.1.0";
export const QIMEN_POLICY = Object.freeze({
  method: "时家奇门",
  layout: "茅山派转盘法",
  juMethod: "repository-pinned ju calculation",
  timezone: "Asia/Shanghai wall time encoded deterministically",
  interpretation: "upstream jieduan/geju/analysis fields discarded",
});

export class QimenInputError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "QimenInputError";
    this.code = code;
  }
}

export function normalizeQimenInput(input = {}) {
  const date = String(input.date || "").trim();
  const dm = DATE_PATTERN.exec(date);
  if (!dm) throw new QimenInputError("INVALID_DATE", "起局日期格式应为 YYYY-MM-DD。");
  const [year, month, day] = dm.slice(1).map(Number);
  if (year < 1900 || year > 2099 || !isRealDate(year, month, day)) {
    throw new QimenInputError("INVALID_DATE", "请输入 1900-2099 年之间的有效日期。");
  }
  const time = String(input.time || "").trim();
  const tm = TIME_PATTERN.exec(time);
  if (!tm) throw new QimenInputError("TIME_REQUIRED", "时家奇门必须提供起局时间。");
  const hour = Number(tm[1]);
  const minute = Number(tm[2]);
  if (hour > 23 || minute > 59) throw new QimenInputError("INVALID_TIME", "请输入有效起局时间。");
  return Object.freeze({ date, time, year, month, day, hour, minute });
}

export async function calculateQimen(input, { adapter = qimenAdapter } = {}) {
  const normalized = normalizeQimenInput(input);
  const raw = await adapter(normalized);
  if (raw?.error || !raw?.juShu || !raw?.diPan || !raw?.tianPan) {
    throw new Error(raw?.message || "奇门引擎没有返回完整盘面。");
  }
  return Object.freeze({
    system: "qimen",
    engineVersion: QIMEN_ENGINE_VERSION,
    input: { date: normalized.date, time: normalized.time, timezone: "Asia/Shanghai" },
    method: "时家",
    siZhu: raw.siZhu,
    juShu: {
      jieQiName: raw.juShu.jieQiName,
      type: raw.juShu.type,
      number: String(raw.juShu.number),
      yuan: raw.juShu.yuan,
      fullName: raw.juShu.fullName,
    },
    xunShou: raw.xunShou,
    zhiFu: { star: raw.zhiFuXing, palace: String(raw.zhiFuGong) },
    zhiShi: { door: raw.zhiShiMen, palace: String(raw.zhiShiGong) },
    emptyPalaces: (raw.kongWangGong || []).map(String),
    horse: raw.maStar || null,
    palaces: Object.keys(PALACE_META).map((key) => sanitizePalace(key, raw)),
    calculationPolicy: QIMEN_POLICY,
  });
}

function qimenAdapter(input) {
  const wallClock = new Date(Date.UTC(input.year, input.month - 1, input.day, input.hour - 8, input.minute, 0));
  return qimen.calculate(wallClock, { method: "时家", purpose: "结构研究" });
}

function sanitizePalace(key, raw) {
  const [name, direction, element] = PALACE_META[key];
  return Object.freeze({
    number: Number(key), name, direction, element,
    earthStem: String(raw.diPan[key] || ""),
    heavenStem: String(raw.tianPan[key] || ""),
    hiddenStem: String(raw.anGan?.[key] || ""),
    star: String(raw.jiuXing?.[key] || ""),
    door: String(raw.baMen?.[key] || ""),
    deity: String(raw.baShen?.[key] || ""),
    isEmpty: (raw.kongWangGong || []).map(String).includes(String(key)),
    isHorse: String(raw.maStar?.gong || "") === String(key),
  });
}

function isRealDate(year, month, day) {
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === day;
}
