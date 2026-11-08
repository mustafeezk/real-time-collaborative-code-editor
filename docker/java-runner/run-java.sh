#!/bin/sh

if ! cat > /workspace/Main.java; then
  echo "Could not read Java source" >&2
  exit 1
fi

mkdir -p /tmp/java-classes
javac -J-Xmx64m -d /tmp/java-classes /workspace/Main.java
compile_status=$?

if [ "$compile_status" -ne 0 ]; then
  echo "__JAVA_COMPILATION_FAILED__:$compile_status" >&2
  exit 100
fi

java -Xmx64m -XX:ActiveProcessorCount=1 -cp /tmp/java-classes Main
runtime_status=$?
echo "__JAVA_RUNTIME_EXIT__:$runtime_status" >&2
exit 0
