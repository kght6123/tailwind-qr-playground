import type { Sample } from './codec';

export type Draft = Sample & { title: string };
export type HistoryEntry = Draft & { id: string; loadedAt: string };
const DRAFT_KEY = 'tailwind-qr:draft:v1';
const validDraft = (value: unknown): value is Draft => {
  const item = value as Draft | null;
  return !!item && typeof item.title === 'string' && typeof item.html === 'string' && typeof item.css === 'string';
};
export function loadDraft(): Draft | undefined {
  const raw = localStorage.getItem(DRAFT_KEY);
  if (!raw) return;
  const value: unknown = JSON.parse(raw);
  if (!validDraft(value)) throw new Error('編集状態を復元できませんでした。');
  return value;
}
export function saveDraft(draft: Draft) { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); }
async function directory() {
  if (!navigator.storage?.getDirectory || !globalThis.FileSystemFileHandle?.prototype.createWritable) {
    throw new Error('このブラウザでは履歴を保存できません。Safari 26以降など、対応ブラウザをご利用ください。');
  }
  return (await navigator.storage.getDirectory()).getDirectoryHandle('tailwind-qr-history-v1', { create: true });
}
export async function remember(entry: HistoryEntry) {
  const dir = await directory();
  const file = await dir.getFileHandle(`${entry.id}.json`, { create: true });
  const writer = await file.createWritable();
  try { await writer.write(JSON.stringify(entry)); await writer.close(); }
  catch (error) { await writer.abort().catch(() => {}); throw error; }
}
export async function listHistory(): Promise<HistoryEntry[]> {
  const dir = await directory();
  const entries: HistoryEntry[] = [];
  // TypeScript's DOM declarations omit the async directory iterator.
  const iterable = dir as FileSystemDirectoryHandle & { values(): AsyncIterableIterator<FileSystemHandle> };
  for await (const handle of iterable.values()) {
    if (handle.kind !== 'file' || !handle.name.endsWith('.json')) continue;
    const value: unknown = JSON.parse(await (await (handle as FileSystemFileHandle).getFile()).text());
    if (!validDraft(value) || typeof (value as HistoryEntry).id !== 'string' || !Number.isFinite(Date.parse((value as HistoryEntry).loadedAt))) {
      throw new Error('読み取れない履歴があります。');
    }
    entries.push(value as HistoryEntry);
  }
  return entries.sort((a, b) => b.loadedAt.localeCompare(a.loadedAt));
}
