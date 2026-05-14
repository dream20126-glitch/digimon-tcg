// 演出タイプ辞書（プロトタイプ用デフォルト）
import type { VisualTypeEntry } from './types';

export const DEFAULT_VISUAL_TYPES: VisualTypeEntry[] = [
  { code: 'popup_plus',    label: '数値ポップアップ+', description: '対象に「+N」をフロート表示（DP/メモリー増加）', defaultColor: '緑' },
  { code: 'popup_minus',   label: '数値ポップアップ-', description: '対象に「-N」をフロート表示（DP/メモリー減少）', defaultColor: '赤' },
  { code: 'card_destroy',  label: '消滅演出', description: 'カードに×印 → フェードアウトしてトラッシュへ移動', defaultColor: '赤' },
  { code: 'card_appear',   label: 'カード登場', description: 'カードがフェードインで登場、軽いバウンスアニメ', defaultColor: '緑' },
  { code: 'card_move',     label: 'カード移動', description: 'カードがスライドで別エリアへ移動', defaultColor: 'シアン' },
  { code: 'draw_card',     label: 'ドロー演出', description: 'デッキから手札へカードがアーチを描いて移動', defaultColor: 'シアン' },
  { code: 'rest_card',     label: 'レスト演出', description: 'カードを 90度回転（横向き）', defaultColor: 'オレンジ' },
  { code: 'active_card',   label: 'アクティブ演出', description: 'カードを縦向きに戻す + 軽い光エフェクト', defaultColor: '緑' },
  { code: 'buff_status',   label: '状態付与演出', description: '対象に状態アイコン表示（持続中はマーク常駐）', defaultColor: '紫' },
  { code: 'sattack_plus',  label: 'Sアタック+', description: 'カード上に「Sアタック+N」バッジ表示', defaultColor: '緑' },
  { code: 'sattack_minus', label: 'Sアタック-', description: 'カード上に「Sアタック-N」バッジ表示', defaultColor: '赤' },
  { code: 'dedigivolve',   label: '退化演出', description: '進化元から N枚 をはがす演出', defaultColor: '黄' },
  { code: 'jogress_evolve',label: 'ジョグレス進化', description: '2枚のカードが合体して新カードに変化', defaultColor: '黄' },
  { code: 'link_effect',   label: 'リンク演出', description: 'デジモンとリンクカードを線で結ぶエフェクト', defaultColor: '水色' },
  { code: 'vs_battle',     label: 'VS画面', description: 'アタッカー vs 対象 のフルスクリーン VS 演出', defaultColor: '赤' },
  { code: 'security_check',label: 'セキュリティチェック', description: 'セキュリティトップカードをめくる演出', defaultColor: '青' },
  { code: 'none',          label: 'なし', description: '演出なし（即座に状態変更のみ）', defaultColor: 'なし' },
];
