// 本物ならデータベースから読む
export async function getItems(): Promise<string[]> {
  return Array.from({ length: 5 }, (_, i) => `Item ${i + 1}`);
}
