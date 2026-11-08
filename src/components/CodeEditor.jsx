
import { useEffect, useRef } from "react";
import { collab, getSyncedVersion, receiveUpdates, sendableUpdates } from "@codemirror/collab";
import { ChangeSet, EditorState } from "@codemirror/state";
import { java } from "@codemirror/lang-java";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { oneDark } from "@codemirror/theme-one-dark";

function decodeUpdates(updates) {
  return updates.map((update) => ({
    clientID: update.clientID,
    changes: ChangeSet.fromJSON(update.changes),
  }));
}

function createCollaborationPlugin(socket, onSyncStatus) {
  return ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view;
      this.pushing = false;
      this.needsPush = false;
      this.syncing = false;
      this.pushTimer = null;
      this.destroyed = false;
      this.snapshotWaiters = [];
      this.onUpdates = (batch) => this.applyBatch(batch);
      this.onRoomJoined = () => this.sync();
      socket.on("room:updates", this.onUpdates);
      socket.on("room:joined", this.onRoomJoined);
      this.sync();
    }

    update(update) {
      if (update.docChanged) this.schedulePush();
    }

    schedulePush() {
      if (!sendableUpdates(this.view.state).length) return;
      if (this.pushing) {
        this.needsPush = true;
        return;
      }

      clearTimeout(this.pushTimer);
      this.pushTimer = setTimeout(() => this.push(), 30);
    }

    flushAndGetSnapshot() {
      return new Promise((resolve, reject) => {
        if (this.destroyed) {
          reject(new Error("The editor is no longer available"));
          return;
        }
        if (!socket.connected) {
          reject(new Error("Reconnect to the room before running code"));
          return;
        }
        this.snapshotWaiters.push({ resolve, reject });
        clearTimeout(this.pushTimer);
        if (sendableUpdates(this.view.state).length) this.push();
        else this.resolveSnapshotWaiters();
      });
    }

    resolveSnapshotWaiters() {
      if (
        this.destroyed || this.pushing || this.syncing ||
        sendableUpdates(this.view.state).length > 0
      ) return;
      const snapshot = {
        code: this.view.state.doc.toString(),
        documentVersion: getSyncedVersion(this.view.state),
      };
      this.snapshotWaiters.splice(0).forEach(({ resolve }) => resolve(snapshot));
    }

    rejectSnapshotWaiters(error) {
      this.snapshotWaiters.splice(0).forEach(({ reject }) => reject(error));
    }

    push() {
      if (this.destroyed || !socket.connected) {
        onSyncStatus("Waiting for connection");
        this.rejectSnapshotWaiters(new Error("Connection lost before edits were synced"));
        return;
      }

      const updates = sendableUpdates(this.view.state);
      if (!updates.length) {
        this.resolveSnapshotWaiters();
        return;
      }

      this.pushing = true;
      this.needsPush = false;
      onSyncStatus("Syncing edits…");
      socket.emit(
        "room:push",
        {
          version: getSyncedVersion(this.view.state),
          updates: updates.map((update) => ({
            clientID: update.clientID,
            changes: update.changes.toJSON(),
          })),
        },
        (result) => {
          this.pushing = false;
          if (this.destroyed) return;
          if (!result?.ok) {
            const message = result?.message || "Could not sync edits";
            onSyncStatus(message);
            this.rejectSnapshotWaiters(new Error(message));
            if (result?.syncRequired) this.sync();
            return;
          }

          this.applyBatch(result);
          if (this.needsPush || sendableUpdates(this.view.state).length) {
            clearTimeout(this.pushTimer);
            this.push();
          } else {
            this.resolveSnapshotWaiters();
          }
        }
      );
    }

    applyBatch(batch) {
      if (this.destroyed || batch?.baseVersion === undefined) return;
      const currentVersion = getSyncedVersion(this.view.state);
      if (batch.baseVersion !== currentVersion) {
        this.sync();
        return;
      }

      if (batch.updates?.length) {
        this.view.dispatch(
          receiveUpdates(this.view.state, decodeUpdates(batch.updates))
        );
      }
      onSyncStatus("Synced");
      this.schedulePush();
      this.resolveSnapshotWaiters();
    }

    sync() {
      if (this.destroyed || !socket.connected) return;
      this.syncing = true;
      const version = getSyncedVersion(this.view.state);
      socket.emit("room:sync", { version }, (result) => {
        this.syncing = false;
        if (this.destroyed) return;
        if (!result?.ok) {
          const message = result?.message || "Could not sync room";
          onSyncStatus(message);
          this.rejectSnapshotWaiters(new Error(message));
          return;
        }
        if (result.baseVersion !== getSyncedVersion(this.view.state)) {
          this.sync();
          return;
        }
        this.applyBatch(result);
        this.resolveSnapshotWaiters();
      });
    }

    destroy() {
      this.destroyed = true;
      clearTimeout(this.pushTimer);
      this.rejectSnapshotWaiters(new Error("The editor was closed"));
      socket.off("room:updates", this.onUpdates);
      socket.off("room:joined", this.onRoomJoined);
    }
  });
}

export default function CodeEditor({
  initialCode,
  startVersion,
  socket,
  onSyncStatus,
  onEditorApi,
  height = "400px",
}) {
  const hostRef = useRef(null);

  useEffect(() => {
    if (!hostRef.current || !socket) return undefined;

    const clientID = globalThis.crypto?.randomUUID?.()
      || `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const collaborationExtension = createCollaborationPlugin(socket, onSyncStatus);
    const editorState = EditorState.create({
      doc: initialCode,
      extensions: [
        basicSetup,
        java(),
        oneDark,
        collab({ startVersion, clientID }),
        collaborationExtension,
        EditorView.theme({
          "&": { height },
          ".cm-scroller": { overflow: "auto" },
        }),
      ],
    });
    const view = new EditorView({ state: editorState, parent: hostRef.current });
    const collaboration = view.plugin(collaborationExtension);
    onEditorApi({ flushAndGetSnapshot: () => collaboration.flushAndGetSnapshot() });

    return () => {
      onEditorApi(null);
      view.destroy();
    };
  }, [height, initialCode, onEditorApi, onSyncStatus, socket, startVersion]);

  return <div className="code-editor" ref={hostRef} />;
}
