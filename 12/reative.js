const bucket = new WeakMap();
let activeEffect = null;
const effectsStack = [];
const ITERATE_KEY = Symbol("iterate");
const TriggerType = {
  ADD: "ADD",
  SET: "SET",
  DELETE: "DELETE",
};

const reactiveMap = new Map();

export function reactive(obj) {
  return createReactive(obj);
}

export function shallowReactive(obj) {
  return createReactive(obj, true);
}

const arrInstrucmentations = {};
let shouldTrack = true;

["includes", "indexOf", "lastIndexOf"].forEach((method) => {
  const originMeth = Array.prototype[method];
  arrInstrucmentations[method] = function (...args) {
    let res = originMeth.apply(this, args);
    if (!res) {
      res = originMeth.apply(this.raw, args);
    }

    return res;
  };
});

["push", "pop", "shift", "unshift", "splice"].forEach((method) => {
  const originMeth = Array.prototype[method];
  arrInstrucmentations[method] = function (...args) {
    shouldTrack = false;
    const res = originMeth.apply(this, args);
    shouldTrack = true;
    return res;
  };
});

function createReactive(source, isShallow = false) {
  const existProxy = reactiveMap.get(source);
  if (existProxy) return existProxy;
  const proxy =
    source instanceof Set
      ? proxySetMap(source, (isShallow = false))
      : proxyObj(source, (isShallow = false));

  reactiveMap.set(source, proxy);
  return proxy;
}

const mutableInstrumenttations = {
  get(key) {
    const target = this.raw;
    const hadKey = target.has(key);
    track(target, key);
    if (hadKey) {
      const res = target.get(key);
      return typeof res === "object" ? reactive(res) : res;
    }
  },
  forEach(callback, thisArgs) {
    const target = this.raw;
    track(target, ITERATE_KEY);

    const wrap = (value) =>
      typeof value === "object" ? reactive(value) : value;

    return target.forEach((value, key) => {
      return callback.call(thisArgs, wrap(value), wrap(key));
    });
  },
  add(key) {
    const target = this.raw;
    const hadKey = target.has(key);
    let res = null;
    if (!hadKey) {
      res = target.add(key);
      trigger(target, key, "ADD");
    }

    return res;
  },
  delete(key) {
    const target = this.raw;
    const hadKey = target.has(key);
    const res = target.delete(key);
    if (hadKey) {
      trigger(target, key, "DELETE");
    }
    return res;
  },
  set(key, value) {
    const target = this.raw;
    const hadKey = target.has(key);
    const oldValue = target.get(key);
    target.set(key, value.raw || value);

    if (!hadKey) {
      trigger(target, key, "ADD");
    } else {
      if (oldValue !== value && (oldValue === oldValue || value === value)) {
        trigger(target, key, "SET");
      }
    }
    return res;
  },
};

function proxySetMap(source, isShallow = fals) {
  return new Proxy(source, {
    get(target, key, receiver) {
      if (key === "raw") return target;
      if (key === "size") {
        track(target, ITERATE_KEY);
        return Reflect.get(target, key, target);
      }
      return mutableInstrumenttations[key];
    },
  });
}

function proxyObj(source, isShallow = false) {
  return new Proxy(source, {
    get(target, key, receiver) {
      if (key === "raw") return target;
      if (Array.isArray(target) && arrInstrucmentations.hasOwnProperty(key)) {
        return Reflect.get(arrInstrucmentations, key, receiver);
      }

      const res = Reflect.get(target, key, receiver);

      if (typeof key !== "symbol" && shouldTrack) {
        track(target, key);
      }

      if (isShallow) {
        return res;
      } else {
        if (typeof res == "object" && res !== null) {
          return reactive(res);
        } else {
          return res;
        }
      }
    },
    has(target, key) {
      track(target, key);
      return Reflect.has(target, key);
    },
    ownKeys(target) {
      track(target, Array.isArray(target) ? "length" : ITERATE_KEY);
      return Reflect.ownKeys(target);
    },
    set(target, key, newValue, receiver) {
      const oldValue = target[key];

      const type = Array.isArray(target)
        ? key < target.length
          ? TriggerType.SET
          : TriggerType.ADD
        : Object.prototype.hasOwnProperty.call(target, key)
        ? TriggerType.SET
        : TriggerType.ADD;
      const res = Reflect.set(target, key, newValue, receiver);

      if (target === receiver.raw) {
        trigger(target, key, type, newValue);
      }

      return res;
    },
    deleteProperty(target, key) {
      const hadKey = Object.prototype.hasOwnProperty.call(target, key);
      const res = Reflect.deleteProperty(target, key);
      if (hadKey && res) {
        trigger(target, key, TriggerType.DELETE);
      }
    },
  });
}

