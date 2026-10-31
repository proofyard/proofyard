// テストから直接読み書きできるサーバー側のデータ
export const db = {
  afterLog: [] as string[],
  cacheCalls: 0,
  gate: null as Promise<void> | null,
  likes: 0,
  tagged: 0,
  users: [] as string[],
};
