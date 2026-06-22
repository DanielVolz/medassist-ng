import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import "@mantine/notifications/styles.css";
import App from "./App";
import { AppUiProvider } from "./ui/providers/AppUiProvider";
import "./i18n";

ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<AppUiProvider>
			<BrowserRouter>
				<App />
			</BrowserRouter>
		</AppUiProvider>
	</React.StrictMode>
);
