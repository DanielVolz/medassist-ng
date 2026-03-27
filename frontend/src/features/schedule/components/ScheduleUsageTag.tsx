type ScheduleUsageTagProps = {
	children: React.ReactNode;
};

export function ScheduleUsageTag({ children }: ScheduleUsageTagProps) {
	return <span className="tag subtle">{children}</span>;
}
