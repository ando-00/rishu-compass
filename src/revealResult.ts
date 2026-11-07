// 回答の結果は画面の上に出るので、下のカードで答えると画面の外に出る。答えたボタンも消えて焦点が失われる（V-24）。
// 焦点を結果へ移し、外れているときだけ anchor まで戻す。見えているときは画面を動かさない。
export function revealResult(target: HTMLElement | null, anchor: HTMLElement | null, viewportHeight: number) {
  if (!target) return;
  target.focus({ preventScroll: true });
  const { top, bottom } = target.getBoundingClientRect();
  if (top < 0 || bottom > viewportHeight) (anchor ?? target).scrollIntoView({ behavior: "smooth", block: "start" });
}
