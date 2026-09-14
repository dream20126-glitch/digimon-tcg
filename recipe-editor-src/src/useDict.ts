// 辞書 = スプシをシングルソース化（GAS バックエンド）
// 演出タイプはローカル管理（スプシ無関係）
import { useState, useEffect, useCallback } from 'react';
import { DEFAULT_VISUAL_TYPES } from './visualTypes';
import { listDict, addDictEntry as apiAdd, updateDictEntry as apiUpdate, removeDictEntry as apiRemove } from './api';
import { OPTIONS as DEFAULT_OPTIONS } from './dict';
import type { DictEntry, VisualTypeEntry } from './types';

const VT_STORAGE_KEY = 'recipe_editor_visual_types';
const CACHE_KEY = 'recipe_editor_dict_cache';
const ACTION_FLAGS_KEY = 'recipe_editor_action_flags';

// アクション単位のフラグ（allowsRules / hasPositionVariant / hasFromZones / hasDeckPosition）
// を localStorage で永続化。スプシ側に該当列が無くてもエディタ内では保持される。
type ActionFlags = Record<string, { allowsRules?: boolean; hasPositionVariant?: boolean; hasFromZones?: boolean; hasDeckPosition?: boolean }>;
function loadActionFlags(): ActionFlags {
  try { return JSON.parse(localStorage.getItem(ACTION_FLAGS_KEY) || '{}') || {}; }
  catch (_) { return {}; }
}
function saveActionFlags(flags: ActionFlags) {
  try { localStorage.setItem(ACTION_FLAGS_KEY, JSON.stringify(flags)); } catch (_) {}
}
function setActionFlagsForCode(code: string, patch: { allowsRules?: boolean; hasPositionVariant?: boolean; hasFromZones?: boolean; hasDeckPosition?: boolean }) {
  const all = loadActionFlags();
  all[code] = { ...(all[code] || {}), ...patch };
  saveActionFlags(all);
}

type DictKind = 'triggers' | 'conditions' | 'actions' | 'keywords' | 'options';

// スプシに無くても必ず表示する特殊トリガー
const REQUIRED_TRIGGERS: DictEntry[] = [
  { code: 'passive', kind: 'trigger', label: 'パッシブ' },
  { code: 'main', kind: 'trigger', label: 'メインフェイズ中' },
];

function ensureRequired(list: DictEntry[], required: DictEntry[]): DictEntry[] {
  const codes = new Set(list.map((e) => e.code));
  const missing = required.filter((r) => !codes.has(r.code));
  return [...list, ...missing];
}

