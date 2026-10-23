FROM oven/bun:1 AS base
WORKDIR /app

# Install system deps + Foundry
RUN apt-get update && apt-get install -y curl git && rm -rf /var/lib/apt/lists/*
RUN curl -L https://foundry.paradigm.xyz | bash
ENV PATH="/root/.foundry/bin:$PATH"
RUN foundryup

# Install dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Copy source
COPY . .

# Build frontend
RUN bun run build

# Expose port (HF Spaces uses 7860)
ENV PORT=7860
EXPOSE 7860

# Start server (serves both API and static frontend)
CMD ["bun", "run", "start"]
