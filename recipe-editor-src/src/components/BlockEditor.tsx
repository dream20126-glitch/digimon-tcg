import { useState } from 'react';
import type { EffectBlock, ConditionPair, CostStep, MiniStep, DictEntry, AltAction, GrantedStep } from '../types';
import {
  SECTIONS,
  ZONES,
  LIMITS,
  DURATIONS,
  TARGETS,
  TARGET_COUNTS,
  TRIGGER_SUBJECTS,
  CONDITION_SUBJECTS,
  FROM_ZONES,
  REF_SUBJECTS,
} from '../dict';
import type { DictAPI } from '../useDict';
import { isActionImplemented, isKeywordImplemented, isConditionImplemented, isOptionImplemented } from '../implemented';
import { SearchSelect, type SelectOption } from './SearchSelect';
import { hasRuleTranslator } from '../ruleTranslator';

interface Props {
  block: EffectBlock;
  index: number;
  dict: DictAPI;
  onChange: (b: EffectBlock) => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

// 共通ヘルパ: code/label の配列 → SelectOption[]
function toOpts(arr: { code: string; label: string }[]): SelectOption[] {
  return arr.map((e) => ({ value: e.code, label: e.label }));
}

// 限定文字列の split/combine
// 'once_per_turn' → { type:'per_turn', count:1 }
// 'per_turn:2' → { type:'per_turn', count:2 }
// '' → { type:'', count:1 }
function splitLimit(s: string | undefined): { type: string; count: number } {
  if (!s) return { type: '', count: 1 };
  if (s === 'once_per_turn') return { type: 'per_turn', count: 1 };
  const m = s.match(/^per_turn:(\d+)$/);
  if (m) return { type: 'per_turn', count: parseInt(m[1], 10) };
  return { type: s.split(':')[0], count: 1 };
}
function combineLimit(type: string, count: number): string {
  if (!type) return '';
  if (type === 'per_turn') {
    return count === 1 ? 'once_per_turn' : 'per_turn:' + count;
  }
  return type;
}

export function BlockEditor({ block, index, dict, onChange, onRemove, onMoveUp, onMoveDown }: Props) {
  function update(key: keyof EffectBlock, value: any) {
    onChange({ ...block, [key]: value });
  }

  // アクションコード → 辞書エントリ（位置バリアント suffix を剥がしてベース code でも引ける）
  function findActionEntry(code: string) {
    if (!code) return undefined;
    const direct = dict.actions.find((a) => a.code === code);
    if (direct) return direct;
    const v = getActionVariant(code);
    if (v) return dict.actions.find((a) => a.code === v.base);
    return undefined;
  }

  // アクション変更時、新アクションが rules 非対応なら既存 rules をクリア
  function changeAction(newAction: string) {
    const next = { ...block, action: newAction };
    const dictEntry = findActionEntry(newAction);
    const allowsRules = !!(dictEntry && dictEntry.allowsRules) || hasRuleTranslator(newAction);
    if (!allowsRules && Array.isArray(block.rules) && block.rules.length > 0) {
      next.rules = [];
    }
    onChange(next);
  }

  // target は base + count の合成
  const tgtBase = (block.target || '').split(':')[0];
  const tgtSuffix = (block.target || '').substring(tgtBase.length);

  function setTarget(base: string, suffix: string) {
    if (!base) return update('target', '');
    update('target', base + (suffix || ''));
  }


  // 条件操作（発動条件）
  const conditions = block.conditions || [];
  function updateCondition(i: number, p: ConditionPair) {
    const next = conditions.slice();
    next[i] = p;
    update('conditions', next);
  }
  function addCondition() {
    update('conditions', [...conditions, { base: '', value: '' }]);
  }
  function removeCondition(i: number) {
    update('conditions', conditions.filter((_, idx) => idx !== i));
  }

  // ターゲットフィルタ操作（step.filter に serialize）
  const targetFilter = block.targetFilter || [];
  function updateTargetFilter(i: number, p: ConditionPair) {
    const next = targetFilter.slice();
    next[i] = p;
    update('targetFilter', next);
  }
  function addTargetFilter() {
    update('targetFilter', [...targetFilter, { base: '', value: '' }]);
  }
  function removeTargetFilter(i: number) {
    update('targetFilter', targetFilter.filter((_, idx) => idx !== i));
  }

  // トリガー条件操作（トリガー発火元カードへのフィルタ）
  const triggerConditions = block.triggerConditions || [];
  function updateTriggerCondition(i: number, p: ConditionPair) {
    const next = triggerConditions.slice();
    next[i] = p;
    update('triggerConditions', next);
  }
  function addTriggerCondition() {
    update('triggerConditions', [...triggerConditions, { base: '', value: '' }]);
  }
  function removeTriggerCondition(i: number) {
    update('triggerConditions', triggerConditions.filter((_, idx) => idx !== i));
  }

  // 修飾子操作（複数選択可）
  const opts = block.options || [];
  function toggleOption(code: string) {
    const next = opts.includes(code) ? opts.filter((o) => o !== code) : [...opts, code];
    update('options', next);
  }

  // ルール操作 (MiniStep[])
  const ruleSteps: MiniStep[] = block.rules || [];
  // メインアクションが rules 対応か判定（dict 由来の allowsRules または翻訳器あり）
  // 位置バリアント suffix が付いていてもベース code で辞書を引く
  const dictAction = findActionEntry(block.action || '');
  const actionAllowsRules = !!(dictAction && dictAction.allowsRules) || hasRuleTranslator(block.action);
  function setRuleSteps(next: MiniStep[]) { update('rules', next); }
  function addRuleStep() { setRuleSteps([...ruleSteps, { action: '' }]); }
  function updateRuleStep(i: number, patch: Partial<MiniStep>) {
    const next = ruleSteps.slice();
    next[i] = { ...next[i], ...patch };
    setRuleSteps(next);
  }
  function removeRuleStep(i: number) { setRuleSteps(ruleSteps.filter((_, j) => j !== i)); }
  function moveRuleStep(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= ruleSteps.length) return;
    const next = ruleSteps.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setRuleSteps(next);
  }

  // 代替アクション操作（OR / AND 結合）
  const altActions = block.altActions || [];
  const altOp = block.altActionsOp || 'or';
  function updateAltAction(i: number, patch: Partial<AltAction>) {
    const next = altActions.slice();
    next[i] = { ...next[i], ...patch };
    update('altActions', next);
  }
  function addAltAction() {
    update('altActions', [...altActions, { action: '', value: '', target: '', conditions: [], options: [], fromZones: [] }]);
  }
  function removeAltAction(i: number) {
    update('altActions', altActions.filter((_, idx) => idx !== i));
  }

  // 付与効果操作（grantedStep）
  const grantedStep: GrantedStep = block.grantedStep || { trigger: '', action: '', conditions: [], options: [] };
  function updateGrantedStep(patch: Partial<GrantedStep>) {
    onChange({ ...block, grantedStep: { ...grantedStep, ...patch } });
  }
  function clearGrantedStep() {
    onChange({ ...block, grantedStep: undefined });
  }

  // コスト操作
  const costs = block.costs || [];
  function updateCost(i: number, c: CostStep) {
    const next = costs.slice();
    next[i] = c;
    update('costs', next);
  }
  function addCost() {
    update('costs', [...costs, { action: '', value: '', target: '' }]);
  }
  function removeCost(i: number) {
    update('costs', costs.filter((_, idx) => idx !== i));
  }

  // === 折りたたみ state ===
  // 追加オプション（期間/取得元/修飾子/～ごとに/コスト/追加JSON）にデータがあれば展開
  const _hasActionExtras = !!(
    (block.options || []).length > 0 ||
    (block.fromZones || []).length > 0 ||
    (block.costs || []).length > 0 ||
    block.duration ||
    block.perCount ||
    block.extras
  );
  const [triggerCondsOpen, setTriggerCondsOpen] = useState<boolean>((block.triggerConditions || []).length > 0);

