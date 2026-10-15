# aimarket node: speaks the federation protocol for the seller node (docs/operator-guide.md, step 7).
FROM python:3.12-slim
RUN pip install --no-cache-dir "aimarket-hub==3.15.27"
WORKDIR /node
# aimarket keeps its signing key and state in ./data: a volume in compose, owned by the image's user.
RUN mkdir -p /node/data && chown -R 1000:1000 /node
USER 1000
EXPOSE 9090
CMD ["aimarket", "node", "serve", "--config", "/node/node.toml", "--host", "0.0.0.0", "--port", "9090"]
