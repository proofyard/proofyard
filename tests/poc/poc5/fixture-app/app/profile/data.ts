// 本物ならデータベースなどから読む（テストでは mock.module で差し替える）
// oxlint-disable-next-line require-await -- 例外ではなく reject した Promise を返す
export const getProfile = async (id: string): Promise<{ name: string }> => {
  throw new Error(
    `[fixture] real data source is not available in tests (${id})`
  );
};
