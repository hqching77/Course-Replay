# Course Replay API — production image (used by render.yaml and deploy/docker-compose.yml).
# Contains no secrets: everything sensitive is passed in as environment variables at run time.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# LibreOffice turns uploaded PPT / Word files into pages; Noto CJK makes Chinese text render.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 python3-venv ca-certificates \
      libreoffice-impress libreoffice-writer fonts-noto-cjk \
 && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app
# Install exactly the versions pinned in uv.lock (the ones the tests run against), hash-checked.
COPY pyproject.toml uv.lock ./
RUN pip install uv \
 && uv export --frozen --no-emit-project --extra postgres -o /tmp/requirements.txt \
 && pip install -r /tmp/requirements.txt \
 && pip uninstall -y uv \
 && rm /tmp/requirements.txt
COPY app ./app

# Run unprivileged. Uploaded files (and the SQLite file, if you use SQLite) live in /app/data.
RUN useradd --create-home --uid 10001 app && mkdir -p /app/data && chown app /app/data
USER app
ENV HOME=/home/app \
    APP_ENV=production

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python3 -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/api/health' % os.environ.get('PORT', '8000'), timeout=4)"
# Render sets $PORT; elsewhere it defaults to 8000.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
