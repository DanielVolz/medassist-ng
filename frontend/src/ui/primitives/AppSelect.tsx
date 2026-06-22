import { NativeSelect, type NativeSelectProps } from "@mantine/core";
import { ChevronDown } from "lucide-react";
import classes from "./AppSelect.module.css";

export function AppSelect({ className, classNames, rightSection, size = "lg", ...props }: NativeSelectProps) {
	const usesClassNamesFunction = typeof classNames === "function";
	const objectClassNames = usesClassNamesFunction || classNames == null ? undefined : classNames;
	const mergedInputClassName = [classes.input, objectClassNames?.input, className].filter(Boolean).join(" ");
	let resolvedClassNames = classNames;
	if (objectClassNames) {
		resolvedClassNames = {
			...objectClassNames,
			input: mergedInputClassName,
		};
	} else if (!usesClassNamesFunction) {
		resolvedClassNames = { input: classes.input };
	}

	return (
		<NativeSelect
			radius="md"
			size={size}
			className={objectClassNames ? undefined : className}
			classNames={resolvedClassNames}
			rightSection={rightSection ?? <ChevronDown size={16} aria-hidden="true" />}
			rightSectionPointerEvents="none"
			{...props}
		/>
	);
}
