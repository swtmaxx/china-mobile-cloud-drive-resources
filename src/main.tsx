import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import AdminApp from "./Admin";
import "./styles.css";

const RootApp = window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/") ? AdminApp : App;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootApp />
  </StrictMode>,
);
