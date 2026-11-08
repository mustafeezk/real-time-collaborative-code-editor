# Java execution image

Build the runner image from the project root:

```sh
npm run docker:build:java
```

The backend expects the local image name `collab-java-runner:local`. Set
`JAVA_RUNNER_IMAGE` in the backend environment only if you build the same
runner under a different name. The frontend never receives Docker access.

Each run starts a fresh container. The source is sent over the container's
stdin and stored in its private `/workspace` tmpfs; compiled classes go into
its private `/tmp` tmpfs. Docker removes the container after exit, and the
backend also issues a best-effort forced removal during cleanup.

The backend applies CPU, memory, swap, process, file-size, and wall-clock
limits. The container has no network, a read-only root filesystem, no Linux
capabilities, and runs as UID 10001. Its only writable paths are bounded
tmpfs mounts. Standard output and standard error are capped together at
64,000 bytes; source is capped at 100,000 bytes.

The service uses the Docker CLI on the backend host, so Docker Engine must be
installed and running where Express runs. The runner image must be built on
that Docker host before code can be executed.
