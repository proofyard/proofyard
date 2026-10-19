import { expect, test } from "bun:test";
import { installDom } from "./dom";

installDom();

function formData(html: string, submitterSelector?: string) {
  document.body.innerHTML = `<form>${html}</form>`;
  const form = document.querySelector("form")!;
  const submitter = submitterSelector ? (form.querySelector(submitterSelector) as HTMLElement) : null;
  return [...new FormData(form, submitter).entries()];
}

test("FormData(form): HTML 仕様の entry list", () => {
  expect(
    formData(`
      <input name="text" value="Alice">
      <input name="nameless-skipped-below">
      <input value="no name">
      <input name="disabled" value="x" disabled>
      <fieldset disabled><input name="in-disabled-fieldset" value="x"></fieldset>
      <input type="checkbox" name="on" checked>
      <input type="checkbox" name="off" value="x">
      <input type="radio" name="r" value="a">
      <input type="radio" name="r" value="b" checked>
      <select name="s" multiple>
        <option value="1" selected>1</option>
        <option value="2">2</option>
        <option value="3" selected disabled>3</option>
      </select>
      <textarea name="t">hello</textarea>
      <datalist><input name="in-datalist" value="x"></datalist>
      <button name="intent" value="save">Save</button>
      <button name="other" value="x">Other</button>
      <input type="reset" name="reset" value="x">
    `, 'button[name="intent"]'),
  ).toEqual([
    ["text", "Alice"],
    ["nameless-skipped-below", ""],
    ["on", "on"],
    ["r", "b"],
    ["s", "1"],
    ["t", "hello"],
    ["intent", "save"],
  ]);
});

test("submitter なしではボタンを含めない", () => {
  expect(formData(`<input name="a" value="1"><button name="b" value="2">B</button>`)).toEqual([["a", "1"]]);
});

test("Bun 本来の FormData のまま（Request の body に使える）", async () => {
  const fd = new FormData();
  fd.append("a", "1");
  const body = await new Request("http://x", { method: "POST", body: fd }).formData();
  expect(body.get("a")).toBe("1");
});

test("file input は Fail Closed", () => {
  expect(() => formData(`<input type="file" name="f">`)).toThrow(/Unsupported/);
});

test("ブラウザと同じく toJSON を持たない（JSON.stringify で中身に化けない）", () => {
  const fd = new FormData();
  fd.append("a", "1");
  expect(JSON.stringify({ fd })).toBe('{"fd":{}}');
});
