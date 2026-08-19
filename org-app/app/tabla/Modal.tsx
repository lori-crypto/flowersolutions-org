"use client";
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { Person, createPerson } from "@/lib/orgboard";

export type Field =
  | { key: string; label: string; type?: "text"; value: string }
  | { key: string; label: string; type: "textarea"; value: string }
  | { key: string; label: string; type: "checkbox"; value: boolean }
  | { key: string; label: string; type: "color"; value: string }
  | { key: string; label: string; type: "holders"; value: string[]; persons: Person[] };

export type FormValues = Record<string, string | boolean | string[]>;

export default function Modal({ title, fields, onSave, onClose }: {
  title: string;
  fields: Field[];
  onSave: (v: FormValues) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [vals, setVals] = useState<FormValues>(() =>
    Object.fromEntries(fields.map(f => [f.key, f.value])));
  const [persons, setPersons] = useState<Person[]>(() => {
    const hf = fields.find(f => f.type === "holders") as Extract<Field, {type:"holders"}> | undefined;
    return hf ? hf.persons : [];
  });
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const set = (k: string, v: string | boolean | string[]) =>
    setVals(p => ({ ...p, [k]: v }));

  async function addPerson(holderKey: string) {
    const name = newName.trim();
    if (!name) return;
    setErr("");
    try {
      const p = await createPerson(name);
      setPersons(list => [...list, p].sort((a, b) => a.name.localeCompare(b.name)));
      set(holderKey, [...(vals[holderKey] as string[]), p.id]);
      setNewName("");
    } catch (e) { setErr(t("err_save") + " (" + (e as Error).message + ")"); }
  }

  async function save() {
    setBusy(true); setErr("");
    try { await onSave(vals); onClose(); }
    catch (e) { setErr(t("err_save") + " (" + (e as Error).message + ")"); setBusy(false); }
  }

  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h3>{title}</h3>
        {fields.map(f => {
          if (f.type === "checkbox") return (
            <div className="chk" key={f.key}>
              <input type="checkbox" id={"f_" + f.key} checked={vals[f.key] as boolean}
                     onChange={e => set(f.key, e.target.checked)} />
              <label htmlFor={"f_" + f.key} style={{ margin: 0, textTransform: "none", fontSize: 13.5, color: "var(--ink)" }}>{f.label}</label>
            </div>
          );
          if (f.type === "textarea") return (
            <div key={f.key}>
              <label>{f.label}</label>
              <textarea value={vals[f.key] as string} onChange={e => set(f.key, e.target.value)} />
            </div>
          );
          if (f.type === "color") return (
            <div key={f.key}>
              <label>{f.label}</label>
              <input type="color" className="color-input" value={vals[f.key] as string}
                     onChange={e => set(f.key, e.target.value)} />
            </div>
          );
          if (f.type === "holders") {
            const sel = vals[f.key] as string[];
            return (
              <div key={f.key}>
                <label>{f.label}</label>
                <div className="person-list">
                  {persons.map(p => (
                    <label className="person-row" key={p.id}>
                      <input type="checkbox" checked={sel.includes(p.id)}
                             onChange={e => set(f.key, e.target.checked
                               ? [...sel, p.id] : sel.filter(id => id !== p.id))} />
                      {p.name}
                    </label>
                  ))}
                </div>
                <div className="new-person">
                  <input type="text" placeholder={t("f_new_person")} value={newName}
                         onChange={e => setNewName(e.target.value)}
                         onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addPerson(f.key); } }} />
                  <button type="button" onClick={() => addPerson(f.key)}>＋</button>
                </div>
              </div>
            );
          }
          return (
            <div key={f.key}>
              <label>{f.label}</label>
              <input type="text" value={vals[f.key] as string}
                     onChange={e => set(f.key, e.target.value)} />
            </div>
          );
        })}
        {err && <div className="err">{err}</div>}
        <div className="btns">
          <button className="btn-cancel" onClick={onClose}>{t("cancel")}</button>
          <button className="btn-save" onClick={save} disabled={busy}>{t("save")}</button>
        </div>
      </div>
    </div>
  );
}
