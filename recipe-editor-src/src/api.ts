// GAS API クライアント
const GAS_URL =
  'https://script.google.com/macros/s/AKfycbxB3kIy-fSGrGfJm65RWaNxGGvpCeF0GqrqGitXT7yBRLZE9LtW-SbpOqydxTLgDKf8/exec';

export async function gasGet(action: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(GAS_URL);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { redirect: 'follow' });
  return res.json();
}

export async function gasPost(action: string, body: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(GAS_URL, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action, ...body }),
  });
  return res.json();
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
