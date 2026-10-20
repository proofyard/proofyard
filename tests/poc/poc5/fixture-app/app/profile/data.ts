// 本物ならデータベースなどから読む（テストでは mock.module で差し替える）
export async function getProfile(id: string): Promise<{ name: string }> {
  throw new Error(`[fixture] real data source is not available in tests (${id})`);
}
