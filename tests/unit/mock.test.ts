// mock.module の差し替えは、テストの中ならテストの後、ファイルの直下ならファイルの後に戻る（仕様 19 章。次のファイルに残らないことは mock-files.test.ts）
import { expect, mock, test } from "bun:test";
import { greeting } from "./mocks/greeting";

mock.module("./mocks/greeting", () => ({ greeting: () => "file mock" }));

test("ファイルの直下の差し替えは、そのファイルのテストの間は残る", () => {
  expect(greeting()).toBe("file mock");
});

test("テストの中の差し替えは、テストの後にファイルの直下の差し替えに戻る: 差し替える", () => {
  mock.module("./mocks/greeting", () => ({ greeting: () => "test mock" }));
  expect(greeting()).toBe("test mock");
});

test("テストの中の差し替えは、テストの後にファイルの直下の差し替えに戻る: 戻る", () => {
  expect(greeting()).toBe("file mock");
});

test("読み込めないモジュールの差し替え: 差し替える", async () => {
  mock.module("./mocks/broken", () => ({ query: () => "mocked rows" }));
  expect((await import("./mocks/broken")).query()).toBe("mocked rows");
});

test("読み込めないモジュールの差し替え: 戻した後に使うと、本物の読み込みのエラー", async () => {
  const { query } = await import("./mocks/broken");
  expect(() => query()).toThrow("broken: needs a database");
});
