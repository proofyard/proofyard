// テストから直接読み書きできる Server 側のデータ
export const db = { users: [] as string[], gate: null as Promise<void> | null };
