import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

export default function useRoomSocket({
  roomId,
  userName,
  enabled,
}) {
  const initialStateRef = useRef(null);
  const [socket, setSocket] = useState(null);
  const [initialState, setInitialState] = useState(null);
  const [status, setStatus] = useState("Disconnected");
  const [error, setError] = useState("");
  const [activeExecution, setActiveExecution] = useState(null);
  const [executionResult, setExecutionResult] = useState(null);

  useEffect(() => {
    if (!enabled || !roomId || !userName) return undefined;

    initialStateRef.current = null;
    const roomSocket = io();

    roomSocket.on("connect", () => {
      setStatus("Joining room…");
      roomSocket.emit("room:join", { roomId, userName }, (result) => {
        if (!result?.ok) {
          setStatus("Not connected");
          setError(result?.message || "Could not join room");
          return;
        }

        if (!initialStateRef.current) {
          const state = {
            roomId,
            userName,
            code: result.code,
            version: result.version,
          };
          initialStateRef.current = state;
          setInitialState(state);
        }
        setSocket(roomSocket);
        setActiveExecution(result.activeExecution || null);
        setExecutionResult(result.latestExecutionResult || null);
        setError("");
        setStatus("Connected");
      });
    });

    roomSocket.on("room:joined", () => {
      setStatus("Connected");
      setError("");
    });

    roomSocket.on("room:save-error", ({ message }) => {
      setStatus("Not saved");
      setError(message || "Could not save room updates");
    });

    roomSocket.on("code:execution-status", (execution) => {
      if (execution?.roomId !== roomId) return;
      setActiveExecution(execution);
    });

    roomSocket.on("code:execution-result", (result, acknowledge = () => {}) => {
      if (result?.roomId !== roomId) {
        acknowledge({ displayed: false });
        return;
      }
      setExecutionResult(result);
      window.requestAnimationFrame(() => acknowledge({ displayed: true }));
    });

    roomSocket.on("code:execution-unlocked", ({ roomId: unlockedRoomId, executionId }) => {
      if (unlockedRoomId !== roomId) return;
      setActiveExecution((current) => (
        current?.executionId === executionId ? null : current
      ));
    });

    roomSocket.on("connect_error", () => {
      setStatus("Not connected");
      setError("Could not connect to the collaboration server");
    });

    roomSocket.on("disconnect", () => {
      setStatus("Reconnecting…");
      setError("Connection lost; trying to reconnect");
    });

    return () => {
      roomSocket.disconnect();
    };
  }, [enabled, roomId, userName]);

  const activeInitialState = initialState?.roomId === roomId
    && initialState?.userName === userName
    ? initialState
    : null;

  return {
    socket,
    initialState: activeInitialState,
    activeExecution: activeExecution?.roomId === roomId ? activeExecution : null,
    executionResult: executionResult?.roomId === roomId ? executionResult : null,
    status: enabled ? status : "Disconnected",
    error,
  };
}
