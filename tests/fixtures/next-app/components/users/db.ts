// テストから直接読み書きできるサーバー側のデータ
export const db = { users: [] as string[], likes: 0, gate: null as Promise<void> | null, afterLog: [] as string[] };
