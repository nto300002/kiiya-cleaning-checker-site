import { chatGPTSignInPath } from "../chatgpt-auth";

export default function SignedOutPage() {
  return <main className="signed-out-page">
    <section className="signed-out-card">
      <div className="brand"><span className="brand-mark">K</span><span>KIIYA <small>見落としチェッカー</small></span></div>
      <h1>ログアウトしました</h1>
      <p>KIIYA清掃チェッカーの利用を終了しました。</p>
      <a className="button primary" href={chatGPTSignInPath("/")} target="_top">もう一度ログイン</a>
    </section>
  </main>;
}
