import { createApp } from "vue";
import "./style.css";
import "./app.css";
import App from "./App.vue";

createApp(App).mount("#app");

const harmonyWebView = "JiandingNative" in window;

if (harmonyWebView && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      .then(() => {
        if (!("caches" in window)) return;
        return caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))));
      })
      .catch(() => undefined);
  });
}

if (
  import.meta.env.PROD &&
  "serviceWorker" in navigator &&
  !("__TAURI_INTERNALS__" in window) &&
  !harmonyWebView
) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch((error) => console.warn("离线缓存未启用", error));
  });
}
