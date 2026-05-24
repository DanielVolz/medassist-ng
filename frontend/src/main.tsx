import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles.css";
import "./styles/intake-journal.css";
import "./styles/modals-base.css";
import "./styles/share-dialog.css";
import "./styles/medication-workflows.css";
import "./styles/schedule-mobile-edit.css";
import "./i18n";

ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<BrowserRouter>
			<App />
		</BrowserRouter>
	</React.StrictMode>
);