// スプシ「効果辞書」の生データ → 種類別の DictEntry 配列に分類
function categorize(rows: any[]): { triggers: DictEntry[]; conditions: DictEntry[]; actions: DictEntry[]; keywords: DictEntry[]; options: DictEntry[] } {
  const triggers: DictEntry[] = [];
  const conditions: DictEntry[] = [];
  const actions: DictEntry[] = [];
  const keywords: DictEntry[] = [];
  const options: DictEntry[] = [];
  for (const r of rows) {
    const code = String(r['コード'] || '').trim();
    if (!code) continue;
    const kind = String(r['種類'] || '').trim();
    const label = String(r['表示名'] || '').trim() || code;
    const entry: DictEntry = {
      code,
      kind,
      label,
      description: String(r['説明'] || '').trim(),
      visualType: String(r['演出タイプ'] || '').trim() || undefined,
      visualCode: String(r['演出コード'] || '').trim() || undefined,
      autoManual: String(r['自動/手動'] || '').trim() || undefined,
      manualDesc: String(r['手動操作の内容'] || '').trim() || undefined,
      frameColor: String(r['枠色'] || '').trim() || undefined,
      valueLabel: String(r['数値の意味'] || '').trim() || undefined,
      logicCode: String(r['ロジックコード'] || '').trim() || undefined,
      recipeTemplate: String(r['キーワードレシピ'] || '').trim() || undefined,
      // ルール許可フラグ: スプシ「ルール許可」列に "1" / "true" / "yes" 等が入っていれば true
      allowsRules: (() => {
        const v = String(r['ルール許可'] || '').trim().toLowerCase();
        return v === '1' || v === 'true' || v === 'yes' || v === 'on';
      })(),
      // 位置指定フラグ: 「位置指定」列に "1"/"true" 等で 位置 pulldown を表示
      hasPositionVariant: (() => {
        const v = String(r['位置指定'] || '').trim().toLowerCase();
        return v === '1' || v === 'true' || v === 'yes' || v === 'on';
      })(),
      // 場所指定フラグ: 「場所指定」列に "1"/"true" 等で「場所」(取得元エリア) ボタンを表示
      hasFromZones: (() => {
        const v = String(r['場所指定'] || '').trim().toLowerCase();
        return v === '1' || v === 'true' || v === 'yes' || v === 'on';
      })(),
      // 上下指定フラグ: 「上下指定」列に "1"/"true" 等で「上/下」ボタンを表示
      hasDeckPosition: (() => {
        const v = String(r['上下指定'] || '').trim().toLowerCase();
        return v === '1' || v === 'true' || v === 'yes' || v === 'on';
      })(),
    };
    if (kind === 'trigger' || kind === 'continuous') triggers.push(entry);
    else if (kind === 'condition') conditions.push(entry);
    else if (kind === 'action') actions.push(entry);
    else if (kind === 'keyword') keywords.push(entry);
    else if (kind === 'option') options.push(entry);
  }
  return { triggers, conditions, actions, keywords, options };
}

function loadVisualTypes(): VisualTypeEntry[] {
  try {
    const raw = localStorage.getItem(VT_STORAGE_KEY);
    return raw ? JSON.parse(raw) || [] : [];
  } catch (_) { return []; }
}

function loadCachedDict() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) { return null; }
}

export interface DictAPI {
  triggers: DictEntry[];
  conditions: DictEntry[];
  actions: DictEntry[];
  keywords: DictEntry[];
  options: DictEntry[];
  visualTypes: VisualTypeEntry[];
  customVisualTypes: VisualTypeEntry[];
  loading: boolean;
  error: string;
  password: string;
  // CRUD operations (GAS同期)
  addEntry: (kind: DictKind, entry: DictEntry) => Promise<{ ok: boolean; msg?: string }>;
  updateEntry: (kind: DictKind, code: string, patch: Partial<DictEntry>) => Promise<{ ok: boolean; msg?: string }>;
  removeEntry: (kind: DictKind, code: string) => Promise<{ ok: boolean; msg?: string }>;
  refresh: () => Promise<void>;
  // 演出タイプ（ローカル管理）
  addVisualType: (vt: VisualTypeEntry) => boolean;
  updateVisualType: (code: string, vt: Partial<VisualTypeEntry>) => boolean;
  removeVisualType: (code: string) => void;
  // 互換（廃止予定）
  custom: { triggers: DictEntry[]; conditions: DictEntry[]; actions: DictEntry[]; keywords: DictEntry[]; options: DictEntry[] };
  exportJson: () => string;
  importJson: (json: string) => boolean;
  resetCustom: () => void;
}

