/**
 * ThemeMenu - Shared theme preference dropdown (light / dark / system)
 * used by the app header and the public shared-schedule page.
 */
import { ActionIcon, Menu } from "@mantine/core";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import classes from "./ThemeMenu.module.css";

type ThemePreference = "light" | "dark" | "system";

interface ThemeMenuProps {
	resolvedTheme: "light" | "dark";
	themePreference: ThemePreference;
	onChange: (preference: ThemePreference) => void;
}

export function ThemeMenu({ resolvedTheme, themePreference, onChange }: ThemeMenuProps) {
	const { t } = useTranslation();

	const themeOptions: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
		{ value: "light", label: t("theme.light"), icon: Sun },
		{ value: "dark", label: t("theme.dark"), icon: Moon },
		{ value: "system", label: t("theme.system"), icon: Monitor },
	];

	return (
		<Menu position="bottom-end" width={180}>
			<Menu.Target>
				<ActionIcon
					aria-label={t("theme.title")}
					className={classes.trigger}
					data-testid="theme-menu-trigger"
					radius="xl"
					size="input-sm"
					title={t("theme.title")}
					variant="subtle"
				>
					{resolvedTheme === "dark" ? <Moon size={18} /> : <Sun size={18} />}
				</ActionIcon>
			</Menu.Target>
			<Menu.Dropdown>
				<Menu.Label>{t("theme.title")}</Menu.Label>
				{themeOptions.map(({ value, label, icon: Icon }) => (
					<Menu.Item
						key={value}
						leftSection={<Icon size={16} />}
						rightSection={
							themePreference === value ? <Check aria-hidden="true" className={classes.check} size={14} /> : null
						}
						onClick={() => onChange(value)}
					>
						{label}
					</Menu.Item>
				))}
			</Menu.Dropdown>
		</Menu>
	);
}
