export default function JoinRoom({
  roomName,
  userName,
  onNameChange,
  onJoin,
  joining,
  error,
}) {
  return (
    <main className="editor-page">
      <h2>Join {roomName}</h2>
      <form onSubmit={onJoin}>
        <label htmlFor="join-name">Display name</label>
        <input
          id="join-name"
          name="userName"
          value={userName}
          onChange={(event) => onNameChange(event.target.value)}
          autoComplete="name"
          maxLength={100}
          required
        />
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={joining}>
          {joining ? "Joining..." : "Join room"}
        </button>
      </form>
    </main>
  );
}