export function useDict(password: string): DictAPI {
  const cached = loadCachedDict();
  const initial = cached
    ? { triggers: cached.triggers || [], conditions: cached.conditions || [], actions: cached.actions || [], keywords: cached.keywords || [], options: cached.options || [] }
    : { triggers: [], conditions: [], actions: [], keywords: [], options: [] };
  const [triggers, setTriggers] = useState<DictEntry[]>(initial.triggers);
  const [conditions, setConditions] = useState<DictEntry[]>(initial.conditions);
  const [actions, setActions] = useState<DictEntry[]>(initial.actions);
  const [keywords, setKeywords] = useState<DictEntry[]>(initial.keywords);
  const [options, setOptions] = useState<DictEntry[]>(initial.options);
  const [customVT, setCustomVT] = useState<VisualTypeEntry[]>(() => loadVisualTypes());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    localStorage.setItem(VT_STORAGE_KEY, JSON.stringify(customVT));
  }, [customVT]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await listDict();
      if (!r.ok) throw new Error(r.error || 'listDict failed');
      const cat = categorize(r.dict || []);
      setTriggers(cat.triggers);
      setConditions(cat.conditions);
      setActions(cat.actions);
      setKeywords(cat.keywords);
      setOptions(cat.options);
      // ローカルキャッシュ
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(cat));
      } catch (_) {}
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // 初回ロード
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 種類⇄シングル形式変換
  function kindToSingular(k: DictKind): string {
    return k === 'triggers' ? 'trigger'
      : k === 'conditions' ? 'condition'
      : k === 'actions' ? 'action'
      : k === 'options' ? 'option'
      : 'keyword';
  }

  const addEntry = useCallback(async (kind: DictKind, entry: DictEntry) => {
    if (!entry.code || !entry.label) return { ok: false, msg: 'コードと表示名は必須' };
    // 効果辞書の列形式に変換
    const row: Record<string, any> = {
      'コード': entry.code,
      '種類': kindToSingular(kind),
      '表示名': entry.label,
      '説明': entry.description || '',
      '演出タイプ': entry.visualType || '',
      '枠色': entry.frameColor || '',
      '演出コード': entry.visualCode || '',
      '自動/手動': entry.autoManual || '',
      '数値の意味': entry.valueLabel || '',
      '手動操作の内容': entry.manualDesc || '',
      'ロジックコード': entry.logicCode || '',
      'ルール許可': entry.allowsRules ? '1' : '',
      '位置指定': entry.hasPositionVariant ? '1' : '',
      '場所指定': entry.hasFromZones ? '1' : '',
      '上下指定': entry.hasDeckPosition ? '1' : '',
      'キーワードレシピ': entry.recipeTemplate || '',
    };
    const r = await apiAdd('dict', row, password);
    // アクションのフラグを localStorage に保存（スプシ側に列がなくてもエディタ内で保持）
    if (kind === 'actions' && entry.code) {
      setActionFlagsForCode(entry.code, {
        allowsRules: !!entry.allowsRules,
        hasPositionVariant: !!entry.hasPositionVariant,
        hasFromZones: !!entry.hasFromZones,
        hasDeckPosition: !!entry.hasDeckPosition,
      });
    }
    if (r.ok) await refresh();
    return { ok: !!r.ok, msg: r.error || '' };
  }, [password, refresh]);

  const updateEntry = useCallback(async (_kind: DictKind, code: string, patch: Partial<DictEntry>) => {
    // patch のキーをスプシ列名に変換
    const colMap: Record<string, string> = {
      label: '表示名',
      description: '説明',
      visualType: '演出タイプ',
      visualCode: '演出コード',
      autoManual: '自動/手動',
      manualDesc: '手動操作の内容',
      frameColor: '枠色',
      valueLabel: '数値の意味',
      logicCode: 'ロジックコード',
      recipeTemplate: 'キーワードレシピ',
    };
    const row: Record<string, any> = {};
    Object.keys(patch).forEach((k) => {
      const colName = colMap[k];
      if (colName) row[colName] = (patch as any)[k];
    });
    // allowsRules は boolean → '1' / '' の文字列で保存
    if (Object.prototype.hasOwnProperty.call(patch, 'allowsRules')) {
      row['ルール許可'] = (patch as any).allowsRules ? '1' : '';
      setActionFlagsForCode(code, { allowsRules: !!(patch as any).allowsRules });
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'hasPositionVariant')) {
      row['位置指定'] = (patch as any).hasPositionVariant ? '1' : '';
      setActionFlagsForCode(code, { hasPositionVariant: !!(patch as any).hasPositionVariant });
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'hasFromZones')) {
      row['場所指定'] = (patch as any).hasFromZones ? '1' : '';
      setActionFlagsForCode(code, { hasFromZones: !!(patch as any).hasFromZones });
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'hasDeckPosition')) {
      row['上下指定'] = (patch as any).hasDeckPosition ? '1' : '';
      setActionFlagsForCode(code, { hasDeckPosition: !!(patch as any).hasDeckPosition });
    }
    const r = await apiUpdate('dict', code, row, password);
    if (r.ok) await refresh();
    return { ok: !!r.ok, msg: r.error || '' };
  }, [password, refresh]);

  const removeEntry = useCallback(async (_kind: DictKind, code: string) => {
    const r = await apiRemove('dict', code, password);
    if (r.ok) await refresh();
    return { ok: !!r.ok, msg: r.error || '' };
  }, [password, refresh]);

  // 演出タイプ（ローカル）
  const addVisualType = useCallback((vt: VisualTypeEntry) => {
    if (!vt.code || !vt.label) return false;
    const all = [...DEFAULT_VISUAL_TYPES, ...customVT];
    if (all.some((x) => x.code === vt.code)) return false;
    setCustomVT((prev) => [...prev, vt]);
    return true;
  }, [customVT]);

  const updateVisualType = useCallback((code: string, patch: Partial<VisualTypeEntry>) => {
    let found = false;
    setCustomVT((prev) => prev.map((v) => {
      if (v.code === code) { found = true; return { ...v, ...patch }; }
      return v;
    }));
    return found;
  }, []);

  const removeVisualType = useCallback((code: string) => {
    setCustomVT((prev) => prev.filter((v) => v.code !== code));
  }, []);

  // 互換: exportJson / importJson / resetCustom（演出タイプのみ）
  const exportJson = useCallback(() => {
    return JSON.stringify({ customVisualTypes: customVT }, null, 2);
  }, [customVT]);
  const importJson = useCallback((json: string) => {
    try {
      const parsed = JSON.parse(json);
      if (parsed.customVisualTypes) setCustomVT(parsed.customVisualTypes);
      return true;
    } catch (_) { return false; }
  }, []);
  const resetCustom = useCallback(() => setCustomVT([]), []);

  // options はスプシ未登録ならローカル既定値で補完
  const mergedOptions = ensureRequired(options, DEFAULT_OPTIONS);
  // アクションフラグの強化:
  //  1. hardcoded（deck_open / deck_search）
  //  2. localStorage キャッシュ（スプシに列が無くても永続）
  const localFlags = loadActionFlags();
  const enhancedActions = actions.map((a) => {
    let merged = a;
    if (a.code === 'deck_open' || a.code === 'deck_search') {
      merged = a.allowsRules ? a : { ...a, allowsRules: true };
    }
    const local = localFlags[a.code];
    if (local) {
      merged = {
        ...merged,
        allowsRules: local.allowsRules !== undefined ? local.allowsRules : merged.allowsRules,
        hasPositionVariant: local.hasPositionVariant !== undefined ? local.hasPositionVariant : merged.hasPositionVariant,
        hasFromZones: local.hasFromZones !== undefined ? local.hasFromZones : merged.hasFromZones,
        hasDeckPosition: local.hasDeckPosition !== undefined ? local.hasDeckPosition : merged.hasDeckPosition,
      };
    }
    return merged;
  });
  return {
    triggers: ensureRequired(triggers, REQUIRED_TRIGGERS),
    conditions,
    actions: enhancedActions,
    keywords,
    options: mergedOptions,
    visualTypes: [...DEFAULT_VISUAL_TYPES, ...customVT],
    customVisualTypes: customVT,
    loading,
    error,
    password,
    addEntry,
    updateEntry,
    removeEntry,
    refresh,
    addVisualType,
    updateVisualType,
    removeVisualType,
    custom: { triggers: [], conditions: [], actions: [], keywords: [], options: [] },
    exportJson,
    importJson,
    resetCustom,
  };
}
