// DOM Adapter（仕様 2.2）: turbo-dom を入れ、足りない部分をここで補う。
// Client Graph の react-dom/client を読む前に呼ぶこと。
import { installGlobals } from "@miaskiewicz/turbo-dom/install";

// turbo-dom 0.5.6 の FormData（TurboFormData）は new FormData(form, submitter) の引数を無視する。
// React 19 のフォーム Action はこれでフォームの値を集めるので、Bun 本来の FormData に HTML 仕様の
// 「entry list の構築」を足したものに差し替える。
// https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#constructing-the-form-data-set
// ponytail: 未対応 = input[type=image] の座標、dirname、fieldset の最初の legend の例外、改行の正規化
const NativeFormData = globalThis.FormData;

const BUTTON_TYPES = new Set(["submit", "button", "reset", "image"]);

function isButton(el: Element) {
  const tag = el.localName;
  return tag === "button" || (tag === "input" && BUTTON_TYPES.has((el as HTMLInputElement).type));
}

function isDisabled(el: Element) {
  return (el as HTMLInputElement).disabled || el.closest("fieldset[disabled]") !== null;
}

class ProofyardFormData extends NativeFormData {
  // Bun の FormData には独自の toJSON があり、JSON.stringify で普通のオブジェクトに化ける。
  // React の encodeReply は JSON.stringify の replacer で FormData を判定するので、ブラウザ同様に無くす
  static {
    Object.defineProperty(this.prototype, "toJSON", { value: undefined });
  }

  constructor(form?: HTMLFormElement, submitter?: HTMLElement | null) {
    super();
    if (form === undefined) return;
    if (form?.localName !== "form") throw new TypeError("FormData: parameter 1 is not of type 'HTMLFormElement'");
    if (submitter != null && (!isButton(submitter) || (submitter as HTMLButtonElement).form !== form)) {
      throw new TypeError("FormData: submitter is not a submit button of the form");
    }
    for (const el of Array.from(form.elements)) {
      if (el.closest("datalist") || isDisabled(el)) continue;
      if (isButton(el) && el !== submitter) continue;
      const name = el.getAttribute("name");
      if (!name) continue;
      const type = (el as HTMLInputElement).type;
      if (el.localName === "input" && (type === "checkbox" || type === "radio")) {
        if ((el as HTMLInputElement).checked) this.append(name, (el as HTMLInputElement).value || "on");
      } else if (el.localName === "input" && type === "file") {
        throw new Error("[proofyard] Unsupported: <input type=\"file\"> in FormData is not supported by the DOM adapter yet");
      } else if (el.localName === "select") {
        for (const option of Array.from((el as HTMLSelectElement).options)) {
          if (option.selected && !option.disabled) this.append(name, option.value);
        }
      } else if (el.localName === "button") {
        // turbo-dom 0.5.6 は HTMLButtonElement.value が未実装。仕様では value 属性の反映
        this.append(name, el.getAttribute("value") ?? "");
      } else {
        this.append(name, (el as HTMLInputElement).value);
      }
    }
  }
}

// 1 プロセスに 1 つだけ入れる。2 回目以降は入れ直さない（document を差し替えると、先に読み込んだライブラリ
// （user-event は読み込み時の document を既定にする）と食い違う）
let installed: ReturnType<typeof installGlobals> | undefined;
// turbo-dom が上書きする Bun 本来のグローバルのうち、DOM に固有でないものは Bun のままにする。
// 同じプロセスで動くサーバー側のコード（Next.js、React の Flight）も使うので、ブラウザ用の実装に差し替えると壊れる
// （例: turbo-dom 0.5.6 の btoa はバイナリの文字列で無限ループする。Server Action のクロージャの暗号化が止まった）
const KEEP_NATIVE = [
  "atob",
  "btoa",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "queueMicrotask",
  "structuredClone",
  "reportError",
  "fetch",
  "URL",
  "performance",
  "MessageChannel",
  "MessagePort",
  "Worker",
  "File",
] as const;

export function installDom(html = "<!doctype html><html><head></head><body></body></html>") {
  if (installed) return installed;
  const native = Object.fromEntries(KEEP_NATIVE.map((name) => [name, (globalThis as any)[name]]));
  installed = installGlobals(globalThis, { html });
  for (const name of KEEP_NATIVE) if (native[name] !== undefined) (globalThis as any)[name] = native[name];
  globalThis.FormData = ProofyardFormData as typeof FormData;
  return installed;
}
