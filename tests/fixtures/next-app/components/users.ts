export type User = { id: number; name: string };

// 本物ならデータベースから読む
export async function getUsers(): Promise<User[]> {
  return [
    { id: 1, name: "Alice" },
    { id: 2, name: "Bob" },
  ];
}
