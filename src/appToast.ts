// 页面层通知回调类型：动作结果统一从页面冒泡到 App 的提示条。
export type Notify = (message: string, ok: boolean) => void;
