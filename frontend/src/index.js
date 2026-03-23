import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";
import { registerServiceWorker } from "@/lib/service-worker";

const root = ReactDOM.createRoot(document.getElementById("root"));
registerServiceWorker();

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