  return (
    <div className="block">
      <div className="block-header">
        <span className="order">効果ステップ {index + 1}</span>
        <span className="actions">
          {onMoveUp && <button onClick={onMoveUp}>↑</button>}
          {onMoveDown && <button onClick={onMoveDown}>↓</button>}
          <button className="danger" onClick={onRemove}>削除</button>
        </span>
      </div>

      <div className="block-grid">
        {/* === 上段: 区分 / 発動領域 / 限定 === */}
        <div style={{ gridColumn: '1 / span 2', display: 'grid', gridTemplateColumns: '1fr 1fr 1.5fr', gap: 8 }}>
          <div className="field">
            <label>区分 *</label>
            <SearchSelect
              value={block.section}
              onChange={(v) => update('section', v)}
              options={toOpts(SECTIONS)}
              required
            />
          </div>

          <div className="field">
            <label>発動領域</label>
            <SearchSelect
              value={block.zone || ''}
              onChange={(v) => update('zone', v)}
              options={toOpts(ZONES)}
            />
          </div>

          <div className="field">
            <label>限定</label>
            {(() => {
              const { type: limType, count: limCount } = splitLimit(block.limit);
              return (
                <div style={{ display: 'flex', gap: 4 }}>
                  <div style={{ flex: 2 }}>
                    <SearchSelect
                      value={limType}
                      onChange={(v) => update('limit', combineLimit(v, limCount))}
                      options={toOpts(LIMITS)}
                    />
                  </div>
                  <input
                    type="number"
                    min={1}
                    value={limType ? limCount : ''}
                    onChange={(e) => {
                      const n = Math.max(1, parseInt(e.target.value, 10) || 1);
                      update('limit', combineLimit(limType, n));
                    }}
                    disabled={!limType}
                    placeholder="回数"
                    style={{ flex: 1, padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12 }}
                  />
                </div>
              );
            })()}
          </div>
        </div>

        {/* === 🎬 トリガーグループ === */}
        {/* セキュリティ効果(区分=セキュリティ)は常に「セキュリティチェック時」に発動するため、
            トリガー/発動主体/タイミング等の入力は不要（内部的に trigger:'security' が自動設定される） */}
        {block.section === 'security' ? (
          <div style={{
            gridColumn: '1 / span 2', padding: 10, background: '#f0f9f0',
            border: '2px solid #93c693', borderRadius: 6,
            fontSize: 12, color: '#1a5a1a',
          }}>
            🔒 セキュリティ効果は「セキュリティでめくれたとき」に自動で発動します。トリガーの指定は不要です。
          </div>
        ) : block.trigger === 'alt_evolve' ? (
          <div style={{
            gridColumn: '1 / span 2', padding: 10, background: '#f0f9f0',
            border: '2px solid #93c693', borderRadius: 6,
            fontSize: 12, color: '#1a5a1a', lineHeight: 1.6,
          }}>
            🔄 <b>代替進化（進化条件を無視して進化できる）</b>は常時判定される特殊トリガーです。アクション/対象は不要（空のままでOK）。下の「🎯 発動条件」欄をこの意味で使います:
            <br />・<b>条件1</b> = この効果が有効になる条件（例:「自分のトラッシュがN枚以上」）
            <br />・<b>条件2</b> = 進化元（進化させたい元のデジモン）の絞り込み（例:「名前を含む: インプモン」）
            <br />・<b>値</b> = 無視して支払う進化コスト
          </div>
        ) : (
        <div style={{
          gridColumn: '1 / span 2',
          padding: 10,
          background: '#f0f9f0',
          border: '2px solid #93c693',
          borderRadius: 6,
        }}>
          <div style={{ fontWeight: 'bold', fontSize: 13, color: '#1a5a1a', marginBottom: 8 }}>
            🎬 トリガー（いつ発動するか）
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div className="field">
              <label>トリガー</label>
              <SearchSelect
                value={block.trigger}
                onChange={(v) => update('trigger', v)}
                options={toOpts(dict.triggers)}
                allowFreeText
              />
            </div>

            <div className="field">
              <label>発動主体</label>
              <SearchSelect
                value={block.triggerSubject || ''}
                onChange={(v) => update('triggerSubject', v)}
                options={toOpts(TRIGGER_SUBJECTS)}
              />
            </div>
          </div>

          {/* ⏱ タイミング・持続プリセット (トリガーグループ内に配置) */}
          <div style={{ marginTop: 8, background: '#fff3e0', padding: 8, borderRadius: 4, border: '1px solid #ffd591' }}>
            <div style={{ fontWeight: 'bold', color: '#b76e00', fontSize: 12 }}>
              ⏱ タイミング・持続プリセット
              <span style={{ fontSize: 10, fontWeight: 'normal', color: '#666', marginLeft: 6 }}>
                （【自分のターン】等を一発入力。トリガー or 発動条件のどちらに使うかで欄を分けています）
              </span>
            </div>

            {/* グループA: トリガーとして設定（持続/イベント・相互排他） */}
            <div style={{ marginTop: 6, padding: 6, background: 'white', borderRadius: 4, border: '1px solid #ffd591' }}>
              <div style={{ fontSize: 11, fontWeight: 'bold', color: '#b76e00', marginBottom: 4 }}>
                🎬 持続・イベント（トリガー欄を上書き・1つだけ選択可）
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
                {TIMING_PRESETS_TRIGGER.map((p) => (
                  <label key={p.code} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, cursor: 'pointer', userSelect: 'none' }}>
                    <input
                      type="checkbox"
                      checked={block.trigger === p.code}
                      onChange={(e) => update('trigger', e.target.checked ? p.code : '')}
                      style={{ margin: 0 }}
                    />
                    {p.label}
                  </label>
                ))}
              </div>
            </div>

            {/* グループB: 発動条件として追加（複数選択可・条件配列に cond_xxx を追加） */}
            <div style={{ marginTop: 6, padding: 6, background: 'white', borderRadius: 4, border: '1px solid #ffd591' }}>
              <div style={{ fontSize: 11, fontWeight: 'bold', color: '#b76e00', marginBottom: 4 }}>
                ❓ 発動条件として（🎯 発動条件に cond_xxx を追加・複数選択可）
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
                {TIMING_PRESETS_CONDITION.map((p) => {
                  const checked = !!conditions.find((c) => c.base === p.code);
                  return (
                    <label key={p.code} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, cursor: 'pointer', userSelect: 'none' }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            if (!conditions.find((c) => c.base === p.code)) {
                              update('conditions', [...conditions, { base: p.code, value: '' }]);
                            }
                          } else {
                            update('conditions', conditions.filter((c) => c.base !== p.code));
                          }
                        }}
                        style={{ margin: 0 }}
                      />
                      {p.label}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ☑ 条件を設定する（トリガー条件） */}
          <label style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
            marginTop: 10, fontWeight: 'bold', fontSize: 12, color: '#1a5a1a',
          }}>
            <input
              type="checkbox"
              checked={triggerCondsOpen}
              onChange={(e) => {
                setTriggerCondsOpen(e.target.checked);
                if (!e.target.checked && triggerConditions.length > 0) {
                  update('triggerConditions', []);
                }
              }}
            />
            ☑ 条件を設定する（トリガー条件・発火元カードへのフィルタ）
          </label>
          {triggerCondsOpen && (
            <div style={{ marginTop: 6 }}>
              <ConditionsHybridEditor
                conditions={triggerConditions}
                onChange={(next) => update('triggerConditions', next)}
                dict={dict}
                title="トリガー条件"
                hint="（このトリガーが発火する条件・トリガー発火元カードへのフィルタ）"
                theme="trigger"
                defaultSubject=""
                showAttackTargetRow={true}
              />
            </div>
          )}
        </div>
        )}

        {/* === ⚡ アクショングループ === */}
        <div style={{
          gridColumn: '1 / span 2',
          padding: 10,
          background: '#eff5fd',
          border: '2px solid #b9c8e0',
          borderRadius: 6,
        }}>
          <div style={{ fontWeight: 'bold', fontSize: 13, color: '#1976d2', marginBottom: 8 }}>
            ⚡ アクション（何をするか）
          </div>

          {block.trigger === 'alt_evolve' && (
            <div style={{ fontSize: 10, color: '#888', marginBottom: 6 }}>
              🔄 代替進化トリガーはアクション/対象を使いません。空のままで構いません。
            </div>
          )}

          {(() => {
          // アクションのグループ表示処理（_top/_bottom/_select 系を1エントリに）
          const { options: actionDisplayOptions, flaggedBases, autoGroupBases } = buildActionDisplay(dict.actions);
          const curVariant = getActionVariant(block.action || '');
          // 現在 block.action が「位置バリアント表示」の対象か判定
          // ケースA: block.action がフラグ付き base そのもの（例: "security_trash"）
          const isFlaggedBaseDirect = flaggedBases.has(block.action || '');
          // ケースB: block.action が <base>_<suffix> で base がフラグ付き or 自動グループ化対象
          const isVariantOfFlagged = !!(curVariant && (flaggedBases.has(curVariant.base) || autoGroupBases.has(curVariant.base)));
          const isPositional = isFlaggedBaseDirect || isVariantOfFlagged;

          // 表示用 value 正規化
          // - フラグ付き base 直: そのまま
          // - suffix 付き: 自動グループ化なら代表 code（autoGroupBases）、フラグ付き base なら base コード
          const normalizedActionValue = (() => {
            if (isFlaggedBaseDirect) return block.action || '';
            if (curVariant && flaggedBases.has(curVariant.base)) return curVariant.base;
            if (curVariant && autoGroupBases.has(curVariant.base)) return curVariant.base + '_top'; // 代表
            return block.action || '';
          })();

          // 位置 pulldown の選択肢（フラグ付き base は3種固定、autoGroup は dict にあるバリアントのみ）
          const variantOptions: SelectOption[] = (() => {
            if (!isPositional) return [];
            if (isFlaggedBaseDirect || (curVariant && flaggedBases.has(curVariant.base))) {
              // フラグ付き base: 3種固定
              return POSITION_VARIANTS.map((v) => ({ value: v.suffix, label: v.label }));
            }
            if (curVariant && autoGroupBases.has(curVariant.base)) {
              return POSITION_VARIANTS
                .filter((v) => dict.actions.some((a) => a.code === curVariant.base + v.suffix))
                .map((v) => ({ value: v.suffix, label: v.label }));
            }
            return [];
          })();
          // 現在の suffix 値
          const currentSuffix = (() => {
            if (curVariant) return curVariant.suffix;
            if (isFlaggedBaseDirect) return ''; // 未選択
            return '';
          })();

          function onActionPulldownChange(newCode: string) {
            const newIsFlaggedBase = flaggedBases.has(newCode);
            const newV = getActionVariant(newCode);
            const cur = block.action || '';
            const curV = getActionVariant(cur);

            // 同じ base なら何もしない（バリアント保持）
            const newBase = newIsFlaggedBase ? newCode : (newV ? newV.base : null);
            const curBase = curV ? curV.base : (flaggedBases.has(cur) ? cur : null);
            if (newBase && curBase && newBase === curBase) return;

            // フラグ付き base を新規選択 → デフォルト _top を付与
            if (newIsFlaggedBase) {
              changeAction(newCode + '_top');
              return;
            }
            // 自動グループ化の代表 code (newCode = base + '_top')
            changeAction(newCode);
          }
          function onVariantChange(newSuffix: string) {
            if (!newSuffix) return;
            // 現在の base を特定
            const base = isFlaggedBaseDirect ? (block.action || '') : (curVariant ? curVariant.base : '');
            if (!base) return;
            changeAction(base + newSuffix);
          }

          return (
            <div style={{
              display: 'grid',
              gridTemplateColumns: isPositional && variantOptions.length > 0 ? '2fr 1fr 1fr' : '2fr 1fr',
              gap: 8,
            }}>
              <div className="field">
                <label>
                  アクション
                  {block.action && (
                    isActionImplemented(block.action, dict.actions.find((a) => a.code === block.action)?.logicCode)
                      ? <span style={{ color: '#2e7d32', fontSize: 10, marginLeft: 6 }}>✅実装済</span>
                      : <span style={{ color: '#e65100', fontSize: 10, marginLeft: 6 }} title="エンジン未実装">⚠未実装</span>
                  )}
                </label>
                <SearchSelect
                  value={normalizedActionValue}
                  onChange={onActionPulldownChange}
                  options={actionDisplayOptions}
                  allowFreeText
                />
              </div>
              {/* 位置バリアント pulldown: フラグ駆動 or 自動グループ化時のみ */}
              {isPositional && variantOptions.length > 0 && (
                <div className="field">
                  <label>📍 位置</label>
                  <SearchSelect
                    value={currentSuffix}
                    onChange={onVariantChange}
                    options={variantOptions}
                  />
                </div>
              )}
              <div className="field">
                <label>値</label>
                <input
                  type="text"
                  value={block.value === undefined ? '' : String(block.value)}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '') update('value', undefined);
                    else if (/^\d+$/.test(v)) update('value', Number(v));
                    else update('value', v);
                  }}
                  placeholder={block.action === 'summon_token' ? 'トークンのカードNo (例: TK-01)' : '数値 (例: 1000)'}
                />
              </div>
            </div>
          );
        })()}

        {/* summon / summon_from_trash 専用: コストを支払わずに登場 / 登場時効果を発揮しない */}
        {(block.action === 'summon' || block.action === 'summon_from_trash') && (
          <div className="field" style={{ marginTop: 8, background: '#fff3e0', padding: 8, borderRadius: 4, border: '1px solid #ffd591' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: 'bold', color: '#b76e00' }}>
              <input
                type="checkbox"
                checked={!!block.costFree}
                onChange={(e) => update('costFree', e.target.checked)}
              />
              コストを支払わずに登場させる（cost_free）
            </label>
            <span style={{ fontSize: 10, color: '#666', marginLeft: 24 }}>
              対象「このデジモン(self)」「このカード(self_card)」の自己登場、または取得元(手札/トラッシュ)からの登場、どちらにも使えます
            </span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: 'bold', color: '#b76e00', marginTop: 6 }}>
              <input
                type="checkbox"
                checked={!!block.skipOnPlay}
                onChange={(e) => update('skipOnPlay', e.target.checked)}
              />
              この効果で登場したデジモンの【登場時】効果は発揮しない（skip_on_play）
            </label>
          </div>
        )}

        {/* memory_plus 専用: このターン終了時メモリー-N */}
        {block.action === 'memory_plus' && (
          <div className="field" style={{ marginTop: 8, background: '#eef4ff', padding: 8, borderRadius: 4, border: '1px solid #b3c8ff' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: 'bold', color: '#1a5fb4' }}>
              <input
                type="checkbox"
                checked={!!block.revertAtTurnEnd}
                onChange={(e) => update('revertAtTurnEnd', e.target.checked)}
              />
              このターン終了時にメモリーを-N（revert_at_turn_end）
            </label>
            <span style={{ fontSize: 10, color: '#666' }}>
              「メモリーを+Nする。このターン終了時、メモリーを-Nする。」のカード用（グラビティブレス / メタルグレイモン等）
            </span>
          </div>
        )}

        {/* 対象 / 対象数 (アクションのターゲット) */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
          <div className="field" style={{ background: '#fff8e6', padding: 6, borderRadius: 4, border: '1px solid #ffd591' }}>
            <label style={{ fontWeight: 'bold', color: '#b76e00' }}>
              🎯 アクションの対象
              <span style={{ fontSize: 10, fontWeight: 'normal', color: '#666', marginLeft: 6 }}>
                （このアクションが効果を与えるカード／デジモン）
              </span>
            </label>
            <SearchSelect
              value={tgtBase}
              onChange={(v) => setTarget(v, tgtSuffix)}
              options={toOpts(TARGETS)}
              allowFreeText
            />
          </div>
          <div className="field" style={{ background: '#fff8e6', padding: 6, borderRadius: 4, border: '1px solid #ffd591' }}>
            <label style={{ fontWeight: 'bold', color: '#b76e00' }}>
              🎯 アクションの対象数
              <span style={{ fontSize: 10, fontWeight: 'normal', color: '#666', marginLeft: 6 }}>
                （何体に適用するか・記述も可）
              </span>
            </label>
            <SearchSelect
              value={tgtSuffix}
              onChange={(v) => setTarget(tgtBase, v)}
              options={toOpts(TARGET_COUNTS)}
              allowFreeText
            />
          </div>
        </div>

        {/* === 🔍 ターゲットフィルタ（対象の直下・step.filter に出力） === */}
        <details className="field" style={{ marginTop: 8 }} open={targetFilter.length > 0}>
          <summary style={{ cursor: 'pointer', fontWeight: 'bold', padding: '4px 0', color: '#0d7377' }}>
            🔍 ターゲットフィルタ{targetFilter.length > 0 ? ` (${targetFilter.length})` : ''} <span style={{ fontSize: 10, fontWeight: 'normal', color: '#666' }}>step.filter に出力</span>
          </summary>
          <div style={{ border: '1px solid #b2dfdb', borderRadius: 4, background: '#e0f7f5', marginTop: 4, padding: 8 }}>
            <div style={{ fontSize: 10, color: '#555', marginBottom: 6 }}>
              対象カードの絞り込み条件（「レスト状態の」「進化元を持たない」「青の」等）
            </div>
            {/* よく使う状態（クイックチェックボックス） */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginBottom: 6, padding: '4px 6px', background: 'white', borderRadius: 3, border: '1px solid #b2dfdb' }}>
              {[
                { code: 'cond_self_rest',   label: 'レスト状態' },
                { code: 'cond_self_active', label: 'アクティブ状態' },
              ].map((f) => {
                const checked = targetFilter.some((c) => c.base === f.code);
                return (
                  <label key={f.code} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, cursor: 'pointer', userSelect: 'none' }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        if (e.target.checked) { if (!checked) update('targetFilter', [...targetFilter, { base: f.code, value: '' }]); }
                        else update('targetFilter', targetFilter.filter((c) => c.base !== f.code));
                      }}
                      style={{ margin: 0 }}
                    />
                    {f.label}
                  </label>
                );
              })}
            </div>
            <ConditionsHybridEditor
              conditions={targetFilter}
              onChange={(next) => update('targetFilter', next)}
              dict={dict}
              title="ターゲットフィルタ"
              hint="（対象カードの絞り込み条件・複数 AND）"
              theme="action"
              defaultSubject=""
              showSubjectSelector={false}
              supportsMultiValue={true}
            />
          </div>
        </details>

        {/* === 🎯 発動条件（常時表示・デフォルト折りたたみ・データあれば展開） === */}
        <details className="field" style={{ marginTop: 8 }} open={conditions.length > 0}>
          <summary style={{ cursor: 'pointer', fontWeight: 'bold', padding: '4px 0', color: '#1a4f8a' }}>
            🎯 発動条件{conditions.length > 0 ? ` (${conditions.length})` : ''}
          </summary>
          <div style={{ fontSize: 10, color: '#666', marginBottom: 4 }}>
            このカード自身やゲーム状況を確認する条件。対象カードを色/タイプで絞る場合は「ターゲットフィルタ」を使用
          </div>
          <ConditionsHybridEditor
            conditions={conditions}
            onChange={(next) => update('conditions', next)}
            dict={dict}
            title="発動条件"
            hint={
              block.trigger === 'alt_evolve'
                ? '（代替進化専用の意味: 条件1=発動条件 / 条件2=進化元の絞り込み・複数追加時は3個目以降は無視されます）'
                : '（このアクションを発動するために満たすべき条件・複数指定可・AND結合）'
            }
            theme="action"
            defaultSubject=""
          />
        </details>

        {/* === 📐 ルール（アクション直下に配置・メインアクションが対応している場合のみ） === */}
        {actionAllowsRules && (
          <div className="field" style={{ marginTop: 8 }}>
            <label>📐 ルール（メインアクションに紐づく追加処理）</label>
            <div style={{ fontSize: 11, color: '#666', marginBottom: 6 }}>
              💡 各ルール = メインアクションと同じ「アクション + 対象 + 値 + 条件」の構造。
              例（デッキオープン）: ルール「アクション=手札に加える / 値=1 / 条件: 色=緑, タイプ=デジモン」
            </div>
            <div style={{ border: '1px solid #d8e0f0', borderRadius: 4, padding: 8, background: '#f3f6fc' }}>
              {ruleSteps.length === 0 && (
                <div style={{ color: '#888', fontSize: 11, padding: '4px 0' }}>（ルール未追加）</div>
              )}
              {ruleSteps.map((rs, i) => (
                <RuleStepEditor
                  key={i}
                  index={i}
                  step={rs}
                  dict={dict}
                  onChange={(patch) => updateRuleStep(i, patch)}
                  onRemove={() => removeRuleStep(i)}
                  onUp={i > 0 ? () => moveRuleStep(i, -1) : undefined}
                  onDown={i < ruleSteps.length - 1 ? () => moveRuleStep(i, 1) : undefined}
                />
              ))}
              <button
                onClick={addRuleStep}
                style={{
                  padding: '4px 10px', border: '1px dashed #88a', background: 'white',
                  borderRadius: 3, cursor: 'pointer', fontSize: 12, color: '#3b6cd1', marginTop: 4,
                }}
              >
                ＋ ルールを追加
              </button>
            </div>
          </div>
        )}

        {/* === 🔀 代替アクション (OR / AND) === */}
        {/* 「〇〇するか〇〇する」「〇〇する＆〇〇する」の表現用 */}
        <details style={{ marginTop: 8 }} open={altActions.length > 0}>
          <summary style={{ cursor: 'pointer', fontWeight: 'bold', padding: '4px 0', fontSize: 12, color: '#9333ea' }}>
            🔀 代替アクション{altActions.length > 0 ? ` (${altActions.length}・${altOp.toUpperCase()})` : ''}
          </summary>
          <div style={{ padding: 8, border: '1px solid #d4b8f0', borderRadius: 4, background: '#faf5ff', marginTop: 4 }}>
            <div style={{ fontSize: 11, color: '#666', marginBottom: 6 }}>
              💡 メインアクションと組み合わせて使用。OR=プレイヤー選択 / AND=順次実行。
            </div>
            {/* 結合演算子切替 */}
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 6, fontSize: 11 }}>
              <span style={{ color: '#666' }}>結合:</span>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name={`altOp_${index}`}
                  checked={altOp === 'or'}
                  onChange={() => update('altActionsOp', 'or')}
                  style={{ margin: 0 }}
                />
                OR（〇〇するか〇〇する・選択）
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name={`altOp_${index}`}
                  checked={altOp === 'and'}
                  onChange={() => update('altActionsOp', 'and')}
                  style={{ margin: 0 }}
                />
                AND（〇〇する＆〇〇する・両方）
              </label>
            </div>
            {altActions.length === 0 && (
              <div style={{ color: '#888', fontSize: 11, padding: '4px 0' }}>（代替アクション未追加）</div>
            )}
            {altActions.map((a, i) => {
              const aTgtBase = (a.target || '').split(':')[0];
              const aTgtSuffix = (a.target || '').substring(aTgtBase.length);
              return (
                <div key={i} style={{ marginBottom: 6, padding: 6, border: '1px solid #d4b8f0', borderRadius: 4, background: 'white' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontWeight: 'bold', fontSize: 12, color: '#9333ea' }}>代替 {i + 1}</span>
                    <button
                      onClick={() => removeAltAction(i)}
                      style={{ padding: '0 6px', border: '1px solid #d33', color: '#d33', background: 'white', borderRadius: 3, cursor: 'pointer', fontSize: 10 }}
                    >
                      ✕ 削除
                    </button>
                  </div>
                  {/* アクション + 値 + 対象 + 対象数 */}
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 4 }}>
                    <div>
                      <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>アクション</div>
                      <SearchSelect
                        value={a.action}
                        onChange={(v) => updateAltAction(i, { action: v })}
                        options={toOpts(dict.actions)}
                        allowFreeText
                        placeholder="--アクション--"
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>値</div>
                      <input
                        type="text"
                        value={a.value === undefined ? '' : String(a.value)}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === '') updateAltAction(i, { value: undefined });
                          else if (/^\d+$/.test(v)) updateAltAction(i, { value: Number(v) });
                          else updateAltAction(i, { value: v });
                        }}
                        placeholder="値"
                        style={{ width: '100%', padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, boxSizing: 'border-box' }}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>対象</div>
                      <SearchSelect
                        value={aTgtBase}
                        onChange={(v) => updateAltAction(i, { target: v + (aTgtSuffix || '') })}
                        options={toOpts(TARGETS)}
                        allowFreeText
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>対象数</div>
                      <SearchSelect
                        value={aTgtSuffix}
                        onChange={(v) => updateAltAction(i, { target: aTgtBase + v })}
                        options={toOpts(TARGET_COUNTS)}
                        allowFreeText
                      />
                    </div>
                  </div>
                  {/* 取得元エリア（簡易・1件のみ select で OK） */}
                  <details style={{ marginTop: 4 }} open={(a.fromZones || []).length > 0}>
                    <summary style={{ cursor: 'pointer', fontSize: 11, color: '#9333ea', padding: '2px 0' }}>
                      📥 取得元エリア{(a.fromZones || []).length > 0 ? ` (${(a.fromZones || []).length})` : ''}
                    </summary>
                    {(() => {
                      const zones = a.fromZones || [];
                      const zop = a.fromZonesOp || 'or';
                      const avail = FROM_ZONES.filter((z) => !zones.includes(z.code));
                      return (
                        <div style={{ padding: 4, marginTop: 2, border: '1px solid #e9d5ff', borderRadius: 3, background: '#faf5ff' }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', minHeight: 22 }}>
                            {zones.length === 0 && <span style={{ color: '#888', fontSize: 11 }}>（指定なし）</span>}
                            {zones.map((zCode, zi) => {
                              const z = FROM_ZONES.find((x) => x.code === zCode);
                              return (
                                <span key={zCode} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', background: 'white', border: '1px solid #c4b5fd', borderRadius: 10, fontSize: 11 }}>
                                  {z ? z.label : zCode}
                                  <button
                                    onClick={() => updateAltAction(i, { fromZones: zones.filter((x) => x !== zCode) })}
                                    style={{ padding: '0 3px', border: 'none', background: 'transparent', color: '#d33', cursor: 'pointer' }}
                                  >✕</button>
                                  {zi < zones.length - 1 && (
                                    <span style={{ fontSize: 9, color: '#666', fontWeight: 'bold', marginLeft: 4 }}>{zop === 'and' ? 'AND' : 'OR'}</span>
                                  )}
                                </span>
                              );
                            })}
                          </div>
                          {avail.length > 0 && (
                            <select
                              value=""
                              onChange={(e) => { if (e.target.value) updateAltAction(i, { fromZones: [...zones, e.target.value] }); e.target.value = ''; }}
                              style={{ marginTop: 4, padding: '2px 4px', border: '1px dashed #c4b5fd', borderRadius: 3, fontSize: 11, background: 'white' }}
                            >
                              <option value="">＋ エリア追加...</option>
                              {avail.map((z) => <option key={z.code} value={z.code}>{z.label}</option>)}
                            </select>
                          )}
                        </div>
                      );
                    })()}
                  </details>
                  {/* 修飾子（簡易・チェックボックス） */}
                  {dict.options.length > 0 && (
                    <details style={{ marginTop: 4 }} open={(a.options || []).length > 0}>
                      <summary style={{ cursor: 'pointer', fontSize: 11, color: '#9333ea', padding: '2px 0' }}>
                        🛡 修飾子{(a.options || []).length > 0 ? ` (${(a.options || []).length})` : ''}
                      </summary>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: 4, marginTop: 2, background: '#faf5ff', borderRadius: 3, border: '1px solid #e9d5ff' }}>
                        {dict.options.map((o) => {
                          const arr = a.options || [];
                          const checked = arr.includes(o.code);
                          return (
                            <label key={o.code} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 11, padding: '1px 4px', border: checked ? '1px solid #9333ea' : '1px solid #d4b8f0', borderRadius: 8, background: checked ? '#ede4fb' : 'white', cursor: 'pointer' }}>
                              <input type="checkbox" checked={checked} onChange={() => {
                                const next = checked ? arr.filter((x) => x !== o.code) : [...arr, o.code];
                                updateAltAction(i, { options: next });
                              }} style={{ margin: 0 }} />
                              {o.label}
                            </label>
                          );
                        })}
                      </div>
                    </details>
                  )}
                  {/* ☑ 代わりに: ONにすると「条件成立時、メインの代わりに自動でこちらを実行」
                      という自動選択モードになる。OFF(未チェック)のままなら従来通り
                      プレイヤーが「🔀 どちらを実行しますか？」で手動選択するモード */}
                  {(() => {
                    const gateConds = a.gateConditions || [];
                    const gateEnabled = gateConds.length > 0;
                    return (
                      <div style={{ marginTop: 6, padding: 6, background: gateEnabled ? '#fff3e0' : '#faf5ff', borderRadius: 4, border: '1px solid #ffd591' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: 'bold', color: '#b76e00', fontSize: 12 }}>
                          <input
                            type="checkbox"
                            checked={gateEnabled}
                            onChange={(e) => updateAltAction(i, { gateConditions: e.target.checked ? [{ base: '', value: '' }] : [] })}
                          />
                          ☑ 代わりに（条件成立時、プレイヤーに確認せずメインの代わりに自動実行）
                        </label>
                        {!gateEnabled && (
                          <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>
                            未チェックの場合は従来通り「🔀 どちらを実行しますか？」でプレイヤーが手動選択します
                          </div>
                        )}
                        {gateEnabled && (
                          <div style={{ marginTop: 6 }}>
                            <ConditionsHybridEditor
                              conditions={gateConds}
                              onChange={(next) => updateAltAction(i, { gateConditions: next })}
                              dict={dict}
                              title="条件"
                              hint="（すべて成立している間だけ「代わりに」が有効・複数AND。対象選択のフィルタには使わない）"
                              theme="action"
                              defaultSubject=""
                            />
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {/* 条件: ハイブリッドエディタ（メインの発動条件と同UI） */}
                  <div style={{ marginTop: 6 }}>
                    <ConditionsHybridEditor
                      conditions={a.conditions || []}
                      onChange={(next) => updateAltAction(i, { conditions: next })}
                      dict={dict}
                      title="代替アクション条件"
                      hint="（この代替アクションを発動するための条件・複数 AND）"
                      theme="action"
                      defaultSubject=""
                      showSubjectSelector={false}
                    />
                  </div>
                  {/* ⚙ 期間・倍率（AND実行時の追加設定） */}
                  <details style={{ marginTop: 6 }} open={!!(a.duration || (a.perCount && a.perRef))}>
                    <summary style={{ cursor: 'pointer', fontSize: 11, color: '#9333ea', padding: '2px 0', fontWeight: 'bold' }}>
                      ⚙ 期間・倍率（AND実行時の追加設定）
                    </summary>
                    <div style={{ padding: 6, border: '1px solid #d4b8f0', borderRadius: 4, background: '#faf5ff', marginTop: 4 }}>
                      {/* 期間 */}
                      <div style={{ marginBottom: 6 }}>
                        <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>期間</div>
                        <SearchSelect
                          value={a.duration || ''}
                          onChange={(v) => updateAltAction(i, { duration: v })}
                          options={toOpts(DURATIONS)}
                        />
                      </div>
                      {/* ✖ ～ごとに */}
                      {(() => {
                        const isPerEnabled = !!(a.perCount && a.perRef);
                        const afArr = a.perRefFilter || [];
                        const PER_FILTER_CONDS: CommonCondDef[] = COMMON_CONDS.filter((c) =>
                          ['cond_color','cond_type','cond_lv','cond_lv_le','cond_lv_ge'].includes(c.code)
                        );
                        const isAFChecked = (code: string) => afArr.some((c) => c.base === code);
                        const getAFValue = (code: string) => { const c = afArr.find((cc) => cc.base === code); return c ? (c.value || '') : ''; };
                        const setAFChecked = (code: string, enabled: boolean) => {
                          if (enabled) { if (!isAFChecked(code)) updateAltAction(i, { perRefFilter: [...afArr, { base: code, value: '' }] }); }
                          else updateAltAction(i, { perRefFilter: afArr.filter((c) => c.base !== code) });
                        };
                        const setAFValue = (code: string, val: string) => {
                          const idx = afArr.findIndex((c) => c.base === code);
                          if (idx >= 0) { const next = afArr.slice(); next[idx] = { ...next[idx], value: val }; updateAltAction(i, { perRefFilter: next }); }
                          else updateAltAction(i, { perRefFilter: [...afArr, { base: code, value: val }] });
                        };
                        return (
                          <div>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11, fontWeight: 'bold', color: '#9333ea' }}>
                              <input
                                type="checkbox"
                                checked={isPerEnabled}
                                onChange={(e) => {
                                  if (e.target.checked) updateAltAction(i, { perCount: 1, perRef: 'opp_digimon' });
                                  else updateAltAction(i, { perCount: undefined, perRef: '' });
                                }}
                                style={{ margin: 0 }}
                              />
                              ✖ ～ごとに（倍率設定）
                            </label>
                            {isPerEnabled && (
                              <div style={{ marginTop: 6, padding: 6, background: 'white', borderRadius: 4, border: '1px solid #d4b8f0' }}>
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <input
                                      type="number" min={1}
                                      value={a.perCount || 1}
                                      onChange={(e) => updateAltAction(i, { perCount: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                                      style={{ width: 50, padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12 }}
                                    />
                                    <span style={{ fontSize: 11, color: '#555' }}>枚ごと、</span>
                                  </div>
                                  <div style={{ minWidth: 180 }}>
                                    <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>対象</div>
                                    <SearchSelect
                                      value={a.perRef || ''}
                                      onChange={(v) => updateAltAction(i, { perRef: v })}
                                      options={toOpts(REF_SUBJECTS)}
                                    />
                                  </div>
                                </div>
                                {/* 発動モード */}
                                <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '4px 6px', background: '#eaf0fb', borderRadius: 4, border: '1px solid #b3c8ff', fontSize: 11, marginBottom: 4 }}>
                                  <span style={{ color: '#1a4f8a', fontWeight: 'bold' }}>発動モード:</span>
                                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
                                    <input type="radio" name={`altPerMode_${index}_${i}`} checked={a.perCountMode !== 'repeat'} onChange={() => updateAltAction(i, { perCountMode: undefined })} style={{ margin: 0 }} />
                                    <span>○ 値×N</span>
                                  </label>
                                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
                                    <input type="radio" name={`altPerMode_${index}_${i}`} checked={a.perCountMode === 'repeat'} onChange={() => updateAltAction(i, { perCountMode: 'repeat' })} style={{ margin: 0 }} />
                                    <span>● N回発動</span>
                                  </label>
                                </div>
                                {/* 絞り込み */}
                                <div style={{ padding: 4, background: '#faf5ff', borderRadius: 4, border: '1px solid #d4b8f0' }}>
                                  <div style={{ fontSize: 10, fontWeight: 'bold', color: '#9333ea', marginBottom: 3 }}>🔍 絞り込み</div>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 10px', marginBottom: 3 }}>
                                    {PER_FILTER_CONDS.map((f) => (
                                      <label key={f.code} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 10, cursor: 'pointer' }}>
                                        <input type="checkbox" checked={isAFChecked(f.code)} onChange={(e) => setAFChecked(f.code, e.target.checked)} style={{ margin: 0 }} />
                                        {f.label}
                                      </label>
                                    ))}
                                  </div>
                                  {PER_FILTER_CONDS.some((f) => isAFChecked(f.code)) && (
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 4 }}>
                                      {PER_FILTER_CONDS.filter((f) => isAFChecked(f.code)).map((f) => (
                                        <div key={f.code}>
                                          <div style={{ fontSize: 9, color: '#555', marginBottom: 1 }}>{f.label}</div>
                                          {f.input === 'select' ? (
                                            <select value={getAFValue(f.code)} onChange={(e) => setAFValue(f.code, e.target.value)} style={{ padding: '2px 4px', border: '1px solid #ccc', borderRadius: 3, fontSize: 11, width: '100%' }}>
                                              {(f.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                            </select>
                                          ) : (
                                            <input type={f.input === 'number' ? 'number' : 'text'} value={getAFValue(f.code)} onChange={(e) => setAFValue(f.code, e.target.value)} style={{ padding: '2px 4px', border: '1px solid #ccc', borderRadius: 3, fontSize: 11, width: '100%', boxSizing: 'border-box' }} />
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </details>
                </div>
              );
            })}
            <button
              onClick={addAltAction}
              style={{ padding: '4px 10px', border: '1px dashed #9333ea', background: 'white', borderRadius: 3, cursor: 'pointer', fontSize: 11, color: '#9333ea', marginTop: 4 }}
            >
              ＋ 代替アクションを追加
            </button>
          </div>
        </details>

        {/* === 🎁 付与する効果（grant_effect 用ネスト） === */}
        {/* 「自分のデジモン全ては『【アタック時】〜』を得る」のような一時的トリガー効果付与の表現 */}
        <details style={{ marginTop: 8 }} open={!!block.grantedStep}>
          <summary style={{ cursor: 'pointer', fontWeight: 'bold', padding: '4px 0', fontSize: 12, color: '#0d9488' }}>
            🎁 付与する効果{block.grantedStep ? ' (有効)' : ''}
          </summary>
          <div style={{ padding: 8, border: '1px solid #5eead4', borderRadius: 4, background: '#f0fdfa', marginTop: 4 }}>
            <div style={{ fontSize: 11, color: '#666', marginBottom: 6 }}>
              💡 アクション=<code>grant_effect</code> 等で対象に付与するトリガー効果。例: 「【アタック時】相手DP-2000」
            </div>
            {/* 有効化トグル */}
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11, marginBottom: 8 }}>
              <input
                type="checkbox"
                checked={!!block.grantedStep}
                onChange={(e) => {
                  if (e.target.checked) {
                    onChange({ ...block, grantedStep: { trigger: 'on_attack', action: '', conditions: [], options: [] } });
                  } else {
                    clearGrantedStep();
                  }
                }}
              />
              <span>付与効果を有効化</span>
            </label>
            {block.grantedStep && (
              <>
                {/* 内側トリガー / アクション / 値 / 対象 / 期間 */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
                  <div>
                    <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>付与効果のトリガー</div>
                    <SearchSelect
                      value={grantedStep.trigger}
                      onChange={(v) => updateGrantedStep({ trigger: v })}
                      options={toOpts(dict.triggers)}
                      allowFreeText
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>付与効果のアクション</div>
                    <SearchSelect
                      value={grantedStep.action}
                      onChange={(v) => updateGrantedStep({ action: v })}
                      options={toOpts(dict.actions)}
                      allowFreeText
                    />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 6 }}>
                  <div>
                    <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>値</div>
                    <input
                      type="text"
                      value={grantedStep.value === undefined ? '' : String(grantedStep.value)}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === '') updateGrantedStep({ value: undefined });
                        else if (/^\d+$/.test(v)) updateGrantedStep({ value: Number(v) });
                        else updateGrantedStep({ value: v });
                      }}
                      placeholder="例: 2000"
                      style={{ width: '100%', padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>対象</div>
                    <SearchSelect
                      value={(grantedStep.target || '').split(':')[0]}
                      onChange={(v) => {
                        const suffix = (grantedStep.target || '').substring((grantedStep.target || '').split(':')[0].length);
                        updateGrantedStep({ target: v + (suffix || '') });
                      }}
                      options={toOpts(TARGETS)}
                      allowFreeText
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>対象数</div>
                    <SearchSelect
                      value={(grantedStep.target || '').substring((grantedStep.target || '').split(':')[0].length)}
                      onChange={(v) => {
                        const base = (grantedStep.target || '').split(':')[0];
                        updateGrantedStep({ target: base + v });
                      }}
                      options={toOpts(TARGET_COUNTS)}
                      allowFreeText
                    />
                  </div>
                </div>
                <div style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>付与効果の期間</div>
                  <SearchSelect
                    value={grantedStep.duration || ''}
                    onChange={(v) => updateGrantedStep({ duration: v })}
                    options={toOpts(DURATIONS)}
                  />
                </div>
                {/* 修飾子（簡易） */}
                {dict.options.length > 0 && (
                  <details style={{ marginBottom: 6 }} open={(grantedStep.options || []).length > 0}>
                    <summary style={{ cursor: 'pointer', fontSize: 11, color: '#0d9488', padding: '2px 0' }}>
                      🛡 修飾子{(grantedStep.options || []).length > 0 ? ` (${(grantedStep.options || []).length})` : ''}
                    </summary>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: 4, marginTop: 2, background: '#f0fdfa', borderRadius: 3, border: '1px solid #99f6e4' }}>
                      {dict.options.map((o) => {
                        const arr = grantedStep.options || [];
                        const checked = arr.includes(o.code);
                        return (
                          <label key={o.code} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 11, padding: '1px 4px', border: checked ? '1px solid #0d9488' : '1px solid #99f6e4', borderRadius: 8, background: checked ? '#ccfbf1' : 'white', cursor: 'pointer' }}>
                            <input type="checkbox" checked={checked} onChange={() => {
                              const next = checked ? arr.filter((x) => x !== o.code) : [...arr, o.code];
                              updateGrantedStep({ options: next });
                            }} style={{ margin: 0 }} />
                            {o.label}
                          </label>
                        );
                      })}
                    </div>
                  </details>
                )}
                {/* 内側条件 */}
                <ConditionsHybridEditor
                  conditions={grantedStep.conditions || []}
                  onChange={(next) => updateGrantedStep({ conditions: next })}
                  dict={dict}
                  title="付与効果の発動条件"
                  hint="（付与された効果が発動するための条件）"
                  theme="action"
                  defaultSubject=""
                  showSubjectSelector={false}
                />
              </>
            )}
          </div>
        </details>

        {/* ⚙ 追加オプション（期間・取得元・修飾子・～ごとに・コスト・追加JSON） */}
        <details style={{ marginTop: 10 }} open={_hasActionExtras}>
          <summary style={{ cursor: 'pointer', fontWeight: 'bold', fontSize: 12, color: '#1976d2', padding: '4px 0' }}>
            ⚙ 追加オプション（期間・取得元・修飾子・倍率・コスト・追加JSON）
          </summary>
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>

        <div className="field">
          <label>期間</label>
          <SearchSelect
            value={block.duration || ''}
            onChange={(v) => update('duration', v)}
            options={toOpts(DURATIONS)}
          />
        </div>

        <details className="field" open={!!(block.fromZones && block.fromZones.length > 0)}>
          <summary style={{ cursor: 'pointer', fontWeight: 'bold', padding: '4px 0' }}>
            📥 取得元エリア{block.fromZones && block.fromZones.length > 0 ? ` (${block.fromZones.length})` : ''}
          </summary>
          {(() => {
            const zones = block.fromZones || [];
            const op = block.fromZonesOp || 'or';
            const available = FROM_ZONES.filter((z) => !zones.includes(z.code));
            return (
              <div style={{ border: '1px solid #d8e0f0', borderRadius: 4, padding: 6, background: '#f3f6fc' }}>
                {/* 選択済みチップ群 + 結合演算子 */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', minHeight: 26 }}>
                  {zones.length === 0 && (
                    <span style={{ color: '#888', fontSize: 11 }}>（指定なし）</span>
                  )}
                  {zones.map((zCode, i) => {
                    const z = FROM_ZONES.find((x) => x.code === zCode);
                    const label = z ? z.label : zCode;
                    return (
                      <span key={zCode} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', background: 'white', border: '1px solid #88a', borderRadius: 12, fontSize: 11 }}>
                          {label}
                          <button
                            onClick={() => update('fromZones', zones.filter((x) => x !== zCode))}
                            style={{ padding: '0 4px', border: 'none', background: 'transparent', color: '#d33', cursor: 'pointer', fontSize: 11 }}
                            title="削除"
                          >
                            ✕
                          </button>
                        </span>
                        {i < zones.length - 1 && (
                          <span style={{ fontSize: 10, color: '#666', fontWeight: 'bold' }}>{op === 'and' ? 'AND' : 'OR'}</span>
                        )}
                      </span>
                    );
                  })}
                </div>
                {/* 追加プルダウン + 結合切替 */}
                <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
                  {available.length > 0 && (
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value) update('fromZones', [...zones, e.target.value]);
                        e.target.value = '';
                      }}
                      style={{ padding: '3px 6px', border: '1px dashed #88a', borderRadius: 3, fontSize: 11, background: 'white', cursor: 'pointer' }}
                    >
                      <option value="">＋ エリア追加...</option>
                      {available.map((z) => (
                        <option key={z.code} value={z.code}>{z.label}</option>
                      ))}
                    </select>
                  )}
                  {zones.length >= 2 && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                      <span style={{ color: '#666' }}>結合:</span>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 2, cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name={`fromZonesOp_${index}`}
                          checked={op === 'or'}
                          onChange={() => update('fromZonesOp', 'or')}
                          style={{ margin: 0 }}
                        />
                        OR（いずれか）
                      </label>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 2, cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name={`fromZonesOp_${index}`}
                          checked={op === 'and'}
                          onChange={() => update('fromZonesOp', 'and')}
                          style={{ margin: 0 }}
                        />
                        AND（全て）
                      </label>
                    </span>
                  )}
                </div>
              </div>
            );
          })()}
        </details>

        {/* ✖ ～ごとに（倍率設定）: 値 × floor(count / N) でスケーリング */}
        {(() => {
          // 旧形式 (own_rest_digimon 等) を subject + 状態cond に分解（読み込み時の互換）
          const decomposeRef = (ref: string): { subject: string; legacyState: string } => {
            switch (ref) {
              case 'own_rest_digimon':   return { subject: 'own_digimon', legacyState: 'cond_self_rest' };
              case 'own_active_digimon': return { subject: 'own_digimon', legacyState: 'cond_self_active' };
              case 'opp_rest_digimon':   return { subject: 'opp_digimon', legacyState: 'cond_self_rest' };
              case 'opp_active_digimon': return { subject: 'opp_digimon', legacyState: 'cond_self_active' };
              default: return { subject: ref || '', legacyState: '' };
            }
          };
          const { subject: legacySubject, legacyState } = decomposeRef(block.perRef || '');
          const refSubject = legacySubject;
          const isDigimonSubject = refSubject === 'own_digimon' || refSubject === 'opp_digimon';
          const isEnabled = !!(block.perCount && block.perRef);
          // 現在の状態 cond（perRefStateCond > legacyState の優先順）
          const currentStateCond: ConditionPair = block.perRefStateCond
            || (legacyState ? { base: legacyState, value: '' } : { base: '', value: '' });

          // 状態 pulldown 候補: dict.conditions のうちカード単体に適用できるものをフィルタ
          // 除外: cond_during_*_turn / cond_memory_* / cond_own_security_* / cond_opp_no_attack_* / cond_exists* 等
          const stateCondOptions: SelectOption[] = [
            { value: '', label: '状態問わず' },
            ...dict.conditions
              .filter((c) => {
                const code = c.code || '';
                if (/^cond_during_/.test(code)) return false;
                if (/^cond_memory_/.test(code)) return false;
                if (/^cond_own_security_/.test(code)) return false;
                if (/^cond_opp_no_attack/.test(code)) return false;
                if (code === 'cond_exists' || code === 'cond_opp_exists' || code === 'cond_own_exists' || code === 'cond_exists_count_ge') return false;
                if (code === 'cond_evolved_this_turn' || code === 'cond_rest_count_ge' || code === 'cond_battle_win') return false;
                return true;
              })
              .map((c) => ({ value: c.code, label: c.label || c.code })),
          ];

          function setSubject(newSubject: string) {
            // 2フィールド同時更新: update を2回呼ぶと古い block 参照で2回目が1回目を上書きするため
            // onChange でまとめて反映する
            const isDigimonRef = (newSubject === 'own_digimon' || newSubject === 'opp_digimon');
            onChange({
              ...block,
              perRef: newSubject,
              // 非デジモン系: 状態をクリア（card-state は意味薄）
              perRefStateCond: isDigimonRef ? block.perRefStateCond : undefined,
            });
          }
          function setStateBase(newBase: string) {
            // 同じく 2フィールド (perRefStateCond + perRef のlegacy正規化) を1回でまとめて更新
            const newStateCond = newBase
              ? { base: newBase, value: currentStateCond.value || '' }
              : undefined;
            let nextPerRef = block.perRef;
            if (block.perRef === 'own_rest_digimon' || block.perRef === 'own_active_digimon') {
              nextPerRef = 'own_digimon';
            } else if (block.perRef === 'opp_rest_digimon' || block.perRef === 'opp_active_digimon') {
              nextPerRef = 'opp_digimon';
            }
            onChange({ ...block, perRefStateCond: newStateCond, perRef: nextPerRef });
          }
          function setStateValue(newValue: string) {
            if (!currentStateCond.base) return;
            update('perRefStateCond', { base: currentStateCond.base, value: newValue });
          }

          return (
            <div className="field" style={{ gridColumn: '1 / span 2' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={isEnabled}
                  onChange={(e) => {
                    // 2フィールドを同時更新する必要があるため、update を2回呼ばず onChange でまとめる
                    if (e.target.checked) {
                      onChange({
                        ...block,
                        perCount: block.perCount || 1,
                        perRef: block.perRef || 'opp_digimon',
                      });
                    } else {
                      onChange({
                        ...block,
                        perCount: undefined,
                        perRef: '',
                      });
                    }
                  }}
                />
                <b>✖ ～ごとに（倍率設定）</b>
                <span style={{ fontSize: 10, fontWeight: 'normal', color: '#666' }}>
                  （指定対象を数えて 値 × その数 を掛ける、または N 回発動）
                </span>
              </label>
              {isEnabled && (
                <div style={{ marginTop: 6, padding: 8, background: '#f3f6fc', borderRadius: 4, border: '1px solid #c5d4ea' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input
                        type="number"
                        min={1}
                        value={block.perCount || 1}
                        onChange={(e) => update('perCount', Math.max(1, parseInt(e.target.value, 10) || 1))}
                        style={{ width: 50, padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12 }}
                      />
                      <span style={{ fontSize: 11, color: '#555' }}>枚ごと、</span>
                    </div>
                    {/* 対象プルダウン */}
                    <div style={{ minWidth: 200 }}>
                      <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>対象</div>
                      <SearchSelect
                        value={refSubject}
                        onChange={setSubject}
                        options={toOpts(REF_SUBJECTS)}
                      />
                    </div>
                    {/* 状態プルダウン: デジモン系のみ表示。dict.conditions から動的に選択肢生成 */}
                    {isDigimonSubject && (
                      <div style={{ minWidth: 200 }}>
                        <div style={{ fontSize: 10, color: '#555', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                          状態（条件）
                          {currentStateCond.base && (
                            isConditionImplemented(currentStateCond.base)
                              ? <span style={{ color: '#2e7d32', fontSize: 9 }}>✅</span>
                              : <span style={{ color: '#e65100', fontSize: 9 }} title="エンジン未実装">⚠</span>
                          )}
                          <span style={{ marginLeft: 'auto', fontSize: 9, color: '#888' }}>辞書の条件を流用</span>
                        </div>
                        <SearchSelect
                          value={currentStateCond.base}
                          onChange={setStateBase}
                          options={stateCondOptions}
                          allowFreeText
                        />
                        {/* 値が必要な条件（cond_lv_le など）の値入力 */}
                        {currentStateCond.base && (
                          <input
                            type="text"
                            value={currentStateCond.value || ''}
                            onChange={(e) => setStateValue(e.target.value)}
                            placeholder="値（必要な場合・例: 5）"
                            style={{ marginTop: 4, padding: '3px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, width: '100%', boxSizing: 'border-box' }}
                          />
                        )}
                      </div>
                    )}
                    <span style={{ fontSize: 10, color: '#666', alignSelf: 'flex-end', paddingBottom: 4 }}>
                      を数える
                    </span>
                  </div>
                  {/* 発動モード: 値×N か N回発動か */}
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 8, padding: '6px 8px', background: '#eaf0fb', borderRadius: 4, border: '1px solid #b3c8ff', fontSize: 11 }}>
                    <span style={{ color: '#1a4f8a', fontWeight: 'bold', whiteSpace: 'nowrap' }}>発動モード:</span>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name={`perCountMode_${index}`}
                        checked={block.perCountMode !== 'repeat'}
                        onChange={() => update('perCountMode', undefined)}
                        style={{ margin: 0 }}
                      />
                      <span>値 × N（合計）</span>
                      <span style={{ color: '#888', fontSize: 10 }}>例: DP-4000×2体=-8000</span>
                    </label>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name={`perCountMode_${index}`}
                        checked={block.perCountMode === 'repeat'}
                        onChange={() => update('perCountMode', 'repeat')}
                        style={{ margin: 0 }}
                      />
                      <span style={{ fontWeight: block.perCountMode === 'repeat' ? 'bold' : 'normal', color: block.perCountMode === 'repeat' ? '#1a4f8a' : 'inherit' }}>N 回発動</span>
                      <span style={{ color: '#888', fontSize: 10 }}>例: DP-4000 を2回（対象を毎回選べる）</span>
                    </label>
                  </div>
                  {/* フィルタ: カウント時に追加で絞り込み（COMMON_CONDS と項目共通） */}
                  {(() => {
                    // 発動条件と同じ COMMON_CONDS を共有（項目統一）
                    const FILTER_FIELDS: CommonCondDef[] = COMMON_CONDS;
                    const filterArr = block.perRefFilter || [];
                    const isFilterChecked = (code: string) => filterArr.some((c) => c.base === code);
                    const getFilterValue = (code: string) => {
                      const c = filterArr.find((cc) => cc.base === code);
                      return c ? (c.value || '') : '';
                    };
                    const setFilterChecked = (code: string, enabled: boolean) => {
                      if (enabled) {
                        if (!isFilterChecked(code)) {
                          update('perRefFilter', [...filterArr, { base: code, value: '' }]);
                        }
                      } else {
                        update('perRefFilter', filterArr.filter((c) => c.base !== code));
                      }
                    };
                    const setFilterValue = (code: string, val: string) => {
                      const i = filterArr.findIndex((c) => c.base === code);
                      if (i >= 0) {
                        const next = filterArr.slice();
                        next[i] = { ...next[i], value: val };
                        update('perRefFilter', next);
                      } else {
                        update('perRefFilter', [...filterArr, { base: code, value: val }]);
                      }
                    };
                    return (
                      <div style={{ marginTop: 8, padding: 6, background: 'white', borderRadius: 4, border: '1px solid #c5d4ea' }}>
                        <div style={{ fontSize: 11, fontWeight: 'bold', color: '#1976d2', marginBottom: 4 }}>
                          🔍 さらに絞り込み（チェックで有効化・複数で AND）
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
                          {FILTER_FIELDS.map((f) => (
                            <label key={f.code} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={isFilterChecked(f.code)}
                                onChange={(e) => setFilterChecked(f.code, e.target.checked)}
                                style={{ margin: 0 }}
                              />
                              {f.label}
                            </label>
                          ))}
                        </div>
                        {FILTER_FIELDS.some((f) => isFilterChecked(f.code)) && (
                          <div style={{ marginTop: 6, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 6 }}>
                            {FILTER_FIELDS.filter((f) => isFilterChecked(f.code)).map((f) => (
                              <div key={f.code}>
                                <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>{f.label}</div>
                                {f.input === 'select' ? (
                                  <select
                                    value={getFilterValue(f.code)}
                                    onChange={(e) => setFilterValue(f.code, e.target.value)}
                                    style={{ padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, width: '100%' }}
                                  >
                                    {(f.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                  </select>
                                ) : f.input === 'number' ? (
                                  <input
                                    type="number"
                                    value={getFilterValue(f.code)}
                                    onChange={(e) => setFilterValue(f.code, e.target.value)}
                                    style={{ padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, width: '100%', boxSizing: 'border-box' }}
                                  />
                                ) : (
                                  <input
                                    type="text"
                                    value={getFilterValue(f.code)}
                                    onChange={(e) => setFilterValue(f.code, e.target.value)}
                                    style={{ padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, width: '100%', boxSizing: 'border-box' }}
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })()}

        {/* コスト: 「〇〇することで」を表現 */}
        <div className="field" style={{ gridColumn: '1 / span 2' }}>
          <label>コスト（「〇〇することで」発動）</label>
          {costs.length === 0 && (
            <div style={{ color: '#888', fontSize: 11, padding: '4px 0' }}>コストなし</div>
          )}
          {costs.map((c, i) => {
            // コストアクションにも位置指定対応（フラグ駆動 + 自動グループ化）
            const { options: costActionOptions, flaggedBases: costFlaggedBases, autoGroupBases: costAutoGroupBases } = buildActionDisplay(dict.actions);
            const costCurVariant = getActionVariant(c.action || '');
            const costIsFlaggedBaseDirect = costFlaggedBases.has(c.action || '');
            const costIsVariantOfFlagged = !!(costCurVariant && (costFlaggedBases.has(costCurVariant.base) || costAutoGroupBases.has(costCurVariant.base)));
            const costIsPositional = costIsFlaggedBaseDirect || costIsVariantOfFlagged;

            const costNormalizedActionValue = (() => {
              if (costIsFlaggedBaseDirect) return c.action || '';
              if (costCurVariant && costFlaggedBases.has(costCurVariant.base)) return costCurVariant.base;
              if (costCurVariant && costAutoGroupBases.has(costCurVariant.base)) return costCurVariant.base + '_top';
              return c.action || '';
            })();

            const costVariantOptions: SelectOption[] = (() => {
              if (!costIsPositional) return [];
              if (costIsFlaggedBaseDirect || (costCurVariant && costFlaggedBases.has(costCurVariant.base))) {
                return POSITION_VARIANTS.map((v) => ({ value: v.suffix, label: v.label }));
              }
              if (costCurVariant && costAutoGroupBases.has(costCurVariant.base)) {
                return POSITION_VARIANTS
                  .filter((v) => dict.actions.some((a) => a.code === costCurVariant.base + v.suffix))
                  .map((v) => ({ value: v.suffix, label: v.label }));
              }
              return [];
            })();
            const costCurrentSuffix = costCurVariant ? costCurVariant.suffix : '';

            function onCostActionChange(newCode: string) {
              const newIsFlaggedBase = costFlaggedBases.has(newCode);
              const newV = getActionVariant(newCode);
              const cur = c.action || '';
              const curV = getActionVariant(cur);
              const newBase = newIsFlaggedBase ? newCode : (newV ? newV.base : null);
              const curBase = curV ? curV.base : (costFlaggedBases.has(cur) ? cur : null);
              if (newBase && curBase && newBase === curBase) return;
              if (newIsFlaggedBase) {
                updateCost(i, { ...c, action: newCode + '_top' });
                return;
              }
              updateCost(i, { ...c, action: newCode });
            }
            function onCostVariantChange(newSuffix: string) {
              if (!newSuffix) return;
              const base = costIsFlaggedBaseDirect ? (c.action || '') : (costCurVariant ? costCurVariant.base : '');
              if (!base) return;
              updateCost(i, { ...c, action: base + newSuffix });
            }

            return (
              <div key={i} style={{ marginBottom: 6, padding: 6, border: '1px solid #ffe0b2', borderRadius: 4, background: '#fffbe6' }}>
                <div style={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
                  <div style={{ flex: 2 }}>
                    <SearchSelect
                      value={costNormalizedActionValue}
                      onChange={onCostActionChange}
                      options={costActionOptions}
                      allowFreeText
                      placeholder="--コストアクション--"
                    />
                    {/* 📍 位置 pulldown: フラグ付き or 自動グループ時のみ */}
                    {costIsPositional && costVariantOptions.length > 0 && (
                      <div style={{ marginTop: 2 }}>
                        <SearchSelect
                          value={costCurrentSuffix}
                          onChange={onCostVariantChange}
                          options={costVariantOptions}
                          placeholder="📍 位置"
                        />
                      </div>
                    )}
                  </div>
                  <input
                    type="text"
                    value={c.value === undefined ? '' : String(c.value)}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '') updateCost(i, { ...c, value: undefined });
                      else if (/^\d+$/.test(v)) updateCost(i, { ...c, value: Number(v) });
                      else updateCost(i, { ...c, value: v });
                    }}
                    placeholder="値（枚数等）"
                    style={{ flex: 1, padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12 }}
                  />
                  <div style={{ flex: 1.5 }}>
                    <SearchSelect
                      value={(c.target || '').split(':')[0]}
                      onChange={(v) => updateCost(i, { ...c, target: v })}
                      options={toOpts(TARGETS)}
                      allowFreeText
                      placeholder="--対象--"
                    />
                  </div>
                  <button
                    onClick={() => removeCost(i)}
                    style={{
                      padding: '0 8px',
                      border: '1px solid #d33',
                      color: '#d33',
                      background: 'white',
                      borderRadius: 3,
                      cursor: 'pointer',
                      height: 26,
                    }}
                  >
                    ✕
                  </button>
                </div>

                {/* === コスト対象の取得元エリア === */}
                {(() => {
                  const czones = c.fromZones || [];
                  const cop = c.fromZonesOp || 'or';
                  const cAvailable = FROM_ZONES.filter((z) => !czones.includes(z.code));
                  return (
                    <div style={{ marginTop: 6, padding: 6, background: '#f3f6fc', borderRadius: 4, border: '1px solid #d8e0f0' }}>
                      <div style={{ fontSize: 11, fontWeight: 'bold', color: '#1976d2', marginBottom: 4 }}>
                        📥 取得元エリア{czones.length > 0 ? ` (${czones.length})` : ''}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', minHeight: 26 }}>
                        {czones.length === 0 && (
                          <span style={{ color: '#888', fontSize: 11 }}>（指定なし）</span>
                        )}
                        {czones.map((zCode, zi) => {
                          const z = FROM_ZONES.find((x) => x.code === zCode);
                          const label = z ? z.label : zCode;
                          return (
                            <span key={zCode} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', background: 'white', border: '1px solid #88a', borderRadius: 12, fontSize: 11 }}>
                                {label}
                                <button
                                  onClick={() => updateCost(i, { ...c, fromZones: czones.filter((x) => x !== zCode) })}
                                  style={{ padding: '0 4px', border: 'none', background: 'transparent', color: '#d33', cursor: 'pointer', fontSize: 11 }}
                                  title="削除"
                                >
                                  ✕
                                </button>
                              </span>
                              {zi < czones.length - 1 && (
                                <span style={{ fontSize: 10, color: '#666', fontWeight: 'bold' }}>{cop === 'and' ? 'AND' : 'OR'}</span>
                              )}
                            </span>
                          );
                        })}
                      </div>
                      <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
                        {cAvailable.length > 0 && (
                          <select
                            value=""
                            onChange={(e) => {
                              if (e.target.value) updateCost(i, { ...c, fromZones: [...czones, e.target.value] });
                              e.target.value = '';
                            }}
                            style={{ padding: '3px 6px', border: '1px dashed #88a', borderRadius: 3, fontSize: 11, background: 'white', cursor: 'pointer' }}
                          >
                            <option value="">＋ エリア追加...</option>
                            {cAvailable.map((z) => (
                              <option key={z.code} value={z.code}>{z.label}</option>
                            ))}
                          </select>
                        )}
                        {czones.length >= 2 && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                            <span style={{ color: '#666' }}>結合:</span>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 2, cursor: 'pointer' }}>
                              <input
                                type="radio"
                                name={`costFromOp_${index}_${i}`}
                                checked={cop === 'or'}
                                onChange={() => updateCost(i, { ...c, fromZonesOp: 'or' })}
                                style={{ margin: 0 }}
                              />
                              OR
                            </label>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 2, cursor: 'pointer' }}>
                              <input
                                type="radio"
                                name={`costFromOp_${index}_${i}`}
                                checked={cop === 'and'}
                                onChange={() => updateCost(i, { ...c, fromZonesOp: 'and' })}
                                style={{ margin: 0 }}
                              />
                              AND
                            </label>
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* === コスト対象の絞り込み条件 (チェックボックス・複数AND) === */}
                {(() => {
                  const condArr = c.conditions || [];
                  const isCondChecked = (code: string) => condArr.some((cc) => cc.base === code);
                  const getCondValue = (code: string) => {
                    const cc = condArr.find((x) => x.base === code);
                    return cc ? (cc.value || '') : '';
                  };
                  const setCondChecked = (code: string, enabled: boolean) => {
                    if (enabled) {
                      if (!isCondChecked(code)) {
                        updateCost(i, { ...c, conditions: [...condArr, { base: code, value: '' }] });
                      }
                    } else {
                      updateCost(i, { ...c, conditions: condArr.filter((x) => x.base !== code) });
                    }
                  };
                  const setCondValue = (code: string, val: string) => {
                    const idx = condArr.findIndex((x) => x.base === code);
                    if (idx >= 0) {
                      const next = condArr.slice();
                      next[idx] = { ...next[idx], value: val };
                      updateCost(i, { ...c, conditions: next });
                    } else {
                      updateCost(i, { ...c, conditions: [...condArr, { base: code, value: val }] });
                    }
                  };
                  return (
                    <div style={{ marginTop: 6, padding: 6, background: 'white', borderRadius: 4, border: '1px solid #ffe0b2' }}>
                      <div style={{ fontSize: 11, fontWeight: 'bold', color: '#b76e00', marginBottom: 4 }}>
                        🔍 コスト対象の絞り込み（チェックで有効化・複数で AND）
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
                        {COMMON_CONDS.map((f) => (
                          <label key={f.code} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, cursor: 'pointer', userSelect: 'none' }}>
                            <input
                              type="checkbox"
                              checked={isCondChecked(f.code)}
                              onChange={(e) => setCondChecked(f.code, e.target.checked)}
                              style={{ margin: 0 }}
                            />
                            {f.label}
                          </label>
                        ))}
                      </div>
                      {COMMON_CONDS.some((f) => isCondChecked(f.code)) && (
                        <div style={{ marginTop: 6, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 6 }}>
                          {COMMON_CONDS.filter((f) => isCondChecked(f.code)).map((f) => (
                            <div key={f.code}>
                              <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>{f.label}</div>
                              {f.input === 'select' ? (
                                <select
                                  value={getCondValue(f.code)}
                                  onChange={(e) => setCondValue(f.code, e.target.value)}
                                  style={{ padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, width: '100%' }}
                                >
                                  {(f.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                              ) : f.input === 'number' ? (
                                <input
                                  type="number"
                                  value={getCondValue(f.code)}
                                  onChange={(e) => setCondValue(f.code, e.target.value)}
                                  style={{ padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, width: '100%', boxSizing: 'border-box' }}
                                />
                              ) : (
                                <input
                                  type="text"
                                  value={getCondValue(f.code)}
                                  onChange={(e) => setCondValue(f.code, e.target.value)}
                                  style={{ padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, width: '100%', boxSizing: 'border-box' }}
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })}
          <button
            onClick={addCost}
            style={{
              padding: '4px 8px',
              border: '1px dashed #f9a825',
              background: 'white',
              borderRadius: 3,
              cursor: 'pointer',
              fontSize: 11,
              marginTop: 2,
              color: '#e65100',
            }}
          >
            ＋ コストを追加
          </button>
        </div>

        {/* 修飾子: 「コストを支払わず」「裏向きで」等。複数選択可 */}
        <details className="field" open={(block.options || []).length > 0} style={{ gridColumn: '1 / span 2' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 'bold', padding: '4px 0' }}>
            🛡 修飾子{(block.options || []).length > 0 ? ` (${block.options!.length})` : ''}
          </summary>
          <label style={{ fontSize: 11, color: '#666' }}>（複数選択可・アクションの実行方法を変える）</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: 6, border: '1px solid #d8e0f0', borderRadius: 4, background: '#f3f6fc' }}>
            {dict.options.length === 0 && (
              <div style={{ color: '#888', fontSize: 11 }}>修飾子辞書が空です</div>
            )}
            {dict.options.map((o) => {
              const checked = opts.includes(o.code);
              const implemented = isOptionImplemented(o.code, o.logicCode);
              return (
                <label
                  key={o.code}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '3px 8px',
                    border: checked ? '1px solid #3b6cd1' : '1px solid #c5cfe0',
                    borderRadius: 12,
                    background: checked ? '#dde7fb' : 'white',
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleOption(o.code)}
                    style={{ margin: 0 }}
                  />
                  <span>{o.label}</span>
                  {implemented
                    ? <span style={{ color: '#2e7d32', fontSize: 10 }}>✅</span>
                    : <span style={{ color: '#e65100', fontSize: 10 }} title="エンジン未実装">⚠</span>}
                </label>
              );
            })}
          </div>
          {opts.length > 0 && (
            <div style={{ fontSize: 10, color: '#666', marginTop: 4 }}>
              選択中: {opts.join(', ')}
            </div>
          )}
        </details>

        {/* 追加JSON: 通常は使わないが、特殊ネスト構造の手動入力用に残す */}
        <details className="field" open={!!block.extras}>
          <summary style={{ cursor: 'pointer', fontWeight: 'bold', padding: '4px 0' }}>
            📜 追加JSON（特殊なネスト構造のみ・上級者向け）
          </summary>
          <textarea
            value={block.extras || ''}
            onChange={(e) => update('extras', e.target.value)}
            rows={2}
            placeholder='例: {"some_special_nested_field":...}'
          />
        </details>

        </div>
        </details>
        </div>
        {/* === アクショングループここまで === */}

        {/* === キーワード（最下段） === */}
        <div className="field" style={{ gridColumn: '1 / span 2' }}>
          <label>
            キーワード（passive / grant_keyword 用）
            {block.keyword && (
              isKeywordImplemented(block.keyword)
                ? <span style={{ color: '#2e7d32', fontSize: 10, marginLeft: 6 }}>✅実装済</span>
                : <span style={{ color: '#e65100', fontSize: 10, marginLeft: 6 }} title="エンジン未実装">⚠未実装</span>
            )}
          </label>
          <SearchSelect
            value={block.keyword || ''}
            onChange={(v) => update('keyword', v)}
            options={toOpts(dict.keywords)}
            allowFreeText
          />
        </div>
      </div>
    </div>
  );
}

// === ルール step エディタ ===
// ルール = ミニ effect step（action / target / value / conditions）。
// メインの effect step UI を縮小したもの。
interface RuleStepEditorProps {
  index: number;
  step: MiniStep;
  dict: DictAPI;
  onChange: (patch: Partial<MiniStep>) => void;
  onRemove: () => void;
  onUp?: () => void;
  onDown?: () => void;
}
// === ルールフィールド定義 ===
// 各フィールドはチェックボックスで有効/無効を切替できる。
// kind:'top' = step 直下のフィールド (target/type/value)
// kind:'condition' = step.conditions 配列に cond_xxx として格納
//
// input:
//   'select' = プルダウン (options 必須)
//   'text'   = テキスト入力
//   'number' = 数値入力
//   'value'  = 専用 値プルダウン (1/2/3/全て/記述)
type RuleFieldKind = 'top' | 'condition';
type RuleFieldInput = 'select' | 'text' | 'number' | 'value' | 'flag';
interface RuleFieldDef {
  key: string;
  label: string;
  kind: RuleFieldKind;
  topKey?: 'target' | 'type' | 'value' | 'isRemaining';   // kind:'top' のとき step のどのキー
  condCode?: string;                        // kind:'condition' のとき cond_xxx
  input: RuleFieldInput;                    // 'flag' は値入力なし（チェックボックス自体が値）
  options?: SelectOption[];                 // input='select' 用
  placeholder?: string;
}

const RULE_COLOR_OPTS: SelectOption[] = [
  { value: '', label: '（選択）' },
  { value: '赤', label: '赤' }, { value: '青', label: '青' }, { value: '黄', label: '黄' },
  { value: '緑', label: '緑' }, { value: '黒', label: '黒' }, { value: '紫', label: '紫' }, { value: '白', label: '白' },
];
const RULE_TYPE_OPTS: SelectOption[] = [
  { value: '', label: '（選択）' },
  { value: 'デジモン', label: 'デジモン' },
  { value: 'テイマー', label: 'テイマー' },
  { value: 'オプション', label: 'オプション' },
  { value: 'カード', label: '全カード' },
];
const RULE_VALUE_OPTS: SelectOption[] = [
  { value: '', label: '（選択）' },
  { value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' },
  { value: 'all', label: '全て' },
  { value: '__custom__', label: '記述（自由入力）' },
];

// === アクション「位置バリアント」グループ化 ===
// アクションコード末尾が _top / _bottom / _select で、
// 同じ base に2件以上バリアントが存在する場合、エディタ上でグループ化する。
// 例: security_trash_top / security_trash_bottom / security_trash_select
//   → アクションプルダウンには "セキュリティを破棄" 1件のみ表示
//   → 別途「📍 位置」サブプルダウンで上から/下から/選んで を選択
const POSITION_VARIANTS: { suffix: string; label: string }[] = [
  { suffix: '_top',    label: '上' },
  { suffix: '_bottom', label: '下' },
  { suffix: '_select', label: '選んで' },
  // 「全て」も位置・量バリアントの一種として扱う（例: evo_discard_all = 進化元全破棄）
  // value="all" を入れる代わりにこの位置を選べば action コード自体に "_all" が付く
  { suffix: '_all',    label: '全て' },
];
// base コード → 「グループの代表ラベル」のマッピング（自動推測がうまく行かない時の手動指定用）
const POSITION_BASE_LABELS: Record<string, string> = {
  security_trash: 'セキュリティを破棄',
  evo_discard: '進化元を破棄',
  deck_trash: 'デッキを破棄',
};

function getActionVariant(code: string): { base: string; suffix: string } | null {
  if (!code) return null;
  for (const v of POSITION_VARIANTS) {
    if (code.endsWith(v.suffix)) return { base: code.slice(0, -v.suffix.length), suffix: v.suffix };
  }
  return null;
}

// dict.actions を「位置バリアント対応の表示用」に再構成
// ルール:
//   1. dict entry に hasPositionVariant=true フラグがあれば、その entry を base として扱う
//      pulldown には base ラベルだけ表示。代表 value = base コード（保存時に _top suffix が付く）
//      同じ base で suffix 付きの entry (security_trash_top 等) が dict にあれば pulldown から隠す
//   2. フラグなしでも 2件以上の suffix variants が存在する場合は自動グループ化（後方互換）
function buildActionDisplay(actions: DictEntry[]): {
  options: SelectOption[];
  flaggedBases: Set<string>;        // hasPositionVariant=true な base コード集合
  autoGroupBases: Set<string>;      // 自動グループ化された base コード集合
} {
  const allCodes = new Set(actions.map((a) => a.code));
  const flaggedBases = new Set<string>();
  actions.forEach((a) => {
    if (a.hasPositionVariant && !getActionVariant(a.code)) {
      // base コード（suffix無し）+ フラグ
      flaggedBases.add(a.code);
    }
  });

  const autoGroupBases = new Set<string>();
  const variantEntriesByBase = new Map<string, DictEntry[]>();
  actions.forEach((a) => {
    const v = getActionVariant(a.code);
    if (!v) return;
    if (flaggedBases.has(v.base)) return; // base がフラグ付きなら自動グループ化対象外（base 側で表示）
    const otherCount = POSITION_VARIANTS.filter(
      (p) => p.suffix !== v.suffix && allCodes.has(v.base + p.suffix)
    ).length;
    if (otherCount >= 1) {
      autoGroupBases.add(v.base);
      if (!variantEntriesByBase.has(v.base)) variantEntriesByBase.set(v.base, []);
      variantEntriesByBase.get(v.base)!.push(a);
    }
  });

  const options: SelectOption[] = [];
  // フラグ付き base の表示
  flaggedBases.forEach((base) => {
    const entry = actions.find((a) => a.code === base);
    if (!entry) return;
    options.push({ value: base, label: entry.label });
  });
  // 自動グループ化された base の表示
  variantEntriesByBase.forEach((entries, base) => {
    entries.sort((a, b) => {
      const ai = POSITION_VARIANTS.findIndex((v) => a.code.endsWith(v.suffix));
      const bi = POSITION_VARIANTS.findIndex((v) => b.code.endsWith(v.suffix));
      return ai - bi;
    });
    const baseLabel = POSITION_BASE_LABELS[base] || (() => {
      let lbl = entries[0].label;
      ['の上から', 'の下から', 'を選んで', '上から', '下から', '選んで', 'の上', 'の下'].forEach((w) => {
        lbl = lbl.replace(new RegExp(w, 'g'), '');
      });
      return lbl.trim() || entries[0].label;
    })();
    options.push({ value: entries[0].code, label: baseLabel });
  });

  // 残り: 個別表示する entry (フラグ付き base の variant entries は除外)
  actions.forEach((a) => {
    const v = getActionVariant(a.code);
    if (v && flaggedBases.has(v.base)) return;          // フラグ付き base の suffix entry → 隠す
    if (v && autoGroupBases.has(v.base)) return;         // 自動グループ済 → 隠す
    if (flaggedBases.has(a.code)) return;                // 既に追加済
    options.push({ value: a.code, label: a.label });
  });
  return { options, flaggedBases, autoGroupBases };
}

// === タイミング/持続 プリセット ===
// トリガー領域に表示するチェックボックス群。【自分のターン】等の一発入力用。
//
// kind:
//   'trigger'   = block.trigger に該当コードをセット（持続効果 or ターン境界イベント）
//                 同グループ内で相互排他（1つだけ ON）
//   'condition' = block.conditions に cond_during_*_turn を追加（発動条件としてのタイミング）
//                 複数追加可（独立）
type TimingPresetKind = 'trigger' | 'condition';
interface TimingPreset {
  code: string;
  label: string;
  kind: TimingPresetKind;
}
const TIMING_PRESETS_TRIGGER: TimingPreset[] = [
  { code: 'main',              label: 'メイン（メインフェイズ起動効果）', kind: 'trigger' },
  { code: 'during_own_turn',   label: '自分のターン (持続)',   kind: 'trigger' },
  { code: 'during_opp_turn',   label: '相手のターン (持続)',   kind: 'trigger' },
  { code: 'during_any_turn',   label: 'お互いのターン (持続)', kind: 'trigger' },
  { code: 'on_own_turn_start', label: '自分のターン開始時',    kind: 'trigger' },
  { code: 'on_opp_turn_start', label: '相手のターン開始時',    kind: 'trigger' },
  { code: 'on_own_turn_end',   label: '自分のターン終了時',    kind: 'trigger' },
  { code: 'on_opp_turn_end',   label: '相手のターン終了時',    kind: 'trigger' },
];
const TIMING_PRESETS_CONDITION: TimingPreset[] = [
  { code: 'cond_during_own_turn', label: '自分のターン中', kind: 'condition' },
  { code: 'cond_during_opp_turn', label: '相手のターン中', kind: 'condition' },
  { code: 'cond_during_any_turn', label: 'お互いのターン中', kind: 'condition' },
];

// === 「選んだデジモンと同じ」用の属性選択 ===
// cond_same_as_picked の値はカンマ区切り属性リスト ('name,color' 等)。
// この属性チェックボックス UI で値を編集する。
const SAME_AS_PICKED_FIELDS: { code: string; label: string }[] = [
  { code: 'name',     label: '名前' },
  { code: 'color',    label: '色' },
  { code: 'type',     label: 'タイプ' },
  { code: 'level',    label: 'Lv' },
  { code: 'dp',       label: 'DP' },
  { code: 'playCost', label: 'コスト' },
  { code: 'feature',  label: '特徴' },
  { code: 'cardNo',   label: 'カードNo' },
];

// === 条件のチェックボックス用「よく使う条件」定義 ===
// ConditionsHybridEditor で使用。
// プルダウン側からも cond_xxx で選べるが、こちらはチェックボックス1クリックで追加できる時短UI。
type CommonCondInput = 'select' | 'text' | 'number';
interface CommonCondDef {
  code: string;
  label: string;
  input: CommonCondInput;
  options?: SelectOption[];
}
const COMMON_CONDS: CommonCondDef[] = [
  { code: 'cond_color',            label: '色',           input: 'select', options: RULE_COLOR_OPTS },
  { code: 'cond_type',             label: 'タイプ',       input: 'select', options: RULE_TYPE_OPTS },
  { code: 'cond_lv',               label: 'Lv完全一致',   input: 'number' },
  { code: 'cond_lv_le',            label: 'Lv以下',       input: 'number' },
  { code: 'cond_lv_ge',            label: 'Lv以上',       input: 'number' },
  { code: 'cond_dp',               label: 'DP完全一致',   input: 'number' },
  { code: 'cond_dp_le',            label: 'DP以下',       input: 'number' },
  { code: 'cond_dp_ge',            label: 'DP以上',       input: 'number' },
  { code: 'cond_cost',             label: 'コスト完全一致', input: 'number' },
  { code: 'cond_cost_le',          label: 'コスト以下',   input: 'number' },
  { code: 'cond_cost_ge',          label: 'コスト以上',   input: 'number' },
  { code: 'cond_memory_le',        label: 'メモリー以下', input: 'number' },
  { code: 'cond_memory_ge',        label: 'メモリー以上', input: 'number' },
  { code: 'cond_feature_contains', label: '特徴を含む',   input: 'text' },
  { code: 'cond_name',             label: '名前（完全一致）', input: 'text' },
  { code: 'cond_name_contains',    label: '名前を含む',   input: 'text' },
  // 取得元（手札/トラッシュ等）。タイガ(BT2-088)「手札の名称に〜」等、進化元カードの
  // 所在ゾーンを限定したいケース用。判定ロジックはエンジン未実装（before_evolve 等の
  // 割り込みトリガーと合わせて対応予定）で、現状は常に'hand'扱いになる想定。
  { code: 'cond_from_zone',        label: '取得元',       input: 'select', options: toOpts(FROM_ZONES) },
];
// ルール上部フィールド (step 直下) のみ。条件は ConditionsHybridEditor に統一。
const RULE_FIELDS: RuleFieldDef[] = [
  { key: 'is_remaining', label: '残ったカード', kind: 'top', topKey: 'isRemaining', input: 'flag' },
  { key: 'target', label: '対象',       kind: 'top', topKey: 'target', input: 'select', options: [] /* TARGETS で動的設定 */ },
  { key: 'type',   label: 'タイプ',     kind: 'top', topKey: 'type',   input: 'select', options: RULE_TYPE_OPTS },
  { key: 'value',  label: '値（枚数）', kind: 'top', topKey: 'value',  input: 'value' },
];

function RuleStepEditor({ index, step, dict, onChange, onRemove, onUp, onDown }: RuleStepEditorProps) {
  // === フィールドの「有効化」判定 ===
  // top: step[topKey] が undefined でなければ有効
  // condition: step.conditions に condCode がある entry があれば有効
  function isFieldEnabled(f: RuleFieldDef): boolean {
    if (f.kind === 'top' && f.topKey) {
      const v = (step as any)[f.topKey];
      // flag 型: 真偽値で判定
      if (f.input === 'flag') return v === true;
      return v !== undefined;
    }
    if (f.kind === 'condition' && f.condCode) {
      return !!(step.conditions || []).find((c) => c.base === f.condCode);
    }
    return false;
  }

  // === フィールドの現在値取得 ===
  function getFieldValue(f: RuleFieldDef): any {
    if (f.kind === 'top' && f.topKey) {
      return (step as any)[f.topKey];
    }
    if (f.kind === 'condition' && f.condCode) {
      const c = (step.conditions || []).find((cc) => cc.base === f.condCode);
      return c ? c.value : undefined;
    }
    return undefined;
  }

  // === フィールドの値を更新 ===
  function setFieldValue(f: RuleFieldDef, v: any) {
    if (f.kind === 'top' && f.topKey) {
      onChange({ [f.topKey]: v });
      return;
    }
    if (f.kind === 'condition' && f.condCode) {
      const conds = (step.conditions || []).slice();
      const i = conds.findIndex((c) => c.base === f.condCode);
      const valStr = v === undefined || v === null ? '' : String(v);
      if (i >= 0) conds[i] = { ...conds[i], value: valStr };
      else conds.push({ base: f.condCode, value: valStr });
      onChange({ conditions: conds });
    }
  }

  // === フィールド有効化トグル ===
  function setFieldEnabled(f: RuleFieldDef, enabled: boolean) {
    if (f.kind === 'top' && f.topKey) {
      // flag型: チェック自体が値 (true/undefined)
      if (f.input === 'flag') {
        onChange({ [f.topKey]: enabled ? true : undefined });
        return;
      }
      // 通常 top フィールド: 有効化=空文字、無効化=undefined
      onChange({ [f.topKey]: enabled ? '' : undefined });
      return;
    }
    if (f.kind === 'condition' && f.condCode) {
      const conds = step.conditions || [];
      if (enabled) {
        if (!conds.find((c) => c.base === f.condCode)) {
          onChange({ conditions: [...conds, { base: f.condCode!, value: '' }] });
        }
      } else {
        onChange({ conditions: conds.filter((c) => c.base !== f.condCode) });
      }
    }
  }

  // 値フィールド (input='value') の記述モード state
  const valueRaw = step.value;
  const valueStr = valueRaw === undefined || valueRaw === null ? '' : String(valueRaw);
  const isPresetValue = ['', '1', '2', '3', 'all'].includes(valueStr);
  const [customMode, setCustomMode] = useState<boolean>(!isPresetValue && valueRaw !== undefined);

  // 「対象」のオプションは TARGETS から動的に取得（コンパイル時の動的依存避け）
  const targetOptions = toOpts(TARGETS);

  return (
    <div style={{ marginBottom: 6, padding: 8, background: 'white', border: '1px solid #c5d4ea', borderRadius: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontWeight: 'bold', fontSize: 12, color: '#1976d2' }}>ルール {index + 1}</span>
        <span style={{ display: 'flex', gap: 2 }}>
          {onUp && <button onClick={onUp} style={miniBtn()}>↑</button>}
          {onDown && <button onClick={onDown} style={miniBtn()}>↓</button>}
          <button onClick={onRemove} style={{ ...miniBtn(), borderColor: '#d33', color: '#d33' }}>✕ 削除</button>
        </span>
      </div>

      {/* アクションは常に表示・必須。位置指定フラグ付きアクション選択時は 📍 位置 pulldown も出現 */}
      {(() => {
        const { options: ruleActionOptions, flaggedBases: ruleFlaggedBases, autoGroupBases: ruleAutoGroupBases } = buildActionDisplay(dict.actions);
        const ruleCurVariant = getActionVariant(step.action || '');
        const ruleIsFlaggedBaseDirect = ruleFlaggedBases.has(step.action || '');
        const ruleIsVariantOfFlagged = !!(ruleCurVariant && (ruleFlaggedBases.has(ruleCurVariant.base) || ruleAutoGroupBases.has(ruleCurVariant.base)));
        const ruleIsPositional = ruleIsFlaggedBaseDirect || ruleIsVariantOfFlagged;

        const ruleNormalizedActionValue = (() => {
          if (ruleIsFlaggedBaseDirect) return step.action || '';
          if (ruleCurVariant && ruleFlaggedBases.has(ruleCurVariant.base)) return ruleCurVariant.base;
          if (ruleCurVariant && ruleAutoGroupBases.has(ruleCurVariant.base)) return ruleCurVariant.base + '_top';
          return step.action || '';
        })();

        const ruleVariantOptions: SelectOption[] = (() => {
          if (!ruleIsPositional) return [];
          if (ruleIsFlaggedBaseDirect || (ruleCurVariant && ruleFlaggedBases.has(ruleCurVariant.base))) {
            return POSITION_VARIANTS.map((v) => ({ value: v.suffix, label: v.label }));
          }
          if (ruleCurVariant && ruleAutoGroupBases.has(ruleCurVariant.base)) {
            return POSITION_VARIANTS
              .filter((v) => dict.actions.some((a) => a.code === ruleCurVariant.base + v.suffix))
              .map((v) => ({ value: v.suffix, label: v.label }));
          }
          return [];
        })();
        const ruleCurrentSuffix = ruleCurVariant ? ruleCurVariant.suffix : '';

        function onRuleActionChange(newCode: string) {
          const newIsFlaggedBase = ruleFlaggedBases.has(newCode);
          const newV = getActionVariant(newCode);
          const cur = step.action || '';
          const curV = getActionVariant(cur);
          const newBase = newIsFlaggedBase ? newCode : (newV ? newV.base : null);
          const curBase = curV ? curV.base : (ruleFlaggedBases.has(cur) ? cur : null);
          if (newBase && curBase && newBase === curBase) return;
          if (newIsFlaggedBase) {
            onChange({ action: newCode + '_top' });
            return;
          }
          onChange({ action: newCode });
        }
        function onRuleVariantChange(newSuffix: string) {
          if (!newSuffix) return;
          const base = ruleIsFlaggedBaseDirect ? (step.action || '') : (ruleCurVariant ? ruleCurVariant.base : '');
          if (!base) return;
          onChange({ action: base + newSuffix });
        }

        return (
          <div style={{ marginBottom: 8 }}>
            <div style={miniLbl()}>アクション *</div>
            <SearchSelect
              value={ruleNormalizedActionValue}
              onChange={onRuleActionChange}
              options={ruleActionOptions}
              allowFreeText
              placeholder="例: 手札に加える"
            />
            {ruleIsPositional && ruleVariantOptions.length > 0 && (
              <div style={{ marginTop: 4 }}>
                <div style={miniLbl()}>📍 位置</div>
                <SearchSelect
                  value={ruleCurrentSuffix}
                  onChange={onRuleVariantChange}
                  options={ruleVariantOptions}
                />
              </div>
            )}
          </div>
        );
      })()}

      {/* チェックボックス: 必要なフィールドだけ ☑ */}
      <div style={{ marginBottom: 6, padding: 6, background: '#f3f6fc', borderRadius: 4, border: '1px solid #d8e0f0' }}>
        <div style={{ ...miniLbl(), marginBottom: 4 }}>有効化する項目（必要なものに ☑）</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px' }}>
          {RULE_FIELDS.map((f) => (
            <label key={f.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={isFieldEnabled(f)}
                onChange={(e) => setFieldEnabled(f, e.target.checked)}
                style={{ margin: 0 }}
              />
              {f.label}
            </label>
          ))}
        </div>
      </div>

      {/* 有効化されたフィールドの入力欄（flag型は値入力不要なので除外） */}
      {RULE_FIELDS.filter((f) => f.input !== 'flag').some(isFieldEnabled) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 6 }}>
          {RULE_FIELDS.filter((f) => f.input !== 'flag' && isFieldEnabled(f)).map((f) => (
            <div key={f.key}>
              <div style={miniLbl()}>{f.label}</div>
              {/* input: select */}
              {f.input === 'select' && (
                <SearchSelect
                  value={String(getFieldValue(f) ?? '')}
                  onChange={(v) => setFieldValue(f, v)}
                  options={f.key === 'target' ? targetOptions : (f.options || [])}
                  allowFreeText={f.key === 'target'}
                  placeholder={f.placeholder}
                />
              )}
              {/* input: text */}
              {f.input === 'text' && (
                <input
                  type="text"
                  value={String(getFieldValue(f) ?? '')}
                  onChange={(e) => setFieldValue(f, e.target.value)}
                  placeholder={f.placeholder}
                  style={{ padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, width: '100%', boxSizing: 'border-box' }}
                />
              )}
              {/* input: number */}
              {f.input === 'number' && (
                <input
                  type="number"
                  value={String(getFieldValue(f) ?? '')}
                  onChange={(e) => setFieldValue(f, e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder={f.placeholder}
                  style={{ padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, width: '100%', boxSizing: 'border-box' }}
                />
              )}
              {/* input: value（プルダウン or 記述） */}
              {f.input === 'value' && (
                !customMode ? (
                  <select
                    value={isPresetValue ? valueStr : ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '__custom__') setCustomMode(true);
                      else if (v === '') onChange({ value: '' });
                      else if (v === 'all') onChange({ value: 'all' });
                      else onChange({ value: Number(v) });
                    }}
                    style={{ padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, width: '100%' }}
                  >
                    {RULE_VALUE_OPTS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                ) : (
                  <div style={{ display: 'flex', gap: 2 }}>
                    <input
                      type="text"
                      value={valueStr}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === '') onChange({ value: '' });
                        else if (/^\d+$/.test(v)) onChange({ value: Number(v) });
                        else onChange({ value: v });
                      }}
                      placeholder="例: deck_choice / 1000"
                      autoFocus
                      style={{ flex: 1, padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, minWidth: 0 }}
                    />
                    <button
                      onClick={() => { setCustomMode(false); onChange({ value: '' }); }}
                      title="プルダウンに戻す（値はクリア）"
                      style={{ padding: '0 6px', border: '1px solid #888', background: 'white', borderRadius: 3, cursor: 'pointer', fontSize: 11 }}
                    >
                      ↺
                    </button>
                  </div>
                )
              )}
            </div>
          ))}
        </div>
      )}

      {/* === ルール条件: トリガー条件 / 発動条件と同じハイブリッドUI === */}
      {/* チェックボックス (色 / Lv / DP 等) + プルダウン (cond_picked_color 等の高度条件) */}
      <div style={{ marginTop: 8 }}>
        <ConditionsHybridEditor
          conditions={step.conditions || []}
          onChange={(next) => onChange({ conditions: next })}
          dict={dict}
          title="ルール条件"
          hint="（このルールが発動する条件・cond_picked_color 等で直前選択を参照可・複数 AND）"
          theme="action"
          defaultSubject=""
          showSubjectSelector={false}
        />
      </div>

      {/* === ルール内 修飾子: このルール限定で適用される options === */}
      {/* 例: 「相手に見せて」をルール「手札に加える」に付与 → selections[].options に展開 */}
      {dict.options.length > 0 && (
        <details style={{ marginTop: 8 }} open={Array.isArray(step.options) && step.options.length > 0}>
          <summary style={{ cursor: 'pointer', fontWeight: 'bold', fontSize: 12, color: '#1976d2', padding: '2px 0' }}>
            🛡 修飾子（このルールに限定）
            {Array.isArray(step.options) && step.options.length > 0 ? ` (${step.options.length})` : ''}
          </summary>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: 6, border: '1px solid #d8e0f0', borderRadius: 4, background: '#f3f6fc', marginTop: 4 }}>
            {dict.options.map((o) => {
              const optsArr = step.options || [];
              const checked = optsArr.includes(o.code);
              const implemented = isOptionImplemented(o.code, o.logicCode);
              return (
                <label
                  key={o.code}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '3px 8px',
                    border: checked ? '1px solid #3b6cd1' : '1px solid #c5cfe0',
                    borderRadius: 12,
                    background: checked ? '#dde7fb' : 'white',
                    cursor: 'pointer', fontSize: 11,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      const next = checked ? optsArr.filter((x) => x !== o.code) : [...optsArr, o.code];
                      onChange({ options: next });
                    }}
                    style={{ margin: 0 }}
                  />
                  <span>{o.label}</span>
                  {implemented
                    ? <span style={{ color: '#2e7d32', fontSize: 9 }}>✅</span>
                    : <span style={{ color: '#e65100', fontSize: 9 }} title="エンジン未実装">⚠</span>}
                </label>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}

// === ハイブリッド条件エディタ ===
// チェックボックス（よく使う条件・hardcoded）+ プルダウン（その他の条件・dict 由来）の併用。
// トリガー条件 / 発動条件 の両方で使う。
interface ConditionsHybridEditorProps {
  conditions: ConditionPair[];
  onChange: (next: ConditionPair[]) => void;
  dict: DictAPI;
  title: string;
  hint: string;
  theme: 'trigger' | 'action';
  defaultSubject?: string;  // チェックボックス追加時の既定 subject（'' or 'self' 等）
  showSubjectSelector?: boolean; // 主体プルダウンを各行に出すか
  showAttackTargetRow?: boolean; // 🎯 アタック対象行（プレイヤー/デジモン）を表示するか（トリガー条件専用）
  // true のとき cond_type 等を複数選択(カンマ区切り値)で入力可能にする。
  // step.filter (ターゲットフィルタ) は type_in 配列を受け付けるためOK判定できるが、
  // trigger_conditions/発動条件側の cond_type は単一値exact-matchのみ対応のため、
  // それらの用途では誤動作を避けるため false のままにすること。
  supportsMultiValue?: boolean;
}
// 値入力が不要な条件（チェック的な意味だけを持つ cond_xxx）。UIでプレースホルダを変える程度に使用
const NO_VALUE_CONDS = new Set([
  'cond_attack_target_player', 'cond_attack_target_digimon', 'cond_no_evo',
  'cond_jogress', 'cond_in_battle', 'cond_during_own_turn', 'cond_during_opp_turn',
  'cond_during_any_turn', 'cond_self_active', 'cond_self_rest', 'cond_opp_no_attack_this_turn',
  'cond_evolved_this_turn', 'cond_no_tamer_evo', 'cond_not_own_effect', 'cond_has_evo_digimon',
]);

// === 条件の「種別」を大分類(カテゴリ)+詳細(バリアント)の2段構成にする ===
// 色/タイプ/特徴/場所は 1カテゴリ=1コードの直接対応。
// Lv/DP/名前は複数コードがあるため、カテゴリ選択後に「以上/以下」等の
// バリアントプルダウンが追加で現れる。その他はカテゴリに無い全条件を選べる逃し弁。
type CondCategory = 'color' | 'type' | 'feature' | 'lv' | 'dp' | 'name' | 'zone' | 'other' | '';

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: 'color', label: '色' },
  { value: 'type', label: 'タイプ' },
  { value: 'feature', label: '特徴' },
  { value: 'lv', label: 'Lv' },
  { value: 'dp', label: 'DP' },
  { value: 'name', label: '名前' },
  { value: 'zone', label: '場所' },
  { value: 'other', label: 'その他' },
];

// カテゴリ選択直後に自動セットされる既定コード（バリアント無しは1つだけ・バリアント有りは先頭）
const CATEGORY_DEFAULT_BASE: Record<string, string> = {
  color: 'cond_color',
  type: 'cond_type',
  feature: 'cond_feature_contains',
  zone: 'cond_from_zone',
  lv: 'cond_lv_ge',
  dp: 'cond_dp_ge',
  name: 'cond_name',
};

// バリアント選択が必要なカテゴリのプルダウン候補
const CATEGORY_VARIANTS: Partial<Record<CondCategory, { value: string; label: string }[]>> = {
  lv: [
    { value: 'cond_lv_ge', label: '以上' },
    { value: 'cond_lv_le', label: '以下' },
    { value: 'cond_lv', label: '完全一致' },
  ],
  dp: [
    { value: 'cond_dp_ge', label: '以上' },
    { value: 'cond_dp_le', label: '以下' },
    { value: 'cond_dp', label: '完全一致' },
  ],
  name: [
    { value: 'cond_name', label: '完全一致' },
    { value: 'cond_name_contains', label: '含む' },
  ],
};

// 条件コード → カテゴリ の逆引き（既存レシピ読込時・行の見た目復元用）
function baseToCategory(base: string): CondCategory {
  if (!base) return '';
  if (base === 'cond_color') return 'color';
  if (base === 'cond_type') return 'type';
  if (base === 'cond_feature_contains' || base === 'cond_feature') return 'feature';
  if (base === 'cond_from_zone') return 'zone';
  if (base === 'cond_lv_ge' || base === 'cond_lv_le' || base === 'cond_lv') return 'lv';
  if (base === 'cond_dp_ge' || base === 'cond_dp_le' || base === 'cond_dp') return 'dp';
  if (base === 'cond_name' || base === 'cond_name_contains') return 'name';
  return 'other';
}

// クイック追加ショートカット（ワンクリックで「条件N」の新規行を追加・カテゴリ既定コードを直接セット）
// トリガー条件専用の「アタック対象」もここに統合（旧: 専用トグルUI → 通常の条件行として扱う）
const QUICK_ADD_COMMON: { code: string; label: string }[] = CATEGORY_OPTIONS
  .filter((c) => c.value !== 'other')
  .map((c) => ({ code: CATEGORY_DEFAULT_BASE[c.value], label: c.label }));
const QUICK_ADD_ATTACK_TARGET: { code: string; label: string }[] = [
  { code: 'cond_attack_target_player', label: 'プレイヤーにアタック' },
  { code: 'cond_attack_target_digimon', label: 'デジモンにアタック' },
];

function ConditionsHybridEditor({
  conditions, onChange, dict, title, hint, theme, defaultSubject = '', showSubjectSelector = true, showAttackTargetRow = false,
  supportsMultiValue = false,
}: ConditionsHybridEditorProps) {
  const colors = theme === 'trigger'
    ? { bg: '#e8f7e8', border: '#93c693', accent: '#1a5a1a', icon: '🔔' }
    : { bg: '#e8f0fe', border: '#93b5e5', accent: '#1a4f8a', icon: '🎯' };

  // 「その他」用: 色/タイプ/特徴/Lv/DP/名前/場所として直接選べるコード群を除いた残り
  const CATEGORIZED_CODES = new Set<string>([
    'cond_color', 'cond_type', 'cond_feature_contains', 'cond_feature', 'cond_from_zone',
    'cond_lv_ge', 'cond_lv_le', 'cond_lv', 'cond_dp_ge', 'cond_dp_le', 'cond_dp',
    'cond_name', 'cond_name_contains',
  ]);
  const otherCondOptions = toOpts(dict.conditions.filter((c) => !CATEGORIZED_CODES.has(c.code)));

  function updateAt(i: number, patch: Partial<ConditionPair>) {
    const next = conditions.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }
  function removeAt(i: number) {
    onChange(conditions.filter((_, idx) => idx !== i));
  }
  function addRow(base = '') {
    onChange([...conditions, { base, value: '', subject: defaultSubject || undefined }]);
  }

  return (
    <div className="field" style={{ gridColumn: '1 / span 2', background: colors.bg, padding: 8, borderRadius: 4, border: `1px solid ${colors.border}` }}>
      <label style={{ fontWeight: 'bold', color: colors.accent }}>
        {colors.icon} {title}
        <span style={{ fontSize: 10, fontWeight: 'normal', color: '#666', marginLeft: 6 }}>{hint}</span>
      </label>
      <div style={{ fontSize: 10, color: '#666', margin: '2px 0 6px' }}>
        条件1・条件2・…はすべて AND（全部を満たしたときだけ発動）。各行で「種別・値・対象」を個別に設定できます。
      </div>

      {conditions.length === 0 && (
        <div style={{ color: '#888', fontSize: 11, padding: '4px 0' }}>条件なし</div>
      )}

      {conditions.map((c, i) => {
        const def = COMMON_CONDS.find((cc) => cc.code === c.base);
        return (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 6, padding: 6, border: `1px solid ${colors.border}`, borderRadius: 4, background: 'white' }}>
            <div style={{ fontSize: 11, fontWeight: 'bold', color: colors.accent, minWidth: 44, paddingTop: 6, whiteSpace: 'nowrap' }}>
              条件{i + 1}
            </div>
            <div style={{ flex: 2 }}>
              <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>種別</div>
              {(() => {
                const category = baseToCategory(c.base);
                return (
                  <SearchSelect
                    value={category}
                    onChange={(newCat) => {
                      if (newCat === 'other') {
                        updateAt(i, { base: otherCondOptions[0]?.value || '', value: '' });
                      } else {
                        updateAt(i, { base: CATEGORY_DEFAULT_BASE[newCat] || '', value: '' });
                      }
                    }}
                    options={CATEGORY_OPTIONS}
                    placeholder="--種別を選択--"
                  />
                );
              })()}
              {/* Lv/DP/名前: 「以上/以下/完全一致」等のバリアントプルダウン */}
              {CATEGORY_VARIANTS[baseToCategory(c.base)] && (
                <div style={{ marginTop: 4 }}>
                  <SearchSelect
                    value={c.base}
                    onChange={(v) => updateAt(i, { base: v })}
                    options={CATEGORY_VARIANTS[baseToCategory(c.base)]!}
                  />
                </div>
              )}
              {/* その他: カテゴリ化されていない条件を直接選ぶ逃し弁 */}
              {baseToCategory(c.base) === 'other' && (
                <div style={{ marginTop: 4 }}>
                  <SearchSelect
                    value={c.base}
                    onChange={(v) => updateAt(i, { base: v })}
                    options={otherCondOptions}
                    allowFreeText
                    placeholder="--条件を選択--"
                  />
                </div>
              )}
              {c.base && (
                isConditionImplemented(c.base)
                  ? <span style={{ color: '#2e7d32', fontSize: 10 }}>✅実装済</span>
                  : <span style={{ color: '#e65100', fontSize: 10 }} title="エンジン未実装">⚠未実装</span>
              )}
            </div>
            <div style={{ flex: 1.5 }}>
              <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>値</div>
              {c.base === 'cond_same_as_picked' || c.base === 'cond_from_zone'
                || (supportsMultiValue && c.base === 'cond_type') ? (
                /* 「選んだデジモンと同じ」「取得元」「タイプ(複数可・ターゲットフィルタ限定)」:
                   複数選択チェックボックス群（カンマ区切りで保存）。
                   カードは同時に複数ゾーンやタイプを持てないため、複数選択=常にOR判定でよい
                   （「紫のデジモンかオプション」はタイプで デジモン,オプション を両方チェックするだけで表現可能）
                   ※ cond_type の複数値は step.filter (type_in配列) でのみ解釈される。
                     トリガー条件/発動条件側は単一値exact-match想定なのでそちらでは使わないこと */
                (() => {
                  const optList = c.base === 'cond_from_zone' ? FROM_ZONES
                    : c.base === 'cond_type' ? RULE_TYPE_OPTS.filter((o) => o.value).map((o) => ({ code: o.value, label: o.label }))
                    : SAME_AS_PICKED_FIELDS;
                  const sel = (c.value || '').split(',').map((s) => s.trim()).filter(Boolean);
                  const isCheckedAttr = (code: string) => sel.includes(code);
                  const toggleAttr = (code: string, on: boolean) => {
                    const next = on
                      ? Array.from(new Set([...sel, code]))
                      : sel.filter((s) => s !== code);
                    updateAt(i, { value: next.join(',') });
                  };
                  return (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 8px', padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, background: 'white' }}>
                      {optList.map((f) => (
                        <label key={f.code} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 11, cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={isCheckedAttr(f.code)}
                            onChange={(e) => toggleAttr(f.code, e.target.checked)}
                            style={{ margin: 0 }}
                          />
                          {f.label}
                        </label>
                      ))}
                    </div>
                  );
                })()
              ) : def && def.input === 'select' ? (
                <select
                  value={c.value || ''}
                  onChange={(e) => updateAt(i, { value: e.target.value })}
                  style={{ padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, width: '100%' }}
                >
                  {(def.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : def && def.input === 'number' ? (
                <input
                  type="number"
                  value={c.value || ''}
                  onChange={(e) => updateAt(i, { value: e.target.value })}
                  style={{ padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, width: '100%', boxSizing: 'border-box' }}
                />
              ) : (
                <input
                  type="text"
                  value={c.value || ''}
                  onChange={(e) => updateAt(i, { value: e.target.value })}
                  placeholder={NO_VALUE_CONDS.has(c.base) ? '（値不要）' : '（必要なら）'}
                  disabled={NO_VALUE_CONDS.has(c.base)}
                  style={{ width: '100%', padding: '4px 6px', border: '1px solid #ccc', borderRadius: 3, fontSize: 12, boxSizing: 'border-box' }}
                />
              )}
            </div>
            {showSubjectSelector && (
              <div style={{ flex: 1.6 }}>
                <div style={{ fontSize: 10, color: '#555', marginBottom: 2 }}>対象</div>
                <SearchSelect
                  value={c.subject || ''}
                  onChange={(v) => updateAt(i, { subject: v || undefined })}
                  options={toOpts(CONDITION_SUBJECTS)}
                />
              </div>
            )}
            <button
              onClick={() => removeAt(i)}
              style={{ padding: '0 8px', border: '1px solid #d33', color: '#d33', background: 'white', borderRadius: 3, cursor: 'pointer', height: 26, alignSelf: 'flex-end' }}
            >
              ✕
            </button>
          </div>
        );
      })}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 4 }}>
        <button
          onClick={() => addRow()}
          style={{ padding: '4px 8px', border: `1px dashed ${colors.border}`, background: 'white', borderRadius: 3, cursor: 'pointer', fontSize: 11, color: colors.accent }}
        >
          ＋ 条件{conditions.length + 1}を追加
        </button>
        <span style={{ fontSize: 10, color: '#888' }}>よく使う条件:</span>
        {QUICK_ADD_COMMON.map((q) => (
          <button
            key={q.code}
            onClick={() => addRow(q.code)}
            style={{ padding: '3px 8px', border: `1px solid ${colors.border}`, background: colors.bg, borderRadius: 10, cursor: 'pointer', fontSize: 10.5, color: colors.accent }}
          >
            ＋{q.label}
          </button>
        ))}
        {showAttackTargetRow && QUICK_ADD_ATTACK_TARGET.map((q) => (
          <button
            key={q.code}
            onClick={() => addRow(q.code)}
            style={{ padding: '3px 8px', border: '1px solid #ffd591', background: '#fff8e6', borderRadius: 10, cursor: 'pointer', fontSize: 10.5, color: '#b76e00' }}
          >
            ＋{q.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function miniBtn(): React.CSSProperties {
  return { padding: '2px 6px', border: '1px solid #888', background: 'white', borderRadius: 3, cursor: 'pointer', fontSize: 10 };
}
function miniLbl(): React.CSSProperties {
  return { fontSize: 10, color: '#555', marginBottom: 2, fontWeight: 'bold' };
}

// （旧 RulePanel/RuleParamInput は MiniStep 方式への移行で削除済）
