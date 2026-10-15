# Your own AIMarket hub, in place of the federation node (docs/<lang>/own-hub.md): a whole hub on your
# domain that lists your eSIM offers itself, keeps its own catalogue and search, speaks MCP and A2A,
# and federates with other hubs. Started with the "hub" profile instead of "federation".
#
# 3.15.27 or later: 3.15.26 refuses an esim.quote answer as "PII" (the catalogue's byte counts look
# like an ID number). 3.15.28 also publishes your seller key in the hub's manifest, so other hubs
# count your buyers' signed receipts; move the pin up when it is on PyPI. HUB_PACKAGE (and a wheel
# in hub/wheels/) lets you build a version that is not on PyPI yet.
FROM python:3.12-slim
ARG HUB_PACKAGE="aimarket-hub[pqc]==3.15.27"
COPY wheels/ /wheels/
RUN pip install --no-cache-dir --find-links /wheels "${HUB_PACKAGE}" && rm -rf /wheels
WORKDIR /hub
# The hub keeps its settings (aimarket.env), database and signing keys in ./data: a volume in compose.
RUN mkdir -p /hub/data && chown -R 1000:1000 /hub
USER 1000
ENV HOME=/hub
EXPOSE 9083
ENTRYPOINT ["aimarket"]
CMD ["serve"]
