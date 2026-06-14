import "./polyfills"; // must be first: defines globalThis.Buffer before app code loads
import { createRoot } from "react-dom/client";
import App from "./App";
createRoot(document.getElementById("root")!).render(<App />);
