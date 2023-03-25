let handleError = null;

const utils = {
  foo(fn) {
    callWithErrorHandler(fn);
  },
  bar(fn) {
    callWithErrorHandler(fn);
  },
  registerErrorHandler(fn) {
    handleError = fn;
  },
};

function callWithErrorHandler(fn) {
  try {
    fn && fn();
  } catch (e) {
    handleError && handleError(e);
  }
}
