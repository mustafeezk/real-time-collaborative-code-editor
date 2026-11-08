import { useState } from "react";
import BrandMark from "../components/BrandMark";
import "../css/link.css";

function Home() {
  const [formData, setFormData] = useState({ username: "", roomName: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((previous) => ({ ...previous, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userName: formData.username,
          roomName: formData.roomName,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Failed to create room");

      sessionStorage.setItem(`joinedRoom:${data.room.id}`, formData.username.trim());
      window.location.assign(data.shareUrl);
    } catch (requestError) {
      console.error("Error creating room:", requestError);
      setError(requestError.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="home-container">
      <header className="home-nav">
        <BrandMark />
        <div className="nav-note"><span className="status-dot" /> Built for focused collaboration</div>
      </header>

      <div className="home-layout">
        <section className="home-intro">
          <p className="eyebrow"><span className="eyebrow-line" /> REAL-TIME JAVA COLLABORATION</p>
          <h1>Good ideas<br />get better <span>together.</span></h1>
          <p className="home-lede">
            A shared space to think, write, and run Java code with your team — wherever you are.
          </p>

          <div className="feature-list">
            <div className="feature-item">
              <span className="feature-icon" aria-hidden="true">↗</span>
              <div><strong>One shared editor</strong><span>Changes stay in sync as you work.</span></div>
            </div>
            <div className="feature-item">
              <span className="feature-icon feature-code" aria-hidden="true">{"{ }"}</span>
              <div><strong>Run in isolation</strong><span>Execute Java safely in a container.</span></div>
            </div>
            <div className="feature-item">
              <span className="feature-icon" aria-hidden="true">⌁</span>
              <div><strong>Share with a link</strong><span>Bring your collaborators into the room.</span></div>
            </div>
          </div>
        </section>

        <form className="room-form" onSubmit={handleSubmit}>
          <div className="form-kicker"><span className="form-kicker-icon">✳</span> YOUR NEXT SESSION</div>
          <div className="form-header">
            <h2>Create a room</h2>
            <p>Set up a space and invite your team when you’re ready.</p>
          </div>

          <div className="form-group">
            <label htmlFor="username">Your name</label>
            <input
              type="text"
              name="username"
              id="username"
              placeholder="How should teammates find you?"
              value={formData.username}
              onChange={handleChange}
              autoComplete="name"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="roomName">Room name</label>
            <input
              type="text"
              name="roomName"
              id="roomName"
              placeholder="e.g. java-practice"
              value={formData.roomName}
              onChange={handleChange}
              required
            />
            <span className="input-hint">Choose a name your team will recognize.</span>
          </div>

          {error && <p className="form-error" role="alert">{error}</p>}

          <button type="submit" className="button-primary create-room-btn" disabled={loading}>
            {loading ? "Creating your room…" : "Create room"}
            {!loading && <span aria-hidden="true">→</span>}
          </button>
          <p className="form-footer"><span className="privacy-mark">●</span> Your room is ready to share as soon as it’s created.</p>
        </form>
      </div>

      <footer className="home-footer">
        <span>Think clearly. Build together.</span>
        <span>Made for teams who learn by doing.</span>
      </footer>
    </main>
  );
}

export default Home;
