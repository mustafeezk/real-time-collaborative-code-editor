FROM eclipse-temurin:21-jdk-jammy

RUN useradd --system --uid 10001 --home-dir /home/runner --create-home runner \
    && mkdir -p /workspace /tmp/java-classes \
    && chown -R runner:runner /workspace /tmp/java-classes

COPY run-java.sh /usr/local/bin/run-java
RUN chmod 0555 /usr/local/bin/run-java

USER 10001:10001
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/run-java"]
