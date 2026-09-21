// node 环境桩：必须在 store 模块求值前安装（ES 模块按导入顺序执行）。
class LocalStorageStub {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

(globalThis as any).localStorage = new LocalStorageStub();
(globalThis as any).window = { addEventListener: () => {} };
(globalThis as any).navigator = {};

export {};
