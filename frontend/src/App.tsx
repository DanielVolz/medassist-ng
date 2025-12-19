import { useEffect, useMemo, useState } from "react";
import { z } from "zod";

const healthSchema = z.object({ status: z.string() });

type Medication = {
  id: string;
  name: string;
  dosage: string;
  frequency: string;
  timeOfDay: string;
  startDate: string;
  notes?: string;
  active: boolean;
};

type DoseEvent = {
  id: string;
  medId: string;
  medName: string;
  time: Date;
  notes?: string;
};

// Simple backend health check
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

const starterMeds: Medication[] = [
  {
    id: "med-1",
    name: "Lisinopril",
    dosage: "10 mg",
    frequency: "Daily",
    timeOfDay: "08:00",
    startDate: "2025-11-28",
    notes: "Blood pressure",
    active: true,
  },
  {
    id: "med-2",
    name: "Metformin",
    dosage: "500 mg",
    frequency: "2x daily",
    timeOfDay: "08:00",
    startDate: "2025-12-01",
    notes: "Before meals",
    active: true,
  },
  {
    id: "med-3",
    name: "Vitamin D",
    dosage: "2000 IU",
    frequency: "Weekly",
    timeOfDay: "09:00",
    startDate: "2025-12-05",
    notes: "Sunday dose",
    active: false,
  },
];

const frequencies = ["Daily", "2x daily", "Weekly", "As needed"] as const;

export default function App() {
  const status = useHealth();
  const [meds, setMeds] = useState<Medication[]>(starterMeds);
  const [form, setForm] = useState({
    name: "",
    dosage: "",
    frequency: "Daily",
    timeOfDay: "08:00",
    notes: "",
  });

  const activeCount = meds.filter((m) => m.active).length;

  const schedule: DoseEvent[] = useMemo(() => {
    const daysAhead = 3;
    const events: DoseEvent[] = [];
    const now = new Date();
    for (let d = 0; d <= daysAhead; d++) {
      const base = new Date(now);
      base.setDate(now.getDate() + d);
      meds
        .filter((m) => m.active)
        .forEach((m) => {
          if (m.frequency === "As needed") return;
          const [h, min] = m.timeOfDay.split(":").map(Number);
          const when = new Date(base);
          when.setHours(h ?? 8, min ?? 0, 0, 0);
          events.push({
            id: `${m.id}-${when.toISOString()}`,
            medId: m.id,
            medName: m.name,
            time: when,
            notes: m.notes,
          });
          if (m.frequency === "2x daily") {
            const evening = new Date(when);
            evening.setHours(20, 0, 0, 0);
            events.push({
              id: `${m.id}-${evening.toISOString()}`,
              medId: m.id,
              medName: m.name,
              time: evening,
              notes: m.notes,
            });
          }
        });
    }
    return events.sort((a, b) => a.time.getTime() - b.time.getTime());
  }, [meds]);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.dosage.trim()) return;
    const newMed: Medication = {
      id: crypto.randomUUID(),
      name: form.name.trim(),
      dosage: form.dosage.trim(),
      frequency: form.frequency,
      timeOfDay: form.timeOfDay,
      startDate: new Date().toISOString().slice(0, 10),
      notes: form.notes.trim() || undefined,
      active: true,
    };
    setMeds((prev) => [newMed, ...prev]);
    setForm({ name: "", dosage: "", frequency: "Daily", timeOfDay: "08:00", notes: "" });
  };

  const toggleActive = (id: string) => {
    setMeds((prev) => prev.map((m) => (m.id === id ? { ...m, active: !m.active } : m)));
  };

  return (
    <main className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">Medassist · Rebuild Preview</p>
          <h1>Deine Medikationszentrale</h1>
          <p className="sub">Schneller Überblick über Medikamente, Einnahmeplan und Erinnerungen.</p>
          <div className="badges">
            <span className="pill success">Backend: {status}</span>
            <span className="pill">Aktive Medikamente: {activeCount}</span>
          </div>
        </div>
        <div className="stats">
          <div className="stat">
            <p className="label">Heute geplant</p>
            <p className="value">{schedule.filter((e) => isToday(e.time)).length}</p>
          </div>
          <div className="stat">
            <p className="label">Diese Woche</p>
            <p className="value">{schedule.length}</p>
          </div>
          <div className="stat">
            <p className="label">Ohne Login</p>
            <p className="value">Demo</p>
          </div>
        </div>
      </header>

      <section className="grid">
        <article className="card meds">
          <div className="card-head">
            <h2>Medikamentenliste</h2>
            <span className="pill">{meds.length} gesamt</span>
          </div>
          <div className="med-list">
            {meds.map((med) => (
              <div key={med.id} className="med-row">
                <div>
                  <div className="med-name">{med.name}</div>
                  <div className="muted">{med.dosage} · {med.frequency} · Start {med.startDate}</div>
                  {med.notes && <div className="tag">{med.notes}</div>}
                </div>
                <div className="med-actions">
                  <span className={`pill ${med.active ? "success" : "neutral"}`}>
                    {med.active ? "aktiv" : "pausiert"}
                  </span>
                  <button className="ghost" onClick={() => toggleActive(med.id)}>
                    {med.active ? "Pausieren" : "Aktivieren"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="card form">
          <div className="card-head">
            <h2>Neues Medikament</h2>
            <span className="pill">ohne Login</span>
          </div>
          <form className="form-grid" onSubmit={handleAdd}>
            <label>
              Name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="z.B. Ibuprofen" />
            </label>
            <label>
              Dosierung
              <input value={form.dosage} onChange={(e) => setForm({ ...form, dosage: e.target.value })} placeholder="z.B. 400 mg" />
            </label>
            <label>
              Einnahmezeit
              <input type="time" value={form.timeOfDay} onChange={(e) => setForm({ ...form, timeOfDay: e.target.value })} />
            </label>
            <label>
              Frequenz
              <select value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
                {frequencies.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label className="full">
              Notizen
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Erinnerung oder Kontext" />
            </label>
            <div className="full align-end">
              <button type="submit">Hinzufügen</button>
            </div>
          </form>
        </article>
      </section>

      <section className="grid">
        <article className="card">
          <div className="card-head">
            <h2>Nächste Einnahmen</h2>
            <span className="pill">3 Tage Vorschau</span>
          </div>
          <div className="timeline">
            {schedule.slice(0, 8).map((event) => (
              <div key={event.id} className="time-row">
                <div className="time-chip">{formatTime(event.time)}</div>
                <div>
                  <div className="med-name">{event.medName}</div>
                  <div className="muted">{formatDate(event.time)}</div>
                  {event.notes && <div className="tag subtle">{event.notes}</div>}
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="card">
          <div className="card-head">
            <h2>Highlights</h2>
            <span className="pill neutral">Demo-Daten</span>
          </div>
          <div className="highlights">
            <div>
              <p className="label">Aktive Pläne</p>
              <p className="value">{activeCount}</p>
            </div>
            <div>
              <p className="label">Starttermine</p>
              <p className="value">{meds.filter((m) => m.startDate).length}</p>
            </div>
            <div>
              <p className="label">Backend Health</p>
              <p className="value">{status}</p>
            </div>
          </div>
          <p className="muted small">Login und Synchronisation kommen später – dies ist ein sichtbarer Preview.</p>
        </article>
      </section>
    </main>
  );
}

function isToday(date: Date) {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function formatTime(date: Date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(date: Date) {
  return date.toLocaleDateString([], { weekday: "short", day: "2-digit", month: "short" });
}
