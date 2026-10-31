import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

export default function useRoomSocket({
  roomId,
  userName,
  enabled,
  onRemoteCode,
}) {
  const socketRef = useRef(null);
  const versionRef = useRef(0);
  const latestCodeRef = useRef("");
  const hasPendingChangesRef = useRef(false);
  const [status, setStatus] = useState("Disconnected");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!enabled || !roomId || !userName) {
      setStatus("Disconnected");
      return undefined;
    }

    const socket = io();
    socketRef.current = socket;

    function sendPendingCode() {
      socket.emit(
        "room:code",
        { code: latestCodeRef.current, version: versionRef.current },
        (result) => {
          if (result?.ok) {
            setStatus("Saving…");
            setError("");
          } else {
            setStatus("Not saved");
            setError(result?.message || "Could not send code to the room");
          }
        }
      );
    }

    socket.on("connect", () => {
      setStatus("Joining room…");
      socket.emit("room:join", { roomId, userName }, (result) => {
        if (!result?.ok) {
          setStatus("Not connected");
          setError(result?.message || "Could not join room");
          return;
        }

        setError("");
        if (hasPendingChangesRef.current) {
          setStatus("Saving…");
          sendPendingCode();
          return;
        }

        latestCodeRef.current = result.code;
        onRemoteCode(result.code);
        setStatus("Connected");
      });
    });

    socket.on("room:code", ({ code }) => {
      latestCodeRef.current = code;
      hasPendingChangesRef.current = false;
      onRemoteCode(code);
      setStatus("Connected");
      setError("");
    });

    socket.on("room:saved", ({ sourceSocketId, version }) => {
      if (sourceSocketId !== socket.id || version !== versionRef.current) return;
      hasPendingChangesRef.current = false;
      setStatus("Saved");
      setError("");
    });

    socket.on("room:save-error", ({ message }) => {
      setStatus("Not saved");
      setError(message || "Could not save room code");
    });

    socket.on("disconnect", () => {
      setStatus("Reconnecting…");
      setError("Connection lost; trying to reconnect");
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [enabled, onRemoteCode, roomId, userName]);

  const sendCode = useCallback((code) => {
    if (code === latestCodeRef.current) return;

    latestCodeRef.current = code;
    versionRef.current += 1;
    hasPendingChangesRef.current = true;
    setStatus("Sending…");
    setError("");

    const socket = socketRef.current;
    if (!socket?.connected) {
      setStatus("Waiting for connection");
      setError("Changes will sync when the room reconnects");
      return;
    }

    socket.emit(
      "room:code",
      { code, version: versionRef.current },
      (result) => {
        if (result?.ok) {
          setStatus("Saving…");
          setError("");
        } else {
          setStatus("Not saved");
          setError(result?.message || "Could not send code to the room");
        }
      }
    );
  }, []);

  return { sendCode, status, error };
}
