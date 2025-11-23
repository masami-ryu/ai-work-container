FROM mcr.microsoft.com/vscode/devcontainers/base:ubuntu

ENV DEBIAN_FRONTEND=noninteractive

# Install basic packages required for anyenv/nodenv and node-build
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    curl \
    git \
    build-essential \
    libssl-dev \
    libreadline-dev \
    zlib1g-dev \
    ca-certificates \
    wget \
    locales \
  && locale-gen en_US.UTF-8 \
  && rm -rf /var/lib/apt/lists/*

# anyenv will be installed into /home/vscode/.anyenv by the post-create script
ENV ANYENV_ROOT="/home/vscode/.anyenv"
ENV NODENV_ROOT="/home/vscode/.nodenv"

# Ensure vscode user exists (provided by base image) and user has home
ARG USERNAME=vscode
ARG USER_UID=1000
ARG USER_GID=1000

USER root

# Give vscode user ownership for anyenv paths just in case
RUN mkdir -p /home/vscode && chown -R ${USERNAME}:${USERNAME} /home/vscode

USER ${USERNAME}

ENV PATH="$NODENV_ROOT/bin:$NODENV_ROOT/shims:$PATH"

## Copy post-create script into image (path simplified so it works whether build context is repo root or .devcontainer)
COPY post-create.sh /usr/local/bin/devcontainer-post-create.sh
USER root
RUN chmod +x /usr/local/bin/devcontainer-post-create.sh \
  && chown ${USERNAME}:${USERNAME} /usr/local/bin/devcontainer-post-create.sh
USER ${USERNAME}

CMD ["sleep", "infinity"]
