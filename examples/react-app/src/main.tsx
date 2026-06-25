import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const root = document.getElementById("root");

if (root) {
	createRoot(root).render(
		<App apiKey={import.meta.env.VITE_GUAPOCADO_CLIENT_KEY ?? "ck_guap_test_demo"} />,
	);
}
