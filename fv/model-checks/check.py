#!/usr/bin/env python3
"""Finite executable specifications; not implementation or cryptographic proofs."""
import hashlib
import json
import platform
import time
from collections import deque
from dataclasses import dataclass, replace
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
START = time.monotonic()

def explore(initial, successors, invariant, depth, mutation=None):
    queue = deque([(initial, ())]); seen = {initial}; edges = 0
    while queue:
        state, trace = queue.popleft()
        if len(trace) == depth:
            continue
        for action, nxt in successors(state, mutation):
            edges += 1
            error = invariant(state, action, nxt)
            if error:
                return {'states': len(seen), 'edges': edges, 'counterexample': list(trace + (action,)), 'violation': error}
            if nxt not in seen:
                seen.add(nxt); queue.append((nxt, trace + (action,)))
        if len(seen) > 150000 or time.monotonic() - START > 30:
            raise RuntimeError('Model exploration resource bound exceeded')
    return {'states': len(seen), 'edges': edges, 'counterexample': None}

@dataclass(frozen=True)
class Bridge:
    # Two owners, amounts 1/2, at most two receipt generations each.
    nonce: tuple = (0, 0)
    active: tuple = (0, 0)
    claimed: frozenset = frozenset()
    notes: tuple = ()
    exits: frozenset = frozenset()
    consumed: frozenset = frozenset()
    total: int = 0
    balance: int = 0
    surplus: int = 0
    paid_in: int = 0
    paid_out: int = 0

def set_at(values, i, v):
    return values[:i] + (v,) + values[i+1:]

def bridge_steps(s, mutation):
    # Activation/authenticated full network scope are preconditions of this model.
    for owner in range(2):
        if s.active[owner] == 0 and s.nonce[owner] < 2:
            for amount in (1, 2):
                yield f'deposit({owner},{amount})', replace(s, nonce=set_at(s.nonce, owner, s.nonce[owner]+1), active=set_at(s.active, owner, amount), total=s.total+amount, balance=s.balance+amount, paid_in=s.paid_in+amount)
        amount = s.active[owner]
        receipt = (owner, s.nonce[owner], amount)
        if amount and (receipt not in s.claimed or mutation == 'duplicate-claim'):
            yield f'claim({owner},{s.nonce[owner]})', replace(s, claimed=s.claimed | {receipt}, notes=tuple(sorted(s.notes+(receipt,))))
        if receipt in s.notes:
            notes = list(s.notes); notes.remove(receipt)
            yield f'exit({owner},{s.nonce[owner]})', replace(s, notes=tuple(notes), exits=s.exits | {receipt})
        if amount and receipt in s.exits and receipt not in s.consumed:
            yield f'refund({owner},{s.nonce[owner]})', replace(s, active=set_at(s.active, owner, 0), consumed=s.consumed | {receipt}, total=s.total-amount, balance=s.balance-amount, paid_out=s.paid_out+amount)
            # EVM rollback on failed payment/proof preserves every field.
            yield f'failed-refund({owner})', s
    if s.surplus == 0:
        yield 'force-surplus(1)', replace(s, surplus=1, balance=s.balance+1)

def bridge_invariant(old, action, s):
    if s.total != sum(s.active) or s.balance != s.total+s.surplus or s.paid_in-s.paid_out != s.total:
        return 'portal liabilities/value conservation'
    if len(s.notes) != len(set(s.notes)):
        return 'one live deposit note per consumed receipt'
    if action.startswith('claim') and s.claimed == old.claimed:
        return 'receipt may be claimed only once'
    if not s.consumed <= s.exits or s.paid_out > s.paid_in:
        return 'refund requires unique authenticated exit'

@dataclass(frozen=True)
class Screening:
    now: int = 0
    due: int = 1
    # Each note: (dummy, immutable inclusion deadline, flagged).
    posts: tuple = ()
    screened: int = 0
    last_real: int = 0
    withdrawn: bool = False

def screening_steps(s, mutation):
    if s.withdrawn:
        return
    if s.now < 7:
        yield 'tick', replace(s, now=s.now+1)
    # Cooldown=1, penalty multiplier=3, save-up cap=2; no overflow in this domain.
    if len(s.posts) < 3 and s.now >= s.due:
        cursor = s.screened; flags = 0
        for _ in range(2):
            if cursor == len(s.posts):
                break
            dummy, deadline, flagged = s.posts[cursor]
            if not dummy and s.now < deadline:
                if mutation == 'skipped-screening':
                    cursor += 1
                break
            flags += int(flagged and not dummy); cursor += 1
        due = max(s.due, max(0, s.now-1)) + 1 + 2*flags
        for dummy in (False, True):
            yield 'post-dummy' if dummy else 'post-real', replace(s, due=due, posts=s.posts+((dummy,s.now+2,False),), screened=cursor, last_real=s.last_real if dummy else len(s.posts)+1)
    for i, (dummy, deadline, flagged) in enumerate(s.posts):
        if not dummy and not flagged and s.now < deadline:
            yield f'flag({i+1})', replace(s, posts=set_at(s.posts, i, (dummy,deadline,True)))
    if s.screened >= s.last_real and (s.now >= s.due or (mutation == 'debt-reset' and any(flagged for _, _, flagged in s.posts[:s.screened]))):
        yield 'withdraw', replace(s, withdrawn=True)

def screening_invariant(old, action, s):
    if s.screened < old.screened or s.screened > len(old.posts) or s.screened-old.screened > 2:
        return 'screening is monotone and at most two existing notes per post'
    if action.startswith('post'):
        for dummy, deadline, _ in old.posts[old.screened:s.screened]:
            if not dummy and old.now < deadline:
                return 'screening must not skip an immature real predecessor'
        flags = sum(int(flagged and not dummy) for dummy, _, flagged in old.posts[old.screened:s.screened])
        if s.due != max(old.due, max(0, old.now-1))+1+2*flags:
            return 'each newly screened flag contributes exactly one penalty'
    if action == 'withdraw' and (old.now < old.due or old.screened < old.last_real):
        return 'withdrawal preserves outstanding screening and cooldown debt'

if __name__ == '__main__':
    results = {}
    for name, initial, steps, invariant, depth, mutants in [
        ('bridge', Bridge(), bridge_steps, bridge_invariant, 9, ['duplicate-claim']),
        ('screening', Screening(), screening_steps, screening_invariant, 11, ['skipped-screening','debt-reset']),
    ]:
        result = explore(initial, steps, invariant, depth)
        assert result['counterexample'] is None, result
        results[name] = {'depth': depth, 'correct': result, 'mutations': {}}
        for mutant in mutants:
            result = explore(initial, steps, invariant, depth, mutant)
            assert result['counterexample'] is not None, f'Undetected mutation: {mutant}'
            results[name]['mutations'][mutant] = result
    sources = ['billboard/portal/src/PortalMessages.sol','billboard/portal/src/BillboardPortal.sol','billboard/billboard_contract/src/main.nr','billboard/billboard_contract/src/lib.nr']
    print(json.dumps({'runtime':{'implementation':platform.python_implementation(),'version':platform.python_version()},'scope':'finite abstract transition checking, not contract or cryptographic proof','sources':{p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in sources},'results':results,'elapsedSeconds':round(time.monotonic()-START,3)},indent=2))
