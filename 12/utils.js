export function resolveProps(options, propsData) {
  const props = {};
  const attrs = {};

  for (const key in propsData) {
    if (key in options) {
      props[key] = propsData[key];
    } else {
      attrs[key] = propsData[key];
    }
  }

  return [props, attrs];
}

export function hasPropsChanges(prevProps, nextProps) {
  const nextKeys = Object.keys(nextProps);

  if (nextKeys.length !== Object.keys(prevProps).length) {
    return true;
  }

  for (const key in nextProps) {
    if (nextProps[key] !== prevProps[key]) {
      return true;
    }
  }

  return false;
}
