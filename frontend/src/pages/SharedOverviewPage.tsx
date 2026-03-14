import { Navigate, useParams } from "react-router-dom";

export function SharedOverviewPage() {
	const { token } = useParams<{ token: string }>();

	if (!token) {
		return <Navigate to="/" replace />;
	}

	return <Navigate to={`/share/${token}`} replace />;
}
