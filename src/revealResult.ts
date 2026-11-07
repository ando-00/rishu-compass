// 回答の結果は画面の上に出るので、下のカードで答えると画面の外に出る。答えたボタンも消えて焦点が失われる（V-24）。
// 焦点を結果へ移し、結果か anchor（上の人数の欄）が外れているときだけ anchor まで戻す。見えているときは画面を動かさない。
export function revealResult(target: HTMLElement | null, anchor: HTMLElement | null, viewportHeight: number) {
  if (!target) return;
  target.focus({ preventScroll: true });
  const { top, bottom } = target.getBoundingClientRect();
  const anchorAbove = (anchor?.getBoundingClientRect().top ?? 0) < 0;
  if (top < 0 || bottom > viewportHeight || anchorAbove) (anchor ?? target).scrollIntoView({ behavior: "smooth", block: "start" });
}
