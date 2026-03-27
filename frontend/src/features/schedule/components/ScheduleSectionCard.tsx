type ScheduleSectionCardProps = {
	title: string;
	children: React.ReactNode;
	headerRight?: React.ReactNode;
	className?: string;
};

export function ScheduleSectionCard({ title, children, headerRight, className }: ScheduleSectionCardProps) {
	return (
		<article className={className ?? "card schedule-full"}>
			<div className="card-head">
				<h2>{title}</h2>
				{headerRight}
			</div>
			{children}
		</article>
	);
}
