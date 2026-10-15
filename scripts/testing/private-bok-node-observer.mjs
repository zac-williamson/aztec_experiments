// TEST ONLY. Actual in-process SDK calls; neither wire capture nor anonymity evidence.
import assert from 'node:assert/strict';
import {createT03RpcObserver} from '../t03-rpc-observer.mjs';

export function createPrivateBokNodeObserver({maxObservations = 2000} = {}) {
  const humans = new Map(), proxies = new WeakMap();
  let operatorObserver, operatorAddress, instrumentationErrors = 0;
  const address = value => {
    const text = typeof value === 'string' ? value : value.toString();
    assert(/^0x[0-9a-fA-F]{64}$/.test(text), 'Expected disposable Aztec identity');
    return text.toLowerCase();
  };
  const safely = action => { try { return action(); } catch { instrumentationErrors++; } };
  function observeNode({node, human, operator, role}) {
    assert(['owner', 'otherUser'].includes(role) && !humans.has(role), 'Distinct observer role required');
    const humanAddress = address(human), publicOperator = address(operator);
    assert(humanAddress !== publicOperator, 'Human and operator must differ');
    assert(!operatorAddress || operatorAddress === publicOperator, 'Operator changed');
    assert(![...humans.values()].some(entry => entry.address === humanAddress), 'Human roles must differ');
    if (!operatorObserver) {
      operatorAddress = publicOperator;
      // T03's payer role is the explicitly public operator, not either human.
      operatorObserver = createT03RpcObserver({roles: {payer: publicOperator}, maxObservations});
    }
    humans.set(role, {address: humanAddress,
      observer: createT03RpcObserver({roles: {author: humanAddress}, maxObservations})});
    if (proxies.has(node)) return proxies.get(node);
    const wrappers = new Map();
    const proxy = new Proxy(node, {get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      if (wrappers.get(key)?.source === value) return wrappers.get(key).wrapped;
      const wrapped = (...args) => {
        // begin classifies synchronously; closures retain no request arguments.
        const completions = [...humans.values()].map(({observer}) =>
          safely(() => observer.begin('aztec', key, args)));
        completions.push(safely(() => operatorObserver.begin('aztec', key, args)));
        const complete = success => completions.forEach(done => safely(() => done?.(success)));
        let result;
        try { result = Reflect.apply(value, target, args); }
        catch (error) { complete(false); throw error; }
        // Preserve the original SDK promise, value and thrown object. No retries,
        // response traversal, raw errors, or extra node calls. SDK methods return
        // native Promises; use the intrinsic rather than an arbitrary then getter.
        if (result instanceof Promise) Promise.prototype.then.call(result,
          () => complete(true), () => complete(false));
        else complete(true);
        return result;
      };
      wrappers.set(key, {source: value, wrapped});
      return wrapped;
    }});
    proxies.set(node, proxy);
    return proxy;
  }
  function snapshot() {
    const humanSnapshots = Object.fromEntries([...humans].map(([role, {observer}]) => [role, observer.snapshot()]));
    const publicOperator = operatorObserver?.snapshot();
    const matches = (record, role) => record?.rows.filter(row => row.method === 'getContract'
      && row.roles.includes(role)).reduce((sum, row) => sum + row.count, 0) ?? 0;
    return {schema: 'private-bok-node-observer-v1',
      scope: 'in-process SDK node calls; not network capture',
      interpretation: 'Address matches establish disclosure to this node interface; absence is inconclusive, never anonymity acceptance',
      humanRole: 'author', publicOperatorRole: 'payer', instrumentationErrors,
      humans: humanSnapshots, ...(publicOperator ? {publicOperator} : {}),
      getContractMatches: Object.fromEntries(Object.entries(humanSnapshots).map(([role, record]) => [role, matches(record, 'author')])),
      operatorGetContractPositiveControl: matches(publicOperator, 'payer') > 0,
      derivedIdentifierCorrelationMeasured: false};
  }
  return {observeNode, snapshot};
}
