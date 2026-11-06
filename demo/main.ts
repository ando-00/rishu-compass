import type { DemoRequest, DemoResponse } from "./protocol";

// 公開デモの入口。/api/ への通信を、ブラウザの中で動く API へ渡してから画面を読み込む。
const worker = new Worker(new URL("./apiWorker.ts", import.meta.url), { type: "module" });
const pending = new Map<number, { resolve: (response: Response) => void; reject: (cause: Error) => void }>();
let nextId = 0;

worker.onmessage = ({ data }: MessageEvent<DemoResponse>) => {
  const waiting = pending.get(data.id);
  pending.delete(data.id);
  waiting?.resolve(new Response(data.body, { status: data.status, headers: data.headers }));
};
worker.onerror = () => {
  for (const waiting of pending.values()) waiting.reject(new Error("公開デモの API を起動できませんでした"));
  pending.clear();
};

const networkFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  if (!url.pathname.startsWith("/api/")) return networkFetch(input, init);
  const id = nextId++;
  const message: DemoRequest = {
    id,
    url: url.href,
    method: init?.method ?? "GET",
    headers: [...new Headers(init?.headers)],
    body: typeof init?.body === "string" ? init.body : null,
  };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage(message);
  });
};

const notice = document.createElement("div");
notice.textContent =
  "公開デモ（架空のデータ）: 手元で動かす版と同じコードをブラウザの中で動かしています。Claude は呼びません。再読み込みすると最初に戻ります。";
notice.style.cssText = "padding:6px 16px;background:#eef2f7;color:#333;font-size:13px;line-height:1.5";
document.body.prepend(notice);

void import("../src/main");
