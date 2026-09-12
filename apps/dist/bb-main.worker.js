// node_modules/comlink/dist/esm/comlink.mjs
var proxyMarker = Symbol("Comlink.proxy");
var createEndpoint = Symbol("Comlink.endpoint");
var releaseProxy = Symbol("Comlink.releaseProxy");
var finalizer = Symbol("Comlink.finalizer");
var throwMarker = Symbol("Comlink.thrown");
var isObject = (val) => typeof val === "object" && val !== null || typeof val === "function";
var proxyTransferHandler = {
  canHandle: (val) => isObject(val) && val[proxyMarker],
  serialize(obj) {
    const { port1, port2 } = new MessageChannel();
    expose(obj, port1);
    return [port2, [port2]];
  },
  deserialize(port) {
    port.start();
    return wrap(port);
  }
};
var throwTransferHandler = {
  canHandle: (value) => isObject(value) && throwMarker in value,
  serialize({ value }) {
    let serialized;
    if (value instanceof Error) {
      serialized = {
        isError: true,
        value: {
          message: value.message,
          name: value.name,
          stack: value.stack
        }
      };
    } else {
      serialized = { isError: false, value };
    }
    return [serialized, []];
  },
  deserialize(serialized) {
    if (serialized.isError) {
      throw Object.assign(new Error(serialized.value.message), serialized.value);
    }
    throw serialized.value;
  }
};
var transferHandlers = /* @__PURE__ */ new Map([
  ["proxy", proxyTransferHandler],
  ["throw", throwTransferHandler]
]);
function isAllowedOrigin(allowedOrigins, origin) {
  for (const allowedOrigin of allowedOrigins) {
    if (origin === allowedOrigin || allowedOrigin === "*") {
      return true;
    }
    if (allowedOrigin instanceof RegExp && allowedOrigin.test(origin)) {
      return true;
    }
  }
  return false;
}
function expose(obj, ep = globalThis, allowedOrigins = ["*"]) {
  ep.addEventListener("message", function callback(ev) {
    if (!ev || !ev.data) {
      return;
    }
    if (!isAllowedOrigin(allowedOrigins, ev.origin)) {
      console.warn(`Invalid origin '${ev.origin}' for comlink proxy`);
      return;
    }
    const { id, type, path } = Object.assign({ path: [] }, ev.data);
    const argumentList = (ev.data.argumentList || []).map(fromWireValue);
    let returnValue;
    try {
      const parent = path.slice(0, -1).reduce((obj2, prop) => obj2[prop], obj);
      const rawValue = path.reduce((obj2, prop) => obj2[prop], obj);
      switch (type) {
        case "GET":
          {
            returnValue = rawValue;
          }
          break;
        case "SET":
          {
            parent[path.slice(-1)[0]] = fromWireValue(ev.data.value);
            returnValue = true;
          }
          break;
        case "APPLY":
          {
            returnValue = rawValue.apply(parent, argumentList);
          }
          break;
        case "CONSTRUCT":
          {
            const value = new rawValue(...argumentList);
            returnValue = proxy(value);
          }
          break;
        case "ENDPOINT":
          {
            const { port1, port2 } = new MessageChannel();
            expose(obj, port2);
            returnValue = transfer(port1, [port1]);
          }
          break;
        case "RELEASE":
          {
            returnValue = void 0;
          }
          break;
        default:
          return;
      }
    } catch (value) {
      returnValue = { value, [throwMarker]: 0 };
    }
    Promise.resolve(returnValue).catch((value) => {
      return { value, [throwMarker]: 0 };
    }).then((returnValue2) => {
      const [wireValue, transferables] = toWireValue(returnValue2);
      ep.postMessage(Object.assign(Object.assign({}, wireValue), { id }), transferables);
      if (type === "RELEASE") {
        ep.removeEventListener("message", callback);
        closeEndPoint(ep);
        if (finalizer in obj && typeof obj[finalizer] === "function") {
          obj[finalizer]();
        }
      }
    }).catch((error) => {
      const [wireValue, transferables] = toWireValue({
        value: new TypeError("Unserializable return value"),
        [throwMarker]: 0
      });
      ep.postMessage(Object.assign(Object.assign({}, wireValue), { id }), transferables);
    });
  });
  if (ep.start) {
    ep.start();
  }
}
function isMessagePort(endpoint) {
  return endpoint.constructor.name === "MessagePort";
}
function closeEndPoint(endpoint) {
  if (isMessagePort(endpoint))
    endpoint.close();
}
function wrap(ep, target) {
  const pendingListeners = /* @__PURE__ */ new Map();
  ep.addEventListener("message", function handleMessage(ev) {
    const { data } = ev;
    if (!data || !data.id) {
      return;
    }
    const resolver = pendingListeners.get(data.id);
    if (!resolver) {
      return;
    }
    try {
      resolver(data);
    } finally {
      pendingListeners.delete(data.id);
    }
  });
  return createProxy(ep, pendingListeners, [], target);
}
function throwIfProxyReleased(isReleased) {
  if (isReleased) {
    throw new Error("Proxy has been released and is not useable");
  }
}
function releaseEndpoint(ep) {
  return requestResponseMessage(ep, /* @__PURE__ */ new Map(), {
    type: "RELEASE"
  }).then(() => {
    closeEndPoint(ep);
  });
}
var proxyCounter = /* @__PURE__ */ new WeakMap();
var proxyFinalizers = "FinalizationRegistry" in globalThis && new FinalizationRegistry((ep) => {
  const newCount = (proxyCounter.get(ep) || 0) - 1;
  proxyCounter.set(ep, newCount);
  if (newCount === 0) {
    releaseEndpoint(ep);
  }
});
function registerProxy(proxy2, ep) {
  const newCount = (proxyCounter.get(ep) || 0) + 1;
  proxyCounter.set(ep, newCount);
  if (proxyFinalizers) {
    proxyFinalizers.register(proxy2, ep, proxy2);
  }
}
function unregisterProxy(proxy2) {
  if (proxyFinalizers) {
    proxyFinalizers.unregister(proxy2);
  }
}
function createProxy(ep, pendingListeners, path = [], target = function() {
}) {
  let isProxyReleased = false;
  const proxy2 = new Proxy(target, {
    get(_target, prop) {
      throwIfProxyReleased(isProxyReleased);
      if (prop === releaseProxy) {
        return () => {
          unregisterProxy(proxy2);
          releaseEndpoint(ep);
          pendingListeners.clear();
          isProxyReleased = true;
        };
      }
      if (prop === "then") {
        if (path.length === 0) {
          return { then: () => proxy2 };
        }
        const r = requestResponseMessage(ep, pendingListeners, {
          type: "GET",
          path: path.map((p) => p.toString())
        }).then(fromWireValue);
        return r.then.bind(r);
      }
      return createProxy(ep, pendingListeners, [...path, prop]);
    },
    set(_target, prop, rawValue) {
      throwIfProxyReleased(isProxyReleased);
      const [value, transferables] = toWireValue(rawValue);
      return requestResponseMessage(ep, pendingListeners, {
        type: "SET",
        path: [...path, prop].map((p) => p.toString()),
        value
      }, transferables).then(fromWireValue);
    },
    apply(_target, _thisArg, rawArgumentList) {
      throwIfProxyReleased(isProxyReleased);
      const last = path[path.length - 1];
      if (last === createEndpoint) {
        return requestResponseMessage(ep, pendingListeners, {
          type: "ENDPOINT"
        }).then(fromWireValue);
      }
      if (last === "bind") {
        return createProxy(ep, pendingListeners, path.slice(0, -1));
      }
      const [argumentList, transferables] = processArguments(rawArgumentList);
      return requestResponseMessage(ep, pendingListeners, {
        type: "APPLY",
        path: path.map((p) => p.toString()),
        argumentList
      }, transferables).then(fromWireValue);
    },
    construct(_target, rawArgumentList) {
      throwIfProxyReleased(isProxyReleased);
      const [argumentList, transferables] = processArguments(rawArgumentList);
      return requestResponseMessage(ep, pendingListeners, {
        type: "CONSTRUCT",
        path: path.map((p) => p.toString()),
        argumentList
      }, transferables).then(fromWireValue);
    }
  });
  registerProxy(proxy2, ep);
  return proxy2;
}
function myFlat(arr) {
  return Array.prototype.concat.apply([], arr);
}
function processArguments(argumentList) {
  const processed = argumentList.map(toWireValue);
  return [processed.map((v) => v[0]), myFlat(processed.map((v) => v[1]))];
}
var transferCache = /* @__PURE__ */ new WeakMap();
function transfer(obj, transfers) {
  transferCache.set(obj, transfers);
  return obj;
}
function proxy(obj) {
  return Object.assign(obj, { [proxyMarker]: true });
}
function toWireValue(value) {
  for (const [name, handler] of transferHandlers) {
    if (handler.canHandle(value)) {
      const [serializedValue, transferables] = handler.serialize(value);
      return [
        {
          type: "HANDLER",
          name,
          value: serializedValue
        },
        transferables
      ];
    }
  }
  return [
    {
      type: "RAW",
      value
    },
    transferCache.get(value) || []
  ];
}
function fromWireValue(value) {
  switch (value.type) {
    case "HANDLER":
      return transferHandlers.get(value.name).deserialize(value.value);
    case "RAW":
      return value.value;
  }
}
function requestResponseMessage(ep, pendingListeners, msg, transfers) {
  return new Promise((resolve) => {
    const id = generateUUID();
    pendingListeners.set(id, resolve);
    if (ep.start) {
      ep.start();
    }
    ep.postMessage(Object.assign({ id }, msg), transfers);
  });
}
function generateUUID() {
  return new Array(4).fill(0).map(() => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(16)).join("-");
}

