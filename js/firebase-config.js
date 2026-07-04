// Firebase 初期化（Realtime Database のみ）+ GAS API ヘルパー
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getDatabase, ref, set, update, remove, onValue, onDisconnect } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';

const firebaseConfig = {
  apiKey: "AIzaSyCdb4gErcaGQy8xmWKPUpHF5gU60VVRTZA",
  authDomain: "digimon-tcg-app.firebaseapp.com",
  databaseURL: "https://digimon-tcg-app-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "digimon-tcg-app",
  storageBucket: "digimon-tcg-app.firebasestorage.app",
  messagingSenderId: "958809454877",
  appId: "1:958809454877:web:1f22c71397fdd993bc49f4",
  measurementId: "G-RXH84J28RC"
};

const app = initializeApp(firebaseConfig);

// Realtime Database（オンライン対戦用）
export const rtdb = getDatabase(app);
export { ref, set, update, remove, onValue, onDisconnect };

// ===== GAS REST API ヘルパー =====
// デプロイ後にここのURLを更新してください
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxB3kIy-fSGrGfJm65RWaNxGGvpCeF0GqrqGitXT7yBRLZE9LtW-SbpOqydxTLgDKf8/exec';

// GAS Webアプリの302リダイレクト先(script.googleusercontent.com)が
// 一定確率(実測15〜25%)で404を返す既知の間欠障害があるため、
// 非JSON応答/非200応答は自動リトライする
const GAS_MAX_RETRIES = 2;

async function fetchJsonWithRetry(doFetch) {
  let lastError;
  for (let attempt = 0; attempt <= GAS_MAX_RETRIES; attempt++) {
    try {
      const res = await doFetch();
      const text = await res.text();
      if (res.ok) {
        try {
          return JSON.parse(text);
        } catch (e) {
          lastError = e;
        }
      } else {
        lastError = new Error(`HTTP ${res.status}`);
      }
    } catch (e) {
      lastError = e;
    }
    if (attempt < GAS_MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  console.error('[gas] retry exhausted:', lastError);
  throw new Error('通信が不安定です。もう一度お試しください。');
}

// GET リクエスト
export async function gasGet(action, params = {}) {
  const url = new URL(GAS_URL);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return fetchJsonWithRetry(() => fetch(url.toString(), { redirect: 'follow' }));
}

// POST リクエスト
export async function gasPost(action, body = {}) {
  return fetchJsonWithRetry(() =>
    fetch(GAS_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action, ...body })
    })
  );
}
