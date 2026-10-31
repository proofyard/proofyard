// oxlint-disable-next-line eslint/require-await -- async の Server Component が投げるエラー（rejected Promise）を確かめる
export default async function Boom(): Promise<never> {
  throw new Error("boom");
}
