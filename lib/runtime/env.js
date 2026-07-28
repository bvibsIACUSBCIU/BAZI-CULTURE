export function getEnv() {
  if (typeof process !== "undefined" && process?.env) return process.env;
  return globalThis.__BCL_ENV__ || {};
}
