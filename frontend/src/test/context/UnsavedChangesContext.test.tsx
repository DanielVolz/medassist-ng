import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { UnsavedChangesProvider, useUnsavedChanges } from "../../context/UnsavedChangesContext";

function TestConsumer() {
	const { hasUnsavedChanges, setHasUnsavedChanges, confirmNavigation } = useUnsavedChanges();
	const [result, setResult] = useState("idle");

	return (
		<div>
			<div data-testid="has-unsaved">{String(hasUnsavedChanges)}</div>
			<div data-testid="result">{result}</div>
			<button type="button" onClick={() => setHasUnsavedChanges(true)}>
				set-unsaved
			</button>
			<button
				type="button"
				onClick={async () => {
					const shouldProceed = await confirmNavigation();
					setResult(String(shouldProceed));
				}}
			>
				confirm-navigation
			</button>
		</div>
	);
}

describe("UnsavedChangesContext", () => {
	it("throws if used outside provider", () => {
		expect(() => renderHook(() => useUnsavedChanges())).toThrow(
			"useUnsavedChanges must be used within UnsavedChangesProvider"
		);
	});

	it("resolves confirmNavigation immediately when there are no unsaved changes", async () => {
		render(
			<UnsavedChangesProvider>
				<TestConsumer />
			</UnsavedChangesProvider>
		);

		fireEvent.click(screen.getByText("confirm-navigation"));

		await waitFor(() => {
			expect(screen.getByTestId("result")).toHaveTextContent("true");
		});
		expect(screen.queryByText("common.unsavedChanges.title")).not.toBeInTheDocument();
	});

	it("opens confirmation modal and resolves false on cancel", async () => {
		render(
			<UnsavedChangesProvider>
				<TestConsumer />
			</UnsavedChangesProvider>
		);

		fireEvent.click(screen.getByText("set-unsaved"));
		expect(screen.getByTestId("has-unsaved")).toHaveTextContent("true");

		fireEvent.click(screen.getByText("confirm-navigation"));
		expect(screen.getByText("common.unsavedChanges.title")).toBeInTheDocument();

		fireEvent.click(screen.getByText("common.unsavedChanges.stay"));

		await waitFor(() => {
			expect(screen.getByTestId("result")).toHaveTextContent("false");
		});
		expect(screen.queryByText("common.unsavedChanges.title")).not.toBeInTheDocument();
	});

	it("opens confirmation modal and resolves true on confirm", async () => {
		render(
			<UnsavedChangesProvider>
				<TestConsumer />
			</UnsavedChangesProvider>
		);

		fireEvent.click(screen.getByText("set-unsaved"));
		fireEvent.click(screen.getByText("confirm-navigation"));
		expect(screen.getByText("common.unsavedChanges.title")).toBeInTheDocument();

		fireEvent.click(screen.getByText("common.unsavedChanges.leave"));

		await waitFor(() => {
			expect(screen.getByTestId("result")).toHaveTextContent("true");
		});
		expect(screen.queryByText("common.unsavedChanges.title")).not.toBeInTheDocument();
	});
});
