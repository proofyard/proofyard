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
  installLocation();
  resolveUrlAttributes();
  installReportError();
  installNavigationTiming();
  installIsEqualNode();
  return installed;
}

// turbo-dom 0.5.6 には Node.isEqualNode がない（Next.js の Pages Router の next/head が、<head> の要素を比べて入れ替えるのに使う）
// https://dom.spec.whatwg.org/#concept-node-equals
function installIsEqualNode() {
  if (typeof Node.prototype.isEqualNode === "function") return;
  const equal = (a: Node, b: Node): boolean => {
    if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) return false;
    if (a.nodeType === 1) {
      const [x, y] = [a as Element, b as Element];
      if (x.namespaceURI !== y.namespaceURI || x.attributes.length !== y.attributes.length) return false;
      for (const { name, value } of Array.from(x.attributes)) if (y.getAttribute(name) !== value) return false;
    } else if (a.nodeType === 3 || a.nodeType === 8) {
      if ((a as CharacterData).data !== (b as CharacterData).data) return false;
    }
    if (a.childNodes.length !== b.childNodes.length) return false;
    return Array.from(a.childNodes).every((child, i) => equal(child, b.childNodes[i]!));
  };
  Node.prototype.isEqualNode = function (this: Node, other: Node | null) {
    return other !== null && equal(this, other);
  };
}

// ブラウザの performance.measure は、始まりに PerformanceTiming の名前（navigationStart）も使える（Next.js の Pages Router が使う）。
// ページの読み込みの始まりは、Bun の時間の原点にする
function installNavigationTiming() {
  const measure = performance.measure.bind(performance);
  performance.measure = ((name: string, start?: string | PerformanceMeasureOptions, end?: string) =>
    start === "navigationStart" ? measure(name, { start: 0, end }) : measure(name, start, end)) as Performance["measure"];
}

// ブラウザの reportError: window に error イベントを送り、取り消されなければコンソールに出す
// （Bun のものは捕まえられなかった例外になり、テストが落ちる。Next.js は Hydration Mismatch などをこれで報告する）
// turbo-dom 0.5.6 には ErrorEvent がない（グローバルの ErrorEvent は Bun のもので、turbo-dom の window には送れない）
// https://html.spec.whatwg.org/multipage/webappapis.html#dom-reporterror
function installReportError() {
  class ErrorEvent extends Event {
    readonly error: unknown;
    readonly message: string;
    constructor(type: string, init: EventInit & { error?: unknown; message?: string } = {}) {
      super(type, init);
      this.error = init.error;
      this.message = init.message ?? "";
    }
  }
  (globalThis as any).ErrorEvent = ErrorEvent;
  globalThis.reportError = (error: unknown) => {
    const event = new ErrorEvent("error", { error, message: error instanceof Error ? error.message : String(error), cancelable: true });
    if (window.dispatchEvent(event)) console.error(error);
  };
}

// turbo-dom 0.5.6 の src / href は属性の値をそのまま返す。HTML の要素ではブラウザと同じく文書の URL で解決する
// （Next.js のクライアントは <script>.src から assetPrefix を求める）
// https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#reflecting-content-attributes-in-idl-attributes
function resolveUrlAttributes() {
  for (const name of ["src", "href"]) {
    const original = Object.getOwnPropertyDescriptor(Element.prototype, name);
    if (!original?.get) throw new Error(`[proofyard] the DOM adapter expected Element.prototype.${name}`);
    Object.defineProperty(Element.prototype, name, {
      ...original,
      get(this: Element) {
        if (this.namespaceURI !== "http://www.w3.org/1999/xhtml") return original.get!.call(this);
        const value = this.getAttribute(name);
        if (value === null) return "";
        return URL.parse(value, document.baseURI)?.href ?? value;
      },
    });
  }
}

// turbo-dom 0.5.6 の location は http://localhost/ 固定で、history.pushState も URL を変えない。
// Next.js のルーターは location.href と history.state / pushState / replaceState / popstate を使うので、
// URL を共有する Location と History を入れる。
// ponytail: ページ遷移（href の代入・assign・replace・reload）はテストの中では起こせないので Fail Closed
let current = new URL("http://localhost/");
const entries: { url: URL; state: unknown }[] = [{ url: current, state: null }];
let index = 0;

const navigation = (what: string) => () => {
  throw new Error(`[proofyard] Unsupported: ${what} (a full page navigation) is not supported in tests`);
};

const location = {
  get href() {
    return current.href;
  },
  set href(_: string) {
    navigation("location.href = ...")();
  },
  get protocol() {
    return current.protocol;
  },
  get host() {
    return current.host;
  },
  get hostname() {
    return current.hostname;
  },
  get port() {
    return current.port;
  },
  get pathname() {
    return current.pathname;
  },
  get search() {
    return current.search;
  },
  get hash() {
    return current.hash;
  },
  get origin() {
    return current.origin;
  },
  assign: navigation("location.assign()"),
  replace: navigation("location.replace()"),
  reload: navigation("location.reload()"),
  toString: () => current.href,
};

function move(url: string | URL | null | undefined, state: unknown, push: boolean) {
  const next = url == null ? current : new URL(url, current);
  if (next.origin !== current.origin) throw new DOMException(`Cannot change the URL to ${next.href} (different origin)`, "SecurityError");
  if (push) entries.splice(++index, Infinity, { url: next, state: structuredClone(state) });
  else entries[index] = { url: next, state: structuredClone(state) };
  current = next;
  for (const resolve of historyWaiters.splice(0)) resolve();
}

// 次の pushState / replaceState を待つ。Next.js のルーターは状態をコミットするたびに書く（app-router.tsx の HistoryUpdater）
const historyWaiters: (() => void)[] = [];
export const nextHistoryWrite = () => new Promise<void>((resolve) => historyWaiters.push(resolve));

const history = {
  get length() {
    return entries.length;
  },
  get state() {
    return entries[index]!.state;
  },
  scrollRestoration: "auto",
  pushState: (state: unknown, _title: string, url?: string | URL | null) => move(url, state, true),
  replaceState: (state: unknown, _title: string, url?: string | URL | null) => move(url, state, false),
  go(delta = 0) {
    const target = index + delta;
    if (delta === 0 || target < 0 || target >= entries.length) return;
    index = target;
    current = entries[index]!.url;
    // ブラウザと同じく popstate は非同期に発火する
    setTimeout(() => {
      const event = new Event("popstate");
      Object.defineProperty(event, "state", { value: entries[index]!.state });
      window.dispatchEvent(event);
    });
  },
  back: () => history.go(-1),
  forward: () => history.go(1),
};

function installLocation() {
  for (const target of [globalThis, document]) Object.defineProperty(target, "location", { configurable: true, get: () => location });
  Object.defineProperty(globalThis, "history", { configurable: true, get: () => history });
  Object.defineProperty(document, "URL", { configurable: true, get: () => current.href });
}

// テストのはじめに URL と履歴を決める（renderRoute が使う）
export function resetLocation(url: string) {
  current = new URL(url, "http://localhost/");
  entries.splice(0, Infinity, { url: current, state: null });
  index = 0;
}
