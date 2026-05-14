import { useEffect, useState } from 'react';
import { Login } from './components/Login';
import { CardList } from './components/CardList';
import { RecipeEditor } from './components/RecipeEditor';
import { DictManager } from './components/DictManager';
import { loadCards } from './api';
import { useDict } from './useDict';
import type { CardData } from './types';

type View = 'editor' | 'dict';

export default function App() {
  const [pw, setPw] = useState<string>(() => sessionStorage.getItem('admin_pw') || '');
  const [cards, setCards] = useState<CardData[]>([]);
  const [selectedNo, setSelectedNo] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<View>('editor');
  const dict = useDict(pw);

  useEffect(() => {
    if (!pw) return;
    setLoading(true);
    loadCards()
      .then((d) => {
        const list: CardData[] = (d.cards || []).map((c: any) => ({
          cardNo: String(c['カードNo'] || ''),
          name: String(c['名前'] || ''),
          type: String(c['タイプ'] || ''),
          color: String(c['色'] || ''),
          lv: String(c['Lv'] || c['レベル'] || ''),
          effectText: String(c['効果テキスト'] || c['効果'] || ''),
          evoText: String(c['進化元テキスト'] || c['進化元効果'] || ''),
          securityText: String(c['セキュリティテキスト'] || c['セキュリティ効果'] || ''),
          recipe: String(c['レシピ'] || c['効果レシピ'] || ''),
        })).filter((c: CardData) => c.cardNo);
        setCards(list);
      })
      .finally(() => setLoading(false));
  }, [pw]);

  if (!pw) return <Login onSuccess={setPw} />;

  const selectedCard = cards.find((c) => c.cardNo === selectedNo);

  function handleSaved(cardNo: string, recipe: string) {
    setCards((prev) => prev.map((c) => (c.cardNo === cardNo ? { ...c, recipe } : c)));
  }

  function logout() {
    sessionStorage.removeItem('admin_pw');
    setPw('');
  }

  return (
    <div className="app">
      <div className="app-header">
        <h1>🍽 レシピエディタ</h1>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setView('editor')} style={view === 'editor' ? { background: '#1976d2', color: 'white', borderColor: '#1976d2' } : {}}>
            📝 エディタ
          </button>
          <button onClick={() => setView('dict')} style={view === 'dict' ? { background: '#1976d2', color: 'white', borderColor: '#1976d2' } : {}}>
            📚 辞書管理
          </button>
          <button onClick={logout}>ログアウト</button>
        </div>
      </div>
      {loading && <div className="placeholder">カード読込中...</div>}
      {!loading && cards.length === 0 && <div className="placeholder">カードが取得できませんでした</div>}
      {!loading && cards.length > 0 && view === 'editor' && (
        <div className="split">
          <CardList cards={cards} selectedNo={selectedNo} onSelect={setSelectedNo} />
          <div className="right">
            {selectedCard ? (
              <RecipeEditor card={selectedCard} password={pw} dict={dict} onSaved={handleSaved} />
            ) : (
              <div className="placeholder">← 左のリストからカードを選んでください</div>
            )}
          </div>
        </div>
      )}
      {!loading && view === 'dict' && (
        <div className="right" style={{ height: 'calc(100vh - 100px)', background: 'white', borderRadius: 8 }}>
          <DictManager dict={dict} onClose={() => setView('editor')} />
        </div>
      )}
    </div>
  );
}
