// テストから直接読み書きできる Server 側のデータ
export const db = { gate: null as Promise<void> | null, users: [] as string[] };
