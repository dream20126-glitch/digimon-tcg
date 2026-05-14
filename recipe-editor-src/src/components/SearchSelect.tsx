import { useState, useRef, useEffect, useMemo } from 'react';

export interface SelectOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  allowFreeText?: boolean;
  style?: React.CSSProperties;
  required?: boolean;
}

export function SearchSelect({ value, onChange, options, placeholder = '--選択--', allowFreeText, style, required }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hoverIdx, setHoverIdx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 選択中の表示ラベル
  const currentLabel = useMemo(() => {
    const found = options.find((o) => o.value === value);
    return found ? found.label : value || '';
  }, [options, value]);

  // クリック外で閉じる
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // 開いた時にinputフォーカス
  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) =>
      o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)
    );
  }, [options, query]);

  // hoverIdx を範囲内に
  useEffect(() => {
    if (hoverIdx >= filtered.length) setHoverIdx(Math.max(0, filtered.length - 1));
  }, [filtered.length, hoverIdx]);

  function select(v: string) {
    onChange(v);
    setOpen(false);
    setQuery('');
    setHoverIdx(0);
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setQuery('');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered.length > 0) {
        select(filtered[hoverIdx]?.value ?? filtered[0].value);
      } else if (allowFreeText && query.trim()) {
        select(query.trim());
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHoverIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHoverIdx((i) => Math.max(0, i - 1));
    }
  }

  return (
    <div ref={ref} style={{ position: 'relative', ...style }}>
      {open ? (
        <>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setHoverIdx(0); }}
            onKeyDown={handleKey}
            placeholder="🔍 入力で絞り込み"
            style={{
              width: '100%',
              padding: '4px 6px',
              border: '1px solid #1976d2',
              borderRadius: 3,
              fontSize: 12,
              fontFamily: 'inherit',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <div
            ref={listRef}
            style={{
              position: 'absolute', top: '100%', left: 0, right: 0,
              background: 'white', border: '1px solid #1976d2', borderTop: 'none',
              borderRadius: '0 0 3px 3px',
              maxHeight: 240, overflowY: 'auto', zIndex: 100,
              boxShadow: '0 4px 8px rgba(0,0,0,0.1)',
            }}
          >
            {/* クリア候補 */}
            {!required && value && (
              <div
                onMouseDown={(e) => { e.preventDefault(); select(''); }}
                style={itemStyle(false, '#888')}
              >
                <em>（クリア）</em>
              </div>
            )}
            {filtered.length === 0 ? (
              allowFreeText && query.trim() ? (
                <div
                  onMouseDown={(e) => { e.preventDefault(); select(query.trim()); }}
                  style={itemStyle(false)}
                >
                  ＋ 「{query.trim()}」を直接入力
                </div>
              ) : (
                <div style={{ padding: 8, color: '#888', fontSize: 11 }}>該当なし</div>
              )
            ) : (
              filtered.map((o, i) => (
                <div
                  key={o.value || '__empty__' + i}
                  onMouseDown={(e) => { e.preventDefault(); select(o.value); }}
                  onMouseEnter={() => setHoverIdx(i)}
                  style={itemStyle(i === hoverIdx, undefined, o.value === value)}
                >
                  {o.label || <em style={{ color: '#888' }}>(空)</em>}
                  {o.value && o.value !== o.label && (
                    <span style={{ color: '#888', fontSize: 10, marginLeft: 6 }}>({o.value})</span>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      ) : (
        <div
          onClick={() => setOpen(true)}
          style={{
            padding: '4px 6px',
            border: '1px solid #ccc',
            borderRadius: 3,
            fontSize: 12,
            cursor: 'pointer',
            background: 'white',
            minHeight: 24,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            boxSizing: 'border-box',
          }}
        >
          <span style={{ color: currentLabel ? '#222' : '#aaa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {currentLabel || placeholder}
          </span>
          <span style={{ color: '#888', fontSize: 9, marginLeft: 4 }}>▼</span>
        </div>
      )}
    </div>
  );
}

function itemStyle(hover: boolean, color?: string, selected?: boolean): React.CSSProperties {
  return {
    padding: '4px 8px',
    cursor: 'pointer',
    fontSize: 12,
    borderBottom: '1px solid #f0f0f0',
    color: color || '#222',
    background: hover ? '#e3f2fd' : selected ? '#f0f7ff' : 'white',
    fontWeight: selected ? 'bold' : 'normal',
  };
}
