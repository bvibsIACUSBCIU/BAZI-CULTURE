import { astro } from "iztro";

const GENDERS = new Set(["男", "女"]);
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/u;

export const ZIWEI_ENGINE_VERSION = "ziwei-iztro-2.5.8-mvp-0.1.0";
export const ZIWEI_POLICY = Object.freeze({
  calendar: "Gregorian input converted internally by iztro",
  dependency: "iztro@2.5.8",
  schoolConfig: "iztro default configuration",
  leapMonthFix: true,
  timezone: "Asia/Shanghai wall time; birthplace correction not enabled",
  interpretation: "structure only; no fortune inference",
});

export class ZiweiInputError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ZiweiInputError";
    this.code = code;
  }
}

export function normalizeZiweiInput(input = {}) {
  const date = String(input.date || "").trim();
  const dateMatch = DATE_PATTERN.exec(date);
  if (!dateMatch) throw new ZiweiInputError("INVALID_DATE", "出生日期格式应为 YYYY-MM-DD。");
  const [year, month, day] = dateMatch.slice(1).map(Number);
  if (year < 1900 || year > 2099 || !isRealDate(year, month, day)) {
    throw new ZiweiInputError("INVALID_DATE", "请输入 1900-2099 年之间的有效公历日期。");
  }

  const time = String(input.time || "").trim();
  const timeMatch = TIME_PATTERN.exec(time);
  if (!timeMatch) throw new ZiweiInputError("TIME_REQUIRED", "紫微斗数出生盘必须提供出生时间。");
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (hour > 23 || minute > 59) throw new ZiweiInputError("INVALID_TIME", "请输入有效出生时间。");

  const gender = String(input.gender || "").trim();
  if (!GENDERS.has(gender)) throw new ZiweiInputError("GENDER_REQUIRED", "紫微斗数排盘需要选择男或女。");

  return Object.freeze({ date, time, gender, year, month, day, hour, minute });
}

export function hourToZiweiIndex(hour) {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new ZiweiInputError("INVALID_TIME", "出生小时无效。");
  }
  if (hour === 0) return 0;
  if (hour === 23) return 12;
  return Math.floor((hour + 1) / 2);
}

export async function calculateZiwei(input, { adapter = iztroAdapter } = {}) {
  const normalized = normalizeZiweiInput(input);
  const timeIndex = hourToZiweiIndex(normalized.hour);
  const raw = await adapter(normalized, timeIndex);
  if (!Array.isArray(raw?.palaces) || raw.palaces.length !== 12) {
    throw new Error("紫微排盘引擎未返回完整十二宫。");
  }

  return Object.freeze({
    system: "ziwei",
    engineVersion: ZIWEI_ENGINE_VERSION,
    input: {
      date: normalized.date,
      time: normalized.time,
      gender: normalized.gender,
      timeIndex,
      timezone: "Asia/Shanghai",
    },
    solarDate: raw.solarDate,
    lunarDate: raw.lunarDate,
    chineseDate: raw.chineseDate,
    timeLabel: raw.time,
    timeRange: raw.timeRange,
    zodiac: raw.zodiac,
    sign: raw.sign,
    soul: raw.soul,
    body: raw.body,
    fiveElementsClass: raw.fiveElementsClass,
    soulPalaceBranch: raw.earthlyBranchOfSoulPalace,
    bodyPalaceBranch: raw.earthlyBranchOfBodyPalace,
    palaces: raw.palaces.map(sanitizePalace),
    calculationPolicy: ZIWEI_POLICY,
  });
}

function iztroAdapter(input, timeIndex) {
  return astro.bySolar(
    `${input.year}-${input.month}-${input.day}`,
    timeIndex,
    input.gender,
    true,
    "zh-CN",
  );
}

function sanitizePalace(palace) {
  return Object.freeze({
    name: String(palace.name || ""),
    heavenlyStem: String(palace.heavenlyStem || ""),
    earthlyBranch: String(palace.earthlyBranch || ""),
    isBodyPalace: palace.isBodyPalace === true,
    isOriginalPalace: palace.isOriginalPalace === true,
    majorStars: sanitizeStars(palace.majorStars),
    minorStars: sanitizeStars(palace.minorStars),
    stage: palace.stage
      ? { range: [...(palace.stage.range || [])], heavenlyStem: palace.stage.heavenlyStem || "" }
      : null,
  });
}

function sanitizeStars(stars) {
  return (stars || []).map((star) => ({
    name: String(star.name || ""),
    brightness: String(star.brightness || ""),
    mutagen: String(star.mutagen || ""),
  }));
}

function isRealDate(year, month, day) {
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === day;
}
