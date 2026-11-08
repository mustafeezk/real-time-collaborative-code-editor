import BrandMark from "./BrandMark";

export default function JoinRoom({
  roomName,
  userName,
  onNameChange,
  onJoin,
  joining,
  error,
}) {
  return (
    <main className="state-page join-page">
      <div className="join-card">
        <BrandMark compact />
        <div className="join-room-icon" aria-hidden="true">⌘</div>
        <p className="eyebrow"><span className="eyebrow-line" /> YOU’RE INVITED</p>
        <h1>Join the room</h1>
        <p className="join-description">You’re joining <strong>{roomName}</strong>. Add your name so your teammates know you’re here.</p>
        <form className="join-form" onSubmit={onJoin}>
          <label htmlFor="join-name">Your name</label>
          <input
            id="join-name"
            name="userName"
            value={userName}
            onChange={(event) => onNameChange(event.target.value)}
            autoComplete="name"
            maxLength={100}
            placeholder="Enter your display name"
            required
          />
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button-primary join-submit" type="submit" disabled={joining}>
            {joining ? <><span className="button-spinner" aria-hidden="true" /> Joining room…</> : <>Continue to room <span aria-hidden="true">→</span></>}
          </button>
        </form>
        <p className="join-footnote"><span className="status-dot" /> Your name is visible to people in this room.</p>
      </div>
    </main>
  );
}
