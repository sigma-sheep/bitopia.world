import { useState } from "react";

// Bottom-center chat box: type and press Enter to send. The world has no keyboard
// handlers (movement is click-to-move), but we still stopPropagation so typing
// never leaks to canvas listeners added later.
export function ChatInput({ onSend }: { onSend: (text: string) => void }) {
  const [value, setValue] = useState("");

  const onKeyDown = (ev: React.KeyboardEvent<HTMLInputElement>) => {
    ev.stopPropagation();
    if (ev.key !== "Enter" || ev.shiftKey) return;
    const text = value.trim();
    if (!text) return;
    onSend(text);
    setValue("");
  };

  return (
    <div style={wrap}>
      <input
        style={input}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Press Enter to chat"
        maxLength={280}
      />
    </div>
  );
}

const wrap: React.CSSProperties = {
  position: "fixed",
  bottom: 14,
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 50,
  fontFamily: "system-ui, sans-serif",
};
const input: React.CSSProperties = {
  width: 360,
  maxWidth: "80vw",
  padding: "11px 16px",
  borderRadius: 12,
  background: "#161c26",
  border: "1px solid #2a3340",
  boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
  color: "#e8eef6",
  fontSize: 15,
  outline: "none",
};
