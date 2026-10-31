// 本物ならデータベースから読む
export const getItems = (): Promise<string[]> =>
  Promise.resolve(Array.from({ length: 5 }, (_, i) => `Item ${i + 1}`));
