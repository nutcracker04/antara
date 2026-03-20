import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";

const root = ReactDOM.createRoot(document.getElementById("root"));

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${process.env.PUBLIC_URL || ""}/sw.js`).catch((error) => {
      console.error("Service worker registration failed", error);
    });
  });
}

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