// node_modules/@aztec/bb.js/dest/browser/barretenberg_wasm/helpers/browser/index.js
function getSharedMemoryAvailable() {
  const globalScope = typeof window !== "undefined" ? window : globalThis;
  return typeof SharedArrayBuffer !== "undefined" && globalScope.crossOriginIsolated;
}
function getRemoteBarretenbergWasm(worker) {
  return wrap(worker);
}
function getNumCpu() {
  return navigator.hardwareConcurrency;
}
var Ready = { ready: true };
function readinessListener(worker, callback) {
  worker.addEventListener("message", function ready(event) {
    if (!!event.data && event.data.ready === true) {
      worker.removeEventListener("message", ready);
      callback();
    }
  });
}

// node_modules/@aztec/bb.js/dest/browser/barretenberg_wasm/barretenberg_wasm_thread/factory/browser/index.js
async function createThreadWorker() {
  const worker = new Worker(new URL("./bb-thread.worker.js", import.meta.url), { type: "module" });
  await new Promise((resolve) => readinessListener(worker, resolve));
  return worker;
}

// node_modules/@aztec/bb.js/dest/browser/random/browser/index.js
var randomBytes = (len) => {
  const getWebCrypto = () => {
    if (typeof window !== "undefined" && window.crypto)
      return window.crypto;
    if (typeof globalThis !== "undefined" && globalThis.crypto)
      return globalThis.crypto;
    return void 0;
  };
  const crypto = getWebCrypto();
  if (!crypto) {
    throw new Error("randomBytes UnsupportedEnvironment");
  }
  const buf = new Uint8Array(len);
  const MAX_BYTES = 65536;
  if (len > MAX_BYTES) {
    for (let generated = 0; generated < len; generated += MAX_BYTES) {
      crypto.getRandomValues(buf.subarray(generated, generated + MAX_BYTES));
    }
  } else {
    crypto.getRandomValues(buf);
  }
  return buf;
};

