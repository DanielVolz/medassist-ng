import { useEffect, useState } from "react";
import { z } from "zod";

const healthSchema = z.object({ status: z.string() });

function useHealth() {
  const [status, setStatus] = useState<string>("loading");
  useEffect(() => {
    fetch("/api/health", { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        const parsed = healthSchema.safeParse(data);
        if (parsed.success) setStatus(parsed.data.status);
        else setStatus("error");
      })
      .catch(() => setStatus("error"));
  }, []);
  return status;
}

export default function App() {
  const status = useHealth();
  return (
    <main>
      <div className="card">
        <h1>Medassist (Rebuild)</h1>
        <p>Backend health: {status}</p>
        <p>Frontend scaffold ready. Auth & CRUD folgen.</p>
      </div>
    </main>
  );
}
