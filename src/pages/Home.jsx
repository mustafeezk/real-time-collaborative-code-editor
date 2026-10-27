
import "../css/link.css";
import { useState } from "react";

function Home() {
    const [formData, setFormData] = useState({
        username: "",
        roomName: "",
    });

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const handleChange = (e) => {
        const { name, value } = e.target;

        setFormData((prev) => ({
            ...prev,
            [name]: value,
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        setLoading(true);
        setError("");

        try {
            const response = await fetch(
                "/api/rooms",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        userName: formData.username,
                        roomName: formData.roomName,
                    }),
                }
            );

            const data = await response.json();

            if (!response.ok) {
                throw new Error(
                    data.message || "Failed to create room"
                );
            }

            console.log("Room created:", data);

            // Handle the successful response here.
            alert("Room created successfully!");
        } catch (err) {
            console.error("Error creating room:", err);
            setError(err.message || "Something went wrong");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="home-container">
            <form className="room-form" onSubmit={handleSubmit}>
                <div className="form-header">
                    <h2>Create a new room</h2>
                    <p>Start coding together in real time.</p>
                </div>

                <div className="form-group">
                    <label htmlFor="username">Display name</label>
                    <input
                        type="text"
                        name="username"
                        id="username"
                        placeholder="Enter your display name"
                        value={formData.username}
                        onChange={handleChange}
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
                </div>

                {error && <p role="alert">{error}</p>}

                <button
                    type="submit"
                    className="create-room-btn"
                    disabled={loading}
                >
                    {loading ? "Creating..." : "Create room"}
                    {!loading && (
                        <span aria-hidden="true"> →</span>
                    )}
                </button>

                <p className="form-footer">
                    Invite your teammates and start collaborating.
                </p>
            </form>
        </div>
    );
}

export default Home;
