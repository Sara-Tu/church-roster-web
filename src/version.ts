/**
 * 版號的唯一來源是 package.json 的 version，由 Vite 的 define 在建置時注入。
 * 不要在這裡寫死字串（規格 §7.5.3）。
 */

declare const __APP_VERSION__: string;

export const APP_VERSION: string = __APP_VERSION__;
