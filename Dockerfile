FROM node:22-bookworm-slim AS build

WORKDIR /src
COPY package.json package-lock.json ./
COPY packages ./packages

RUN npm ci --ignore-scripts
RUN mkdir -p plugins/mdflow/server
RUN npm run plugin:build

FROM node:22-bookworm-slim

LABEL io.modelcontextprotocol.server.name="io.github.yubinbin32-ops/mdflow"
LABEL org.opencontainers.image.source="https://github.com/yubinbin32-ops/Mdflow-Canvas"
LABEL org.opencontainers.image.description="Context OS for AI coding agents: task-scoped context, AST code streams, verified mutation, and rollback."

WORKDIR /workspace
COPY --from=build /src/plugins/mdflow/server/mdflow-mcp.mjs /opt/mdflow/mdflow-mcp.mjs

ENV MDFLOW_PROJECT_ROOT=/workspace

ENTRYPOINT ["node", "/opt/mdflow/mdflow-mcp.mjs"]
