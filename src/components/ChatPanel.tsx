import { useEffect, useRef, useState } from "react";
import { ChatMsg } from "../net/useMultiplayer";

interface Props {
  chat: ChatMsg[];
  selfId: string | null;
  onSend: (t: string) => void;
  voiceActive: boolean;
  onToggleVoice: () => void;
  voiceEnabled: boolean;
}

export default function ChatPanel({
  chat,
  selfId,
  onSend,
  voiceActive,
  onToggleVoice,
  voiceEnabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth" });
    else if (chat.length) setUnread((u) => u + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.length]);

  useEffect(() => {
    if (open) setUnread(0);
  }, [open]);

  const send = () => {
    const t = text.trim();
    if (t) {
      onSend(t);
      setText("");
    }
  };

  return (
    <>
      {/* floating buttons */}
      <div className="fixed bottom-4 right-4 z-40 flex flex-col gap-2">
        {voiceEnabled && (
          <button
            onClick={onToggleVoice}
            className={`flex h-12 w-12 items-center justify-center rounded-full text-xl shadow-lg transition ${
              voiceActive
                ? "bg-green-500 animate-pulse"
                : "bg-slate-700"
            }`}
            title="Voice chat"
          >
            🎤
          </button>
        )}
        <button
          onClick={() => setOpen((o) => !o)}
          className="relative flex h-12 w-12 items-center justify-center rounded-full bg-orange-500 text-xl shadow-lg"
        >
          💬
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white">
              {unread}
            </span>
          )}
        </button>
      </div>

      {open && (
        <div className="fixed bottom-20 right-4 z-40 flex h-80 w-72 flex-col rounded-2xl border border-orange-500/40 bg-slate-900/95 shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <span className="font-black text-orange-400">CHAT</span>
            <button onClick={() => setOpen(false)} className="text-white/60">
              ✕
            </button>
          </div>
          <div className="flex-1 space-y-1.5 overflow-y-auto p-3 text-sm">
            {chat.length === 0 && (
              <p className="text-center text-xs text-white/40">Say hi to your opponent 👋</p>
            )}
            {chat.map((m, i) => (
              <div
                key={i}
                className={`${
                  m.from === "sys"
                    ? "text-center text-xs italic text-yellow-300/80"
                    : m.from === selfId
                    ? "text-right"
                    : "text-left"
                }`}
              >
                {m.from !== "sys" && (
                  <span
                    className={`text-[10px] font-bold ${
                      m.from === selfId ? "text-orange-400" : "text-cyan-400"
                    }`}
                  >
                    {m.name}
                  </span>
                )}
                <div
                  className={`inline-block max-w-[85%] rounded-xl px-3 py-1.5 text-white ${
                    m.from === "sys"
                      ? ""
                      : m.from === selfId
                      ? "bg-orange-600"
                      : "bg-slate-700"
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
          <div className="flex gap-2 border-t border-white/10 p-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Type a message…"
              className="flex-1 rounded-lg bg-slate-800 px-3 py-2 text-sm text-white outline-none placeholder:text-white/40"
            />
            <button
              onClick={send}
              className="rounded-lg bg-orange-500 px-3 font-bold text-white"
            >
              ➤
            </button>
          </div>
        </div>
      )}
    </>
  );
}
