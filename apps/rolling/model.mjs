export const MAX_BYTES = 992;
export function allowance(text) {
  const bytes = new TextEncoder().encode(text).length;
  const characters = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length;
  return { bytes, characters, remaining: MAX_BYTES - bytes, valid: bytes > 0 && bytes <= MAX_BYTES };
}
export function safeURL(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}
export function rankPosts(posts, mode, followedBoards, followedNames, curatedBoards) {
  const filtered = posts.filter(p => !p.parent && (mode === 'following'
    ? followedBoards.has(p.board) || followedNames.has(p.author)
    : curatedBoards.has(p.board)));
  return [...filtered].sort((a, b) => (mode === 'home' ? b.likes - a.likes : 0) || b.time - a.time || a.id.localeCompare(b.id));
}
export function searchBoards(boards, query) {
  const normalized = query.trim().toLocaleLowerCase();
  return boards.filter(b => `${b.name} ${b.description} ${b.id}`.toLocaleLowerCase().includes(normalized));
}
