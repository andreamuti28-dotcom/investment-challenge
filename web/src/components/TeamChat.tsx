import { useEffect, useRef, useState } from "react";
import { errText, supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { Loading, Notice } from "./ui";

interface Msg { id: number; team_id: string; user_id: string | null; author: string; body: string; created_at: string }

const time = (iso: string) => {
  const d = new Date(iso), today = new Date().toDateString() === d.toDateString();
  return d.toLocaleString("en-GB", today ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

/** Real-time chat of a team: only its members (and the organiser) can read and write. */
export default function TeamChat({ teamId, teamName }: { teamId: string; teamName: string }) {
  const { session } = useAuth();
  const me = session?.user.id;
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    supabase.from("team_messages").select("*").eq("team_id", teamId).order("created_at", { ascending: false }).limit(300)
      .then(({ data, error }) => { if (!alive) return; if (error) setErr(error.message); setMsgs(((data ?? []) as Msg[]).reverse()); });
    const ch = supabase.channel(`team-chat-${teamId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "team_messages", filter: `team_id=eq.${teamId}` },
        (p) => setMsgs((cur) => (cur && !cur.some((m) => m.id === (p.new as Msg).id) ? [...cur, p.new as Msg] : cur)))
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "team_messages" },
        (p) => setMsgs((cur) => cur?.filter((m) => m.id !== (p.old as Msg).id) ?? cur))
      .subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, [teamId]);

  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [msgs?.length]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setBusy(true); setErr("");
    const { data, error } = await supabase.from("team_messages").insert({ team_id: teamId, body }).select().single();
    setBusy(false);
    if (error) return setErr(errText(error));
    setText("");
    setMsgs((cur) => (cur && !cur.some((m) => m.id === (data as Msg).id) ? [...cur, data as Msg] : cur));
  }

  if (!msgs) return <Loading />;
  let lastDay = "";
  return (
    <div className="card chat">
      <div className="chat-head"><h3>Team chat</h3><span className="muted small">{teamName} · visible only to the team and the organiser</span></div>
      <div className="chat-box" ref={box} aria-live="polite">
        {msgs.length === 0 && <p className="muted small chat-empty">No messages yet: say hello to your team.</p>}
        {msgs.map((m) => {
          const day = new Date(m.created_at).toDateString();
          const sep = day !== lastDay; lastDay = day;
          const mine = m.user_id === me;
          return (
            <div key={m.id}>
              {sep && <div className="chat-day">{new Date(m.created_at).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</div>}
              <div className={`chat-msg ${mine ? "mine" : ""}`}>
                {!mine && <div className="chat-author">{m.author || "Member"}</div>}
                <div className="chat-bubble">{m.body}</div>
                <div className="chat-time">{time(m.created_at)}</div>
              </div>
            </div>
          );
        })}
      </div>
      <Notice kind="err">{err}</Notice>
      <form className="chat-form" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea rows={1} maxLength={2000} placeholder="Write a message…" value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} aria-label="Message" />
        <button type="submit" disabled={busy || !text.trim()}>Send</button>
      </form>
    </div>
  );
}
