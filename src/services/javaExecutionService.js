import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import process from "node:process";

const RUNNER_IMAGE = process.env.JAVA_RUNNER_IMAGE || "collab-java-runner:local";
const MAX_SOURCE_BYTES = 100_000;
const MAX_OUTPUT_BYTES = 64_000;
const EXECUTION_TIMEOUT_MS = 8_000;
const CONTAINER_STOP_GRACE_MS = 1_500;

function runDocker(args, options = {}) {
  return spawn("docker", args, {
    stdio: options.stdio || "ignore",
    windowsHide: true,
  });
}

function stopContainer(containerName) {
  try {
    const killer = runDocker(["kill", containerName]);
    killer.on("error", () => {});
  } catch {
    // The container may have exited between the timeout and cleanup.
  }
}

function cleanupContainer(containerName) {
  return new Promise((resolve) => {
    let settled = false;
    let cleanupTimer;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(cleanupTimer);
      resolve();
    };

    let cleanup;
    try {
      cleanup = runDocker(["rm", "--force", containerName]);
    } catch {
      finish();
      return;
    }
    cleanup.on("error", finish);
    cleanup.on("close", finish);
    cleanupTimer = setTimeout(() => {
      cleanup.kill();
      finish();
    }, 2_000).unref();
  });
}

function decodeOutput(chunks) {
  return Buffer.concat(chunks).toString("utf8");
}

export async function executeJava(source, executionId = randomUUID()) {
  if (typeof source !== "string") {
    throw new TypeError("Java source must be a string");
  }
  if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) {
    return {
      status: "Rejected",
      stdout: "",
      stderr: `Source code exceeds the ${MAX_SOURCE_BYTES}-byte limit.`,
      exitCode: null,
      executionTime: 0,
    };
  }

  const containerName = `collab-java-${executionId.replaceAll("-", "")}`;
  const startedAt = Date.now();
  const stdoutChunks = [];
  const stderrChunks = [];
  let outputBytes = 0;
  let outputLimitExceeded = false;
  let timedOut = false;
  let processError = null;

  const result = await new Promise((resolve) => {
    let child;
    let completed = false;
    let timeout;
    let forceClose;
    const finish = (exitCode, signal) => {
      if (completed) return;
      completed = true;
      clearTimeout(timeout);
      clearTimeout(forceClose);

      const stdout = decodeOutput(stdoutChunks);
      const stderr = decodeOutput(stderrChunks);
      const compileMarker = [...stderr.matchAll(/__JAVA_COMPILATION_FAILED__:(\d+)/g)].at(-1);
      const runtimeMarker = [...stderr.matchAll(/__JAVA_RUNTIME_EXIT__:(\d+)/g)].at(-1);
      const programExitCode = compileMarker
        ? Number(compileMarker[1])
        : runtimeMarker
          ? Number(runtimeMarker[1])
          : Number.isInteger(exitCode) ? exitCode : null;
      let status;
      if (timedOut) status = "Timed Out";
      else if (outputLimitExceeded) status = "Output Limit Exceeded";
      else if (compileMarker) status = "Compilation Error";
      else if (runtimeMarker) status = Number(runtimeMarker[1]) === 0
        ? "Completed"
        : "Runtime Error";
      else if (processError || (exitCode === null && signal)) status = "Infrastructure Error";
      else if (exitCode === 0) status = "Completed";
      else if (exitCode === 125 || exitCode === 126 || exitCode === 127) {
        status = "Infrastructure Error";
      } else status = "Runtime Error";

      resolve({
        status,
        stdout,
        stderr: stderr
          .replace(/__JAVA_COMPILATION_FAILED__:\d+\r?\n/g, "")
          .replace(/__JAVA_RUNTIME_EXIT__:\d+\r?\n/g, ""),
        exitCode: programExitCode,
        executionTime: Date.now() - startedAt,
        ...(processError ? { internalError: processError.message } : {}),
      });
    };

    const killForLimit = () => stopContainer(containerName);
    const capture = (chunks, chunk) => {
      const remaining = MAX_OUTPUT_BYTES - outputBytes;
      if (remaining > 0) {
        const accepted = chunk.subarray(0, remaining);
        chunks.push(accepted);
        outputBytes += accepted.length;
      }
      if (chunk.length > remaining && !outputLimitExceeded) {
        outputLimitExceeded = true;
        killForLimit();
      }
    };

    try {
      child = runDocker([
        "run", "--rm", "--interactive", "--name", containerName,
        "--network", "none",
        "--cpus", "0.5",
        "--memory", "192m",
        "--memory-swap", "192m",
        "--pids-limit", "32",
        "--read-only",
        "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges",
        "--user", "10001:10001",
        "--env", "HOME=/tmp",
        "--ulimit", "nofile=64:64",
        "--ulimit", "fsize=4194304:4194304",
        "--tmpfs", "/workspace:rw,noexec,nosuid,nodev,size=1m,uid=10001,gid=10001",
        "--tmpfs", "/tmp:rw,nosuid,nodev,size=64m,uid=10001,gid=10001",
        RUNNER_IMAGE,
      ], { stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      processError = error;
      finish(null, null);
      return;
    }

    child.stdout.on("data", (chunk) => capture(stdoutChunks, chunk));
    child.stderr.on("data", (chunk) => capture(stderrChunks, chunk));
    child.on("error", (error) => {
      processError = error;
      finish(null, null);
    });
    child.on("close", (code, signal) => finish(code, signal));

    timeout = setTimeout(() => {
      timedOut = true;
      killForLimit();
    }, EXECUTION_TIMEOUT_MS);
    forceClose = setTimeout(() => {
      if (!completed) child.kill();
    }, EXECUTION_TIMEOUT_MS + CONTAINER_STOP_GRACE_MS);
    timeout.unref();
    forceClose.unref();

    child.stdin.on("error", () => {});
    child.stdin.end(source);
  });

  await cleanupContainer(containerName);
  return result;
}
