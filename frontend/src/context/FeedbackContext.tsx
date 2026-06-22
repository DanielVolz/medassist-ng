import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import classes from "./FeedbackContext.module.css";

export type FeedbackTone = "info" | "success" | "warning" | "error";

type FeedbackNotice = {
	id: number;
	message: string;
	tone: FeedbackTone;
	durationMs: number;
};

type FeedbackContextValue = {
	showFeedback: (options: { message: string; tone?: FeedbackTone; durationMs?: number }) => void;
	dismissFeedback: (id: number) => void;
	clearFeedback: () => void;
};

const noop = () => {};

const defaultValue: FeedbackContextValue = {
	showFeedback: noop,
	dismissFeedback: noop,
	clearFeedback: noop,
};

const FeedbackContext = createContext<FeedbackContextValue>(defaultValue);

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
	const { t } = useTranslation();
	const [notices, setNotices] = useState<FeedbackNotice[]>([]);
	const nextIdRef = useRef(1);
	const timeoutMapRef = useRef<Map<number, number>>(new Map());

	const dismissFeedback = useCallback((id: number) => {
		const timeoutId = timeoutMapRef.current.get(id);
		if (typeof timeoutId === "number") {
			window.clearTimeout(timeoutId);
			timeoutMapRef.current.delete(id);
		}
		setNotices((current) => current.filter((notice) => notice.id !== id));
	}, []);

	const clearFeedback = useCallback(() => {
		for (const timeoutId of timeoutMapRef.current.values()) {
			window.clearTimeout(timeoutId);
		}
		timeoutMapRef.current.clear();
		setNotices([]);
	}, []);

	const showFeedback = useCallback(
		({ message, tone = "info", durationMs = 5000 }: { message: string; tone?: FeedbackTone; durationMs?: number }) => {
			const id = nextIdRef.current++;
			setNotices((current) => [...current, { id, message, tone, durationMs }].slice(-3));
			const timeoutId = window.setTimeout(() => {
				dismissFeedback(id);
			}, durationMs);
			timeoutMapRef.current.set(id, timeoutId);
		},
		[dismissFeedback]
	);

	useEffect(() => () => clearFeedback(), [clearFeedback]);

	const value = useMemo(
		() => ({
			showFeedback,
			dismissFeedback,
			clearFeedback,
		}),
		[showFeedback, dismissFeedback, clearFeedback]
	);

	return (
		<FeedbackContext.Provider value={value}>
			{children}
			<div className={classes.stack} aria-live="polite" aria-atomic="false">
				{notices.map((notice) => (
					<div
						key={notice.id}
						className={`${classes.notice} ${classes[notice.tone]}`}
						role={notice.tone === "error" ? "alert" : "status"}
					>
						<div className={classes.message}>{notice.message}</div>
						<button
							type="button"
							className={classes.close}
							onClick={() => dismissFeedback(notice.id)}
							aria-label={t("common.close")}
						>
							×
						</button>
					</div>
				))}
			</div>
		</FeedbackContext.Provider>
	);
}

export function useFeedback() {
	return useContext(FeedbackContext);
}
