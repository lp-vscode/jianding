import { createApp } from "vue";
import "./style.css";
import "./app.css";
import App from "./App.vue";

createApp(App).mount("#app");

if (
  import.meta.env.PROD &&
  "serviceWorker" in navigator &&
  !("__TAURI_INTERNALS__" in window)
) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch((error) => console.warn("离线缓存未启用", error));
  });
}