// node_modules/@aztec/bb.js/dest/browser/barretenberg_wasm/barretenberg_wasm_base/index.js
var BarretenbergWasmBase = class {
  memory;
  instance;
  logger = () => {
  };
  getImportObj(memory) {
    const importObj = {
      // We need to implement a part of the wasi api:
      // https://github.com/WebAssembly/WASI/blob/main/phases/snapshot/docs.md
      // We literally only need to support random_get, everything else is noop implementated in barretenberg.wasm.
      wasi_snapshot_preview1: {
        random_get: (out, length) => {
          out = out >>> 0;
          const randomData = randomBytes(length);
          const mem = this.getMemory();
          mem.set(randomData, out);
        },
        clock_time_get: (a1, a2, out) => {
          out = out >>> 0;
          const ts = BigInt((/* @__PURE__ */ new Date()).getTime()) * 1000000n;
          const view = new DataView(this.getMemory().buffer);
          view.setBigUint64(out, ts, true);
        },
        proc_exit: () => {
          this.logger("PANIC: proc_exit was called.");
          throw new Error();
        }
      },
      // These are functions implementations for imports we've defined are needed.
      // The native C++ build defines these in a module called "env". We must implement TypeScript versions here.
      env: {
        /**
         * The 'info' call we use for logging in C++, calls this under the hood.
         * The native code will just print to std:err (to avoid std::cout which is used for IPC).
         * Here we just emit the log line for the client to decide what to do with.
         */
        logstr: (addr) => {
          const str = this.stringFromAddress(addr);
          const m = this.getMemory();
          const str2 = `${str} (mem: ${(m.length / (1024 * 1024)).toFixed(2)}MiB)`;
          this.logger(str2);
        },
        throw_or_abort_impl: (addr) => {
          const str = this.stringFromAddress(addr);
          throw new Error(str);
        },
        memory
      }
    };
    return importObj;
  }
  exports() {
    return this.instance.exports;
  }
  /**
   * When returning values from the WASM, use >>> operator to convert signed representation to unsigned representation.
   */
  call(name, ...args) {
    if (!this.exports()[name]) {
      throw new Error(`WASM function ${name} not found.`);
    }
    try {
      return this.exports()[name](...args) >>> 0;
    } catch (err) {
      const message = `WASM function ${name} aborted, error: ${err}`;
      this.logger(message);
      this.logger(err.stack);
      throw err;
    }
  }
  memSize() {
    return this.getMemory().length;
  }
  /**
   * Returns a copy of the data, not a view.
   */
  getMemorySlice(start, end) {
    return this.getMemory().subarray(start, end).slice();
  }
  writeMemory(offset, arr) {
    const mem = this.getMemory();
    mem.set(arr, offset);
  }
  getMemory() {
    return new Uint8Array(this.memory.buffer);
  }
  // PRIVATE METHODS
  stringFromAddress(addr) {
    addr = addr >>> 0;
    const m = this.getMemory();
    let i = addr;
    for (; m[i] !== 0; ++i)
      ;
    const textDecoder = new TextDecoder("ascii");
    return textDecoder.decode(m.slice(addr, i));
  }
};

