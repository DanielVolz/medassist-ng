import { Alert, Anchor, Box, Group, Image, Loader, Stack, Text, Title } from "@mantine/core";
import { ExternalLink, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FRONTEND_VERSION, GITHUB_URL } from "../App";
import { AppModal } from "../ui/modal/AppModal";
import { AppButton } from "../ui/primitives/AppButton";
import classes from "./AboutModal.module.css";

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

	// ESC is handled by the global handler in App.tsx to avoid double history.back()

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

	const renderUpdateResult = () => {
		if (!updateCheckResult) return null;

		if (updateCheckResult.status === "up-to-date") {
			return (
				<Alert color="green" data-testid="about-update-result">
					{t("about.upToDate")}
				</Alert>
			);
		}

		if (updateCheckResult.status === "update-available") {
			return (
				<Alert color="blue" data-testid="about-update-result">
					<Group gap="xs" justify="center">
						<Text component="span">
							{t("about.updateAvailable")}: <strong>v{updateCheckResult.latestVersion}</strong>
						</Text>
						<Anchor href={`${GITHUB_URL}/releases/latest`} rel="noopener noreferrer" target="_blank">
							{t("about.downloadUpdate")}
						</Anchor>
					</Group>
				</Alert>
			);
		}

		return (
			<Alert color="red" data-testid="about-update-result">
				{t("about.checkFailed")}
			</Alert>
		);
	};

	return (
		<AppModal
			centered
			classNames={{
				body: classes.body,
				content: classes.modal,
				header: classes.modalHeader,
				title: classes.modalTitle,
			}}
			closeButtonProps={{ "aria-label": t("common.close") }}
			lockScroll={false}
			manageEscape={false}
			manageScrollLock={false}
			onClose={onClose}
			opened={isOpen}
			size={380}
			title={t("about.title")}
			withCloseButton
		>
			<Stack gap={0} ta="center">
				<Box className={classes.hero}>
					<Image alt="MedAssist-ng" className={classes.logo} h={64} radius={16} src="/app-logo.png" w={64} />
					<Title order={2} className={classes.appName}>
						{t("about.appName")}
					</Title>
					<Text className={classes.tagline}>{t("about.description")}</Text>
				</Box>

				<Box className={classes.section}>
					<Group align="center" gap="sm" justify="center">
						<Text className={classes.versionLabel}>{t("about.version")}</Text>
						<Anchor
							className={classes.versionValue}
							href={`${GITHUB_URL}/releases/tag/v${FRONTEND_VERSION}`}
							rel="noopener noreferrer"
							target="_blank"
						>
							{FRONTEND_VERSION}
						</Anchor>
					</Group>
				</Box>

				<Stack className={classes.section} gap="md">
					<AppButton
						disabled={isChecking}
						fullWidth
						leftSection={isChecking ? <Loader size={16} /> : <RefreshCw size={16} />}
						onClick={checkForUpdates}
						tone="secondary"
					>
						{isChecking ? t("about.checking") : t("about.checkForUpdates")}
					</AppButton>
					{renderUpdateResult()}
				</Stack>

				<Box className={classes.section}>
					<Anchor className={classes.githubLink} href={GITHUB_URL} rel="noopener noreferrer" target="_blank">
						<ExternalLink size={18} />
						{t("about.viewOnGitHub")}
					</Anchor>
				</Box>

				<Box className={classes.footer}>
					<Text className={classes.footerText}>{t("about.copyright", { year: new Date().getFullYear() })}</Text>
					<Text className={classes.license}>{t("about.license")}</Text>
				</Box>
			</Stack>
		</AppModal>
	);
}
