export interface User {
  id: number;
  name: string;
}

// 本物ならデータベースから読む
// oxlint-disable-next-line eslint/require-await -- 本物のデータベースと同じく Promise を返す
export const getUsers = async (): Promise<User[]> => [
  { id: 1, name: "Alice" },
  { id: 2, name: "Bob" },
];