// node_modules/@aztec/bb.js/dest/browser/barretenberg_wasm/barretenberg_wasm_main/heap_allocator.js
var HeapAllocator = class {
  wasm;
  allocs = [];
  inScratchPtr = 0;
  // Next input starts here, grows UP
  outScratchPtr = 1024;
  // Next output ends here, grows DOWN
  constructor(wasm) {
    this.wasm = wasm;
  }
  getInputs(buffers) {
    return buffers.map((bufOrNum) => {
      if (typeof bufOrNum === "object") {
        const size = bufOrNum.length;
        if (this.inScratchPtr + size <= this.outScratchPtr) {
          const ptr = this.inScratchPtr;
          this.inScratchPtr += size;
          this.wasm.writeMemory(ptr, bufOrNum);
          return ptr;
        } else {
          const ptr = this.wasm.call("bbmalloc", size);
          this.wasm.writeMemory(ptr, bufOrNum);
          this.allocs.push(ptr);
          return ptr;
        }
      } else {
        return bufOrNum;
      }
    });
  }
  getOutputPtrs(outLens) {
    return outLens.map((len) => {
      const size = len || 4;
      if (this.inScratchPtr + size <= this.outScratchPtr) {
        this.outScratchPtr -= size;
        return this.outScratchPtr;
      } else {
        const ptr = this.wasm.call("bbmalloc", size);
        this.allocs.push(ptr);
        return ptr;
      }
    });
  }
  addOutputPtr(ptr) {
    if (ptr >= 1024) {
      this.allocs.push(ptr);
    }
  }
  freeAll() {
    for (const ptr of this.allocs) {
      this.wasm.call("bbfree", ptr);
    }
  }
};

