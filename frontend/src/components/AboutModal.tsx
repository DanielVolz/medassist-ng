import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FRONTEND_VERSION, GITHUB_URL } from "../App";
import { useEscapeKey } from "../hooks/useEscapeKey";

interface UpdateCheckResult {
	status: "up-to-date" | "update-available" | "error";
	latestVersion?: string;
}

interface AboutModalProps {
	isOpen: boolean;
	onClose: () => void;
}

export default function AboutModal({ isOpen, onClose }: AboutModalProps) {
	const { t } = useTranslation();
	const [isChecking, setIsChecking] = useState(false);
	const [updateCheckResult, setUpdateCheckResult] = useState<UpdateCheckResult | null>(null);

	useEscapeKey(isOpen, onClose);

	// Reset check result when modal opens so stale results are never shown
	useEffect(() => {
		if (isOpen) {
			setUpdateCheckResult(null);
		}
	}, [isOpen]);

	async function checkForUpdates() {
		setIsChecking(true);
		const minDelay = new Promise((resolve) => setTimeout(resolve, 1000));
		try {
			const [res] = await Promise.all([
				fetch(`https://api.github.com/repos/DanielVolz/medassist-ng/releases/latest`),
				minDelay,
			]);
			if (!res.ok) throw new Error("Failed to fetch");
			const data = await res.json();
			const latestVersion = (data.tag_name || "").replace(/^v/, "");
			const currentVersion = FRONTEND_VERSION.replace(/^v/, "");
			const isUpToDate = latestVersion === currentVersion;
			setUpdateCheckResult({
				status: isUpToDate ? "up-to-date" : "update-available",
				latestVersion,
			});
		} catch {
			setUpdateCheckResult({ status: "error" });
		} finally {
			setIsChecking(false);
		}
	}

	if (!isOpen) return null;

	return (
		<div
			className="modal-overlay"
			onClick={onClose}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onClose();
				}
			}}
		>
			<div
				className="modal-content about-modal"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => {
					if (e.key !== "Escape") e.stopPropagation();
				}}
			>
				<button className="modal-close" onClick={onClose}>
					×
				</button>
				<div className="about-header">
					<div className="about-logo">
						<img src="/favicon.svg" alt="MedAssist-ng" />
					</div>
					<h2>{t("about.appName", "MedAssist-ng")}</h2>
					<p className="about-tagline">{t("about.description", "Personal medication tracking and reminder app")}</p>
				</div>
				<div className="about-versions">
					<div className="about-version-row">
						<span className="about-version-label">{t("about.version", "Version")}</span>
						<a
							href={`${GITHUB_URL}/releases/tag/v${FRONTEND_VERSION}`}
							target="_blank"
							rel="noopener noreferrer"
							className="about-version-value about-version-link"
						>
							{FRONTEND_VERSION}
						</a>
					</div>
				</div>
				<div className="about-update-section">
					<button className="about-update-btn" onClick={checkForUpdates} disabled={isChecking}>
						{isChecking ? (
							<>
								<span className="spinner-small"></span>
								{t("about.checking", "Checking...")}
							</>
						) : (
							<>
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
									<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
									<path d="M3 3v5h5" />
									<path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
									<path d="M16 16h5v5" />
								</svg>
								{t("about.checkForUpdates", "Check for Updates")}
							</>
						)}
					</button>
					{updateCheckResult && (
						<div className={`about-update-result ${updateCheckResult.status}`}>
							{updateCheckResult.status === "up-to-date" && (
								<span className="update-status-text">&#10003; {t("about.upToDate", "You are up to date!")}</span>
							)}
							{updateCheckResult.status === "update-available" && (
								<span className="update-status-text">
									&#11014; {t("about.updateAvailable", "Update available")}:{" "}
									<strong>v{updateCheckResult.latestVersion}</strong>
									<a
										href={`${GITHUB_URL}/releases/latest`}
										target="_blank"
										rel="noopener noreferrer"
										className="update-download-link"
									>
										{t("about.downloadUpdate", "Download")}
									</a>
								</span>
							)}
							{updateCheckResult.status === "error" && (
								<span className="update-status-text">
									&#9888; {t("about.checkFailed", "Could not check for updates")}
								</span>
							)}
						</div>
					)}
				</div>
				<div className="about-links">
					<a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="about-link">
						<svg viewBox="0 0 24 24" fill="currentColor">
							<path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
						</svg>
						{t("about.viewOnGitHub", "View on GitHub")}
					</a>
				</div>
				<div className="about-footer">
					<p className="about-copyright">
						{t("about.copyright", "© {{year}} Daniel Volz", { year: new Date().getFullYear() })}
					</p>
					<p className="about-license">{t("about.license", "GPL-3.0 License")}</p>
				</div>
			</div>
		</div>
	);
}
