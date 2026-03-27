import { createContext, useContext } from "react";

type ShareContextValue = {
	showShareDialog: boolean;
	sharePeople: string[];
	shareSelectedPerson: string;
	setShareSelectedPerson: React.Dispatch<React.SetStateAction<string>>;
	shareSelectedDays: number;
	setShareSelectedDays: React.Dispatch<React.SetStateAction<number>>;
	shareGenerating: boolean;
	shareLink: string | null;
	setShareLink: React.Dispatch<React.SetStateAction<string | null>>;
	shareCopied: boolean;
	setShareCopied: React.Dispatch<React.SetStateAction<boolean>>;
	openShareDialog: () => void;
	generateShareLink: () => Promise<void>;
	copyShareLink: () => void;
	closeShareDialog: () => void;
	resetShareDialogState: () => void;
};

const ShareContext = createContext<ShareContextValue | null>(null);

type ShareContextProviderProps = {
	value: ShareContextValue;
	children: React.ReactNode;
};

export function ShareContextProvider({ value, children }: ShareContextProviderProps) {
	return <ShareContext.Provider value={value}>{children}</ShareContext.Provider>;
}

export function useShareContext(): ShareContextValue {
	const context = useContext(ShareContext);
	if (!context) {
		throw new Error("useShareContext must be used within ShareContextProvider");
	}
	return context;
}

export type { ShareContextValue };
