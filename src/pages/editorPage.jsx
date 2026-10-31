
import { useEffect, useState } from "react";
import CodeEditor from "../components/CodeEditor";
import JoinRoom from "../components/JoinRoom";
import useRoomSocket from "../hooks/useRoomSocket";
import "../css/EditorPage.css";

export default function EditorPage({ roomId }) {
  const [code, setCode] = useState(
    'console.log("Hello, world!");'
  );
  const joinedRoomKey = `joinedRoom:${roomId}`;
  const [room, setRoom] = useState(null);
  const [userName, setUserName] = useState(
    () => sessionStorage.getItem(joinedRoomKey) || ""
  );
  const [joinName, setJoinName] = useState("");
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const {
    sendCode,
    status: socketStatus,
    error: socketError,
  } = useRoomSocket({
    roomId,
    userName,
    enabled: Boolean(room && userName),
    onRemoteCode: setCode,
  });

  useEffect(() => {
    let active = true;

    async function loadRoom() {
      try {
        const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Could not load room");
        if (active) {
          setRoom(data.room);
          const initialCode = data.room.code || 'console.log("Hello, world!");';
          setCode(initialCode);
        }
      } catch (err) {
        if (active) setError(err.message || "Could not load room");
      } finally {
        if (active) setLoading(false);
      }
    }

    loadRoom();
    return () => { active = false; };
  }, [roomId]);

  function handleCodeChange(nextCode) {
    setCode(nextCode);
    sendCode(nextCode);
  }

  async function handleJoin(event) {
    event.preventDefault();
    setJoining(true);
    setError("");
    try {
      const response = await fetch(
        `/api/rooms/${encodeURIComponent(roomId)}/join`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userName: joinName }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not join room");
      sessionStorage.setItem(joinedRoomKey, data.userName);
      setUserName(data.userName);
    } catch (err) {
      setError(err.message || "Could not join room");
    } finally {
      setJoining(false);
    }
  }

  async function copyInviteLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy the link. Copy it from the address bar instead.");
    }
  }

  if (loading) return <main className="editor-page"><p>Loading room…</p></main>;
  if (!room) {
    return (
      <main className="editor-page">
        <p role="alert">{error || "Room not found"}</p>
        <a href="/">Back to home</a>
      </main>
    );
  }
  if (!userName) {
    return (
      <JoinRoom
        roomName={room.name}
        userName={joinName}
        onNameChange={setJoinName}
        onJoin={handleJoin}
        joining={joining}
        error={error}
      />
    );
  }

  return (
    <main className="editor-page">
      <header>
        <div>
          <h2>{room.name}</h2>
          <p>Joined as {userName}</p>
        </div>
        <button type="button" onClick={copyInviteLink}>
          {copied ? "Link copied" : "Copy invite link"}
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      <p aria-live="polite">{socketError || socketStatus}</p>

      <CodeEditor
        value={code}
        onChange={handleCodeChange}
        height="400px"
      />

      <div className="editor-actions">
        <button type="button" onClick={() => {}}>
          ▶ Run
        </button>
      </div>

      <section className="output-panel">
        <h3>Output</h3>
        <div className="output-content"></div>
      </section>
    </main>
  );
}
