# aimarket node: speaks the federation protocol for the seller node (docs/operator-guide.md, step 7).
FROM python:3.12-slim
RUN pip install --no-cache-dir "aimarket-hub==3.15.26"
WORKDIR /node
USER 1000
EXPOSE 9090
CMD ["aimarket", "node", "serve", "--config", "/node/node.toml", "--host", "0.0.0.0", "--port", "9090"]
