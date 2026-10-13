export type DemoIntake = {
	usage: number;
	every: number;
	start: string;
	takenBy: string;
	intakeRemindersEnabled: boolean;
};

export type DemoMedication = {
	name: string;
	genericName: string;
	takenBy: string[];
	medicationForm: string;
	pillForm?: string;
	packageType: string;
	packCount: number;
	blistersPerPack: number;
	pillsPerBlister: number;
	packageAmountValue?: number;
	packageAmountUnit?: string;
	totalPills?: number;
	looseTablets: number;
	doseUnit: string;
	intakes: DemoIntake[];
};

export const demoMedications: Array<{
	imageAsset: string;
	medication: DemoMedication;
}>;
