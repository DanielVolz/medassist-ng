import { useEffect, useMemo, useState } from "react";
import { z } from "zod";

const healthSchema = z.object({ status: z.string() });

type Slice = {
  usage: number;
  every: number;
  start: string; // ISO date string
};

type Medication = {
  id: number;
  name: string;
  count: number;
  stripSize: number;
  slices: Slice[];
  updatedAt: string | number | null;
};

type FormState = {
  name: string;
  count: string;
  stripSize: string;
  slices: Array<{ usage: string; every: string; start: string }>;
};

const defaultSlice = (): FormState["slices"][number] => ({
  usage: "1",
  every: "1",
  start: new Date().toISOString().slice(0, 16),
});

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
  const [meds, setMeds] = useState<Medication[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>({ name: "", count: "0", stripSize: "1", slices: [defaultSlice()] });

  const activeCount = meds.length;

  const schedule = useMemo(() => buildSchedulePreview(meds), [meds]);

  useEffect(() => {
    loadMeds();
  }, []);

  function loadMeds() {
    setLoading(true);
    fetch("/medications")
      .then((res) => res.json())
      .then((data: Medication[]) => setMeds(data))
      .catch(() => setMeds([]))
      .finally(() => setLoading(false));
  }

  function setSliceValue(idx: number, field: keyof FormState["slices"][number], value: string) {
    setForm((prev) => {
      const next = [...prev.slices];
      next[idx] = { ...next[idx], [field]: value };
      return { ...prev, slices: next };
    });
  }

  function addSlice() {
    setForm((prev) => ({ ...prev, slices: [...prev.slices, defaultSlice()] }));
  }

  function removeSlice(idx: number) {
    setForm((prev) => ({ ...prev, slices: prev.slices.filter((_, i) => i !== idx) }));
  }

  function startEdit(med: Medication) {
    setEditingId(med.id);
    setForm({
      name: med.name,
      count: String(med.count),
      stripSize: String(med.stripSize),
      slices: med.slices.map((s) => ({
        usage: String(s.usage),
        every: String(s.every),
        start: toInputValue(s.start),
      })),
    });
  }

  function resetForm() {
    setEditingId(null);
    setForm({ name: "", count: "0", stripSize: "1", slices: [defaultSlice()] });
  }

  async function saveMedication(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);

    const payload = {
      name: form.name.trim(),
      count: Number(form.count) || 0,
      stripSize: Number(form.stripSize) || 1,
      slices: form.slices.map((s) => ({
        usage: Number(s.usage) || 0,
        every: Math.max(1, Number(s.every) || 1),
        start: toIsoString(s.start),
      })),
    };

    const method = editingId ? "PUT" : "POST";
    const url = editingId ? `/medications/${editingId}` : "/medications";

    await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null);

    setSaving(false);
    resetForm();
    loadMeds();
  }

  return (
    <main className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">Medassist · Planner</p>
          <h1>Medikationspläne anlegen & bearbeiten</h1>
          <p className="sub">Slices wie früher: usage, every (days), start (Datum/Uhrzeit), plus Bestand & Strip-Size.</p>
          <div className="badges">
            <span className="pill success">Backend: {status}</span>
            <span className="pill">Einträge: {meds.length}</span>
          </div>
        </div>
        <div className="stats">
          <div className="stat">
            <p className="label">Heute geplant</p>
            <p className="value">{schedule.today}</p>
          </div>
          <div className="stat">
            <p className="label">Nächste 3 Tage</p>
            <p className="value">{schedule.nextThree}</p>
          </div>
          <div className="stat">
            <p className="label">Aktive Slices</p>
            <p className="value">{schedule.totalSlices}</p>
          </div>
        </div>
      </header>

      <section className="grid">
        <article className="card meds">
          <div className="card-head">
            <h2>Medikamentenliste</h2>
            <span className="pill">{loading ? "lädt..." : `${meds.length} gesamt`}</span>
          </div>
          <div className="med-list">
            {meds.map((med) => (
              <div key={med.id} className="med-row">
                <div>
                  <div className="med-name">{med.name}</div>
                  <div className="muted">Bestand: {med.count} · Strip-Size: {med.stripSize}</div>
                  <div className="tag subtle">Slices: {med.slices.length}</div>
                  <div className="slice-list">
                    {med.slices.map((s, idx) => (
                      <div key={`${med.id}-${idx}`} className="slice-pill">
                        <span className="pill">{s.usage} meds</span>
                        <span className="pill neutral">alle {s.every} Tage</span>
                        <span className="pill subtle">ab {formatDateTime(s.start)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="med-actions">
                  <button className="ghost" onClick={() => startEdit(med)}>Bearbeiten</button>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="card form">
          <div className="card-head">
            <h2>{editingId ? "Eintrag bearbeiten" : "Neuer Eintrag"}</h2>
            <span className="pill">Slices wie alte App</span>
          </div>
          <form className="form-grid" onSubmit={saveMedication}>
            <label>
              Name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="z.B. Lisinopril" required />
            </label>
            <label>
              Bestand (count)
              <input type="number" min="0" value={form.count} onChange={(e) => setForm({ ...form, count: e.target.value })} />
            </label>
            <label>
              Strip Size
              <input type="number" min="1" value={form.stripSize} onChange={(e) => setForm({ ...form, stripSize: e.target.value })} />
            </label>

            <div className="full slices">
              <div className="card-head">
                <h3>Slice / Plan</h3>
                <button type="button" className="ghost" onClick={addSlice}>+ Slice</button>
              </div>
              {form.slices.map((s, idx) => (
                <div key={idx} className="slice-row">
                  <label>
                    Usage (meds)
                    <input type="number" min="0" step="0.1" value={s.usage} onChange={(e) => setSliceValue(idx, "usage", e.target.value)} />
                  </label>
                  <label>
                    Every (days)
                    <input type="number" min="1" value={s.every} onChange={(e) => setSliceValue(idx, "every", e.target.value)} />
                  </label>
                  <label>
                    Start (Datum/Zeit)
                    <input type="datetime-local" value={s.start} onChange={(e) => setSliceValue(idx, "start", e.target.value)} />
                  </label>
                  {form.slices.length > 1 && (
                    <button type="button" className="ghost" onClick={() => removeSlice(idx)}>Entfernen</button>
                  )}
                </div>
              ))}
            </div>

            <div className="full align-end gap">
              {editingId && (
                <button type="button" className="ghost" onClick={resetForm}>
                  Abbrechen
                </button>
              )}
              <button type="submit" disabled={saving}>{saving ? "Speichern..." : "Speichern"}</button>
            </div>
          </form>
        </article>
      </section>

      <section className="grid">
        <article className="card">
          <div className="card-head">
            <h2>Nächste Einnahmen (3 Tage)</h2>
            <span className="pill neutral">Preview</span>
          </div>
          <div className="timeline">
            {schedule.events.slice(0, 10).map((event) => (
              <div key={event.id} className="time-row">
                <div className="time-chip">{event.timeStr}</div>
                <div>
                  <div className="med-name">{event.medName}</div>
                  <div className="muted">{event.dateStr}</div>
                  <div className="tag subtle">{event.usage} meds</div>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}

function toIsoString(value: string) {
  // Accept datetime-local value; fallback to now
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function toInputValue(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 16);
  const iso = date.toISOString();
  return iso.slice(0, 16);
}

function formatDateTime(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString([], { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function buildSchedulePreview(meds: Medication[]) {
  const events: Array<{ id: string; medName: string; timeStr: string; dateStr: string; usage: number; when: number }> = [];
  const now = new Date();
  const end = new Date();
  end.setDate(end.getDate() + 3);

  meds.forEach((med) => {
    med.slices.forEach((slice, idx) => {
      const start = new Date(slice.start);
      if (Number.isNaN(start.getTime())) return;
      // generate occurrences within next 3 days (simplified)
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + slice.every)) {
        if (d < now) continue;
        const whenMs = d.getTime();
        events.push({
          id: `${med.id}-${idx}-${whenMs}`,
          medName: med.name,
          usage: slice.usage,
          when: whenMs,
          timeStr: d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          dateStr: d.toLocaleDateString([], { weekday: "short", day: "2-digit", month: "short" }),
        });
      }
    });
  });

  events.sort((a, b) => a.when - b.when);

  const todayCount = events.filter((e) => {
    const t = new Date(e.when);
    const n = new Date();
    return t.getFullYear() === n.getFullYear() && t.getMonth() === n.getMonth() && t.getDate() === n.getDate();
  }).length;

  return { events, today: todayCount, nextThree: events.length, totalSlices: meds.reduce((acc, m) => acc + m.slices.length, 0) };
}
