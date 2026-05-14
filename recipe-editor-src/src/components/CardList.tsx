import { useMemo, useState } from 'react';
import type { CardData } from '../types';

type Filter = 'all' | 'has' | 'no';

export function CardList({
  cards,
  selectedNo,
  onSelect,
}: {
  cards: CardData[];
  selectedNo: string;
  onSelect: (no: string) => void;
}) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const filtered = useMemo(() => {
    return cards.filter((c) => {
      if (filter === 'has' && (!c.recipe || c.recipe === '""')) return false;
      if (filter === 'no' && c.recipe && c.recipe !== '""') return false;
      if (!q) return true;
      const hay = (c.cardNo + ' ' + c.name).toLowerCase();
      return hay.includes(q.toLowerCase());
    });
  }, [cards, q, filter]);

  return (
    <div className="left">
      <div className="card-list-search">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="検索 (BT1- や 名前)"
        />
      </div>
      <div className="card-list-filter">
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
          全件 ({cards.length})
        </button>
        <button className={filter === 'has' ? 'active' : ''} onClick={() => setFilter('has')}>
          レシピあり
        </button>
        <button className={filter === 'no' ? 'active' : ''} onClick={() => setFilter('no')}>
          レシピなし
        </button>
      </div>
      <div className="card-list">
        {filtered.map((c) => (
          <div
            key={c.cardNo}
            className={'card-row' + (c.cardNo === selectedNo ? ' active' : '')}
            onClick={() => onSelect(c.cardNo)}
          >
            <span className="no">{c.cardNo}</span>
            <span className="name">{c.name || '(無名)'}</span>
            <span className={'badge ' + (c.recipe && c.recipe !== '""' ? 'has' : 'no')}>
              {c.recipe && c.recipe !== '""' ? '✓' : '–'}
            </span>
          </div>
        ))}
        {filtered.length === 0 && <div className="placeholder">該当カードなし</div>}
      </div>
    </div>
  );
}
