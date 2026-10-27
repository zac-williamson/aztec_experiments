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
// A mention is a local composition choice. Reading credit never belongs to the
// input event; the composer and the page share one account-scoped balance query.
export const mentionsBok = text => typeof text === 'string' && /(^|[^\p{L}\p{N}_@])@bok(?![\p{L}\p{N}_])/iu.test(text);
// Shared presentation for published messages and composer previews. No HTML is
// interpreted, and importing this module does not require a browser document.
// Links become anchors; an @bok mention becomes a highlighted chip, X-style.
export function createMessageContent(value) {
  const node = document.createElement('div');
  node.className = 'post-body';
  const source = typeof value === 'string' ? value : '';
  const pattern = /\[([^\]]+)\]\(([^\s)]+)\)|(https?:\/\/[^\s]+)|(^|[^\p{L}\p{N}_@])(@[Bb][Oo][Kk])(?![\p{L}\p{N}_])/gu;
  let end = 0;
  for (const match of source.matchAll(pattern)) {
    node.append(document.createTextNode(source.slice(end, match.index)));
    if (match[5]) {
      if (match[4]) node.append(document.createTextNode(match[4]));
      const mention = document.createElement('span');
      mention.className = 'mention mention-bok';
      mention.textContent = match[5];
      node.append(mention);
    } else {
      const url = safeURL(match[2] || match[3]);
      if (url) {
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = match[1] || match[3];
        node.append(link);
      } else node.append(document.createTextNode(match[0]));
    }
    end = match.index + match[0].length;
  }
  node.append(document.createTextNode(source.slice(end)));
  return node;
}