// node_modules/@aztec/bb.js/dest/browser/barretenberg_wasm/barretenberg_wasm_main/index.js
var BarretenbergWasmMain = class _BarretenbergWasmMain extends BarretenbergWasmBase {
  static MAX_THREADS = 32;
  workers = [];
  remoteWasms = [];
  nextWorker = 0;
  nextThreadId = 1;
  useCustomLogger = false;
  // Pre-allocated scratch buffers for msgpack I/O to avoid malloc/free overhead
  msgpackInputScratch = 0;
  // 8MB input buffer
  msgpackOutputScratch = 0;
  // 8MB output buffer
  MSGPACK_SCRATCH_SIZE = 1024 * 1024 * 8;
  // 8MB
  getNumThreads() {
    return this.workers.length + 1;
  }
  /**
   * Init as main thread. Spawn child threads.
   */
  async init(module, threads = Math.min(getNumCpu(), _BarretenbergWasmMain.MAX_THREADS), logger, initial = 37, maximum = this.getDefaultMaximumMemoryPages(), unref = false) {
    this.useCustomLogger = logger !== void 0;
    this.logger = logger ?? (() => {
    });
    const initialMb = initial * 2 ** 16 / (1024 * 1024);
    const maxMb = maximum * 2 ** 16 / (1024 * 1024);
    const shared = getSharedMemoryAvailable();
    this.logger(`Initializing bb wasm: initial memory ${initial} pages ${initialMb}MiB; max memory: ${maximum} pages, ${maxMb}MiB; threads: ${threads}; shared memory: ${shared}`);
    this.memory = new WebAssembly.Memory({ initial, maximum, shared });
    const instance = await WebAssembly.instantiate(module, this.getImportObj(this.memory));
    this.instance = instance;
    this.call("_initialize");
    this.msgpackInputScratch = this.call("bbmalloc", this.MSGPACK_SCRATCH_SIZE);
    this.msgpackOutputScratch = this.call("bbmalloc", this.MSGPACK_SCRATCH_SIZE);
    this.logger(`Allocated msgpack scratch buffers: input @ ${this.msgpackInputScratch}, output @ ${this.msgpackOutputScratch} (${this.MSGPACK_SCRATCH_SIZE} bytes each)`);
    if (threads > 1) {
      this.logger(`Creating ${threads} worker threads`);
      this.workers = await Promise.all(Array.from({ length: threads - 1 }).map(createThreadWorker));
      if (this.useCustomLogger) {
        this.workers.forEach((worker) => this.setupWorkerLogForwarding(worker));
      }
      this.remoteWasms = await Promise.all(this.workers.map(getRemoteBarretenbergWasm));
      await Promise.all(this.remoteWasms.map((w) => w.initThread(module, this.memory, this.useCustomLogger)));
      if (unref) {
        for (const worker of this.workers) {
          worker.unref();
        }
      }
    }
  }
  getDefaultMaximumMemoryPages() {
    if (typeof self !== "undefined" && typeof self.navigator !== "undefined" && /iPad|iPhone/.test(self.navigator.userAgent)) {
      return 2 ** 14;
    }
    return 2 ** 16;
  }
  /**
   * Set up forwarding of log messages from worker threads to our logger.
   * Workers post messages with { type: 'log', msg: string } which we intercept here.
   */
  setupWorkerLogForwarding(worker) {
    const handler = (data) => {
      if (data && typeof data === "object" && "type" in data && data.type === "log" && "msg" in data) {
        this.logger(data.msg);
      }
    };
    if ("on" in worker && typeof worker.on === "function") {
      worker.on("message", handler);
    } else if ("addEventListener" in worker) {
      worker.addEventListener("message", (event) => {
        handler(event.data);
      });
    }
  }
  /**
   * Called on main thread. Signals child threads to gracefully exit.
   */
  async destroy() {
    await Promise.all(this.workers.map((w) => w.terminate()));
  }
  getImportObj(memory) {
    const baseImports = super.getImportObj(memory);
    return {
      ...baseImports,
      wasi: {
        "thread-spawn": (arg) => {
          arg = arg >>> 0;
          const id = this.nextThreadId++;
          const worker = this.nextWorker++ % this.remoteWasms.length;
          this.remoteWasms[worker].call("wasi_thread_start", id, arg).catch(this.logger);
          return id;
        }
      },
      env: {
        ...baseImports.env,
        env_hardware_concurrency: () => {
          return this.remoteWasms.length + 1;
        }
      }
    };
  }
  callWasmExport(funcName, inArgs, outLens) {
    const alloc = new HeapAllocator(this);
    const inPtrs = alloc.getInputs(inArgs);
    const outPtrs = alloc.getOutputPtrs(outLens);
    this.call(funcName, ...inPtrs, ...outPtrs);
    const outArgs = this.getOutputArgs(outLens, outPtrs, alloc);
    alloc.freeAll();
    return outArgs;
  }
  getOutputArgs(outLens, outPtrs, alloc) {
    return outLens.map((len, i) => {
      if (len) {
        return this.getMemorySlice(outPtrs[i], outPtrs[i] + len);
      }
      const slice = this.getMemorySlice(outPtrs[i], outPtrs[i] + 4);
      const ptr = new DataView(slice.buffer, slice.byteOffset, slice.byteLength).getUint32(0, true);
      alloc.addOutputPtr(ptr);
      const lslice = this.getMemorySlice(ptr, ptr + 4);
      const length = new DataView(lslice.buffer, lslice.byteOffset, lslice.byteLength).getUint32(0, false);
      return this.getMemorySlice(ptr + 4, ptr + 4 + length);
    });
  }
  cbindCall(cbind, inputBuffer) {
    const needsCustomInputBuffer = inputBuffer.length > this.MSGPACK_SCRATCH_SIZE;
    let inputPtr;
    if (needsCustomInputBuffer) {
      inputPtr = this.call("bbmalloc", inputBuffer.length);
    } else {
      inputPtr = this.msgpackInputScratch;
    }
    this.writeMemory(inputPtr, inputBuffer);
    const METADATA_SIZE = 8;
    const outputPtrLocation = this.msgpackOutputScratch;
    const outputSizeLocation = this.msgpackOutputScratch + 4;
    const scratchDataPtr = this.msgpackOutputScratch + METADATA_SIZE;
    const scratchDataSize = this.MSGPACK_SCRATCH_SIZE - METADATA_SIZE;
    let mem = this.getMemory();
    let view = new DataView(mem.buffer);
    view.setUint32(outputPtrLocation, scratchDataPtr, true);
    view.setUint32(outputSizeLocation, scratchDataSize, true);
    this.call(cbind, inputPtr, inputBuffer.length, outputPtrLocation, outputSizeLocation);
    if (needsCustomInputBuffer) {
      this.call("bbfree", inputPtr);
    }
    mem = this.getMemory();
    view = new DataView(mem.buffer);
    const outputDataPtr = view.getUint32(outputPtrLocation, true);
    const outputSize = view.getUint32(outputSizeLocation, true);
    const usedScratch = outputDataPtr === scratchDataPtr;
    const encodedResult = this.getMemorySlice(outputDataPtr, outputDataPtr + outputSize);
    if (!usedScratch) {
      this.call("bbfree", outputDataPtr);
    }
    return encodedResult;
  }
};

// node_modules/@aztec/bb.js/dest/browser/barretenberg_wasm/barretenberg_wasm_main/factory/browser/main.worker.js
expose(new BarretenbergWasmMain());
postMessage(Ready);
/*! Bundled license information:

comlink/dist/esm/comlink.mjs:
  (**
   * @license
   * Copyright 2019 Google LLC
   * SPDX-License-Identifier: Apache-2.0
   *)
*/
