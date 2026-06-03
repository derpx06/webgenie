export class AsyncLocalStorage<T = any> {
  private static currentStore: any = undefined;

  getStore(): T | undefined {
    return AsyncLocalStorage.currentStore;
  }

  run(store: T, callback: (...args: any[]) => any, ...args: any[]): any {
    const prev = AsyncLocalStorage.currentStore;
    AsyncLocalStorage.currentStore = store;
    try {
      return callback(...args);
    } finally {
      AsyncLocalStorage.currentStore = prev;
    }
  }

  static snapshot(): any {
    const store = AsyncLocalStorage.currentStore;
    return (cb: (...args: any[]) => any, ...args: any[]) => {
      const prev = AsyncLocalStorage.currentStore;
      AsyncLocalStorage.currentStore = store;
      try {
        return cb(...args);
      } finally {
        AsyncLocalStorage.currentStore = prev;
      }
    };
  }
}