// Interface chrome shared by the live reader, the design preview and the account
// panel. Live pages forbid inline styles and markup strings, so icons are built
// with createElementNS and per-item values travel as custom properties (CSSOM).
const SVG = 'http://www.w3.org/2000/svg';
const ICONS = {
  home: 'M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M22 21v-2a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8',
  compass: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M16.2 7.8l-2.1 6.3-6.3 2.1 2.1-6.3z',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9 M10.3 21a1.9 1.9 0 0 0 3.4 0',
  bookmark: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z',
  message: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  plus: 'M12 5v14 M5 12h14',
  wallet: 'M21 12V7H5a2 2 0 0 1 0-4h14v4 M3 5v14a2 2 0 0 0 2 2h16v-5 M18 12a2 2 0 0 0 0 4h4v-4z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.3-4.3',
  close: 'M18 6 6 18 M6 6l12 12',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  pen: 'M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  reply: 'M9 17l-5-5 5-5 M20 18v-2a4 4 0 0 0-4-4H4',
  heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z',
  quote: 'M6 17h3l2-4V7H5v6h3z M14 17h3l2-4V7h-6v6h3z',
  repeat: 'M17 1l4 4-4 4 M3 11V9a4 4 0 0 1 4-4h14 M7 23l-4-4 4-4 M21 13v2a4 4 0 0 1-4 4H3',
  more: 'M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0 M19 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0 M5 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
  sparkle: 'M12 3l1.9 5.6 5.6 1.9-5.6 1.9L12 18l-1.9-5.6-5.6-1.9 5.6-1.9z M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  'chevron-left': 'M15 18l-6-6 6-6',
  'chevron-up': 'M6 15l6-6 6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  check: 'M20 6 9 17l-5-5',
  lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z M7 11V7a5 5 0 0 1 10 0v4',
  archive: 'M3 4h18v4H3z M5 8v12h14V8 M10 12h4',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 16v-4 M12 8h.01',
  bolt: 'M13 2 3 14h9l-1 8 10-12h-9z',
  dot: 'M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0'
};
const svgNode = (tag, attrs) => { const node = document.createElementNS(SVG, tag); for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value); return node; };
export function createIcon(name, className = '') {
  const svg = svgNode('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false', class: `icon icon-${name}${className ? ' ' + className : ''}` });
  svg.append(svgNode('path', { d: ICONS[name] ?? ICONS.dot }));
  return svg;
}
// The wordmark: "rolling" in ink, "chat" in brand violet, beside the rolling-bubble tile.
export function createBrand() {
  const tile = document.createElement('span');
  tile.className = 'brand-tile';
  tile.setAttribute('aria-hidden', 'true');
  const mark = svgNode('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  mark.append(svgNode('path', { d: 'M12 3.5a8.5 8.5 0 1 1-4.1 15.9L4 20.5l1.1-3.7A8.5 8.5 0 0 1 12 3.5z' }), svgNode('path', { d: 'M15.6 10.3a4 4 0 1 0 .3 3.2' }), svgNode('path', { d: 'M16.4 9.2v2.6h-2.6' }));
  tile.append(mark);
  const word = document.createElement('span');
  word.className = 'brand-word';
  word.append('rolling');
  const chat = document.createElement('span');
  chat.className = 'brand-chat';
  chat.textContent = 'chat';
  word.append(chat);
  return [tile, word];
}
// Placeholder cards shown while a feed loads. Decorative: the visible status text
// beside them carries the announcement.
export function createSkeletonFeed(count = 3) {
  const list = document.createElement('div');
  list.className = 'feed-skeleton';
  list.setAttribute('aria-hidden', 'true');
  const block = (className) => { const node = document.createElement('div'); node.className = className; return node; };
  for (let i = 0; i < count; i++) {
    const card = block('skeleton-post');
    card.style.setProperty('--i', String(i));
    const top = block('skeleton-row'), meta = block('skeleton-meta');
    meta.append(block('skeleton w-35'), block('skeleton w-20'));
    top.append(block('skeleton avatar'), meta);
    card.append(top, block('skeleton tall w-100'), block('skeleton tall w-85'), block('skeleton tall w-60'));
    list.append(card);
  }
  return list;
}
// Board tiles: a stable accent per board identifier and the board's initial.
export function boardTone(id) { let hash = 0; for (const char of String(id ?? '')) hash = (hash * 31 + char.charCodeAt(0)) >>> 0; return 'tone-' + (hash % 6 + 1); }
export function boardInitial(name) { const trimmed = String(name ?? '').trim(); return trimmed ? [...trimmed][0].toUpperCase() : '#'; }
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

// A reader control owns one captured action until it settles. An uncertain
// result can be inspected, but this control cannot submit it a second time.
export function createInlineAction({action,perform,onState}) {
  let pending=null,uncertain=null;
  return function run() {
    if(pending)return pending;
    if(uncertain)return Promise.resolve(uncertain);
    const captured=Object.freeze({...action()});
    onState('pending',captured);
    let active=true,included=false;
    const onIncluded=()=>{if(active&&!included){included=true;onState('included',captured);}};
    pending=Promise.resolve().then(()=>perform(captured,onIncluded)).then(result=>{
      if(!['included','confirmed','reverted','blocked','cancelled','failed','unknown'].includes(result?.status))result={status:'unknown'};
      if(result.status==='unknown')uncertain=result;
      onState(result.status,captured,result);return result;
    },()=>{
      uncertain={status:'unknown'};onState('unknown',captured,uncertain);return uncertain;
    }).finally(()=>{active=false;pending=null;});
    return pending;
  };
}

// Only in-flight presentation survives renderer replacement. The wallet owns
// transaction state; completing or rejecting an action removes this entry.
export function createInlineActionRegistry({perform,onState}) {
 const active=new Map();
 return Object.freeze({
  snapshot:key=>active.get(key)?.snapshot??null,
  run(key,action){
   if(active.has(key))return active.get(key).pending;
   const entry={snapshot:null,pending:null};active.set(key,entry);
   const run=createInlineAction({action,perform,onState(state,captured,result){entry.snapshot={state,captured,result};onState(key,entry.snapshot);}});
   try{entry.pending=run().finally(()=>{if(active.get(key)===entry)active.delete(key);});return entry.pending;}
   catch(error){active.delete(key);throw error;}
  }
 });
}

// Unknown saved choices are never interpreted as disabled settings. Only a
// validated boolean supplies an inverse action.
export function savedPreferenceControl(label,value,status,loading=false){
 if(typeof value!=='boolean'){const busy=status==='recovering'&&loading;return {label,disabled:busy,busy,enabled:undefined};}
 return {label:value?({'Bookmark':'Unbookmark','Follow board':'Unfollow board','Follow name':'Unfollow name'}[label]??'Remove '+label):label,disabled:false,busy:false,enabled:!value};
}

// Saved lists are off-chain selections. Capture bounded identifiers before a
// public request; labels are display hints and never select a post or identity.
export function savedReaderSelection(view,snapshot){
 const fail=()=>{throw Error('Saved items are unavailable.');};
 if(!snapshot||!['following','bookmarks'].includes(view))return fail();
 const ids=key=>{const value=snapshot[key];if(!Array.isArray(value)||value.length>100||value.some(id=>typeof id!=='string'||!/^(0|[1-9][0-9]{0,76})$/.test(id)||key!=='followedBoards'&&id==='0'||BigInt(id)>=0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001n)||new Set(value).size!==value.length)return fail();return [...value];};
 const bookmarks=ids('bookmarks'),boards=ids('followedBoards'),names=ids('followedNames');if(boards.length+names.length>100)return fail();
 const label=(kind,id)=>{const value=snapshot.labels?.[kind]?.[id];return typeof value==='string'&&value.length<=128?value:'';};
 return {api:view,parameters:view==='bookmarks'?{ids:bookmarks.join(','),limit:30}:{boards:boards.join(','),names:names.join(','),limit:30},bookmarks,boards,names,
  following:[...boards.map(id=>({id,kind:'board',label:label('boards',id)||(id==='0'?'Main board':'Board '+id)})),...names.map(id=>({id,kind:'profile',label:label('names',id)||'Named profile '+id}))]};
}
export function savedReaderRoute(route){return /^\/(notifications)(?:\/|$)/.test(route)?'/home':route;}

// Conversations. A thread page arrives in chain order, so a parent is always
// present before its replies; the tree is rebuilt from each record's parent. A
// reply whose parent is not in the loaded conversation sits at root level and
// keeps its "In reply to" line instead of being hidden or re-parented.
const threadParent = post => { const value = post?.record?.parent ?? post?.parent ?? null; return value === '0' || value === '' ? null : value; };
const threadRoot = post => post?.record?.root ?? post?.root ?? null;
export function threadTree(posts, root, parentOf = threadParent, rootOf = threadRoot) {
  const nodes = new Map(), order = [];
  for (const post of posts) { const id = post?.id; if (typeof id !== 'string' || nodes.has(id)) continue; nodes.set(id, { id, post, parent: null, children: [], depth: 0, descendants: 0, orphan: false }); order.push(id); }
  const top = nodes.get(root) ?? { id: root, post: null, parent: null, children: [], depth: 0, descendants: 0, orphan: false, virtual: true };
  const placed = new Set([root]);
  for (const id of order) {
    if (id === root) continue;
    // A post that names another conversation is listed, never nested or nested under.
    const node = nodes.get(id), parentId = parentOf(node.post), claimed = rootOf(node.post), foreign = claimed !== null && claimed !== root;
    const parent = !foreign && parentId !== null && parentId !== id && placed.has(parentId) ? (nodes.get(parentId) ?? top) : null;
    node.orphan = foreign || parent === null && parentId !== null && parentId !== root;
    node.parent = parent ?? top; node.depth = node.parent.depth + 1; node.parent.children.push(node); if (!foreign) placed.add(id);
  }
  for (let i = order.length - 1; i >= 0; i--) { const node = nodes.get(order[i]); if (node === top) continue; node.parent.descendants += node.descendants + 1; }
  return { root: top, nodes, order };
}
// Fold policy, Reddit-style: direct replies stay open, deep or busy branches fold,
// and anything the reader opened or collapsed by hand wins over the defaults.
export const THREAD_POLICY = Object.freeze({ quietDepth: 3, continueDepth: 5, fanOut: 5 });
export function threadFolds(tree, signals, state, policy = THREAD_POLICY) {
  const info = new Map();
  const describe = node => { if (info.has(node.id)) return info.get(node.id); const own = node.post ? signals(node.post) : {}; const children = node.children.map(describe); const value = { likes: Number(own.likes) || 0, bot: Boolean(own.bot), removed: Boolean(own.removed), keep: Boolean(own.pending), branchBot: Boolean(own.bot), branchKeep: Boolean(own.pending) }; for (const child of children) { value.branchBot ||= child.branchBot; value.branchKeep ||= child.branchKeep; } info.set(node.id, value); return value; };
  describe(tree.root);
  const folds = new Map(), groups = new Map();
  const visit = node => {
    const group = { kind: null, hidden: [], count: 0 };
    node.children.forEach((child, index) => {
      const own = info.get(child.id);
      let hidden = null;
      if (child.depth === policy.continueDepth && !own.branchKeep && !state.expanded.has('deep:' + node.id)) hidden = 'deep';
      else if (child.depth >= 2 && index >= policy.fanOut && !own.branchKeep && !state.expanded.has('more:' + node.id)) hidden = 'more';
      let collapsed = false;
      if (state.collapsed.has(child.id)) collapsed = true;
      else if (!state.expanded.has(child.id) && !own.branchKeep) collapsed = own.removed || child.depth >= policy.quietDepth && own.likes === 0 && !own.branchBot && node.children.length > 1;
      folds.set(child.id, { collapsed, hidden });
      if (hidden) { group.kind = hidden; group.hidden.push(child.id); group.count += child.descendants + 1; }
      visit(child);
    });
    if (group.kind) groups.set(node.id, group);
  };
  visit(tree.root);
  return { folds, groups };
}
// Shared DOM controller for a conversation: places rendered posts under their parent,
// draws the thread line and collapse controls, applies the fold policy and keeps the
// reader's choices across pages, live refreshes and Back. Renderers keep ownership of
// the article itself; only `.post-top` is read for the collapsed summary.
export function createThreadView({ root, signals, state, announce = () => {}, policy = THREAD_POLICY, parentOf = threadParent, rootOf = threadRoot, icon = createIcon }) {
  const posts = [], articles = new Map(), wrappers = new Map(), branches = new Map(), expanders = new Map();
  let container = null, rootBranch = null, pending = [];
  const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const control = (className, label) => { const node = make('button', className); node.type = 'button'; node.setAttribute('aria-label', label); return node; };
  const author = article => article.querySelector('.author')?.textContent?.trim() || 'this post';
  const plural = (count, one = 'reply', many = 'replies') => count + ' ' + (count === 1 ? one : many);
  function branchFor(id, depth) {
    if (id === root) { if (!rootBranch) { rootBranch = make('div', 'replies thread-replies'); container.append(rootBranch); } return rootBranch; }
    let branch = branches.get(id);
    if (!branch) { branch = make('div', 'replies' + (depth >= 5 ? ' deep' : '') + (depth >= 3 ? ' deep-m' : '')); wrappers.get(id).append(branch); branches.set(id, branch); }
    return branch;
  }
  function wrap(node) {
    const article = articles.get(node.id), wrapper = make('div', 'comment'), line = control('thread-line', 'Collapse replies from ' + author(article)), toggle = control('collapse-toggle', 'Collapse replies from ' + author(article)), summary = control('comment-collapsed', 'Expand replies from ' + author(article));
    wrapper.dataset.post = node.id; wrapper.dataset.depth = String(node.depth); if (node.orphan) wrapper.classList.add('orphan'); else article.querySelector('[data-parent-line]')?.remove();
    const own = node.post ? signals(node.post) : {}; if (own.bot) wrapper.classList.add('bot');
    toggle.append(icon('chevron-up')); summary.append(icon('plus'));
    for (const button of [line, toggle, summary]) button.addEventListener('click', () => toggle_(node.id));
    wrapper.append(line, toggle, summary, article); wrappers.set(node.id, wrapper);
    return wrapper;
  }
  function refresh() {
    const tree = threadTree(posts, root, parentOf, rootOf), { folds, groups } = threadFolds(tree, signals, state, policy);
    for (const [id, fold] of folds) {
      const wrapper = wrappers.get(id), article = articles.get(id), node = tree.nodes.get(id); if (!wrapper) continue;
      wrapper.hidden = Boolean(fold.hidden); wrapper.toggleAttribute('data-collapsed', fold.collapsed); article.hidden = fold.collapsed;
      const branch = branches.get(id); if (branch) branch.hidden = fold.collapsed;
      const label = (fold.collapsed ? 'Expand' : 'Collapse') + ' replies from ' + author(article);
      for (const selector of ['.thread-line', '.collapse-toggle']) { const button = wrapper.querySelector(':scope > ' + selector); button.setAttribute('aria-label', label); button.setAttribute('aria-expanded', String(!fold.collapsed)); }
      const summary = wrapper.querySelector(':scope > .comment-collapsed'); summary.setAttribute('aria-label', label);
      const own = node.post ? signals(node.post) : {};
      summary.replaceChildren(icon('plus'), make('strong', '', author(article)), ...(own.removed ? [make('span', 'comment-note', 'removed')] : []), make('span', 'comment-time', article.querySelector('.post-time')?.textContent ?? ''), make('span', 'comment-count', node.descendants ? plural(node.descendants) : 'no replies'));
    }
    for (const [id, expander] of expanders) if (!groups.has(id)) { expander.remove(); expanders.delete(id); }
    for (const [id, group] of groups) {
      let expander = expanders.get(id);
      if (!expander) { expander = make('button', 'thread-expander'); expander.type = 'button'; expanders.set(id, expander); }
      // A reused expander can change from a depth fold to a sibling fold.
      expander.onclick = () => { state.expanded.add(group.kind + ':' + id); refresh(); const first = wrappers.get(group.hidden[0])?.querySelector('article'); if (first) { first.tabIndex = -1; first.focus({ preventScroll: true }); } announce(plural(group.count, 'reply') + ' shown.'); };
      expander.replaceChildren(icon(group.kind === 'deep' ? 'reply' : 'plus'), group.kind === 'deep' ? 'Continue this conversation · ' + plural(group.count) : 'Show ' + plural(group.count, 'more reply', 'more replies')); expander.dataset.kind = group.kind;
      const branch = id === root ? rootBranch : branches.get(id); if (branch && expander.parentNode !== branch) branch.append(expander);
    }
    return tree;
  }
  function toggle_(id) {
    const wrapper = wrappers.get(id); if (!wrapper) return;
    const collapsed = !wrapper.hasAttribute('data-collapsed');
    if (collapsed) { state.collapsed.add(id); state.expanded.delete(id); } else { state.collapsed.delete(id); state.expanded.add(id); }
    refresh();
    const article = articles.get(id); const focus = collapsed ? wrapper.querySelector(':scope > .comment-collapsed') : wrapper.querySelector(':scope > .collapse-toggle'); focus?.focus({ preventScroll: true });
    announce('Replies from ' + author(article) + (collapsed ? ' hidden.' : ' shown.'));
  }
  return Object.freeze({
    mount(node) { container = node; },
    add(post, article) { if (!container || typeof post?.id !== 'string' || articles.has(post.id)) return; posts.push(post); articles.set(post.id, article); pending.push(post.id); },
    commit() {
      if (!pending.length) return;
      const tree = threadTree(posts, root, parentOf, rootOf), fresh = new Set(pending); pending = [];
      for (const id of tree.order) {
        if (!fresh.has(id)) continue;
        const node = tree.nodes.get(id);
        if (id === root) { container.prepend(articles.get(id)); continue; }
        const branch = branchFor(node.parent.id, node.depth), wrapper = wrap(node), index = node.parent.children.indexOf(node);
        wrapper.style.setProperty('--i', String(Math.min(index, 8)));
        const expander = expanders.get(node.parent.id); if (expander && expander.parentNode === branch) branch.insertBefore(wrapper, expander); else branch.append(wrapper);
      }
      refresh();
    },
    toggle: toggle_,
    // Open every fold on the way to a post, e.g. before focusing a reply just included.
    reveal(id) {
      if (!articles.has(id)) return false;
      const tree = threadTree(posts, root, parentOf, rootOf); let node = tree.nodes.get(id);
      while (node && node.parent) { state.collapsed.delete(node.id); state.expanded.add(node.id); state.expanded.add('more:' + node.parent.id); state.expanded.add('deep:' + node.parent.id); node = node.parent; }
      refresh(); return true;
    },
    has: id => articles.has(id),
    size: () => posts.length
  });
}
