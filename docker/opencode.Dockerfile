FROM node:22-bookworm
WORKDIR /plugin
RUN npm install -g bun@1.3.6 opencode-ai@1.18.18
COPY package.json bun.lock ./
RUN bun install --ignore-scripts
COPY src src
COPY skills skills
COPY templates templates
COPY standards standards
RUN bun run build
RUN mkdir -p /root/.config/opencode && printf '{"$schema":"https://opencode.ai/config.json","model":"deepseek/deepseek-v4-flash","plugin":["file:///plugin/dist/index.js"]}\n' > /root/.config/opencode/opencode.json
COPY requirements-manager/docker/opencode-entrypoint.sh /usr/local/bin/opencode-entrypoint
RUN chmod +x /usr/local/bin/opencode-entrypoint
WORKDIR /data/projects
ENTRYPOINT ["/usr/local/bin/opencode-entrypoint"]
