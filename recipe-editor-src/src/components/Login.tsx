import { useState } from 'react';
import { checkAdmin } from '../api';

export function Login({ onSuccess }: { onSuccess: (pw: string) => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      const ok = await checkAdmin(pw);
      if (ok) {
        sessionStorage.setItem('admin_pw', pw);
        onSuccess(pw);
      } else {
        setErr('パスワードが違います');
      }
    } catch (e: any) {
      setErr('通信エラー: ' + (e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="login" onSubmit={submit}>
      <h2>レシピエディタ</h2>
      <p style={{ fontSize: 12, color: '#666' }}>
        管理者パスワードを入力してください。
      </p>
      <input
        type="password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        placeholder="パスワード"
        autoFocus
      />
      <button type="submit" disabled={loading}>
        {loading ? '認証中...' : 'ログイン'}
      </button>
      {err && <div className="err">{err}</div>}
    </form>
  );
}
