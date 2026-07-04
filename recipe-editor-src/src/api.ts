// GAS API クライアント
const GAS_URL =
  'https://script.google.com/macros/s/AKfycbxB3kIy-fSGrGfJm65RWaNxGGvpCeF0GqrqGitXT7yBRLZE9LtW-SbpOqydxTLgDKf8/exec';

// GAS Webアプリの302リダイレクト先(script.googleusercontent.com)が
// 一定確率(実測15〜25%)で404を返す既知の間欠障害があるため、
// 非JSON応答/非200応答は自動リトライする
const MAX_RETRIES = 2;

async function fetchJsonWithRetry(doFetch: () => Promise<Response>): Promise<any> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
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
    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  console.error('[gas] retry exhausted:', lastError);
  throw new Error('通信が不安定です。もう一度お試しください。');
}

export async function gasGet(action: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(GAS_URL);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return fetchJsonWithRetry(() => fetch(url.toString(), { redirect: 'follow' }));
}

export async function gasPost(action: string, body: Record<string, unknown> = {}): Promise<any> {
  return fetchJsonWithRetry(() =>
    fetch(GAS_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action, ...body }),
    })
  );
}

export async function checkAdmin(pw: string): Promise<boolean> {
  const r = await gasGet('checkAdmin', { pw });
  return !!r.valid;
}

export async function loadCards() {
  const r = await gasGet('getCards');
  return r;
}

export async function saveRecipe(cardNo: string, recipe: string, password: string) {
  return gasPost('saveRecipe', { cardNo, recipe, password });
}

// ==== 辞書 CRUD ====
export async function listDict() {
  return gasGet('listDict');
}

export async function addDictEntry(target: 'dict' | 'keywords', entry: Record<string, any>, password: string) {
  return gasPost('addDictEntry', { target, entry, password });
}

export async function updateDictEntry(target: 'dict' | 'keywords', code: string, entry: Record<string, any>, password: string) {
  return gasPost('updateDictEntry', { target, code, entry, password });
}

export async function removeDictEntry(target: 'dict' | 'keywords', code: string, password: string) {
  return gasPost('removeDictEntry', { target, code, password });
}