function track(target, key) {
  if (!activeEffect) return true;
  let depsMap = bucket.get(target);
  if (!depsMap) {
    bucket.set(target, (depsMap = new Map()));
  }
  let deps = depsMap.get(key);
  if (!deps) {
    depsMap.set(key, (deps = new Set()));
  }
  deps.add(activeEffect);
  activeEffect.deps.push(deps);
}

function trigger(target, key, type, newValue) {
  const depsMap = bucket.get(target);
  if (!depsMap) return true;
  const effects = depsMap.get(key);
  const iterateEffects = depsMap.get(ITERATE_KEY);
  const effectsToRuns = new Set();

  effects &&
    effects.forEach((effect) => {
      if (effect !== activeEffect) effectsToRuns.add(effect);
    });

  // 索引大于新lenght的元素所对应的effect 需要被触发
  if (Array.isArray(target) && key === "length") {
    depsMap.forEach((effects, key) => {
      if (key > newValue) {
        effects.forEach((effect) => {
          if (effect !== activeEffect) effectsToRuns.add(effect);
        });
      }
    });
  }

  if (Array.isArray(target) && type === TriggerType.ADD) {
    const lenghtDeps = depsMap.get("length");
    lenghtDeps &&
      lenghtDeps.forEach((effect) => {
        if (effect !== activeEffect) effectsToRuns.add(effect);
      });
  }

  if (
    type === TriggerType.ADD ||
    type === TriggerType.DELETE ||
    (type === TriggerType.SET &&
      Object.prototype.toString.call(target) === "[object Map]")
  ) {
    iterateEffects &&
      iterateEffects.forEach((effect) => {
        if (effect !== activeEffect) effectsToRuns.add(effect);
      });
  }

  effectsToRuns.forEach((effect) => {
    if (effect.options.shedule) {
      effect.options.shedule(effect);
    } else {
      effect();
    }
  });
}

function clearnUp(effectFn) {
  effectFn.deps.forEach((deps) => {
    deps.delete(effectFn);
  });
  effectFn.deps.length = 0;
}

export function effect(fn, options = {}) {
  let effectFn = () => {
    clearnUp(effectFn);
    activeEffect = effectFn;
    effectsStack.push(activeEffect);
    const res = fn();
    effectsStack.pop();
    activeEffect = effectsStack[effectsStack.length - 1];

    return res;
  };
  effectFn.deps = [];
  effectFn.options = options;
  if (!options.lazy) {
    return effectFn();
  }
  return effectFn;
}

export function computed(getter) {
  let dirtied = true;
  let value = null;
  const effectFn = effect(getter, {
    lazy: true,
    shedule: () => {
      if (!dirtied) {
        dirtied = true;
        trigger(obj, "value");
      }
    },
  });

  const obj = {
    get value() {
      if (dirtied) {
        value = effectFn();
        dirtied = false;
      }
      track(obj, "value");
      return value;
    },
  };

  return obj;
}

function traverse(value, seen = new Set()) {
  if (typeof value !== "object" || value === null || seen.has(value))
    return value;

  seen.add(value);

  for (const key in value) {
    traverse(value[key], seen);
  }
  return value;
}

export function watch(source, callback, options) {
  let getter;
  let oldValue;
  let cleanup;

  function onInvalidate(fn) {
    cleanup = fn;
  }

  if (typeof source === "function") {
    getter = source;
  } else {
    getter = () => traverse(source);
  }

  function job() {
    if (cleanup) {
      cleanup();
    }
    const newValue = effectFn();
    callback(newValue, oldValue, onInvalidate);
    oldValue = newValue;
  }

  const effectFn = effect(() => getter(), {
    lazy: true,
    shedule: () => {
      if (options.flush === "post") {
        Promise.resolve().then(job);
      } else {
        job();
      }
    },
  });

  if (options.immediate) {
    job(effectFn);
  } else {
    oldValue = effectFn();
  }
}

const queue = new Set();
let isFlushing = false;
const p = Promise.resolve();

export function queueJob(job) {
  queue.add(job);

  if (!isFlushing) {
    isFlushing = true;
    p.then(() => {
      queue.forEach((job) => job());
    })
      .catch(() => {})
      .finally(() => {
        queue.clear();
        isFlushing = false;
      });
  }
}
