import { NO_ADVISOR_MESSAGE } from "../shared/advise";

type State = {
  // 履修案を作れる環境か。読めていないうちは null で、案内を出さない
  enabled: boolean | null;
  recordingAvailable: boolean;
  hasResult: boolean;
};

// 要項の取り込みと同じく、押せない理由と次にできることを先に示す
export function advisorNotice({ enabled, recordingAvailable, hasResult }: State) {
  if (enabled !== false) return null;
  if (hasResult) return "この環境では履修案を作り直せません。";
  if (recordingAvailable) return "この環境では履修案の作成を使えません。「記録を読み込む」を押すと、実際に作った案の記録を見られます。";
  return NO_ADVISOR_MESSAGE;
}
