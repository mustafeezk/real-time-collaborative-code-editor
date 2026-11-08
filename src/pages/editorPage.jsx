
import { useCallback, useEffect, useState } from "react";
import BrandMark from "../components/BrandMark";
import CodeEditor from "../components/CodeEditor";
import JoinRoom from "../components/JoinRoom";
import useRoomSocket from "../hooks/useRoomSocket";
import "../css/EditorPage.css";

export default function EditorPage({ roomId }) {
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
  const [syncStatus, setSyncStatus] = useState("Starting collaboration…");
  const [editorApi, setEditorApi] = useState(null);
  const [runPending, setRunPending] = useState(false);
  const [runError, setRunError] = useState("");

  const {
    socket,
    initialState,
    activeExecution,
    executionResult,
    status: socketStatus,
    error: socketError,
  } = useRoomSocket({
    roomId,
    userName,
    enabled: Boolean(room && userName),
  });

  const handleRun = useCallback(() => {
    if (!socket || !editorApi || activeExecution || runPending) return;

    setRunPending(true);
    setRunError("");
    socket.emit("code:run", { roomId }, (reservation) => {
      if (!reservation?.ok) {
        setRunPending(false);
        setRunError(reservation?.message || "Could not start the run");
        return;
      }
      setRunPending(false);

      editorApi.flushAndGetSnapshot()
        .then(({ code, documentVersion }) => {
          socket.emit(
            "code:run:submit",
            { executionId: reservation.executionId, code, documentVersion },
            (submission) => {
              if (!submission?.ok) {
                setRunPending(false);
                setRunError(submission?.message || "Could not submit the shared code");
              }
            }
          );
        })
        .catch((err) => {
          socket.emit("code:run:cancel", { executionId: reservation.executionId });
          setRunPending(false);
          setRunError(err.message || "Could not sync the editor before running");
        });
    });
  }, [activeExecution, editorApi, roomId, runPending, socket]);

  useEffect(() => {
    if (!socket) return undefined;
    const clearPending = () => setRunPending(false);
    socket.on("code:execution-status", clearPending);
    socket.on("code:execution-unlocked", clearPending);
    socket.on("room:joined", clearPending);
    socket.on("disconnect", clearPending);
    return () => {
      socket.off("code:execution-status", clearPending);
      socket.off("code:execution-unlocked", clearPending);
      socket.off("room:joined", clearPending);
      socket.off("disconnect", clearPending);
    };
  }, [socket]);

  useEffect(() => {
    let active = true;

    async function loadRoom() {
      try {
        const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Could not load room");
        if (active) {
          setRoom(data.room);
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

  if (loading) {
    return (
      <main className="state-page">
        <div className="state-card">
          <BrandMark compact />
          <span className="loading-spinner" aria-hidden="true" />
          <h1>Opening your room</h1>
          <p>Getting your shared workspace ready.</p>
        </div>
      </main>
    );
  }
  if (!room) {
    return (
      <main className="state-page">
        <div className="state-card">
          <BrandMark compact />
          <span className="state-icon state-icon-error" aria-hidden="true">!</span>
          <h1>We couldn’t find that room</h1>
          <p role="alert">{error || "This room may have been closed or the link may be incorrect."}</p>
          <a className="button-primary state-action" href="/">Back to home <span>→</span></a>
        </div>
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
  if (!initialState || !socket) {
    return (
      <main className="state-page">
        <div className="state-card">
          <BrandMark compact />
          <span className="loading-spinner" aria-hidden="true" />
          <h1>{socketError ? "Room unavailable" : `Connecting to ${room.name}`}</h1>
          <p role="status">{socketError || socketStatus}</p>
        </div>
      </main>
    );
  }

  const initials = userName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const syncLabel = socketError || syncStatus;

  return (
    <div className="workspace-shell">
      <header className="workspace-topbar">
        <div className="workspace-brand-group">
          <BrandMark compact />
          <span className="topbar-divider" />
          <div className="room-heading">
            <span className="room-overline">COLLABORATIVE ROOM</span>
            <h1>{room.name}</h1>
          </div>
        </div>
        <div className="topbar-actions">
          <div className={`connection-pill ${socketStatus === "Connected" ? "is-connected" : "is-disconnected"}`} role="status">
            <span className="connection-dot" />
            {socketError || socketStatus}
          </div>
          <div className="user-chip" title={`Joined as ${userName}`}>
            <span className="user-avatar">{initials || "U"}</span>
            <span className="user-chip-name">{userName}</span>
          </div>
          <button type="button" className="button-quiet invite-button" onClick={copyInviteLink}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="7" width="9" height="10" rx="2" /><path d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" /></svg>
            {copied ? "Copied" : "Invite"}
          </button>
        </div>
      </header>

      <main className="workspace-main">
        {error && <p className="workspace-error" role="alert">{error}</p>}
        <section className="workspace-intro">
          <div>
            <p className="eyebrow"><span className="eyebrow-line" /> YOUR SHARED WORKSPACE</p>
            <h2>Think in code.</h2>
            <p>Work through the problem together, one line at a time.</p>
          </div>
          <div className="workspace-room-chip"><span className="room-chip-icon">⌘</span><span>Private room link</span></div>
        </section>

        <section className="editor-panel" aria-label="Shared Java editor">
          <header className="editor-toolbar">
            <div className="file-tab">
              <span className="file-icon">J</span>
              <span>Main.java</span>
              <span className="file-dirty-dot" title="Shared document" />
            </div>
            <div className="editor-toolbar-right">
              <span className="language-tag">Java</span>
              <span className="editor-sync-label" aria-live="polite"><span className="sync-indicator" />{syncLabel}</span>
            </div>
          </header>
          <div className="code-editor-frame">
            <CodeEditor
              initialCode={initialState.code}
              startVersion={initialState.version}
              socket={socket}
              onSyncStatus={setSyncStatus}
              onEditorApi={setEditorApi}
              height="min(52vh, 520px)"
            />
          </div>
          <footer className="editor-statusbar">
            <span><span className="statusbar-mark">⌘</span> OT collaboration enabled</span>
            <span>UTF-8 <i /> Java</span>
          </footer>
        </section>

        <div className="execution-toolbar">
          <div className="execution-copy">
            <span className="execution-symbol" aria-hidden="true">▷</span>
            <div><strong>Run your code</strong><span>One execution at a time in this room.</span></div>
          </div>
          <div className="execution-actions">
            {activeExecution && (
              <span className="run-lock-status" aria-live="polite">
                {activeExecution.requestedBy} {activeExecution.status.toLowerCase()} the code
              </span>
            )}
            <button
              type="button"
              className="button-primary run-button"
              onClick={handleRun}
              disabled={!editorApi || socketStatus !== "Connected" || Boolean(activeExecution) || runPending}
            >
              {runPending || activeExecution?.status === "Running" ? (
                <><span className="button-spinner" aria-hidden="true" /> Running</>
              ) : activeExecution?.status === "Queued" ? "Preparing…" : (
                <><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 9 6-9 6V4Z" /></svg> Run Java</>
              )}
            </button>
          </div>
        </div>
        {runError && <p className="workspace-error run-error" role="alert">{runError}</p>}

        <section className="output-panel" aria-label="Execution output">
          <div className="output-heading">
            <div><span className="output-prompt">›_</span><h3>Console</h3></div>
            {executionResult && (
              <span className={`execution-status status-${executionResult.status.toLowerCase().replaceAll(" ", "-")}`}>
                <span />{executionResult.status}
              </span>
            )}
          </div>
          {executionResult ? (
            <div className="output-content" aria-live="polite">
              <p className="execution-meta">
                <span>Run by <strong>{executionResult.requestedBy}</strong></span>
                <span>Document v{executionResult.documentVersion}</span>
                {Number.isFinite(executionResult.executionTime) && <span>{executionResult.executionTime} ms</span>}
              </p>
              <div className="console-columns">
                <div className="console-stream"><h4>Standard output</h4><pre>{executionResult.stdout || "(no output)"}</pre></div>
                <div className="console-stream"><h4>Errors</h4><pre className="execution-stderr">{executionResult.stderr || "(no errors)"}</pre></div>
              </div>
              {executionResult.exitCode !== null && <p className="exit-code">Process exited with code {executionResult.exitCode}</p>}
            </div>
          ) : (
            <div className="output-content empty-output">
              <span className="empty-terminal-mark">$</span>
              <div><strong>Your output will appear here</strong><span>Run the shared Java document to see the result.</span></div>
            </div>
          )}
        </section>
        <footer className="workspace-footer"><span>CODE ROOM <i /> BUILT FOR SHARED THINKING</span><span>Room ID <code>{roomId.slice(0, 8)}</code></span></footer>
      </main>
    </div>
  );
}
