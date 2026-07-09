import { jsx as _jsx } from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
function App() {
    return _jsx("main", { children: "Sift" });
}
const root = document.getElementById("root");
if (root) {
    createRoot(root).render(_jsx(App, {}));
}
