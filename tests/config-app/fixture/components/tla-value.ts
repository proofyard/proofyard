// top-level await のあるモジュール（Client Component から推移的に import される。Next.js は async module として扱う）
export const tlaValue = await Promise.resolve("From top-level await");
