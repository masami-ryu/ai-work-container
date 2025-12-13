FROM mcr.microsoft.com/vscode/devcontainers/base:ubuntu

ENV DEBIAN_FRONTEND=noninteractive

# anyenv/nodenv と node-build に必要な基本パッケージをインストール
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

# anyenv と nodenv のルートディレクトリ設定
# 実際のインストールは post-create スクリプトで実行
ENV ANYENV_ROOT="/home/vscode/.anyenv"
ENV NODENV_ROOT="/home/vscode/.nodenv"

ARG USERNAME=vscode

# ホームディレクトリの作成(権限設定は post-create.sh で実施)
USER root
RUN mkdir -p /home/vscode

# nodenv を PATH に追加
USER ${USERNAME}
ENV PATH="$NODENV_ROOT/bin:$NODENV_ROOT/shims:$PATH"

# post-create スクリプトをコンテナにコピーして実行権限を付与
COPY post-create.sh /usr/local/bin/devcontainer-post-create.sh
USER root
RUN chmod +x /usr/local/bin/devcontainer-post-create.sh \
  && chown vscode:vscode /usr/local/bin/devcontainer-post-create.sh

USER ${USERNAME}
CMD ["sleep", "infinity"]
