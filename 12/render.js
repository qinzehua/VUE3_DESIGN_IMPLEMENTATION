import { shallowReactive, effect, queueJob } from "./reative.js";
import { resolveProps, hasPropsChanges } from "./utils.js";

export function createRenderer(renderOptions) {
  const { createElement, setElementText, insert, patchProps } = renderOptions;

  function mountElement(vnode, container, anchor) {
    const { tag, props, children } = vnode;
    const element = (vnode.el = createElement(tag));
    if (props) {
      for (const key in props) {
        patchProps(element, key, null, props[key]);
      }
    }

    if (typeof children === "string") {
      setElementText(element, children);
    } else if (Array.isArray(children)) {
      children.forEach((child) => patch(null, child, element));
    }
    insert(element, container, anchor);
  }

  function mountComponent(vnode, container, anchor) {
    const componentOptions = vnode.tag;
    const {
      render,
      data,
      setup,
      beforeCreate,
      created,
      beforeMount,
      mounted,
      beforeUpdate,
      updated,
      props: propsDefine,
    } = componentOptions;

    beforeCreate && beforeCreate();

    const [props, attrs] = resolveProps(propsDefine || {}, vnode.props || {});
    const state = data ? shallowReactive(data()) : null;
    const instance = {
      state,
      props: shallowReactive(props),
      isMounted: false,
      subtree: null,
      keepAliveCtx: null,
    };

    const isKeepAlive = vnode.tag.__isKeepAlive;

    if (isKeepAlive) {
      instance.keepAliveCtx = {
        move(vnode, container, anchor) {
          insert(vnode.el, container, anchor);
        },
        createElement,
      };
    }

    let setupContext = { attrs };
    const setupResult = setup && setup(shallowReactive(props), setupContext);
    let setupState = null;
    if (typeof setupResult === "function") {
      if (render) console.error("setup 函数返回渲染函数, render 选项将被忽略");
      render = setupResult;
    } else {
      setupState = setupResult;
    }

    const renderContext = new Proxy(instance, {
      get(t, k, r) {
        const { state, props } = t;
        if (state && k in state) {
          return state[k];
        } else if (props && k in props) {
          return props[k];
        } else if (setupState && k in setupState) {
          return setupState[k];
        } else {
          return r[k];
        }
      },
      set(t, k, v, r) {
        const { state, props } = t;
        if (state && k in state) {
          state[k] = v;
        } else if (props && k in props) {
          props[k] = v;
        } else if (setupState && k in setupState) {
          return (setupState[k] = v);
        } else {
          r[k] = v;
        }
        return true;
      },
    });
    vnode.component = instance;
    created && created.call(renderContext);

    effect(
      () => {
        const subtree = render.call(renderContext, renderContext);

        if (!instance.isMounted) {
          beforeMount && beforeMount.call(renderContext);
          patch(null, subtree, container, anchor);
          instance.isMounted = true;
          mounted && mounted.call(renderContext);
        } else {
          beforeUpdate && beforeUpdate.call(renderContext);
          patch(instance.subtree, subtree, container, anchor);
          updated && updated.call(renderContext);
        }
        instance.subtree = subtree;
      },
      {
        scheduler: queueJob,
      }
    );
  }

  function patchComponent(n1, n2, anchor) {
    const instance = (n2.component = n1.component);
    const { props } = instance;

    if (hasPropsChanges(n1.props, n2.props)) {
      const [nextProps] = resolveProps(n2.tag.props || {}, n2.props || {});
      for (const k in nextProps) {
        props[k] = nextProps[k];
      }

      for (const k in props) {
        if (!(k in nextProps)) {
          delete props[k];
        }
      }
    }
  }

  function patch(oldVnode, vnode, container, anchor) {
    if (oldVnode && oldVnode.tag !== vnode.tag) {
      unmount(oldVnode);
      oldVnode = null;
    }

    const { tag } = vnode;

    if (typeof tag === "string") {
      if (!oldVnode) {
        mountElement(vnode, container, anchor);
      } else {
        patchElement(oldVnode, vnode, container);
      }
    } else if (typeof tag === "object") {
      if (!oldVnode) {
        if (vnode.keptAlive) {
          vnode.keepAliveInstance._active(vnode, container, anchor);
        } else {
          mountComponent(vnode, container, anchor);
        }
      } else {
        patchComponent(oldVnode, vnode, anchor);
      }
    }
  }

  function patchElement(oldVnode, vnode, container) {
    const el = (vnode.el = oldVnode.el);
    const oldProps = oldVnode.props || {};
    const newProps = vnode.props || {};

    for (const key in newProps) {
      const oldValue = oldProps[key];
      const newValue = newProps[key];
      if (oldValue !== newValue) {
        patchProps(el, key, oldValue, newValue);
      }
    }

    for (const key in oldProps) {
      if (!(key in newProps)) {
        patchProps(el, key, oldProps[key], null);
      }
    }

    patchChildren(oldVnode, vnode, el);
  }

  function patchChildren(oldVnode, vnode, container) {
    const oldCh = oldVnode.children;
    const newCh = vnode.children;

    if (typeof newCh === "string") {
      if (Array.isArray(oldCh)) {
        oldCh.forEach((child) => {
          unmount(child);
        });
      }
      setElementText(container, newCh);
    } else if (Array.isArray(newCh)) {
      if (typeof oldCh === "string") {
        setElementText(container, "");
        newCh.forEach((child) => {
          patch(null, child, container);
        });
      } else if (Array.isArray(oldCh)) {
        patchKeyedChildren(oldCh, newCh, container);
      }
    } else {
      if (Array.isArray(oldCh)) {
        oldCh.forEach((child) => {
          unmount(child);
        });
      } else if (typeof oldCh === "string") {
        setElementText(container, "");
      }
    }
  }

  function patchKeyedChildren(oldCh, newCh, container) {
    let oldStartIdx = 0;
    let oldEndIdx = oldCh.length - 1;
    let newStartIdx = 0;
    let newEndIdx = newCh.length - 1;

    let oldStartVnode = oldCh[oldStartIdx];
    let oldEndVnode = oldCh[oldEndIdx];
    let newStartVnode = newCh[newStartIdx];
    let newEndVnode = newCh[newEndIdx];

    while (oldStartIdx <= oldEndIdx && newStartIdx <= newEndIdx) {
      if (!oldStartVnode) {
        oldStartVnode = oldCh[++oldStartIdx];
      } else if (!oldEndVnode) {
        oldEndVnode = oldCh[--oldEndIdx];
      } else if (oldStartVnode.key === newStartVnode.key) {
        patch(oldStartVnode, newStartVnode, container);
        oldStartVnode = oldCh[++oldStartIdx];
        newStartVnode = newCh[++newStartIdx];
      } else if (oldEndVnode.key === newEndVnode.key) {
        patch(oldEndVnode, newEndVnode, container);
        oldEndVnode = oldCh[--oldEndIdx];
        newEndVnode = newCh[--newEndIdx];
      } else if (oldStartVnode.key === newEndVnode.key) {
        patch(oldStartVnode, newEndVnode, container);
        insert(oldStartVnode.el, container, oldEndVnode.el.nextSibling);
        oldStartVnode = oldCh[++oldStartIdx];
        newEndVnode = newCh[--newEndIdx];
      } else if (oldEndVnode.key === newStartVnode.key) {
        patch(oldEndVnode, newStartVnode, container);
        insert(oldEndVnode.el, container, oldStartVnode.el);

        oldEndVnode = oldCh[--oldEndIdx];
        newStartVnode = newCh[++newStartIdx];
      } else {
        const oldIdx = oldCh.findIndex(
          (node) => node.key === newStartVnode.key
        );

        if (oldIdx >= 0) {
          const vnodeToMove = oldCh[oldIdx];
          patch(vnodeToMove, newStartVnode, container);
          insert(vnodeToMove.el, container, oldStartVnode.el);
          oldCh[oldIdx] = undefined;
        } else {
          patch(null, newStartVnode, container, oldStartVnode.el);
        }
        newStartVnode = newCh[++newStartIdx];
      }
    }

    if (oldEndIdx < oldStartIdx && newStartIdx <= newEndIdx) {
      for (let i = newStartIdx; i <= newEndIdx; i++) {
        patch(null, newCh[i], container, oldStartVnode.el);
      }
    } else if (newEndIdx < newStartIdx && oldStartIdx <= oldEndIdx) {
      for (let i = oldStartIdx; i <= oldEndIdx; i++) {
        if (oldCh[i]) {
          unmount(oldCh[i]);
        }
      }
    }
  }

  function unmount(vnode) {
    if (typeof vnode.tag === "object") {
      if (vnode.shouldKeepAlive) {
        vnode.keepAliveInstance._deActive(vnode);
      } else {
        unmount(vnode.component.subTree);
      }
      return;
    }

    const parent = vnode.el.parentNode;
    if (parent) {
      parent.removeChild(vnode.el);
    }
  }

  function render(vnode, container) {
    if (vnode) {
      patch(container._vnode, vnode, container);
    } else {
      if (container._vnode) {
        unmount(container._vnode);
      }
    }
    container._vnode = vnode;
  }

  return {
    render,
  };
}
